"""
Unit tests for the prompt-cache adapter in routers/agent_chat.py.

Verifies:
  - structured system content arrays are flattened for non-Anthropic models
  - cache_control markers are stripped from forwarded payload
  - plain-string content is left untouched
  - non-system messages are never touched even with array content
  - adapter is pure (no mutation of input)
"""

from __future__ import annotations

import copy

import pytest

from app.routers.agent_chat import adapt_messages_for_provider


class TestFlattenStructuredSystemContent:
    def test_flattens_content_blocks_to_newline_joined_string(self):
        msgs = [
            {
                "role": "system",
                "content": [
                    {"type": "text", "text": "Core block"},
                    {"type": "text", "text": "Role block", "cache_control": {"type": "ephemeral"}},
                    {"type": "text", "text": "Skills block"},
                ],
            },
            {"role": "user", "content": "hi"},
        ]
        out = adapt_messages_for_provider(msgs, model="gpt-5.4")
        assert out[0]["role"] == "system"
        assert isinstance(out[0]["content"], str)
        assert out[0]["content"] == "Core block\n\nRole block\n\nSkills block"
        # cache_control was silently dropped — upstream provider never sees it
        assert "cache_control" not in out[0]["content"]

    def test_drops_non_text_blocks_silently(self):
        msgs = [
            {
                "role": "system",
                "content": [
                    {"type": "text", "text": "kept"},
                    {"type": "image_url", "image_url": {"url": "http://x"}},  # unexpected in system
                    {"type": "text", "text": "also kept"},
                ],
            }
        ]
        out = adapt_messages_for_provider(msgs, model="gpt-5.4")
        assert out[0]["content"] == "kept\n\nalso kept"

    def test_leaves_string_system_content_untouched(self):
        msgs = [
            {"role": "system", "content": "Already a string"},
            {"role": "user", "content": "hi"},
        ]
        out = adapt_messages_for_provider(msgs, model="gpt-5.4")
        assert out[0]["content"] == "Already a string"

    def test_never_touches_non_system_messages(self):
        msgs = [
            {"role": "system", "content": "S"},
            # user with array content (vision) — must stay as-is
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "describe this"},
                    {"type": "image_url", "image_url": {"url": "http://x"}},
                ],
            },
            {
                "role": "assistant",
                "content": "here",
                "tool_calls": [{"id": "c1", "function": {"name": "x", "arguments": "{}"}}],
            },
            {"role": "tool", "content": "{\"ok\":true}", "tool_call_id": "c1"},
        ]
        out = adapt_messages_for_provider(msgs, model="gpt-5.4")
        # user remains with array content
        assert isinstance(out[1]["content"], list)
        assert len(out[1]["content"]) == 2
        # assistant/tool untouched
        assert out[2]["tool_calls"][0]["id"] == "c1"
        assert out[3]["tool_call_id"] == "c1"

    def test_passthrough_does_not_mutate_original(self):
        msgs = [
            {
                "role": "system",
                "content": [{"type": "text", "text": "x", "cache_control": {"type": "ephemeral"}}],
            }
        ]
        snapshot = copy.deepcopy(msgs)
        adapt_messages_for_provider(msgs, model="gpt-5.4")
        # input array must still have the structured block with cache_control
        assert msgs == snapshot

    def test_empty_text_blocks_are_skipped(self):
        msgs = [
            {
                "role": "system",
                "content": [
                    {"type": "text", "text": ""},
                    {"type": "text", "text": "real"},
                    {"type": "text", "text": None},  # type: ignore[typeddict-item]
                ],
            }
        ]
        out = adapt_messages_for_provider(msgs, model="gpt-5.4")
        assert out[0]["content"] == "real"

    def test_no_messages_no_op(self):
        out = adapt_messages_for_provider([], model="gpt-5.4")
        assert out == []

    @pytest.mark.parametrize("model", ["gpt-5.4", "gemini-3.1-pro-preview", "claude-sonnet-4-20250514"])
    def test_current_provider_matrix_all_flatten(self, model):
        """Today the gateway is OpenAI-compatible for all models, so every
        system array gets flattened regardless of model. This guard makes it
        obvious when _is_anthropic_model() starts returning True for some
        model family — that change will flip these cases to skip."""
        msgs = [{"role": "system", "content": [{"type": "text", "text": "x"}]}]
        out = adapt_messages_for_provider(msgs, model=model)
        assert isinstance(out[0]["content"], str)
