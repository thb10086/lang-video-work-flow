"""Backend Agent Runtime — LangGraph StateGraph implementation.

This is the **single Agent main loop** for the Prism platform. The frontend
no longer hosts a tool-dispatch loop; it streams events from this runtime.

Architecture (LangGraph StateGraph):

       ┌──────────────────┐
       │  prepare_prompt  │   build PromptSegments (core/role/skills/...)
       └────────┬─────────┘
                ▼
       ┌──────────────────┐
       │     llm_call     │   stream reasoning + tool_calls
       └────────┬─────────┘
                ▼
       ┌──────────────────┐
       │ check_termination│   budget / loop / stall / final-answer detection
       └────────┬─────────┘
        end ◄───┤ continue
                ▼
       ┌──────────────────┐
       │ dispatch_tool_calls │  fan-out: server tools inline, client tools via RPC
       └────────┬─────────┘
                ▼
       ┌──────────────────┐
       │ emit_observation │   inject reflection / hints back into messages
       └────────┬─────────┘
                ▼  (loop back to prepare_prompt)

Why LangGraph (vs hand-rolled `for round` loop):
  - Native checkpointing (resume across browser/server reboots)
  - Subgraph composition (subagent = nested StateGraph)
  - Conditional edges = explicit FSM, no spaghetti
  - LangSmith tracing for free
  - `interrupt_before` for human-in-the-loop approval gates
  - `Send` API for parallel fan-out

This file ships the runtime SHELL. Each node is implemented as a stub today
that emits the appropriate SSE event so the protocol is testable end-to-end
even before LLM/tool integration is complete.

Subsequent tasks (0.2.2 .. 0.2.7 + 0.3.* + 0.5.*) will fill in:
  - Real prompt building (translation of chatPromptBuilder)
  - Loop control + budget enforcement
  - Real tool registry hookup
  - Reverse RPC for client tools
  - Reflection injection
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Annotated, Any, AsyncIterator, Literal, Optional, TypedDict

from langgraph.graph import END, START, StateGraph

from app.agents.loop_control import (
    AgentLoopController,
    LoopState,
    ToolExecutionRecord,
    create_agent_loop_controller,
)
from app.agents.prompts import (
    BuildOptions,
    build_segments,
    flatten_segments,
)
from app.agents.streaming import EventEmitter
from app.agents.tool_registry import get_registry
from app.config import settings
from app.models.agent import AgentSession
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("prism.agent.runtime")


# ============================================================
# State definition for the runtime StateGraph
# ============================================================

def _append(existing: list, new: list) -> list:
    return (existing or []) + (new or [])


class RuntimeState(TypedDict, total=False):
    """LangGraph state for the Agent main loop.

    Fields with reducer `_append` accumulate; others are replace-on-write.
    """
    # ── Inputs ──
    session_id: int                   # FK to agent_sessions.id
    user_message: str
    user_images: list[str]
    role: str                         # 'assistant' | 'director' | ...
    model: str                        # LLM model id

    # ── Prompt resources (injected by the router; see RuntimeConfig) ──
    # All optional — absent/empty values produce a system prompt that
    # contains only the core segment, which is still a valid contract.
    role_prompt: str                  # role-specific preamble text
    skills_prompt: str                # phase-scoped SKILLS block (may be empty)
    prompt_craft_ref: str             # quick-ref appended to core segment
    canvas_snapshot: str              # textual snapshot of current canvas
    memory_context: str               # relevance-ranked recall string

    # ── Conversation ──
    messages: Annotated[list[dict[str, Any]], _append]  # OpenAI-format messages
    pending_tool_calls: list[dict[str, Any]]            # tools to dispatch this round

    # ── Loop bookkeeping ──
    round: int
    phase: str                        # 'idle' | 'planning' | ...
    tool_call_count: int
    tokens_used: int

    # ── Termination signals ──
    should_stop: bool
    stop_reason: str
    final_text: str

    # ── Force-summary mode (set when budget hits warn threshold) ──
    force_summary: bool


# ============================================================
# Node implementations (stubs — will be filled by 0.2.2 .. 0.2.7)
# ============================================================

# Phase tags accepted by the prompt builder. The runtime stores phase as
# a free-form string ("idle" / "planning" / etc.) but the builder needs
# one of three production-flow buckets.
_VALID_BUILDER_PHASES = {"pre_production", "production", "post_production"}


def _phase_for_builder(state_phase: str) -> str:
    """Map the runtime's free-form phase to one of the builder's three.

    Mirrors the TS `detectCurrentPhase()` fallback: when the live phase
    is `idle`/empty/unknown, default to `pre_production` so the SKILLS
    section still loads its planning-time helpers.
    """
    if state_phase in _VALID_BUILDER_PHASES:
        return state_phase
    return "pre_production"


async def prepare_prompt_node(state: RuntimeState) -> dict[str, Any]:
    """Build PromptSegments and prepend a system message on the first round.

    Idempotent guard: if `messages` already contains a system message,
    or if `round > 0`, this is a no-op. The system prompt is therefore
    constructed once per session and reused across every LLM call.

    Empty-string defaults for every prompt resource are accepted — the
    builder will simply elide the corresponding optional segments. The
    `core` segment is always emitted because its content (mission,
    execution loop, error protocol, output spec, constraints) is the
    Agent's load-bearing contract. The router *should* inject real
    role/skills/canvas/memory; the builder's pure-function design lets
    the runtime work today even when those wires are not yet hooked up.
    """
    # Skip if already prepared. Don't rebuild on every loop iteration.
    messages = list(state.get("messages") or [])
    if any(m.get("role") == "system" for m in messages):
        return {}
    if state.get("round", 0) > 0:
        return {}

    user_images = state.get("user_images") or []
    image_count = len(user_images) if isinstance(user_images, list) else 0

    opts = BuildOptions(
        role_prompt=state.get("role_prompt") or "",
        canvas_snapshot=state.get("canvas_snapshot") or "画布为空。",
        prompt_craft_ref=state.get("prompt_craft_ref") or "",
        phase=_phase_for_builder(state.get("phase", "idle")),  # type: ignore[arg-type]
        skills_prompt=state.get("skills_prompt") or None,
        memory_context=state.get("memory_context") or None,
        image_count=image_count,
        default_video_model=settings.DEFAULT_VIDEO_MODEL
            if hasattr(settings, "DEFAULT_VIDEO_MODEL")
            else "doubao-seedance-2-0",
    )

    segments = build_segments(opts)
    system_text = flatten_segments(segments)

    # Prepend the system message. We insert at index 0 so the order
    # `system → user → assistant → …` is preserved on subsequent rounds.
    new_messages = [{"role": "system", "content": system_text}] + messages
    return {"messages": new_messages}


async def llm_call_node(state: RuntimeState, *, emitter: EventEmitter) -> dict[str, Any]:
    """Call the configured LLM with the current messages + tool registry,
    streaming `reasoning_delta` events as content arrives, and capturing
    any `tool_calls` for the next dispatch round.

    Strategy:
      - Use the same OpenAI-compatible upstream as `app/routers/agent_chat.py`
      - When `force_summary` is set, omit tools so the agent must finalise
      - Include the message history accumulated in state
      - For non-streaming providers, emit a single `reasoning_delta` with
        the full assistant text right before returning
    """
    import httpx
    import json as _json

    model = state.get("model") or settings.DEFAULT_LLM_MODEL
    messages = list(state.get("messages") or [])

    # On round 0, seed the user message + (optional) image content.
    if state.get("round", 0) == 0:
        user_msg = state.get("user_message") or ""
        user_images = state.get("user_images") or []
        if user_images:
            content_parts: list[dict[str, Any]] = [{"type": "text", "text": user_msg}]
            for img in user_images:
                url = img if isinstance(img, str) and img.startswith("data:") else f"data:image/png;base64,{img}"
                content_parts.append({"type": "image_url", "image_url": {"url": url, "detail": "high"}})
            messages.append({"role": "user", "content": content_parts})
        elif user_msg:
            messages.append({"role": "user", "content": user_msg})

    # Build tools[] from the registry, gated by phase if present.
    registry = get_registry()
    tools = registry.to_openai_schema(include_aliases=False)

    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": 0.3,
        "max_tokens": 4096,
    }
    if not state.get("force_summary"):
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{settings.LLM_BASE_URL}/v1/chat/completions",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {settings.LLM_API_KEY}",
                },
                json=payload,
            )
            resp.raise_for_status()
            body = resp.json()
    except Exception as exc:  # noqa: BLE001
        logger.exception("LLM call failed")
        await emitter.emit(
            "error",
            code="llm_failure",
            message=str(exc)[:500],
            recoverable=True,
        )
        return {
            "should_stop": True,
            "stop_reason": "llm_failure",
            "final_text": f"LLM 调用失败: {str(exc)[:200]}",
        }

    choices = body.get("choices") or []
    msg = (choices[0] or {}).get("message", {}) if choices else {}
    assistant_text: str = msg.get("content") or ""
    tool_calls_raw = msg.get("tool_calls") or []

    # Stream the assistant text (single delta — no upstream streaming yet).
    if assistant_text:
        await emitter.emit("reasoning_delta", text=assistant_text)

    pending: list[dict[str, Any]] = []
    for tc in tool_calls_raw:
        if not isinstance(tc, dict):
            continue
        fn = tc.get("function") or {}
        pending.append({
            "id": tc.get("id"),
            "name": fn.get("name"),
            "arguments": fn.get("arguments"),
        })

    # Append assistant message (with tool_calls if any) to history.
    new_messages = list(messages)
    assistant_msg: dict[str, Any] = {"role": "assistant", "content": assistant_text or None}
    if tool_calls_raw:
        assistant_msg["tool_calls"] = tool_calls_raw
    new_messages.append(assistant_msg)

    # Token usage tracking (rough — backend providers may omit usage).
    usage = body.get("usage") or {}
    total_tokens = int(usage.get("total_tokens") or 0)
    new_tokens = state.get("tokens_used", 0) + total_tokens

    return {
        "messages": new_messages,
        "pending_tool_calls": pending,
        "tokens_used": new_tokens,
        "round": state.get("round", 0) + 1,
        "final_text": assistant_text if not pending else state.get("final_text", ""),
    }


async def check_termination_node(
    state: RuntimeState,
    *,
    controller: AgentLoopController,
    started_at_ms: int,
    emitter: EventEmitter,
) -> dict[str, Any]:
    """Decide whether to terminate the loop based on budget / loop / stall.

    Uses the shared `AgentLoopController` (ported from agentLoopControl.ts)
    to make the same decisions the legacy frontend made.
    """
    if state.get("should_stop"):
        return {}

    import time
    elapsed_ms = int(time.time() * 1000) - started_at_ms
    loop_state = LoopState(
        round=state.get("round", 0) + 1,
        elapsed_ms=elapsed_ms,
        tokens_used=state.get("tokens_used", 0),
        tool_call_count=state.get("tool_call_count", 0),
        progress_signature=state.get("progress_signature", ""),
    )

    # Feed stall detector with current progress signature (pulled from state).
    sig = state.get("progress_signature", "")
    if sig:
        controller.observe_progress(sig, loop_state.round)

    decision = controller.evaluate(loop_state)

    if decision.should_stop:
        return {
            "should_stop": True,
            "stop_reason": decision.reason.value if decision.reason else "unknown",
            "final_text": controller.build_stop_message(decision),
        }

    # Soft warn — inject reflection ONCE per reason.
    if decision.escalation == "warn" and decision.reason is not None:
        if decision.reason not in controller._warned_reasons:
            controller._warned_reasons.add(decision.reason)
            reflection = controller.build_reflection(decision)
            if reflection:
                # Emit as a reasoning_delta so the frontend timeline shows it.
                await emitter.emit("reasoning_delta", text=f"\n{reflection}\n")
                # Also push back into messages so the next LLM round sees it.
                msgs = state.get("messages", [])
                msgs = list(msgs) + [{"role": "user", "content": reflection}]
                return {"messages": msgs}

    if decision.escalation == "force-summary" and not state.get("force_summary"):
        reflection = controller.build_reflection(decision)
        msgs = state.get("messages", [])
        msgs = list(msgs) + [{"role": "user", "content": reflection}]
        return {"force_summary": True, "messages": msgs}

    if not state.get("pending_tool_calls"):
        # No new tool calls AND not stopping per budget — assistant finalised.
        return {"should_stop": True, "stop_reason": "no_tool_calls"}

    return {}


async def dispatch_tool_calls_node(
    state: RuntimeState,
    *,
    emitter: EventEmitter,
    db: AsyncSession,
    controller: AgentLoopController,
) -> dict[str, Any]:
    """Execute server tools inline; route client tools via reverse RPC.

    For each call in pending_tool_calls:
      1. Emit `tool_call` SSE event (so the frontend timeline updates live)
      2. Resolve via tool_registry; if missing, return error result
      3. If `scope='server'`: execute handler in-process
      4. If `scope='client'`: register pending Future + emit
         `client_tool_request`, await reply (with timeout)
      5. If `risk_level >= 'high'`: emit `approval_required` and await
         user decision before executing
      6. Append the tool_result message back so the next LLM round sees it
    """
    from app.agents.tool_dispatch import dispatch_one_tool_call  # avoid cycle

    pending = state.get("pending_tool_calls", [])
    if not pending:
        return {"pending_tool_calls": []}

    new_messages: list[dict[str, Any]] = []
    new_tool_call_count = state.get("tool_call_count", 0)

    for call in pending:
        result = await dispatch_one_tool_call(
            call, emitter=emitter, db=db, controller=controller, session_id=state["session_id"],
        )
        new_tool_call_count += 1
        new_messages.append(result["tool_message"])

    return {
        "pending_tool_calls": [],
        "messages": list(state.get("messages", [])) + new_messages,
        "tool_call_count": new_tool_call_count,
    }


async def emit_observation_node(state: RuntimeState, *, emitter: EventEmitter) -> dict[str, Any]:
    """Append [REFLECTION] / [OBSERVATION] back into messages so the next
    LLM round sees execution feedback.

    TODO (task 0.2.7): port existing reflection logic from chatStore.ts.
    """
    return {}


# ============================================================
# Graph builder
# ============================================================

def _route_after_termination(state: RuntimeState) -> Literal["dispatch", "end"]:
    """Conditional edge: continue dispatching tools or end the run."""
    if state.get("should_stop"):
        return "end"
    if not state.get("pending_tool_calls"):
        return "end"
    return "dispatch"


def build_runtime_graph(
    emitter: EventEmitter,
    db: AsyncSession,
    controller: AgentLoopController,
    started_at_ms: int,
):
    """Compile the Agent main-loop StateGraph.

    Returns the compiled graph ready for `astream(...)` invocation. Per-call
    closures bind the emitter, DB session, loop controller and start
    timestamp so the nodes can emit events, persist state, and reason about
    deadlines without globals.
    """
    graph: StateGraph = StateGraph(RuntimeState)

    # Closures so node functions can access emitter + db + controller
    async def _prepare(state: RuntimeState):
        return await prepare_prompt_node(state)

    async def _llm(state: RuntimeState):
        return await llm_call_node(state, emitter=emitter)

    async def _check(state: RuntimeState):
        return await check_termination_node(
            state, controller=controller, started_at_ms=started_at_ms, emitter=emitter,
        )

    async def _dispatch(state: RuntimeState):
        return await dispatch_tool_calls_node(state, emitter=emitter, db=db, controller=controller)

    async def _observe(state: RuntimeState):
        return await emit_observation_node(state, emitter=emitter)

    # Nodes
    graph.add_node("prepare_prompt", _prepare)
    graph.add_node("llm_call", _llm)
    graph.add_node("check_termination", _check)
    graph.add_node("dispatch_tool_calls", _dispatch)
    graph.add_node("emit_observation", _observe)

    # Edges
    graph.add_edge(START, "prepare_prompt")
    graph.add_edge("prepare_prompt", "llm_call")
    graph.add_edge("llm_call", "check_termination")
    graph.add_conditional_edges(
        "check_termination",
        _route_after_termination,
        {"dispatch": "dispatch_tool_calls", "end": END},
    )
    graph.add_edge("dispatch_tool_calls", "emit_observation")
    graph.add_edge("emit_observation", "prepare_prompt")  # loop back

    # NOTE: SqliteSaver checkpointing is added in task 0.2.3 once
    # loop_control + state serialization land. Compiling without a saver
    # is fine — we simply lose mid-run resume capability for now.
    return graph.compile()


# ============================================================
# Public entry point — driven by the SSE router
# ============================================================

@dataclass
class RuntimeConfig:
    """Inputs forwarded by the SSE router into a single agent run.

    Prompt resources (`role_prompt`/`skills_prompt`/etc.) default to empty
    strings to preserve backward compatibility with callers that have
    not yet migrated. When empty, the prompt builder elides the
    corresponding optional segments and the assistant runs against just
    the core contract — still a valid prompt, just without role flavour.
    The router (or a future SSE wiring task) should fill these by
    reading whatever the legacy frontend reads from Zustand.
    """
    user_message: str
    user_images: list[str]
    role: str = "assistant"
    model: str = ""
    # ── Prompt resources (optional — see prepare_prompt_node) ──
    role_prompt: str = ""
    skills_prompt: str = ""
    prompt_craft_ref: str = ""
    canvas_snapshot: str = ""
    memory_context: str = ""


async def run_session(
    *,
    session: AgentSession,
    config: RuntimeConfig,
    emitter: EventEmitter,
    db: AsyncSession,
) -> None:
    """Drive a single Agent session from start to `done`.

    Emits the canonical lifecycle:
      session_start → ... → final → done

    The caller is the SSE route handler; it consumes `emitter.stream()` for
    the actual wire output. This function `await`s the graph to completion
    then closes the emitter so the SSE response generator terminates.
    """
    model = config.model or settings.DEFAULT_LLM_MODEL

    # ── Lifecycle: session_start ──
    await emitter.emit(
        "session_start",
        session_id=str(session.id),
        model=model,
        role=config.role,
        phase=session.phase or "idle",
    )

    initial_state: RuntimeState = {
        "session_id": session.id,
        "user_message": config.user_message,
        "user_images": config.user_images,
        "role": config.role,
        "model": model,
        # Prompt resources — forwarded so prepare_prompt_node can build
        # the system message on round 0.
        "role_prompt": config.role_prompt,
        "skills_prompt": config.skills_prompt,
        "prompt_craft_ref": config.prompt_craft_ref,
        "canvas_snapshot": config.canvas_snapshot,
        "memory_context": config.memory_context,
        "messages": [],
        "pending_tool_calls": [],
        "round": 0,
        "phase": session.phase or "idle",
        "tool_call_count": 0,
        "tokens_used": 0,
        "should_stop": False,
        "stop_reason": "",
        "final_text": "",
        "force_summary": False,
    }

    import time
    started_at_ms = int(time.time() * 1000)
    controller = create_agent_loop_controller()

    final_state: RuntimeState = {}
    try:
        graph = build_runtime_graph(emitter, db, controller, started_at_ms)
        async for chunk in graph.astream(initial_state, {"recursion_limit": 100}):
            # LangGraph streams per-node updates. We don't forward them as
            # SSE here because each node already emits its own events via
            # the emitter closure. We just track the latest state for the
            # final-event payload.
            for _node_name, node_output in chunk.items():
                if isinstance(node_output, dict):
                    final_state.update(node_output)
    except Exception as exc:
        logger.exception("Runtime crashed for session %s", session.id)
        await emitter.emit(
            "error",
            code="runtime_crash",
            message=str(exc)[:500],
            recoverable=False,
        )
        await _mark_session_status(db, session, "error")
        await emitter.emit("done")
        await emitter.close()
        return

    # ── Lifecycle: final + done ──
    await emitter.emit(
        "final",
        text=final_state.get("final_text", ""),
        stop_reason=final_state.get("stop_reason", "completed"),
        tool_calls_summary=[],
    )
    await _mark_session_status(db, session, "completed")
    await emitter.emit("done")
    await emitter.close()


async def _mark_session_status(db: AsyncSession, session: AgentSession, status: str) -> None:
    """Persist the terminal status of a session."""
    session.status = status
    await db.commit()
