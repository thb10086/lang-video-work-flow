"""Tests for `app.agents.prompts.builder` (task 0.2.4).

Covers:
  - Segment ordering matches the TS layered prompt (chatPromptBuilder.ts).
  - Stability tiers are correct so `build_system_content_blocks` puts
    cache_control on the right block.
  - Optional segments (skills / image_hint / memory) elide when their
    inputs are empty.
  - The core segment substitutes `default_video_model` and embeds the
    injected `prompt_craft_ref` verbatim.
  - `flatten_segments` produces a `\\n\\n`-joined string equivalent to
    TS `buildAgentSystemPrompt`.
  - `build_system_content_blocks` attaches a single cache_control marker
    on the last cacheable segment (Anthropic limit ≤ 4 breakpoints).
"""

from __future__ import annotations

import pytest

from app.agents.prompts import (
    BuildOptions,
    build_segments,
    flatten_segments,
    build_system_content_blocks,
)


# ============================================================
# Fixtures
# ============================================================

@pytest.fixture
def opts_minimal() -> BuildOptions:
    """Minimal config — prompt_craft_ref still injected.

    `prompt_craft_ref` is no longer part of the core segment (task 0.2.6
    promoted it to its own segment), so this fixture's resulting
    `build_segments` output has 4 segments: core, prompt_craft_ref, role,
    canvas_state.
    """
    return BuildOptions(
        role_prompt="ROLE_PROMPT_TEXT",
        canvas_snapshot="画布为空。",
        prompt_craft_ref="### 提示词工程速查",
        phase="pre_production",
    )


@pytest.fixture
def opts_full() -> BuildOptions:
    """All optional segments present, image_count > 0."""
    return BuildOptions(
        role_prompt="ROLE_PROMPT_TEXT",
        canvas_snapshot="3 节点, 2 连线",
        prompt_craft_ref="### CRAFT_REF",
        phase="production",
        skills_prompt="SKILLS_TEXT",
        memory_context="MEMORY_TEXT",
        image_count=3,
        default_video_model="custom-model-xyz",
    )


# ============================================================
# Segment ordering + ids
# ============================================================

class TestSegmentOrder:
    def test_minimal_emits_four_segments(self, opts_minimal: BuildOptions) -> None:
        # With prompt_craft_ref injected, fixture yields 4 segments:
        # core + prompt_craft_ref + role + canvas_state.
        segs = build_segments(opts_minimal)
        assert [s.id for s in segs] == ["core", "prompt_craft_ref", "role", "canvas_state"]

    def test_minimal_without_craft_ref_emits_three_segments(self) -> None:
        # When prompt_craft_ref is empty (default-empty router config),
        # only the bare contract remains: core + role + canvas_state.
        opts = BuildOptions(
            role_prompt="R",
            canvas_snapshot="C",
            prompt_craft_ref="",
            phase="pre_production",
        )
        segs = build_segments(opts)
        assert [s.id for s in segs] == ["core", "role", "canvas_state"]

    def test_full_emits_seven_segments_in_order(self, opts_full: BuildOptions) -> None:
        segs = build_segments(opts_full)
        assert [s.id for s in segs] == [
            "core",
            "prompt_craft_ref",
            "role",
            "skills:production:withImages",
            "image_hint",
            "memory",
            "canvas_state",
        ]

    def test_prompt_craft_ref_segment_carries_text_verbatim(self) -> None:
        opts = BuildOptions(
            role_prompt="R",
            canvas_snapshot="C",
            prompt_craft_ref="### MY_QUICK_REF\nbody",
            phase="pre_production",
        )
        segs = build_segments(opts)
        ref = next(s for s in segs if s.id == "prompt_craft_ref")
        assert ref.text == "### MY_QUICK_REF\nbody"
        assert ref.stability == "semi-stable"

    def test_skills_segment_id_omits_with_images_when_no_images(self) -> None:
        opts = BuildOptions(
            role_prompt="R",
            canvas_snapshot="C",
            prompt_craft_ref="PCR",
            phase="post_production",
            skills_prompt="SKILLS",
            image_count=0,
        )
        segs = build_segments(opts)
        skills = next(s for s in segs if s.id.startswith("skills:"))
        assert skills.id == "skills:post_production"  # no `:withImages`

    def test_canvas_state_is_always_last(self, opts_full: BuildOptions) -> None:
        segs = build_segments(opts_full)
        assert segs[-1].id == "canvas_state"


class TestStabilityTiers:
    def test_core_is_stable(self, opts_full: BuildOptions) -> None:
        segs = build_segments(opts_full)
        assert next(s for s in segs if s.id == "core").stability == "stable"

    def test_role_skills_and_craft_ref_are_semi_stable(self, opts_full: BuildOptions) -> None:
        segs = build_segments(opts_full)
        assert next(s for s in segs if s.id == "role").stability == "semi-stable"
        skills = next(s for s in segs if s.id.startswith("skills:"))
        assert skills.stability == "semi-stable"
        ref = next(s for s in segs if s.id == "prompt_craft_ref")
        assert ref.stability == "semi-stable"

    def test_dynamic_segments_are_dynamic(self, opts_full: BuildOptions) -> None:
        segs = build_segments(opts_full)
        for sid in ("image_hint", "memory", "canvas_state"):
            assert next(s for s in segs if s.id == sid).stability == "dynamic"


