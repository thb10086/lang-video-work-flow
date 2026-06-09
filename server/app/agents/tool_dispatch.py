"""Tool dispatch — bridges the LangGraph runtime with the tool_registry.

For each pending tool call from the LLM:
  1. Emit `tool_call` event (with scope inferred from registry)
  2. Route by scope:
     - `server` → call handler in-process
     - `client` → register pending Future, emit `client_tool_request`,
                  await reply (with timeout)
  3. Risk gate: if risk_level ∈ {high, critical}, emit `approval_required`
     and await user decision before executing the body
  4. Emit `tool_result` (regardless of ok/fail) carrying the structured
     `ToolResult` data
  5. Append a tool_message to the conversation so the next LLM round sees it

Behavior gracefully degrades on missing tools / handler exceptions /
client timeouts — every code path produces a valid `ToolResult` so the
runtime never deadlocks.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.loop_control import AgentLoopController, ToolExecutionRecord
from app.agents.streaming import EventEmitter
from app.agents.tool_registry import Tool, get_registry
from app.agents.types import ToolError, ToolMeta, ToolResult

logger = logging.getLogger("prism.agent.tool_dispatch")


# ============================================================
# Public entry point — used by `runtime.dispatch_tool_calls_node`
# ============================================================

async def dispatch_one_tool_call(
    call: dict[str, Any],
    *,
    emitter: EventEmitter,
    db: AsyncSession,
    controller: AgentLoopController,
    session_id: int,
) -> dict[str, Any]:
    """Execute a single LLM-issued tool call. Returns:

        {
          "tool_message": <OpenAI tool_message dict for next round>,
          "result": <ToolResult>
        }
    """
    call_id = str(call.get("id") or call.get("call_id") or f"call_{int(time.time()*1000)}")
    raw_name = str(call.get("name") or (call.get("function", {}) or {}).get("name") or "")
    raw_args = call.get("arguments") or (call.get("function", {}) or {}).get("arguments") or {}

    # OpenAI passes arguments as JSON string by convention.
    if isinstance(raw_args, str):
        import json
        try:
            args = json.loads(raw_args) if raw_args else {}
        except Exception:
            args = {}
    elif isinstance(raw_args, dict):
        args = raw_args
    else:
        args = {}

    started_at = time.time()
    registry = get_registry()
    tool: Optional[Tool] = registry.resolve(raw_name)

    if tool is None:
        await emitter.emit(
            "tool_call",
            call_id=call_id,
            name=raw_name,
            args=args,
            scope="server",  # default
        )
        result = ToolResult.failure(
            "unknown_tool",
            f"未知工具: {raw_name}",
            recoverable=False,
        )
        await _emit_result(emitter, call_id, result)
        controller.record_tool_call(ToolExecutionRecord(tool=raw_name, args=args, success=False))
        return {"tool_message": _to_tool_message(call_id, raw_name, result)}

    # Emit the tool_call event (scope tells frontend whether it'll get a
    # client_tool_request next).
    await emitter.emit(
        "tool_call",
        call_id=call_id,
        name=tool.name,
        args=args,
        scope=tool.scope,
    )

    # ── Risk gate ──
    if tool.risk_level in ("high", "critical"):
        approved = await _await_approval(
            emitter=emitter,
            session_id=session_id,
            call_id=call_id,
            tool=tool,
            args=args,
        )
        if not approved:
            result = ToolResult.failure(
                "user_denied",
                "用户拒绝了该工具调用",
                recoverable=False,
                hints=["用户已拒绝该高风险操作；尝试更小步骤或不同方案"],
            )
            await _emit_result(emitter, call_id, result)
            controller.record_tool_call(
                ToolExecutionRecord(tool=tool.name, args=args, success=False)
            )
            return {"tool_message": _to_tool_message(call_id, tool.name, result)}

    # ── Dispatch by scope ──
    if tool.scope == "client":
        result = await _await_client_tool_result(
            emitter=emitter,
            session_id=session_id,
            call_id=call_id,
            tool=tool,
            args=args,
        )
    else:
        result = await _execute_server_tool(
            tool=tool,
            args=args,
            db=db,
            session_id=session_id,
            started_at=started_at,
        )

    await _emit_result(emitter, call_id, result)
    controller.record_tool_call(
        ToolExecutionRecord(tool=tool.name, args=args, success=result.ok)
    )
    return {"tool_message": _to_tool_message(call_id, tool.name, result)}


# ============================================================
# Server tool execution
# ============================================================

async def _execute_server_tool(
    *,
    tool: Tool,
    args: dict[str, Any],
    db: AsyncSession,
    session_id: int,
    started_at: float,
) -> ToolResult:
    if tool.handler is None:
        return ToolResult.failure(
            "no_handler",
            f"Tool {tool.name} has no server handler registered",
        )
    ctx = {"db": db, "session_id": session_id, "tool_name": tool.name}
    try:
        out = await tool.handler(args, ctx)  # type: ignore[arg-type]
        elapsed_ms = int((time.time() - started_at) * 1000)
        if isinstance(out, ToolResult):
            if out.meta is None:
                out.meta = ToolMeta(elapsed_ms=elapsed_ms)
            return out
        if isinstance(out, dict):
            return ToolResult(ok=True, data=out, meta=ToolMeta(elapsed_ms=elapsed_ms))
        return ToolResult(ok=True, data=out, meta=ToolMeta(elapsed_ms=elapsed_ms))
    except Exception as exc:  # noqa: BLE001
        logger.exception("Tool %s raised", tool.name)
        elapsed_ms = int((time.time() - started_at) * 1000)
        return ToolResult.failure(
            "tool_exception",
            str(exc)[:500],
            recoverable=True,
            elapsed_ms=elapsed_ms,
        )


# ============================================================
# Client tool reverse-RPC
# ============================================================

async def _await_client_tool_result(
    *,
    emitter: EventEmitter,
    session_id: int,
    call_id: str,
    tool: Tool,
    args: dict[str, Any],
    timeout_ms: int = 5000,
) -> ToolResult:
    """Emit `client_tool_request` and await the matching POST."""
    # Lazy import to avoid circular dependency with the router module.
    from app.routers.agent_runtime import register_client_tool_call

    fut = register_client_tool_call(session_id, call_id)
    await emitter.emit(
        "client_tool_request",
        call_id=call_id,
        name=tool.name,
        args=args,
        timeout_ms=timeout_ms,
    )

    try:
        payload = await asyncio.wait_for(fut, timeout=timeout_ms / 1000.0)
    except asyncio.TimeoutError:
        return ToolResult.failure(
            "client_timeout",
            f"客户端在 {timeout_ms}ms 内未回复",
            recoverable=True,
        )
    except asyncio.CancelledError:
        return ToolResult.failure(
            "client_cancelled",
            "客户端会话被取消",
            recoverable=False,
        )

    ok = bool(payload.get("ok"))
    if ok:
        return ToolResult(ok=True, data=payload.get("data"))
    return ToolResult.failure(
        "client_error",
        str(payload.get("error") or "未知客户端错误"),
        recoverable=True,
    )


# ============================================================
# Approval gate
# ============================================================

async def _await_approval(
    *,
    emitter: EventEmitter,
    session_id: int,
    call_id: str,
    tool: Tool,
    args: dict[str, Any],
    timeout_ms: int = 60_000,  # 60s for user decision
) -> bool:
    """Emit `approval_required` and block on user decision via reverse RPC."""
    from app.routers.agent_runtime import register_approval

    fut = register_approval(session_id, call_id)
    await emitter.emit(
        "approval_required",
        call_id=call_id,
        name=tool.name,
        args=args,
        risk_level=tool.risk_level,
        diff=_compute_diff(tool, args),
    )
    try:
        payload = await asyncio.wait_for(fut, timeout=timeout_ms / 1000.0)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        return False
    return bool(payload.get("approved"))


def _compute_diff(tool: Tool, args: dict[str, Any]) -> dict[str, Any]:
    """Best-effort diff payload to show in the approval dialog.

    For batch / destructive tools this surfaces what would be touched.
    """
    diff: dict[str, Any] = {"tool": tool.name, "args_preview": _trim(args)}
    # Common patterns: node_id / node_ids / node_labels
    for key in ("node_id", "node_ids", "node_labels"):
        if key in args:
            diff[key] = args[key]
    return diff


def _trim(obj: Any, max_len: int = 200) -> Any:
    if isinstance(obj, str):
        return obj if len(obj) <= max_len else obj[:max_len] + "…"
    if isinstance(obj, dict):
        return {k: _trim(v, max_len) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_trim(v, max_len) for v in obj[:10]]
    return obj


# ============================================================
# Helpers
# ============================================================

async def _emit_result(emitter: EventEmitter, call_id: str, result: ToolResult) -> None:
    payload: dict[str, Any] = {
        "call_id": call_id,
        "ok": result.ok,
    }
    if result.data is not None:
        payload["data"] = result.data
    if result.hints:
        payload["hints"] = result.hints
    if result.next_step:
        payload["next_step"] = result.next_step
    if result.error:
        payload["error"] = result.error.model_dump()
    await emitter.emit("tool_result", **payload)


def _to_tool_message(call_id: str, tool_name: str, result: ToolResult) -> dict[str, Any]:
    """Build the OpenAI-compatible `role: tool` message body."""
    import json as _json
    legacy = result.to_legacy()
    return {
        "role": "tool",
        "tool_call_id": call_id,
        "name": tool_name,
        "content": _json.dumps(legacy, ensure_ascii=False, default=str),
    }
