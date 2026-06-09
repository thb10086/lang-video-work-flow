"""Backend Agent Runtime — SSE + reverse-RPC routes.

These endpoints back the new thin-client architecture:

  POST   /api/agent/sessions                              create a session, return id
  GET    /api/agent/sessions/{id}/events                  SSE stream (supports Last-Event-ID)
  POST   /api/agent/sessions/{id}/cancel                  abort an in-flight session
  POST   /api/agent/sessions/{id}/resume                  resume a paused session
  POST   /api/agent/sessions/{id}/client-tool-result      reverse RPC: client → server
  POST   /api/agent/sessions/{id}/approval/{call_id}      user approval decision
  GET    /api/agent/sessions/{id}/events?transport=poll   long-polling fallback

Design notes:
  - SSE pipe carries every wire event; client events go via reverse RPC.
  - Pending client-tool calls + approvals live in a process-local registry
    keyed by `(session_id, call_id)`. Each entry holds an `asyncio.Future`
    that the runtime awaits while the user/client decides.
  - All endpoints scope by `user_id` (DEFAULT_USER_ID for now, real auth
    later). The session row enforces ownership.
  - This file is intentionally thin — heavy lifting is in `runtime.py`
    and `streaming.py`.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Header, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.runtime import RuntimeConfig, run_session
from app.agents.streaming import EventEmitter, format_sse, replay_events
from app.config import settings
from app.db.session import async_session_factory, get_db
from app.models.agent import AgentSession

logger = logging.getLogger("prism.agent.runtime_router")

router = APIRouter(prefix="/api/agent", tags=["agent-runtime"])

DEFAULT_USER_ID = 1  # single-tenant placeholder; replaced when auth lands


# ============================================================
# Process-local registries
# ============================================================
# These are intentionally process-local. In a multi-replica deployment
# we'll need a Redis pubsub layer or sticky sessions; for the current
# single-replica setup this is sufficient and avoids extra infra.

_active_emitters: dict[int, EventEmitter] = {}
"""session_id → EventEmitter for currently-streaming SSE connections."""

_pending_client_tools: dict[tuple[int, str], asyncio.Future[dict[str, Any]]] = {}
"""(session_id, call_id) → Future that resolves when client POSTs result."""

_pending_approvals: dict[tuple[int, str], asyncio.Future[dict[str, Any]]] = {}
"""(session_id, call_id) → Future that resolves when user approves/denies."""


def register_client_tool_call(session_id: int, call_id: str) -> asyncio.Future[dict[str, Any]]:
    """Allocate a Future for a pending client tool call. Runtime awaits it."""
    fut: asyncio.Future[dict[str, Any]] = asyncio.get_event_loop().create_future()
    _pending_client_tools[(session_id, call_id)] = fut
    return fut


def register_approval(session_id: int, call_id: str) -> asyncio.Future[dict[str, Any]]:
    """Allocate a Future for a pending user approval. Runtime awaits it."""
    fut: asyncio.Future[dict[str, Any]] = asyncio.get_event_loop().create_future()
    _pending_approvals[(session_id, call_id)] = fut
    return fut


# ============================================================
# Schemas
# ============================================================

class CreateSessionRequest(BaseModel):
    message: str = Field(..., description="User input message")
    images: list[str] = Field(default_factory=list, description="data-URL image array")
    role: str = Field(default="assistant", description="Agent role id")
    model: str = Field(default="", description="LLM model id; empty = default")
    project_id: int | None = Field(default=None, description="Optional project scoping")


class CreateSessionResponse(BaseModel):
    session_id: int


class ClientToolResultBody(BaseModel):
    call_id: str
    ok: bool
    data: Any | None = None
    error: str | None = None


class ApprovalDecisionBody(BaseModel):
    approved: bool
    reason: str | None = None


# ============================================================
# Endpoints
# ============================================================

@router.post("/sessions", response_model=CreateSessionResponse)
async def create_session(
    body: CreateSessionRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> CreateSessionResponse:
    """Create a new agent session. Returns the session id; the client then
    subscribes to `/sessions/{id}/events` to receive the streamed run.

    The actual runtime kicks off as a background task so this endpoint
    returns quickly. The SSE consumer doesn't need to be connected when the
    run starts — events are persisted and replayable.
    """
    session = AgentSession(
        user_id=DEFAULT_USER_ID,
        project_id=body.project_id,
        role_id=body.role,
        model=body.model or settings.DEFAULT_LLM_MODEL,
        status="running",
        phase="idle",
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    # Capture id BEFORE scheduling (the session object is bound to the
    # request-scoped DB; the background task uses its own session).
    session_id = session.id

    config = RuntimeConfig(
        user_message=body.message,
        user_images=body.images,
        role=body.role,
        model=body.model or settings.DEFAULT_LLM_MODEL,
    )

    background_tasks.add_task(_drive_session, session_id, config)
    return CreateSessionResponse(session_id=session_id)


async def _drive_session(session_id: int, config: RuntimeConfig) -> None:
    """Run a session in a background task with its own DB session.

    The emitter is registered in `_active_emitters` so concurrent SSE
    connections can attach. After the runtime closes the emitter, we drop
    the registry entry.
    """
    async with async_session_factory() as db:
        session = await db.get(AgentSession, session_id)
        if session is None:
            logger.error("Session %s vanished before driving", session_id)
            return
        emitter = EventEmitter(session_id=session_id, db=db)
        _active_emitters[session_id] = emitter
        try:
            await run_session(session=session, config=config, emitter=emitter, db=db)
        except Exception:
            logger.exception("Drive failure session=%s", session_id)
            try:
                await emitter.close()
            except Exception:
                pass
        finally:
            _active_emitters.pop(session_id, None)


@router.get("/sessions/{session_id}/events")
async def stream_events(
    session_id: int,
    request: Request,
    transport: str = Query("sse", description="sse | poll"),
    after_seq: int = Query(0, description="poll-mode cursor"),
    last_event_id: str | None = Header(None, alias="Last-Event-ID"),
    db: AsyncSession = Depends(get_db),
):
    """Stream Agent events for a session.

    SSE mode (default): live + replay missed (per Last-Event-ID header).
    Poll mode: returns a JSON array of events with seq > after_seq, plus
               next_cursor; client polls again until done.
    """
    session = await db.get(AgentSession, session_id)
    if session is None or session.user_id != DEFAULT_USER_ID:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")

    last_seq = 0
    if last_event_id:
        try:
            last_seq = int(last_event_id)
        except ValueError:
            last_seq = 0

    if transport == "poll":
        events = await replay_events(db, session_id, after_seq=after_seq)
        next_cursor = events[-1]["seq"] if events else after_seq
        return JSONResponse(
            content={
                "events": events,
                "next_cursor": next_cursor,
                "done": session.status in ("completed", "aborted", "error"),
            }
        )

    # ── SSE mode ──
    async def event_stream():
        # 1) Replay any missed events first.
        if last_seq > 0:
            replayed = await replay_events(db, session_id, after_seq=last_seq)
            for ev in replayed:
                yield format_sse(ev)

        # 2) Attach to the live emitter if the session is still running.
        emitter = _active_emitters.get(session_id)
        if emitter is None:
            # Session already finished — replay everything from after the
            # last seq the client saw (handled above) then close.
            return
        async for ev in emitter.stream():
            if await request.is_disconnected():
                return
            yield format_sse(ev)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable nginx buffering
        },
    )


@router.post("/sessions/{session_id}/cancel")
async def cancel_session(session_id: int, db: AsyncSession = Depends(get_db)):
    """Abort an in-flight session. Closes the emitter (sends `done`)."""
    session = await db.get(AgentSession, session_id)
    if session is None or session.user_id != DEFAULT_USER_ID:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")
    if session.status in ("completed", "aborted", "error"):
        return {"ok": True, "already_terminal": True, "status": session.status}

    session.status = "aborted"
    await db.commit()

    emitter = _active_emitters.get(session_id)
    if emitter is not None:
        await emitter.emit(
            "final",
            text="",
            stop_reason="user_cancelled",
            tool_calls_summary=[],
        )
        await emitter.emit("done")
        await emitter.close()

    # Cancel any pending Futures so the runtime unblocks.
    _cancel_pending(session_id)

    return {"ok": True, "status": session.status}


@router.post("/sessions/{session_id}/client-tool-result")
async def client_tool_result(
    session_id: int,
    body: ClientToolResultBody,
    db: AsyncSession = Depends(get_db),
):
    """Receive the result of a client-side tool call. Resolves the awaiting
    Future inside the runtime so the StateGraph can continue."""
    session = await db.get(AgentSession, session_id)
    if session is None or session.user_id != DEFAULT_USER_ID:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")

    key = (session_id, body.call_id)
    fut = _pending_client_tools.pop(key, None)
    if fut is None:
        raise HTTPException(
            status_code=409,
            detail=f"No pending client-tool call for call_id={body.call_id} (already resolved or expired)",
        )
    if not fut.done():
        fut.set_result(
            {
                "ok": body.ok,
                "data": body.data,
                "error": body.error,
            }
        )
    return {"ok": True}


@router.post("/sessions/{session_id}/approval/{call_id}")
async def approval_decision(
    session_id: int,
    call_id: str,
    body: ApprovalDecisionBody,
    db: AsyncSession = Depends(get_db),
):
    """User approval/denial for a high-risk tool call."""
    session = await db.get(AgentSession, session_id)
    if session is None or session.user_id != DEFAULT_USER_ID:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")

    key = (session_id, call_id)
    fut = _pending_approvals.pop(key, None)
    if fut is None:
        raise HTTPException(
            status_code=409,
            detail=f"No pending approval for call_id={call_id} (already resolved or expired)",
        )
    if not fut.done():
        fut.set_result({"approved": body.approved, "reason": body.reason})

    # Audit the decision into the event log.
    emitter = _active_emitters.get(session_id)
    if emitter is not None:
        await emitter.emit(
            "approval_decision",
            call_id=call_id,
            approved=body.approved,
            reason=body.reason or "",
        )
    return {"ok": True}


def _cancel_pending(session_id: int) -> None:
    """Cancel all pending client-tool / approval Futures for a session."""
    for key in list(_pending_client_tools.keys()):
        if key[0] == session_id:
            fut = _pending_client_tools.pop(key, None)
            if fut and not fut.done():
                fut.cancel()
    for key in list(_pending_approvals.keys()):
        if key[0] == session_id:
            fut = _pending_approvals.pop(key, None)
            if fut and not fut.done():
                fut.cancel()