# ============================================================
# Optional-segment elision
# ============================================================

class TestOptionalSegmentsElide:
    def test_skills_elided_when_empty_or_none(self) -> None:
        for skills in (None, ""):
            opts = BuildOptions(
                role_prompt="R",
                canvas_snapshot="C",
                prompt_craft_ref="PCR",
                phase="pre_production",
                skills_prompt=skills,
            )
            segs = build_segments(opts)
            assert not any(s.id.startswith("skills:") for s in segs)

    def test_image_hint_elided_when_image_count_zero(self) -> None:
        opts = BuildOptions(
            role_prompt="R",
            canvas_snapshot="C",
            prompt_craft_ref="PCR",
            phase="pre_production",
            image_count=0,
        )
        segs = build_segments(opts)
        assert not any(s.id == "image_hint" for s in segs)

    def test_memory_elided_when_context_falsy(self) -> None:
        for mem in (None, ""):
            opts = BuildOptions(
                role_prompt="R",
                canvas_snapshot="C",
                prompt_craft_ref="PCR",
                phase="pre_production",
                memory_context=mem,
            )
            segs = build_segments(opts)
            assert not any(s.id == "memory" for s in segs)


# ============================================================
# Core text content (byte-equivalent fragments from TS source)
# ============================================================

class TestCoreSegmentContent:
    def test_default_video_model_substituted(self) -> None:
        opts = BuildOptions(
            role_prompt="R",
            canvas_snapshot="C",
            prompt_craft_ref="PCR",
            phase="pre_production",
            default_video_model="my-custom-model",
        )
        core = build_segments(opts)[0]
        assert "当前为 my-custom-model" in core.text

    def test_prompt_craft_ref_no_longer_in_core(self) -> None:
        # 0.2.6 promoted prompt_craft_ref to its own segment so the core
        # text never contains the ref body — this is the regression
        # guard for that promotion.
        opts = BuildOptions(
            role_prompt="R",
            canvas_snapshot="C",
            prompt_craft_ref="### MY_QUICK_REF\nbody",
            phase="pre_production",
        )
        core = build_segments(opts)[0]
        assert "### MY_QUICK_REF" not in core.text
        assert not core.text.endswith("### MY_QUICK_REF\nbody")

    @pytest.mark.parametrize("anchor", [
        # The slim core MUST keep every load-bearing structural anchor.
        # If a refactor removes any of these the core has lost a contract
        # the rest of the agent depends on.
        "## 使命",                              # mission heading
        "通过工具调用完整驱动 AI 视频制片流程",  # mission body byte-equivalent to TS
        "**分析 → 规划 → 行动 → 验证**",       # 4-step loop tag
        "**HALT 条件**",                       # HALT clause
        "## 模型参数",                          # model params heading
        "## 错误处理协议",                      # error protocol heading
        "## 输出规范",                          # output spec heading
        "## 约束",                              # constraints heading
        "禁用 emoji",                          # explicit no-emoji rule
    ])
    def test_byte_equivalent_anchors_present_in_core(self, anchor: str) -> None:
        opts = BuildOptions(
            role_prompt="R", canvas_snapshot="C", prompt_craft_ref="PCR",
            phase="pre_production",
        )
        core = build_segments(opts)[0]
        assert anchor in core.text, f"missing anchor: {anchor!r}"

    def test_uses_chinese_full_width_comma_not_ascii(self) -> None:
        # Catches the regression where someone uses Western "," in copy.
        opts = BuildOptions(
            role_prompt="R", canvas_snapshot="C", prompt_craft_ref="PCR",
            phase="pre_production",
        )
        core = build_segments(opts)[0]
        # The mission sentence uses 「，」 (U+FF0C) — assert it stuck.
        assert "搭建、角色设计、分镜拆解，到关键帧" in core.text


# ============================================================
# Injected text passed through verbatim
# ============================================================

class TestInjectedText:
    def test_role_segment_text_is_role_prompt_verbatim(self, opts_full: BuildOptions) -> None:
        segs = build_segments(opts_full)
        role = next(s for s in segs if s.id == "role")
        assert role.text == "ROLE_PROMPT_TEXT"

    def test_skills_segment_wraps_text_with_phase_header(self, opts_full: BuildOptions) -> None:
        segs = build_segments(opts_full)
        skills = next(s for s in segs if s.id.startswith("skills:"))
        assert skills.text == "### 可用技能 (production)\n\nSKILLS_TEXT"

    def test_memory_segment_wraps_text_with_header(self, opts_full: BuildOptions) -> None:
        segs = build_segments(opts_full)
        mem = next(s for s in segs if s.id == "memory")
        assert mem.text == "### 项目记忆\n\nMEMORY_TEXT"

    def test_canvas_state_segment_includes_separator_and_header(self, opts_full: BuildOptions) -> None:
        segs = build_segments(opts_full)
        canvas = next(s for s in segs if s.id == "canvas_state")
        assert canvas.text == "---\n\n## 当前上下文\n\n### 画布状态\n\n3 节点, 2 连线"

    def test_image_hint_includes_image_count(self) -> None:
        for n in (1, 5, 10):
            opts = BuildOptions(
                role_prompt="R", canvas_snapshot="C", prompt_craft_ref="PCR",
                phase="pre_production", image_count=n,
            )
            segs = build_segments(opts)
            hint = next(s for s in segs if s.id == "image_hint")
            assert f"用户上传了 {n} 张图像" in hint.text


