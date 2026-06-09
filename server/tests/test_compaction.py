"""Tests for `app.agents.prompts.compaction` (task 0.2.5).

Three layers + dispatcher must mirror the TS source under
`src/store/chatPromptBuilder.ts`. Where TS reaches into a Zustand store
to record the compaction event we accept an `on_compacted` callback so
the persistence side-effect is testable in isolation.
"""

from __future__ import annotations

import json

from app.agents.prompts import (
    LLMMessage,
    estimate_tokens,
    estimate_total_tokens,
    micro_compact,
    auto_compact,
    full_compact,
    smart_compress,
)
from app.agents.prompts.compaction import (
    CONTEXT_TOKEN_CEILING,
    AUTO_COMPACT_THRESHOLD,
    FULL_COMPACT_THRESHOLD,
)


# ============================================================
# Token estimator parity
# ============================================================

class TestTokenEstimator:
    def test_empty_string_zero_tokens(self) -> None:
        assert estimate_tokens("") == 0
        assert estimate_tokens(None) == 0

    def test_chars_over_three_point_five_ceil(self) -> None:
        # 7 chars → ceil(7/3.5) = 2
        assert estimate_tokens("abcdefg") == 2
        # 8 chars → ceil(8/3.5) = 3
        assert estimate_tokens("abcdefgh") == 3
        # Single char → ceil(1/3.5) = 1
        assert estimate_tokens("a") == 1

    def test_message_overhead_is_four_tokens(self) -> None:
        # Empty message should still count overhead.
        m = LLMMessage(role="user", content="")
        # 4 overhead + 0 content = 4.
        from app.agents.prompts import estimate_message_tokens
        assert estimate_message_tokens(m) == 4

    def test_image_part_costs_one_thousand(self) -> None:
        from app.agents.prompts import estimate_message_tokens
        m = LLMMessage(
            role="user",
            content=[
                {"type": "text", "text": "hi"},
                {"type": "image_url", "image_url": {"url": "x"}},
            ],
        )
        # 4 overhead + ceil(2/3.5)=1 + 1000 = 1005
        assert estimate_message_tokens(m) == 1005

    def test_total_sums_messages(self) -> None:
        msgs = [
            LLMMessage(role="user", content="abcdefg"),     # 4 + 2 = 6
            LLMMessage(role="assistant", content="hi"),     # 4 + 1 = 5
        ]
        assert estimate_total_tokens(msgs) == 11


# ============================================================
# Layer 1 — micro_compact
# ============================================================

class TestMicroCompact:
    def test_noop_when_below_preserve_recent(self) -> None:
        msgs = [LLMMessage(role="user", content="x" * 1000) for _ in range(5)]
        original = [m.content for m in msgs]
        micro_compact(msgs, preserve_recent=20)
        assert [m.content for m in msgs] == original

    def test_trims_long_tool_outputs_to_success_message_pair(self) -> None:
        long_payload = json.dumps({"success": True, "message": "ok " * 200, "data": {"x": 1}}, ensure_ascii=False)
        msgs = [LLMMessage(role="tool", content=long_payload) for _ in range(25)]
        msgs.extend(LLMMessage(role="user", content="recent") for _ in range(20))
        micro_compact(msgs, preserve_recent=20)
        # First 25 are old → trimmed. Each becomes a 2-key JSON object.
        for m in msgs[:25]:
            parsed = json.loads(m.content)  # type: ignore[arg-type]
            assert parsed.keys() == {"success", "message"}
            assert len(parsed["message"]) <= 80

    def test_keeps_short_tool_outputs_as_is(self) -> None:
        short = json.dumps({"success": True, "message": "ok"})
        msgs = [LLMMessage(role="tool", content=short) for _ in range(25)]
        msgs.extend(LLMMessage(role="user", content="recent") for _ in range(20))
        micro_compact(msgs, preserve_recent=20)
        for m in msgs[:25]:
            assert m.content == short  # unchanged

    def test_trims_long_assistant_reasoning_with_ellipsis(self) -> None:
        long = "reasoning " * 200  # 2000 chars > 500 threshold
        msgs = [LLMMessage(role="assistant", content=long) for _ in range(30)]
        msgs.extend(LLMMessage(role="user", content="recent") for _ in range(20))
        # cutoff = len(msgs) - preserve_recent = 50 - 20 = 30
        # The trim guard is `i < cutoff - 5` i.e. i < 25.
        # So msgs[0..24] get trimmed, msgs[25..29] do not, msgs[30..49] are
        # the recent window.
        micro_compact(msgs, preserve_recent=20)
        for m in msgs[:25]:
            assert m.content == long[:200] + "..."
        for m in msgs[25:30]:
            # last 5 of the older window are kept verbatim
            assert m.content == long

    def test_leaves_recent_window_alone(self) -> None:
        long = "x" * 1000
        msgs = [LLMMessage(role="assistant", content=long) for _ in range(30)]
        recent = [LLMMessage(role="assistant", content=long) for _ in range(20)]
        msgs.extend(recent)
        micro_compact(msgs, preserve_recent=20)
        for m in msgs[-20:]:
            assert m.content == long  # untouched


