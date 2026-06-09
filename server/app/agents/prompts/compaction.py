"""Three-layer context compaction — Python parity of the TS version.

Layer 1 (`micro_compact`):  Trim verbose tool outputs and old assistant
                            reasoning IN PLACE. Zero LLM calls. Safe to
                            invoke every round.
Layer 2 (`auto_compact`):   Replace older messages with a structured
                            summary block when context usage approaches
                            the ceiling.
Layer 3 (`full_compact`):   Nuclear option — collapse the entire
                            conversation to a single summary + the most
                            recent user message.

`smart_compress` is the dispatcher; it picks a layer based on observed
token usage as a fraction of `CONTEXT_TOKEN_CEILING`.

Why this is a faithful port:
  - All thresholds and "preserve_recent" defaults match the TS source
    (see src/store/chatPromptBuilder.ts and src/providers/modelDefaults.ts).
  - Summary line format matches verbatim ("用户请求: ..." / "执行工具: ..."
    / "关键结果: ..." / "[上下文摘要 — N 条消息压缩]") so the LLM sees
    identical text on both runtimes.

The `add_compacted_context` callback (memory store sink in TS) is exposed
as an optional `on_compacted` parameter — the runtime owns persistence.
"""

from __future__ import annotations

import json
from collections import OrderedDict
from typing import Callable, Iterable

from .token_estimator import estimate_total_tokens
from .types import LLMMessage, SmartCompressResult


# ============================================================
# Thresholds — keep in lockstep with src/providers/modelDefaults.ts
# ============================================================

CONTEXT_TOKEN_CEILING = 120_000
AUTO_COMPACT_THRESHOLD = 0.75
FULL_COMPACT_THRESHOLD = 0.90

# Default sliding window sizes (overridable per call).
DEFAULT_PRESERVE_RECENT = 20
DEFAULT_MAX_RECENT_AUTO = 20

# Long-message thresholds for in-place trimming (Layer 1).
TOOL_OUTPUT_TRIM_THRESHOLD = 200
TOOL_OUTPUT_TRIM_MAX_MESSAGE = 80
ASSISTANT_REASONING_TRIM_THRESHOLD = 500
ASSISTANT_REASONING_TRIM_LENGTH = 200
ASSISTANT_REASONING_TAIL_OFFSET = 5  # don't trim the last 5 before cutoff

# Layer 1 minimum message count — below this we don't bother.
LAYER_1_MIN_MESSAGES = 30


# ============================================================
# Layer 1 — MicroCompact (in-place)
# ============================================================