# ============================================================
# flatten_segments
# ============================================================

class TestFlatten:
    def test_flatten_joins_with_double_newline(self, opts_full: BuildOptions) -> None:
        segs = build_segments(opts_full)
        joined = flatten_segments(segs)
        # Each adjacent pair of segments must be separated by exactly "\n\n".
        # The role segment text is ROLE_PROMPT_TEXT — it should appear
        # surrounded by \n\n on both sides.
        assert "\n\nROLE_PROMPT_TEXT\n\n" in joined

    def test_flatten_preserves_byte_fidelity(self, opts_full: BuildOptions) -> None:
        segs = build_segments(opts_full)
        joined = flatten_segments(segs)
        # Sum of segment texts (with empty filtered) plus joiners equals the flat string.
        non_empty = [s.text for s in segs if s.text]
        expected = "\n\n".join(non_empty)
        assert joined == expected


# ============================================================
# build_system_content_blocks (Anthropic structured content array)
# ============================================================

class TestSystemContentBlocks:
    def test_one_block_per_non_empty_segment(self, opts_full: BuildOptions) -> None:
        segs = build_segments(opts_full)
        blocks = build_system_content_blocks(segs)
        non_empty = [s for s in segs if s.text]
        assert len(blocks) == len(non_empty)

    def test_at_most_one_cache_control_marker(self, opts_full: BuildOptions) -> None:
        segs = build_segments(opts_full)
        blocks = build_system_content_blocks(segs)
        markers = [b for b in blocks if b.cache_control is not None]
        assert len(markers) == 1

    def test_cache_control_attached_to_last_cacheable_segment(self, opts_full: BuildOptions) -> None:
        segs = build_segments(opts_full)
        blocks = build_system_content_blocks(segs)
        marked = next(b for b in blocks if b.cache_control is not None)
        # With opts_full, skills is the last semi-stable segment.
        skills = next(s for s in segs if s.id.startswith("skills:"))
        assert marked.text == skills.text

    def test_cache_control_falls_back_to_role_when_no_skills(self) -> None:
        opts = BuildOptions(
            role_prompt="R", canvas_snapshot="C", prompt_craft_ref="",
            phase="pre_production",
            skills_prompt=None,
        )
        segs = build_segments(opts)
        blocks = build_system_content_blocks(segs)
        marked = next(b for b in blocks if b.cache_control is not None)
        # No prompt_craft_ref + no skills → role is the last cacheable segment.
        assert marked.text == "R"

    def test_cache_control_attaches_to_prompt_craft_ref_when_role_after_it_empty(self) -> None:
        # Role text is required (non-empty), so when only craft_ref + role
        # are cacheable, cache lands on role (last). When skills also
        # present, cache lands on skills (last). The order check above
        # already covers the skills case; here we lock in that craft_ref
        # is *between* core and role and itself cacheable.
        opts = BuildOptions(
            role_prompt="R", canvas_snapshot="C",
            prompt_craft_ref="PCR_BODY",
            phase="pre_production",
            skills_prompt=None,
        )
        segs = build_segments(opts)
        # Order: core, prompt_craft_ref, role, canvas_state
        ids = [s.id for s in segs]
        assert ids.index("prompt_craft_ref") < ids.index("role")
        # Cache lands on role (the last cacheable).
        blocks = build_system_content_blocks(segs)
        marked = next(b for b in blocks if b.cache_control is not None)
        assert marked.text == "R"

    def test_to_dict_emits_anthropic_compatible_shape(self, opts_full: BuildOptions) -> None:
        segs = build_segments(opts_full)
        blocks = build_system_content_blocks(segs)
        marked = next(b for b in blocks if b.cache_control is not None)
        d = marked.to_dict()
        assert d["type"] == "text"
        assert d["text"] == marked.text
        assert d["cache_control"] == {"type": "ephemeral"}

    def test_dynamic_blocks_have_no_cache_control(self, opts_full: BuildOptions) -> None:
        segs = build_segments(opts_full)
        blocks = build_system_content_blocks(segs)
        # canvas_state, image_hint, memory are dynamic — never marked.
        # We can't go by id from blocks (they don't carry id), so go by text.
        canvas_text = next(s.text for s in segs if s.id == "canvas_state")
        canvas_block = next(b for b in blocks if b.text == canvas_text)
        assert canvas_block.cache_control is None
