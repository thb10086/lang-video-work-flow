"""SSE event schema + emitter for the backend Agent runtime.

This module is the **single source of truth** for events flowing from the
backend agent runtime to the frontend thin client. The frontend
`agentSseClient.ts` mirrors these types in TypeScript.

Event lifecycle (typical successful run):

    session_start
      [phase_change "planning"]
      reasoning_delta x N    (token-level, when supported)
      tool_call               (server-side tool)
      tool_result
      tool_call               (client-side: triggers client_tool_request)
      client_tool_request
        ... awaiting POST /api/agent/sessions/{id}/client-tool-result ...
      tool_result
      [phase_change "building"]
      stats_update
      ...
    final
    done

Replay: every event carries a monotonically increasing `seq` per session
so the frontend can reconnect with `Last-Event-ID: <last_seq>`.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Any, Literal, TypedDict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import AgentEvent, AgentSession

logger = logging.getLogger("prism.agent.streaming")

# ============================================================
# Event types — closed enum to keep frontend type-safe
# ============================================================

EventType = Literal[
    "session_start",        # {session_id, model, role, phase}
    "phase_change",         # {phase, reason?}
    "reasoning_delta",      # {text}            token-level streaming
    "tool_call",            # {call_id, name, args, scope}
    "tool_result",          # {call_id, ok, data?, hints?, error?, next_step?}
    "client_tool_request",  # {call_id, name, args, timeout_ms}
    "subagent_started",     # {subagent_id, parent_call_id, role, goal}
    "subagent_finished",    # {subagent_id, ok, data?, error?}
    "approval_required",    # {call_id, name, args, risk_level, diff?}
    "approval_decision",    # {call_id, approved, reason?}        audit
    "node_ref",             # {message_id, node_ids}              canvas binding
    "stats_update",         # {tokens, elapsed_ms, rounds, tool_calls}
    "error",                # {code, message, recoverable}
    "final",                # {text, stop_reason, tool_calls_summary}
    "done",                 # (empty)
]


class AgentEventPayload(TypedDict, total=False):
    """Wire-format envelope for a single SSE event.

    NOTE: only `type` and `seq` are required. Each event type fills its own
    subset of payload fields (documented above per event).
    """
    type: EventType
    seq: int
    timestamp: str
    # Type-specific payload — flat shape, no nested envelope
    session_id: str
    model: str
    role: str
    phase: str
    reason: str
    text: str
    call_id: str
    name: str
    args: dict[str, Any]
    scope: Literal["server", "client"]
    ok: bool
    data: Any
    hints: list[str]
    next_step: str
    error: dict[str, Any]
    timeout_ms: int
    subagent_id: str
    parent_call_id: str
    goal: str
    approved: bool
    risk_level: Literal["safe", "low", "medium", "high", "critical"]
    diff: dict[str, Any]
    message_id: str
    node_ids: list[str]
    tokens: int
    elapsed_ms: int
    rounds: int
    tool_calls: int
    code: str
    message: str
    recoverable: bool
    stop_reason: str
    tool_calls_summary: list[dict[str, Any]]


# ============================================================
# Emitter — atomic seq allocation + persistence + queue dispatch
# ============================================================

class EventEmitter:
    """Per-session event emitter.

    Responsibilities:
      1. Allocate monotonically increasing `seq` per session (via
         `agent_sessions.last_event_seq` row update — atomic with the event
         insert in the same transaction).
      2. Persist every emitted event to `agent_events` for replay.
      3. Push events to an in-memory `asyncio.Queue` consumed by the SSE
         response generator.

    The emitter is created once per active SSE connection. After the session
    completes (`done` emitted), the emitter is closed and the queue drained.
    """

    def __init__(self, session_id: int, db: AsyncSession):
        self.session_id = session_id
        self.db = db
        self._queue: asyncio.Queue[AgentEventPayload | None] = asyncio.Queue()
        self._closed = False
        self._lock = asyncio.Lock()

    async def emit(self, type: EventType, **payload: Any) -> AgentEventPayload:
        """Emit a single event: allocate seq, persist to DB, push to queue."""
        if self._closed:
            logger.warning("Emit called on closed emitter (session=%s, type=%s)", self.session_id, type)
            return {}  # type: ignore[typeddict-item]

        async with self._lock:
            # Atomically increment last_event_seq on the session row.
            session = await self.db.get(AgentSession, self.session_id)
            if session is None:
                logger.error("Session %s not found during emit", self.session_id)
                return {}  # type: ignore[typeddict-item]
            seq = (session.last_event_seq or 0) + 1
            session.last_event_seq = seq

            # Build wire-format payload.
            event_payload: AgentEventPayload = {
                "type": type,
                "seq": seq,
                "timestamp": datetime.utcnow().isoformat(timespec="milliseconds") + "Z",
                **payload,  # type: ignore[typeddict-item]
            }

            # Persist for replay.
            row = AgentEvent(
                session_id=self.session_id,
                seq=seq,
                type=type,
                payload=event_payload,
            )
            self.db.add(row)
            await self.db.commit()

        # Push to in-memory queue (consumer iterates until None sentinel).
        await self._queue.put(event_payload)
        logger.debug("emit session=%s seq=%s type=%s", self.session_id, seq, type)
        return event_payload

    async def close(self) -> None:
        """Signal the consumer queue to stop. Idempotent."""
        if self._closed:
            return
        self._closed = True
        await self._queue.put(None)

    async def stream(self):
        """Async iterator yielding events until close() is called."""
        while True:
            event = await self._queue.get()
            if event is None:
                return
            yield event


# ============================================================
# SSE wire formatting + replay
# ============================================================

def format_sse(event: AgentEventPayload) -> str:
    """Format a single event for SSE wire transmission.

    Uses `id:` so browsers automatically retain `Last-Event-ID` for reconnect.
    """
    seq = event.get("seq", 0)
    data = json.dumps(event, ensure_ascii=False, default=str)
    return f"id: {seq}\ndata: {data}\n\n"


async def replay_events(db: AsyncSession, session_id: int, after_seq: int) -> list[AgentEventPayload]:
    """Fetch all events for a session with seq > after_seq, ordered ascending."""
    stmt = (
        select(AgentEvent)
        .where(AgentEvent.session_id == session_id)
        .where(AgentEvent.seq > after_seq)
        .order_by(AgentEvent.seq.asc())
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()
    return [row.payload for row in rows]