# ============================================================
# Layer 2 — auto_compact
# ============================================================

class TestAutoCompact:
    def test_returns_input_when_within_window(self) -> None:
        msgs = [LLMMessage(role="user", content=f"u{i}") for i in range(10)]
        out = auto_compact(msgs, max_recent=20)
        assert out == msgs

    def test_summarises_older_and_keeps_recent(self) -> None:
        older = [LLMMessage(role="user", content=f"old user {i}") for i in range(5)]
        older.extend([
            LLMMessage(role="assistant", content=None, tool_calls=[
                {"function": {"name": "create_video_node"}},
            ])
            for _ in range(3)
        ])
        recent = [LLMMessage(role="user", content=f"recent {i}") for i in range(20)]
        out = auto_compact(older + recent, max_recent=20)

        assert len(out) == 21  # 1 summary + 20 recent
        summary = out[0]
        assert summary.role == "assistant"
        assert "[上下文摘要" in str(summary.content)
        assert "用户请求:" in str(summary.content)
        assert "create_video_node" in str(summary.content)
        # Recent are forwarded unchanged.
        assert out[1:] == recent

    def test_dedups_repeated_tool_names_with_count(self) -> None:
        older = [
            LLMMessage(role="assistant", content=None, tool_calls=[
                {"function": {"name": "get_node_output"}},
            ])
            for _ in range(4)
        ]
        recent = [LLMMessage(role="user", content=f"r{i}") for i in range(20)]
        out = auto_compact(older + recent, max_recent=20)
        assert "get_node_output(x4)" in str(out[0].content)

    def test_calls_on_compacted_with_summary_and_tool_names(self) -> None:
        seen: list[tuple[str, list[str]]] = []
        older = [
            LLMMessage(role="assistant", content=None, tool_calls=[
                {"function": {"name": "list_models"}},
            ])
            for _ in range(2)
        ]
        recent = [LLMMessage(role="user", content="r") for _ in range(20)]
        auto_compact(older + recent, on_compacted=lambda s, t: seen.append((s, t)))
        assert len(seen) == 1
        summary_text, tool_names = seen[0]
        assert "list_models" in summary_text
        assert tool_names == ["list_models"]

    def test_marks_failed_results(self) -> None:
        older = [
            LLMMessage(role="user", content="ask"),
            LLMMessage(role="tool", content=json.dumps({"success": False, "message": "boom"})),
        ]
        recent = [LLMMessage(role="user", content="r") for _ in range(20)]
        out = auto_compact(older + recent)
        assert "[FAIL] boom" in str(out[0].content)


# ============================================================
# Layer 3 — full_compact
# ============================================================

