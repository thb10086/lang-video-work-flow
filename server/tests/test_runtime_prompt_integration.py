"""Tests for `prepare_prompt_node` integration with the prompt builder (task 0.2.7).

Scope: this test exercises the *node* in isolation, not the full
LangGraph compiled runtime. End-to-end LangGraph tests will land later
when the SSE wire is finished (Phase 1). For now, all we need to prove
is:

  - On round 0 the node prepends a single `system` message built from
    `app.agents.prompts.build_segments + flatten_segments`.
  - Subsequent rounds are no-ops (idempotent guard).
  - All `RuntimeConfig` prompt-resource fields propagate through to
    the rendered system text.
  - The phase mapper falls back to `pre_production` for `idle`/empty/
    unrecognised phase tags so the SKILLS section still loads.
  - `image_count` is derived from `user_images` length, not from any
    other source — the system text reflects it.
  - `RuntimeConfig` defaults preserve backward compatibility (no
    required new args; legacy `agent_runtime.py` / `subagent.py`
    callers continue to construct `RuntimeConfig(user_message=...,
    user_images=...)` without breakage).
"""

from __future__ import annotations

import asyncio
import pytest

from app.agents.runtime import (
    RuntimeConfig,
    RuntimeState,
    _phase_for_builder,
    prepare_prompt_node,
)


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ============================================================
# RuntimeConfig backward compatibility
# ============================================================

class TestRuntimeConfigDefaults:
    def test_minimal_construction_still_works(self) -> None:
        # Mirrors how `agent_runtime.py` and `subagent.py` build the config.
        cfg = RuntimeConfig(user_message="hello", user_images=[])
        assert cfg.role == "assistant"
        assert cfg.model == ""
        # New fields default to empty strings, not None — empty checks in
        # `prepare_prompt_node` rely on `or` semantics.
        assert cfg.role_prompt == ""
        assert cfg.skills_prompt == ""
        assert cfg.prompt_craft_ref == ""
        assert cfg.canvas_snapshot == ""
        assert cfg.memory_context == ""

    def test_with_all_resources_injected(self) -> None:
        cfg = RuntimeConfig(
            user_message="hi",
            user_images=[],
            role_prompt="R",
            skills_prompt="S",
            prompt_craft_ref="PCR",
            canvas_snapshot="CSV",
            memory_context="MEM",
        )
        assert cfg.role_prompt == "R"
        assert cfg.canvas_snapshot == "CSV"


# ============================================================
# Phase mapping (idle/empty → pre_production)
# ============================================================

class TestPhaseForBuilder:
    @pytest.mark.parametrize("incoming", ["pre_production", "production", "post_production"])
    def test_passes_through_valid_phases(self, incoming: str) -> None:
        assert _phase_for_builder(incoming) == incoming

    @pytest.mark.parametrize("incoming", ["idle", "", "planning", "unknown_string", "WORKFLOW"])
    def test_falls_back_for_unknown(self, incoming: str) -> None:
        assert _phase_for_builder(incoming) == "pre_production"


# ============================================================
# prepare_prompt_node — first-round behaviour
# ============================================================

