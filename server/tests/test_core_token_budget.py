"""Tests for the core segment token budget (task 0.2.6).

The Agent's `core` segment is the load-bearing contract every other
prompt component depends on. Spec mandates it stay under 400 tokens
(measured with the same `chars/3.5` heuristic the runtime uses for
budget tracking) so it:

  1. Fits comfortably in Anthropic's prompt-cache hot region without
     crowding out role/skills text.
  2. Leaves headroom for routine copy edits without immediately
     blowing the budget.
  3. Forces detail to live in the optional `agent_essentials` SKILL
     (preserved verbatim in `ESSENTIALS_TEXT`) instead of always-on
     core overhead.

These tests are deliberately small and focused: they fail loud when a
copy edit drives core back over 400 tokens, and they prove the removed
detail still exists in `ESSENTIALS_TEXT` so future SKILL wiring can
recover it without code archaeology.
"""

from __future__ import annotations

import pytest

from app.agents.prompts import (
    BuildOptions,
    CORE_TEMPLATE,
    ESSENTIALS_TEXT,
    build_segments,
    estimate_tokens,
)


# ============================================================
# Hard budget — task 0.2.6 acceptance criterion
# ============================================================

class TestCoreTokenBudget:
    def test_core_segment_under_400_tokens_with_default_model(self) -> None:
        # The default video model name is the longest reasonable injection
        # in production; if this passes, every shorter model id passes too.
        opts = BuildOptions(
            role_prompt="",
            canvas_snapshot="",
            prompt_craft_ref="",
            phase="pre_production",
            default_video_model="doubao-seedance-2-0",
        )
        core = build_segments(opts)[0]
        tokens = estimate_tokens(core.text)
        assert tokens <= 400, (
            f"core segment is {tokens} tokens (> 400 budget). "
            f"Trim CORE_TEMPLATE in builder.py and move detail to "
            f"ESSENTIALS_TEXT or the agent_essentials SKILL."
        )

    def test_core_segment_under_400_tokens_with_long_model_name(self) -> None:
        # Stress-test with a deliberately long custom model id to ensure
        # substitution headroom is real, not coincidence.
        opts = BuildOptions(
            role_prompt="",
            canvas_snapshot="",
            prompt_craft_ref="",
            phase="pre_production",
            default_video_model="provider-x/very-long-model-id-2026-04-preview",
        )
        core = build_segments(opts)[0]
        tokens = estimate_tokens(core.text)
        assert tokens <= 400, f"core segment is {tokens} tokens with long model id"

    def test_core_template_alone_well_under_budget(self) -> None:
        # Direct measurement of the raw template (with default substitution)
        # so a regression that comes from `prompt_craft_ref` accidentally
        # bleeding back into core would still fail the per-segment test
        # above but this one would still pass — it serves as a quick
        # locator for "is the template itself the problem".
        rendered = CORE_TEMPLATE.format(default_video_model="doubao-seedance-2-0")
        tokens = estimate_tokens(rendered)
        assert tokens <= 400


# ============================================================
# Removed detail must survive in ESSENTIALS_TEXT
# ============================================================

class TestEssentialsPreservation:
    """Detail removed from core must remain accessible in ESSENTIALS_TEXT.

    Future task wires `agent_essentials` SKILL to this constant; until
    then any caller can inject it directly via
    `BuildOptions.skills_prompt` for sessions that need the longer form.
    """

    @pytest.mark.parametrize("anchor", [
        # Detailed execution loop (4 numbered steps with full prose).
        "## 执行循环（详细）",
        "**分析**：读取画布状态",
        "**规划**：复杂任务先 `plan_task` 制定步骤",
        "**行动**：最小工具集完成当前步骤",
        "**验证**：`get_node_output` 确认输出存在",
        # Full error-protocol table.
        "## 错误处理协议（详细）",
        "暂时性错误",
        "API 负载、网络超时、未返回图片",
        "逻辑错误",
        "连续失败",
        "API 过载",
        # Output-format examples.
        "## 输出规范（详细）",
        "**全部成功**：「已完成 [操作描述]",
        "**部分失败**：「[成功项] 完成；[失败项]",
        "**HALT/阻塞**：「遇到阻塞：[原因]",
        # All five constraint lines, intact.
        "## 约束（详细）",
        "**内容质量**",
        "**验证驱动**",
        "**提示词语言**",
        "**信息隔离**",
        "**无 emoji**",
    ])
    def test_essentials_text_carries_removed_detail(self, anchor: str) -> None:
        assert anchor in ESSENTIALS_TEXT, f"missing from ESSENTIALS_TEXT: {anchor!r}"

    def test_essentials_text_is_non_trivial_size(self) -> None:
        # If somebody empties ESSENTIALS_TEXT by accident this should be
        # the canary. 200 chars is well below the actual content size
        # (~900 chars at time of writing) but high enough to detect a
        # full deletion vs an intentional small trim.
        assert len(ESSENTIALS_TEXT) > 200

    def test_essentials_text_does_not_overlap_slim_core(self) -> None:
        # Sanity: the "detailed" string is *additional* to core, not a
        # duplicate of it. A few specific tokens that exist *only* in
        # ESSENTIALS — full table cells, the numbered constraint list —
        # should NOT have crept back into the slim core.
        opts = BuildOptions(
            role_prompt="", canvas_snapshot="", prompt_craft_ref="",
            phase="pre_production",
        )
        core = build_segments(opts)[0]
        # Table-cell phrasings only present in the detailed protocol.
        assert "API 负载、网络超时、未返回图片" not in core.text
        # Numbered constraints unique to the detailed list.
        assert "**信息隔离**" not in core.text