class TestFullCompact:
    def test_collapses_to_summary_plus_last_user(self) -> None:
        msgs = [
            LLMMessage(role="user", content="first"),
            LLMMessage(role="assistant", content=None, tool_calls=[
                {"function": {"name": "plan_task"}},
            ]),
            LLMMessage(role="user", content="last user message"),
        ]
        out = full_compact(msgs, canvas_snapshot="3 节点", plan_summary="某计划 (1/3 完成)")
        assert len(out) == 2
        assert out[0].role == "assistant"
        assert "[全量上下文压缩" in str(out[0].content)
        assert "plan_task" in str(out[0].content)
        assert "3 节点" in str(out[0].content)
        assert "某计划 (1/3 完成)" in str(out[0].content)
        # last user kept verbatim
        assert out[1].content == "last user message"

    def test_truncates_canvas_snapshot_to_300_chars(self) -> None:
        big = "x" * 500
        out = full_compact(
            [LLMMessage(role="user", content="hi")],
            canvas_snapshot=big,
        )
        # The summary should embed exactly 300 chars of canvas.
        assert "x" * 300 in str(out[0].content)
        # And not 301 — be picky.
        assert ("画布状态: " + "x" * 301) not in str(out[0].content)

    def test_only_emits_failure_records(self) -> None:
        msgs = [
            LLMMessage(role="user", content="hi"),
            LLMMessage(role="tool", content=json.dumps({"success": True, "message": "fine"})),
            LLMMessage(role="tool", content=json.dumps({"success": False, "message": "bad"})),
        ]
        out = full_compact(msgs)
        content = str(out[0].content)
        assert "[FAIL] bad" in content
        assert "fine" not in content  # successes ignored

    def test_emits_summary_only_when_no_user_message(self) -> None:
        out = full_compact([
            LLMMessage(role="assistant", content="just thinking"),
        ])
        assert len(out) == 1


# ============================================================
# Smart dispatcher
# ============================================================

class TestSmartCompress:
    def test_layer_zero_when_few_short_messages(self) -> None:
        msgs = [LLMMessage(role="user", content="hi") for _ in range(5)]
        result = smart_compress(msgs)
        assert result.layer == 0
        assert result.compressed is False

    def test_layer_one_in_place_when_many_messages(self) -> None:
        # 35 messages, all short → above the 30-msg layer-1 threshold but
        # nowhere near the 75% token threshold.
        msgs = [LLMMessage(role="user", content="x") for _ in range(35)]
        result = smart_compress(msgs)
        assert result.layer == 1
        assert result.compressed is False
        # Same list reference (in-place).
        assert result.messages is msgs

    def test_layer_two_when_above_auto_threshold(self) -> None:
        # Build messages large enough to cross 75% of CONTEXT_TOKEN_CEILING.
        # Need > 0.75 * 120_000 = 90_000 tokens; each 7000-char user msg
        # contributes ceil(7000/3.5)+4 = 2004 tokens. 50 of them = 100_200.
        big = "x" * 7000
        msgs = [LLMMessage(role="user", content=big) for _ in range(50)]
        # Sanity: usage in (auto, full)
        usage = estimate_total_tokens(msgs) / CONTEXT_TOKEN_CEILING
        assert AUTO_COMPACT_THRESHOLD <= usage < FULL_COMPACT_THRESHOLD
        result = smart_compress(msgs)
        assert result.layer == 2
        assert result.compressed is True

    def test_layer_three_when_above_full_threshold(self) -> None:
        # Need > 0.90 * 120_000 = 108_000 tokens. 60 × 7000-char msgs.
        big = "x" * 7000
        msgs = [LLMMessage(role="user", content=big) for _ in range(60)]
        usage = estimate_total_tokens(msgs) / CONTEXT_TOKEN_CEILING
        assert usage >= FULL_COMPACT_THRESHOLD
        result = smart_compress(msgs, canvas_snapshot="C")
        assert result.layer == 3
        assert result.compressed is True
        # Full compact returns at most 2 messages (summary + last user).
        assert len(result.messages) <= 2

    def test_layer_two_calls_on_compacted_callback(self) -> None:
        seen: list[str] = []
        big = "x" * 7000
        # Mix in an assistant tool_call so the summary has a non-empty
        # tool-name list — exercises the callback's second arg.
        msgs: list[LLMMessage] = []
        for _ in range(45):
            msgs.append(LLMMessage(role="user", content=big))
        msgs.append(LLMMessage(role="assistant", content=None, tool_calls=[
            {"function": {"name": "plan_task"}},
        ]))
        for _ in range(10):
            msgs.append(LLMMessage(role="user", content="recent"))
        smart_compress(msgs, on_compacted=lambda s, t: seen.append(s))
        assert len(seen) == 1
        assert "用户请求:" in seen[0] or "执行工具:" in seen[0]