class TestFirstRound:
    @pytest.mark.asyncio
    async def test_prepends_single_system_message(self) -> None:
        state: RuntimeState = {"round": 0, "phase": "production", "user_images": []}
        out = await prepare_prompt_node(state)
        assert "messages" in out
        assert len(out["messages"]) == 1
        assert out["messages"][0]["role"] == "system"

    @pytest.mark.asyncio
    async def test_system_text_contains_core_anchors(self) -> None:
        out = await prepare_prompt_node({"round": 0, "phase": "production", "user_images": []})
        text = out["messages"][0]["content"]
        # Anchors that must survive any future copy edits — these are the
        # load-bearing structure of the agent contract.
        for anchor in ("## 使命", "## 执行循环", "**HALT 条件", "## 错误处理协议", "## 输出规范", "## 约束"):
            assert anchor in text, f"missing core anchor {anchor!r}"

    @pytest.mark.asyncio
    async def test_role_prompt_propagates_into_system_text(self) -> None:
        state: RuntimeState = {
            "round": 0, "phase": "production", "user_images": [],
            "role_prompt": "MY_CUSTOM_ROLE_TEXT",
        }
        out = await prepare_prompt_node(state)
        assert "MY_CUSTOM_ROLE_TEXT" in out["messages"][0]["content"]

    @pytest.mark.asyncio
    async def test_skills_propagates_with_phase_header(self) -> None:
        state: RuntimeState = {
            "round": 0, "phase": "production", "user_images": [],
            "skills_prompt": "SKILLS_BODY_TEXT",
        }
        out = await prepare_prompt_node(state)
        text = out["messages"][0]["content"]
        assert "### 可用技能 (production)" in text
        assert "SKILLS_BODY_TEXT" in text

    @pytest.mark.asyncio
    async def test_memory_propagates_with_header(self) -> None:
        state: RuntimeState = {
            "round": 0, "phase": "production", "user_images": [],
            "memory_context": "REMEMBERED_FACT",
        }
        out = await prepare_prompt_node(state)
        text = out["messages"][0]["content"]
        assert "### 项目记忆" in text
        assert "REMEMBERED_FACT" in text

    @pytest.mark.asyncio
    async def test_canvas_snapshot_propagates_into_canvas_state_segment(self) -> None:
        state: RuntimeState = {
            "round": 0, "phase": "production", "user_images": [],
            "canvas_snapshot": "MY_CANVAS_DUMP",
        }
        out = await prepare_prompt_node(state)
        text = out["messages"][0]["content"]
        assert "### 画布状态" in text
        assert "MY_CANVAS_DUMP" in text

    @pytest.mark.asyncio
    async def test_canvas_default_when_empty(self) -> None:
        # Empty canvas string falls back to the same Chinese default the
        # TS getCanvasSnapshot() uses, so the prompt remains coherent.
        out = await prepare_prompt_node({"round": 0, "phase": "production", "user_images": []})
        assert "画布为空。" in out["messages"][0]["content"]

    @pytest.mark.asyncio
    async def test_image_count_derived_from_user_images(self) -> None:
        out = await prepare_prompt_node({
            "round": 0, "phase": "production",
            "user_images": ["data:image/png;base64,a", "data:image/png;base64,b", "data:image/png;base64,c"],
        })
        text = out["messages"][0]["content"]
        # Image-hint segment renders the count verbatim.
        assert "用户上传了 3 张图像" in text

    @pytest.mark.asyncio
    async def test_no_image_hint_when_no_images(self) -> None:
        out = await prepare_prompt_node({"round": 0, "phase": "production", "user_images": []})
        text = out["messages"][0]["content"]
        assert "用户上传了" not in text


# ============================================================
# Idempotency
# ============================================================

class TestIdempotency:
    @pytest.mark.asyncio
    async def test_noop_when_round_above_zero(self) -> None:
        state: RuntimeState = {
            "round": 1, "phase": "production", "user_images": [],
            "role_prompt": "R",
        }
        out = await prepare_prompt_node(state)
        assert out == {}

    @pytest.mark.asyncio
    async def test_noop_when_system_message_already_present(self) -> None:
        existing_msg = {"role": "system", "content": "EXISTING SYSTEM"}
        state: RuntimeState = {
            "round": 0, "phase": "production", "user_images": [],
            "messages": [existing_msg],
        }
        out = await prepare_prompt_node(state)
        assert out == {}

    @pytest.mark.asyncio
    async def test_inserts_system_at_index_zero_when_user_already_queued(self) -> None:
        # Hypothetical ordering: somebody pushed a user msg in before
        # prepare ran. The system prompt should still land at index 0.
        state: RuntimeState = {
            "round": 0, "phase": "production", "user_images": [],
            "messages": [{"role": "user", "content": "hi"}],
        }
        out = await prepare_prompt_node(state)
        msgs = out["messages"]
        assert msgs[0]["role"] == "system"
        assert msgs[1] == {"role": "user", "content": "hi"}


# ============================================================
# Settings → builder default model
# ============================================================

class TestDefaultModelInjection:
    @pytest.mark.asyncio
    async def test_default_video_model_from_settings_appears_in_core(self) -> None:
        from app.config import settings
        out = await prepare_prompt_node({"round": 0, "phase": "production", "user_images": []})
        text = out["messages"][0]["content"]
        # Settings value at config.py is "doubao-seedance-2-0" by default.
        assert settings.DEFAULT_VIDEO_MODEL in text