def micro_compact(messages: list[LLMMessage], preserve_recent: int = DEFAULT_PRESERVE_RECENT) -> None:
    """Trim verbose tool outputs and old assistant reasoning in place.

    Mirrors TS `microCompact` 1:1:
      - tool messages with content > 200 chars: re-encode as `{success, message[:80]}`
      - assistant text > 500 chars and not in the last 5 before cutoff:
        truncate to first 200 chars + `...`

    No memory allocation other than the trimmed strings; safe to call
    every round.
    """
    cutoff = len(messages) - preserve_recent
    if cutoff <= 0:
        return

    for i in range(cutoff):
        m = messages[i]
        # Trim verbose tool outputs.
        if m.role == "tool" and isinstance(m.content, str) and len(m.content) > TOOL_OUTPUT_TRIM_THRESHOLD:
            try:
                parsed = json.loads(m.content)
                m.content = json.dumps(
                    {
                        "success": parsed.get("success"),
                        "message": str(parsed.get("message") or "")[:TOOL_OUTPUT_TRIM_MAX_MESSAGE],
                    },
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
            except (ValueError, TypeError):
                # Non-JSON content — leave it alone.
                pass

        # Trim long assistant reasoning.
        if (
            m.role == "assistant"
            and isinstance(m.content, str)
            and len(m.content) > ASSISTANT_REASONING_TRIM_THRESHOLD
            and i < cutoff - ASSISTANT_REASONING_TAIL_OFFSET
        ):
            m.content = m.content[:ASSISTANT_REASONING_TRIM_LENGTH] + "..."


# ============================================================
# Layer 2 — AutoCompact (structured summary)
# ============================================================

OnCompactedFn = Callable[[str, list[str]], None]


def auto_compact(
    messages: list[LLMMessage],
    max_recent: int = DEFAULT_MAX_RECENT_AUTO,
    on_compacted: OnCompactedFn | None = None,
) -> list[LLMMessage]:
    """Replace older-than-max_recent messages with one structured summary.

    The summary block has up to three lines (each elided if empty):
        用户请求: <last 3 user messages, 80-char each>
        执行工具: <unique tool names with x<count> dedup>
        关键结果: <last 5 tool results, 60-char each, [FAIL] prefix on failures>

    Returns a new list whose first element is the summary `LLMMessage`
    followed by `recent`. The original `messages` list is not mutated.
    """
    if len(messages) <= max_recent:
        return list(messages)

    older = messages[:-max_recent]
    recent = messages[-max_recent:]

    user_actions: list[str] = []
    tools_executed: list[str] = []
    key_results: list[str] = []

    for m in older:
        if m.role == "user" and isinstance(m.content, str):
            user_actions.append(m.content[:80])
        elif m.role == "tool" and isinstance(m.content, str):
            try:
                parsed = json.loads(m.content)
                if parsed.get("success"):
                    key_results.append(str(parsed.get("message") or "")[:60])
                else:
                    key_results.append(f"[FAIL] {str(parsed.get('message') or '')[:60]}")
            except (ValueError, TypeError):
                key_results.append(m.content[:60])
        elif m.role == "assistant" and m.tool_calls:
            for tc in m.tool_calls:
                fn = tc.get("function") if isinstance(tc, dict) else None
                name = fn.get("name") if isinstance(fn, dict) else None
                if name:
                    tools_executed.append(str(name))

    # Deduplicate tool names with counts, preserving insertion order.
    tool_counts: OrderedDict[str, int] = OrderedDict()
    for t in tools_executed:
        tool_counts[t] = tool_counts.get(t, 0) + 1
    tool_summary = ", ".join(
        f"{name}(x{count})" if count > 1 else name
        for name, count in tool_counts.items()
    )

    summary_lines = [
        f"用户请求: {'; '.join(user_actions[-3:])}" if user_actions else "",
        f"执行工具: {tool_summary}" if tool_summary else "",
        f"关键结果: {'; '.join(key_results[-5:])}" if key_results else "",
    ]
    summary_lines = [line for line in summary_lines if line]

    compacted_msg = LLMMessage(
        role="assistant",
        content=f"[上下文摘要 — {len(older)} 条消息压缩]\n" + "\n".join(summary_lines) + "\n[/摘要]",
    )

    if on_compacted is not None:
        on_compacted("\n".join(summary_lines), list(tool_counts.keys()))

    return [compacted_msg, *recent]


# ============================================================
# Layer 3 — FullCompact (nuclear)
# ============================================================

def full_compact(
    messages: list[LLMMessage],
    *,
    canvas_snapshot: str = "",
    plan_summary: str | None = None,
) -> list[LLMMessage]:
    """Collapse the whole conversation to a single summary + the last user msg.

    `canvas_snapshot` and `plan_summary` are accepted as parameters
    instead of read from a global store — the runtime owns those data
    sources, mirroring the injection pattern used by `build_segments`.
    """
    last_user = next((m for m in reversed(messages) if m.role == "user"), None)

    all_tools: list[str] = []
    all_results: list[str] = []
    for m in messages:
        if m.role == "assistant" and m.tool_calls:
            for tc in m.tool_calls:
                fn = tc.get("function") if isinstance(tc, dict) else None
                name = fn.get("name") if isinstance(fn, dict) else None
                if name:
                    all_tools.append(str(name))
        if m.role == "tool" and isinstance(m.content, str):
            try:
                parsed = json.loads(m.content)
                if parsed.get("success") is False:
                    all_results.append(f"[FAIL] {str(parsed.get('message') or '')[:50]}")
            except (ValueError, TypeError):
                pass

    tool_counts: OrderedDict[str, int] = OrderedDict()
    for t in all_tools:
        tool_counts[t] = tool_counts.get(t, 0) + 1
    tool_summary = ", ".join(
        f"{name}(x{count})" if count > 1 else name
        for name, count in tool_counts.items()
    )

    plan_str = f"\n当前计划: {plan_summary}" if plan_summary else ""

    parts: Iterable[str] = filter(
        None,
        [
            f"[全量上下文压缩 — {len(messages)} 条消息重置]",
            f"工具调用总计: {tool_summary}",
            f"失败记录: {'; '.join(all_results[-3:])}" if all_results else "",
            f"画布状态: {canvas_snapshot[:300]}",
            plan_str,
            "[/压缩]",
        ],
    )

    full_summary = LLMMessage(role="assistant", content="\n".join(parts))

    result: list[LLMMessage] = [full_summary]
    if last_user is not None:
        result.append(last_user)
    return result


# ============================================================
# Smart dispatcher
# ============================================================

def smart_compress(
    messages: list[LLMMessage],
    *,
    context_ceiling: int = CONTEXT_TOKEN_CEILING,
    auto_threshold: float = AUTO_COMPACT_THRESHOLD,
    full_threshold: float = FULL_COMPACT_THRESHOLD,
    auto_max_recent: int = DEFAULT_MAX_RECENT_AUTO,
    canvas_snapshot: str = "",
    plan_summary: str | None = None,
    on_compacted: OnCompactedFn | None = None,
) -> SmartCompressResult:
    """Pick the right compaction layer based on token usage.

    Layer thresholds (defaults match `src/providers/modelDefaults.ts`):
      - usage ≥ 0.90 ceiling     → Layer 3 (full_compact)
      - usage ≥ 0.75 ceiling     → Layer 2 (auto_compact)
      - len(messages) > 30       → Layer 1 (micro_compact, in-place)
      - else                     → Layer 0 (no-op)
    """
    tokens = estimate_total_tokens(messages)
    usage = tokens / context_ceiling if context_ceiling > 0 else 0.0

    # Layer 3
    if usage >= full_threshold:
        compacted = full_compact(messages, canvas_snapshot=canvas_snapshot, plan_summary=plan_summary)
        return SmartCompressResult(messages=compacted, compressed=True, layer=3)

    # Layer 2
    if usage >= auto_threshold:
        compacted = auto_compact(messages, max_recent=auto_max_recent, on_compacted=on_compacted)
        return SmartCompressResult(messages=compacted, compressed=True, layer=2)

    # Layer 1 — in place
    if len(messages) > LAYER_1_MIN_MESSAGES:
        micro_compact(messages)
        return SmartCompressResult(messages=messages, compressed=False, layer=1)

    return SmartCompressResult(messages=messages, compressed=False, layer=0)
