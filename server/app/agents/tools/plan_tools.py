"""plan.* / phase.* / verify.* metacognitive tools.

These tools manipulate the in-session plan/phase state. Plan state lives
inside the `agent_sessions.metadata_json` field (so it persists across
reconnects without needing a dedicated table).
"""
from __future__ import annotations

import time
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.tool_registry import Tool, get_registry
from app.agents.types import ToolResult
from app.models.agent import AgentSession


VALID_PHASES = ("idle", "planning", "designing", "building", "reviewing", "executing")


async def _load_session(db: AsyncSession, session_id: int) -> AgentSession | None:
    return await db.get(AgentSession, session_id)


# ============================================================
# phase.set — explicit FSM transition
# ============================================================

async def _handle_set_phase(args: dict[str, Any], ctx: dict[str, Any]) -> ToolResult:
    db: AsyncSession = ctx["db"]
    session_id = ctx["session_id"]
    phase = str(args.get("phase") or "")
    if phase not in VALID_PHASES:
        return ToolResult.failure(
            "invalid_phase",
            f"phase 必须为 {VALID_PHASES} 之一",
        )
    session = await _load_session(db, session_id)
    if session is None:
        return ToolResult.failure("session_not_found", "会话不存在")
    old_phase = session.phase
    session.phase = phase
    # Append to phaseHistory inside metadata_json
    meta = dict(session.metadata_json or {})
    history = list(meta.get("phase_history") or [])
    history.append({
        "phase": phase,
        "reason": str(args.get("reason") or ""),
        "timestamp": int(time.time() * 1000),
    })
    meta["phase_history"] = history[-50:]  # cap at 50
    session.metadata_json = meta
    await db.commit()
    return ToolResult(
        ok=True,
        data={"phase": phase, "previous": old_phase},
        hints=["现在工具列表会按新 phase 收敛"],
    )


# ============================================================
# plan.create — store a structured task plan
# ============================================================

async def _handle_plan_create(args: dict[str, Any], ctx: dict[str, Any]) -> ToolResult:
    db: AsyncSession = ctx["db"]
    session_id = ctx["session_id"]
    goal = str(args.get("goal") or "").strip()
    raw_steps = args.get("steps") or []
    if not goal or not isinstance(raw_steps, list) or not raw_steps:
        return ToolResult.failure(
            "missing_args",
            "goal 与 steps 都不能为空",
        )
    steps = [
        {
            "id": f"step_{i+1}",
            "description": str(s).strip()[:300],
            "status": "pending",
        }
        for i, s in enumerate(raw_steps)
        if str(s).strip()
    ]
    if not steps:
        return ToolResult.failure("empty_steps", "steps 中没有有效内容")

    session = await _load_session(db, session_id)
    if session is None:
        return ToolResult.failure("session_not_found", "会话不存在")
    meta = dict(session.metadata_json or {})
    meta["plan"] = {
        "goal": goal,
        "steps": steps,
        "created_at": int(time.time() * 1000),
        "completed_at": None,
    }
    session.metadata_json = meta
    await db.commit()
    return ToolResult(
        ok=True,
        data={"goal": goal, "step_count": len(steps), "steps": steps},
        next_step="开始执行第一步，完成后用 plan.update_step 标记",
    )


# ============================================================
# plan.update_step — mark step status
# ============================================================

async def _handle_plan_update_step(args: dict[str, Any], ctx: dict[str, Any]) -> ToolResult:
    db: AsyncSession = ctx["db"]
    session_id = ctx["session_id"]
    step_id = str(args.get("step_id") or "")
    status = str(args.get("status") or "")
    result_text = args.get("result")
    if status not in ("pending", "in_progress", "done", "failed"):
        return ToolResult.failure(
            "invalid_status",
            "status 必须是 pending|in_progress|done|failed",
        )

    session = await _load_session(db, session_id)
    if session is None:
        return ToolResult.failure("session_not_found", "会话不存在")
    meta = dict(session.metadata_json or {})
    plan = meta.get("plan")
    if not isinstance(plan, dict):
        return ToolResult.failure("no_plan", "尚未创建计划，请先 plan.create")
    steps = list(plan.get("steps") or [])
    found = False
    for step in steps:
        if isinstance(step, dict) and step.get("id") == step_id:
            step["status"] = status
            if result_text is not None:
                step["result"] = str(result_text)[:500]
            found = True
            break
    if not found:
        return ToolResult.failure("step_not_found", f"step_id {step_id} 不存在")

    plan["steps"] = steps
    done_count = sum(1 for s in steps if isinstance(s, dict) and s.get("status") == "done")
    if done_count == len(steps):
        plan["completed_at"] = int(time.time() * 1000)
    meta["plan"] = plan
    session.metadata_json = meta
    await db.commit()
    return ToolResult(
        ok=True,
        data={"step_id": step_id, "status": status, "progress": f"{done_count}/{len(steps)}"},
    )


# ============================================================
# Registration
# ============================================================

def register() -> None:
    r = get_registry()

    r.register(Tool(
        name="phase.set",
        description="切换 Agent 当前阶段（idle|planning|designing|building|reviewing|executing），影响后续工具列表的过滤策略。",
        parameters={
            "type": "object",
            "properties": {
                "phase": {"type": "string", "enum": list(VALID_PHASES)},
                "reason": {"type": "string"},
            },
            "required": ["phase"],
        },
        handler=_handle_set_phase,
        tier="tier1",
        risk_level="safe",
        scope="server",
        aliases=("set_phase",),
    ))

    r.register(Tool(
        name="plan.create",
        description="为当前任务制定有序执行计划。复杂任务（≥3 步）建议先调用此工具再开始执行。",
        parameters={
            "type": "object",
            "properties": {
                "goal": {"type": "string", "description": "本轮任务的总目标"},
                "steps": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "有序的步骤描述列表",
                },
            },
            "required": ["goal", "steps"],
        },
        handler=_handle_plan_create,
        tier="tier3",
        risk_level="safe",
        scope="server",
        aliases=("plan_task",),
    ))

    r.register(Tool(
        name="plan.update_step",
        description="标记某个计划步骤为 pending|in_progress|done|failed，可附 result。",
        parameters={
            "type": "object",
            "properties": {
                "step_id": {"type": "string"},
                "status": {"type": "string", "enum": ["pending", "in_progress", "done", "failed"]},
                "result": {"type": "string"},
            },
            "required": ["step_id", "status"],
        },
        handler=_handle_plan_update_step,
        tier="tier3",
        risk_level="safe",
        scope="server",
        aliases=("update_plan_step",),
    ))
