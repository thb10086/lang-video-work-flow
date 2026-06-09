"""Subagent delegation — short-lived agent runs spawned by the parent.

A subagent:
  - Runs the same `run_session` recursively on a fresh `agent_sessions` row
    (with `parent_session_id` pointing back at the parent)
  - Has its own independent budget (default smaller than parent)
  - Starts with a fresh `messages` list (only the goal, no parent context)
  - Streams events to its OWN session SSE pipe (UI displays nested timeline
    via `subagent_started` / `subagent_finished` parent events)
  - Returns a structured payload conforming to optional `return_schema`

Tools registered:
  - `agent.delegate({role, goal, budget?, return_schema?, parent_tools_allowed?})`
  - `agent.parallel_delegate({subagents: [...]})`

Depth cap (`max_depth=2`) prevents recursion bombs.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.tool_registry import Tool, get_registry
from app.agents.types import ToolResult
from app.config import settings
from app.db.session import async_session_factory
from app.models.agent import AgentSession

logger = logging.getLogger("prism.agent.subagent")

DEFAULT_MAX_DEPTH = 2
DEFAULT_SUBAGENT_BUDGET = {
    "max_iterations": 25,
    "max_tokens": 50_000,
    "max_time_ms": 5 * 60 * 1000,
    "max_tool_calls": 30,
}


# ============================================================
# agent.delegate — single subagent
# ============================================================

async def _handle_delegate(args: dict[str, Any], ctx: dict[str, Any]) -> ToolResult:
    parent_db: AsyncSession = ctx["db"]
    parent_session_id = ctx["session_id"]

    parent = await parent_db.get(AgentSession, parent_session_id)
    if parent is None:
        return ToolResult.failure("session_not_found", "父会话不存在")

    depth = _depth_of(parent)
    if depth >= DEFAULT_MAX_DEPTH:
        return ToolResult.failure(
            "subagent_depth_exceeded",
            f"已达子代理嵌套上限 ({DEFAULT_MAX_DEPTH})",
            recoverable=False,
        )

    role = str(args.get("role") or "assistant")
    goal = str(args.get("goal") or "").strip()
    if not goal:
        return ToolResult.failure("missing_args", "goal 不能为空")
    return_schema = args.get("return_schema")
    budget_override = args.get("budget") or {}

    # Spawn the subagent in a fresh DB session so its commits don't tangle
    # with the parent's transaction.
    sub_session_id = await _spawn_subagent_row(
        parent=parent,
        role=role,
    )

    # Fire-and-await the subagent run on its own DB session.
    result_payload = await _run_subagent(
        sub_session_id=sub_session_id,
        goal=goal,
        role=role,
        return_schema=return_schema,
        budget_override=budget_override,
    )
    return ToolResult(
        ok=result_payload.get("ok", False),
        data=result_payload.get("data"),
        error=None if result_payload.get("ok") else None,
        hints=["子代理已结束"],
    )


# ============================================================
# agent.parallel_delegate — fan-out
# ============================================================

async def _handle_parallel_delegate(args: dict[str, Any], ctx: dict[str, Any]) -> ToolResult:
    parent_db: AsyncSession = ctx["db"]
    parent_session_id = ctx["session_id"]

    sub_specs = args.get("subagents")
    if not isinstance(sub_specs, list) or not sub_specs:
        return ToolResult.failure("missing_args", "subagents 必须是非空数组")

    parent = await parent_db.get(AgentSession, parent_session_id)
    if parent is None:
        return ToolResult.failure("session_not_found", "父会话不存在")
    depth = _depth_of(parent)
    if depth >= DEFAULT_MAX_DEPTH:
        return ToolResult.failure(
            "subagent_depth_exceeded",
            f"已达子代理嵌套上限 ({DEFAULT_MAX_DEPTH})",
            recoverable=False,
        )

    concurrency = int(args.get("concurrency") or 5)
    semaphore = asyncio.Semaphore(max(1, concurrency))

    async def _run_one(spec: dict[str, Any]) -> dict[str, Any]:
        async with semaphore:
            role = str(spec.get("role") or "assistant")
            goal = str(spec.get("goal") or "").strip()
            if not goal:
                return {"ok": False, "error": "empty_goal"}
            sub_session_id = await _spawn_subagent_row(parent=parent, role=role)
            return await _run_subagent(
                sub_session_id=sub_session_id,
                goal=goal,
                role=role,
                return_schema=spec.get("return_schema"),
                budget_override=spec.get("budget") or {},
            )

    tasks = [asyncio.create_task(_run_one(s)) for s in sub_specs if isinstance(s, dict)]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    cleaned: list[dict[str, Any]] = []
    success_count = 0
    for r in results:
        if isinstance(r, Exception):
            cleaned.append({"ok": False, "error": str(r)[:200]})
        else:
            cleaned.append(r)
            if r.get("ok"):
                success_count += 1
    return ToolResult(
        ok=success_count > 0,
        data={
            "total": len(cleaned),
            "succeeded": success_count,
            "results": cleaned,
        },
    )


# ============================================================
# Helpers
# ============================================================

def _depth_of(session: AgentSession) -> int:
    """Compute subagent depth by walking parent chain. Caches in metadata_json."""
    meta = session.metadata_json or {}
    cached = meta.get("_subagent_depth")
    if isinstance(cached, int):
        return cached
    return 0  # parent always at depth 0; subagents bumped by spawner


async def _spawn_subagent_row(*, parent: AgentSession, role: str) -> int:
    """Insert a new agent_sessions row tagged as a subagent of `parent`."""
    async with async_session_factory() as db:
        new_meta = {"_subagent_depth": _depth_of(parent) + 1}
        sub = AgentSession(
            user_id=parent.user_id,
            project_id=parent.project_id,
            role_id=role,
            model=parent.model,
            status="running",
            phase="idle",
            parent_session_id=parent.id,
            metadata_json=new_meta,
        )
        db.add(sub)
        await db.commit()
        await db.refresh(sub)
        return sub.id


async def _run_subagent(
    *,
    sub_session_id: int,
    goal: str,
    role: str,
    return_schema: Any,
    budget_override: dict[str, Any],
) -> dict[str, Any]:
    """Execute a subagent run to completion and harvest its final state."""
    # Lazy import to avoid cycles (runtime → subagent → runtime)
    from app.agents.runtime import RuntimeConfig, run_session
    from app.agents.streaming import EventEmitter

    async with async_session_factory() as db:
        sub = await db.get(AgentSession, sub_session_id)
        if sub is None:
            return {"ok": False, "error": "spawn_failed"}
        emitter = EventEmitter(session_id=sub_session_id, db=db)
        config = RuntimeConfig(
            user_message=goal,
            user_images=[],
            role=role,
            model=sub.model or settings.DEFAULT_LLM_MODEL,
        )
        # Note: subagent emitter goes nowhere unless someone subscribes to its
        # SSE pipe. The events still persist to `agent_events` so they can be
        # replayed for inspection / debugging.
        try:
            await run_session(session=sub, config=config, emitter=emitter, db=db)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Subagent %s crashed", sub_session_id)
            return {"ok": False, "error": str(exc)[:200]}
        # Collect the final assistant text from the last event of type 'final'.
        from sqlalchemy import select
        from app.models.agent import AgentEvent
        final_evt = (await db.execute(
            select(AgentEvent)
            .where(AgentEvent.session_id == sub_session_id)
            .where(AgentEvent.type == "final")
            .order_by(AgentEvent.seq.desc())
            .limit(1)
        )).scalar_one_or_none()
        final_text = ""
        if final_evt is not None:
            payload = final_evt.payload or {}
            final_text = str(payload.get("text") or "")
        # If a return_schema is provided, attempt JSON validation; otherwise
        # wrap the raw text.
        if return_schema:
            try:
                import json as _json
                parsed = _json.loads(final_text or "{}")
                return {"ok": True, "data": parsed, "session_id": sub_session_id}
            except Exception:
                return {
                    "ok": False,
                    "error": "subagent_schema_violation",
                    "data": {"text": final_text},
                    "session_id": sub_session_id,
                }
        return {"ok": True, "data": {"text": final_text}, "session_id": sub_session_id}


# ============================================================
# Registration
# ============================================================

def register() -> None:
    r = get_registry()
    r.register(Tool(
        name="agent.delegate",
        description="孵化一个短生命周期子代理来完成 goal 描述的子任务。子代理拥有独立预算和隔离上下文。",
        parameters={
            "type": "object",
            "properties": {
                "role": {
                    "type": "string",
                    "enum": ["assistant", "director", "screenwriter", "artist", "cinematographer"],
                },
                "goal": {"type": "string"},
                "budget": {"type": "object"},
                "return_schema": {"type": "object"},
                "parent_tools_allowed": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["goal"],
        },
        handler=_handle_delegate,
        tier="tier3",
        risk_level="medium",
        scope="server",
    ))
    r.register(Tool(
        name="agent.parallel_delegate",
        description="并行孵化多个子代理（默认并发上限 5）。返回所有子代理的合并结果。",
        parameters={
            "type": "object",
            "properties": {
                "subagents": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "role": {"type": "string"},
                            "goal": {"type": "string"},
                            "budget": {"type": "object"},
                            "return_schema": {"type": "object"},
                        },
                        "required": ["goal"],
                    },
                },
                "concurrency": {"type": "integer", "default": 5, "minimum": 1, "maximum": 10},
            },
            "required": ["subagents"],
        },
        handler=_handle_parallel_delegate,
        tier="tier3",
        risk_level="medium",
        scope="server",
    ))
