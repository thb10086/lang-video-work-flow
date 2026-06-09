"""
Vision Verify API tests.

Covers:
  - Pydantic schema validation (VerifyImageRequest / VerifyImageResponse)
  - Service-level parsing (JSON extraction + coercion + fallback recommendations)
  - Router-level: 422 on unsupported model, 200 on happy path, Redis cache hit.

Heavy reliance on monkey-patching `VisionVerifyService.verify` so we never
call a real LLM provider during tests — deterministic + fast.
"""

from __future__ import annotations

import hashlib
import json

import pytest
from pydantic import ValidationError

from app.routers import verify as verify_router
from app.schemas.verify import VerifyCriteria, VerifyImageRequest, VerifyImageResponse
from app.services.vision_verify_service import (
    VisionVerifyService,
    _coerce_result,
    _derive_recommendation,
    _extract_balanced_json,
    _parse_llm_reply,
)


# ============================================================
# Schema tests
# ============================================================


class TestVerifyCriteria:
    def test_empty_criteria_is_valid(self):
        c = VerifyCriteria()
        assert c.subjects is None
        assert c.style is None
        assert c.threshold == 70

    def test_threshold_range(self):
        # In-range value accepted
        VerifyCriteria(threshold=0)
        VerifyCriteria(threshold=100)
        # Out-of-range rejected
        with pytest.raises(ValidationError):
            VerifyCriteria(threshold=-1)
        with pytest.raises(ValidationError):
            VerifyCriteria(threshold=101)


class TestVerifyImageRequest:
    def test_valid_url_passes(self):
        r = VerifyImageRequest(
            image_url="https://cdn.example.com/img.png",
            model="gemini-vision",
            criteria=VerifyCriteria(subjects=["cat"]),
        )
        assert r.image_url.endswith("/img.png")
        assert r.model == "gemini-vision"

    def test_empty_url_rejected(self):
        with pytest.raises(ValidationError):
            VerifyImageRequest(image_url="", model="gemini-vision", criteria=VerifyCriteria())

    def test_non_http_url_rejected(self):
        with pytest.raises(ValidationError):
            VerifyImageRequest(
                image_url="ftp://old.example.com/img.png",
                model="gemini-vision",
                criteria=VerifyCriteria(),
            )

    def test_data_url_accepted(self):
        VerifyImageRequest(
            image_url="data:image/png;base64,iVBORw0KGgo=",
            model="gemini-vision",
            criteria=VerifyCriteria(),
        )

    def test_default_criteria_is_set(self):
        r = VerifyImageRequest(image_url="https://x/y", model="gemini-vision")
        # Pydantic populates the default_factory
        assert r.criteria is not None
        assert r.criteria.threshold == 70


# ============================================================
# Service helper tests
# ============================================================


class TestLLMReplyParser:
    def test_parses_plain_json(self):
        text = '{"match_score": 85, "recommendation": "accept"}'
        assert _parse_llm_reply(text, 70) == {"match_score": 85, "recommendation": "accept"}

    def test_parses_fenced_json(self):
        text = "Here is the result:\n```json\n{\"match_score\": 42}\n```\nThanks."
        assert _parse_llm_reply(text, 70) == {"match_score": 42}

    def test_parses_json_with_leading_prose(self):
        text = 'Sure — {"match_score": 60} ← final verdict.'
        assert _parse_llm_reply(text, 70) == {"match_score": 60}

    def test_empty_text_returns_empty_dict(self):
        assert _parse_llm_reply("", 70) == {}

    def test_invalid_json_returns_empty_dict(self):
        assert _parse_llm_reply("not json at all", 70) == {}

    # ── Regression: old greedy regex grabbed from first { to LAST } ──
    # which concatenated multiple JSON blobs and broke json.loads().
    # The new balanced-brace scan picks the FIRST balanced object.

    def test_picks_first_of_multiple_json_blocks(self):
        text = (
            '{"match_score": 88, "recommendation": "accept"} '
            'Other context: {"unrelated": true, "junk": 1}'
        )
        result = _parse_llm_reply(text, 70)
        assert result == {"match_score": 88, "recommendation": "accept"}

    def test_handles_right_brace_inside_string_literal(self):
        # LLM put a `}` inside a reasoning string — greedy regex would miss
        # the closing brace; balanced scan + string awareness handles it.
        text = (
            '{"match_score": 77, "reasoning": "矩阵 {X} 不匹配，改 prompt 吧"}'
        )
        result = _parse_llm_reply(text, 70)
        assert result["match_score"] == 77
        assert "矩阵" in result["reasoning"]

    def test_prefers_fenced_over_inline_fallback(self):
        # When both fenced and inline exist, fenced wins (usually the real
        # answer — inline might just be an escaped example in the prose).
        text = (
            'Not this one: {"match_score": 10}\n'
            '```json\n{"match_score": 95, "recommendation": "accept"}\n```'
        )
        result = _parse_llm_reply(text, 70)
        assert result["match_score"] == 95

    def test_rejects_non_dict_json(self):
        # JSON array at the top level must not be returned as the result
        # (downstream _coerce_result expects a dict shape).
        text = '[{"match_score": 80}]'
        # Balanced-brace scan would pick the inner `{…}`, not the array.
        # So this actually succeeds at extracting the inner object.
        result = _parse_llm_reply(text, 70)
        assert isinstance(result, dict)
        assert result == {"match_score": 80}

    def test_totally_malformed_returns_empty(self):
        # Unbalanced quote prevents balanced scan, greedy regex also fails
        # to parse — all three strategies must return empty dict.
        text = '{"match_score": 88, reasoning: unterminated "string '
        assert _parse_llm_reply(text, 70) == {}


class TestExtractBalancedJson:
    """Direct unit tests for the string-aware balanced-brace scanner."""

    def test_returns_none_when_no_brace(self):
        assert _extract_balanced_json("just some prose") is None

    def test_picks_first_balanced_span(self):
        got = _extract_balanced_json('pre {"a": 1} and {"b": 2} post')
        assert got == '{"a": 1}'

    def test_handles_nested_objects(self):
        got = _extract_balanced_json('pre {"a": {"b": {"c": 1}}, "d": 2} post')
        assert got == '{"a": {"b": {"c": 1}}, "d": 2}'

    def test_ignores_brace_inside_string(self):
        got = _extract_balanced_json('{"msg": "has } brace"}')
        assert got == '{"msg": "has } brace"}'

    def test_ignores_escaped_quote(self):
        got = _extract_balanced_json(r'{"msg": "with \"quoted\" } brace"}')
        # The escaped quotes don't toggle in_string, so the } inside stays guarded.
        assert got is not None
        assert got.startswith('{') and got.endswith('}')

    def test_returns_none_for_unbalanced(self):
        assert _extract_balanced_json('{"a": 1, "b": {"c": 2}') is None


class TestDeriveRecommendation:
    @pytest.mark.parametrize(
        "score, threshold, expected",
        [
            (85, 70, "accept"),
            (70, 70, "accept"),
            (69, 70, "retry"),
            (50, 70, "retry"),
            (49, 70, "edit_prompt"),
            (0, 70, "edit_prompt"),
            (55, 50, "accept"),  # Low threshold edge
        ],
    )
    def test_boundary_cases(self, score, threshold, expected):
        assert _derive_recommendation(score, threshold) == expected


class TestCoerceResult:
    def test_full_valid_dict(self):
        raw = {
            "match_score": 88,
            "detected_subjects": ["cat", "sofa"],
            "missing_elements": [],
            "unexpected_elements": ["dog"],
            "recommendation": "accept",
            "reasoning": "猫清晰可见",
        }
        res = _coerce_result(raw, VerifyCriteria(subjects=["cat"], threshold=70))
        assert res.match_score == 88
        assert res.detected_subjects == ["cat", "sofa"]
        assert res.unexpected_elements == ["dog"]
        assert res.recommendation == "accept"
        assert res.reasoning == "猫清晰可见"

    def test_score_clamped_to_range(self):
        # Over 100 and negative values both snapped
        over = _coerce_result({"match_score": 150}, VerifyCriteria())
        assert over.match_score == 100
        neg = _coerce_result({"match_score": -5}, VerifyCriteria())
        assert neg.match_score == 0

    def test_missing_recommendation_is_derived(self):
        # With no explicit recommendation, we derive from score+threshold
        low = _coerce_result({"match_score": 30}, VerifyCriteria(threshold=70))
        assert low.recommendation == "edit_prompt"
        mid = _coerce_result({"match_score": 55}, VerifyCriteria(threshold=70))
        assert mid.recommendation == "retry"
        high = _coerce_result({"match_score": 90}, VerifyCriteria(threshold=70))
        assert high.recommendation == "accept"

    def test_empty_dict_yields_fallback_reasoning(self):
        res = _coerce_result({}, VerifyCriteria(subjects=["cat"]))
        assert res.match_score == 0
        assert res.reasoning  # non-empty default
        assert res.recommendation in ("retry", "edit_prompt")

    def test_reasoning_truncated_to_120(self):
        long = "a" * 500
        res = _coerce_result({"match_score": 80, "reasoning": long}, VerifyCriteria(threshold=70))
        assert len(res.reasoning) == 120

    def test_alternate_camel_case_keys(self):
        raw = {
            "matchScore": 75,
            "detectedSubjects": ["tree"],
            "missingElements": ["bird"],
            "unexpectedElements": [],
            "recommendation": "retry",
            "reasoning": "缺少鸟",
        }
        res = _coerce_result(raw, VerifyCriteria())
        assert res.match_score == 75
        assert res.detected_subjects == ["tree"]
        assert res.missing_elements == ["bird"]


class TestSupportedModels:
    def test_gemini_is_supported(self):
        assert VisionVerifyService.is_model_supported("gemini-vision")

    def test_unknown_model_is_rejected(self):
        assert not VisionVerifyService.is_model_supported("fake-model-xyz")

    def test_list_includes_gemini(self):
        assert "gemini-vision" in VisionVerifyService.list_supported_models()


class TestAdapterModelRouting:
    """Regression: the adapter-to-model mapping should honour settings.DEFAULT_LLM_MODEL
    as the fallback so changing the env-level default LLM propagates automatically."""

    def test_unmapped_adapter_falls_back_to_default_llm(self, monkeypatch):
        # Build a fake settings with a distinctive default model id
        from app.services import vision_verify_service as svc_mod

        fake_calls: dict[str, str] = {}

        class _FakeLLM:
            async def chat(self, model_id: str, **_: object) -> dict:
                fake_calls["model_id"] = model_id
                return {"text": '{"match_score": 90, "recommendation": "accept", "reasoning": "ok"}'}

        # Swap settings.DEFAULT_LLM_MODEL in the module
        monkeypatch.setattr(svc_mod.settings, "DEFAULT_LLM_MODEL", "some-other-llm-xyz", raising=False)
        # Ensure no override is registered for gemini-vision in the current test
        monkeypatch.setattr(svc_mod, "_ADAPTER_MODEL_OVERRIDES", {}, raising=True)

        import asyncio

        async def _run():
            service = VisionVerifyService.__new__(VisionVerifyService)
            service.db = None  # not needed for this path
            service.llm_svc = _FakeLLM()
            service.model_svc = None
            return await service.verify(
                image_url="https://x/1.png",
                model="gemini-vision",
                criteria=VerifyCriteria(subjects=["cat"]),
            )

        result = asyncio.run(_run())
        # The LLM was called with the settings-provided default model id, not a hardcoded string
        assert fake_calls["model_id"] == "some-other-llm-xyz"
        assert result.match_score == 90

    def test_override_takes_precedence_over_default(self, monkeypatch):
        from app.services import vision_verify_service as svc_mod

        fake_calls: dict[str, str] = {}

        class _FakeLLM:
            async def chat(self, model_id: str, **_: object) -> dict:
                fake_calls["model_id"] = model_id
                return {"text": '{"match_score": 50, "recommendation": "retry", "reasoning": "ok"}'}

        monkeypatch.setattr(svc_mod.settings, "DEFAULT_LLM_MODEL", "default-llm", raising=False)
        monkeypatch.setattr(
            svc_mod,
            "_ADAPTER_MODEL_OVERRIDES",
            {"gemini-vision": "special-gemini-route"},
            raising=True,
        )

        import asyncio

        async def _run():
            service = VisionVerifyService.__new__(VisionVerifyService)
            service.db = None
            service.llm_svc = _FakeLLM()
            service.model_svc = None
            return await service.verify(
                image_url="https://x/2.png",
                model="gemini-vision",
                criteria=VerifyCriteria(),
            )

        asyncio.run(_run())
        # Override wins over the default
        assert fake_calls["model_id"] == "special-gemini-route"


# ============================================================
# Router tests — with service monkey-patched
# ============================================================


@pytest.fixture(autouse=True)
def _clear_cache(redis_sync):
    """Wipe verify cache before each router test — keeps runs independent."""
    try:
        for key in redis_sync.scan_iter(match="prism:verify:image:*", count=100):
            redis_sync.delete(key)
    except Exception:
        pass  # Redis optional for schema tests


class TestVerifyRoute:
    def test_unsupported_model_returns_422(self, client):
        body = {
            "image_url": "https://cdn.example.com/x.png",
            "model": "fake-model-xyz",
            "criteria": {},
        }
        r = client.post("/api/verify/image", json=body)
        assert r.status_code == 422
        detail = r.json()["detail"]
        # Pydantic 422 wraps the detail dict in a list or returns raw — handle both
        text = json.dumps(detail)
        assert "fake-model-xyz" in text or "Unsupported" in text
        assert "gemini-vision" in text  # supported list disclosed

    def test_malformed_url_returns_422(self, client):
        body = {
            "image_url": "not-a-url",
            "model": "gemini-vision",
            "criteria": {},
        }
        r = client.post("/api/verify/image", json=body)
        assert r.status_code == 422

    def test_happy_path_returns_200_with_verify_result(self, client, monkeypatch):
        """Patch the service's `verify` method to return a canned result so we
        don't dial out to any real LLM provider during tests."""

        canned = VerifyImageResponse(
            match_score=92,
            detected_subjects=["cat"],
            missing_elements=[],
            unexpected_elements=[],
            recommendation="accept",
            reasoning="猫清晰可见",
            cached=False,
        )

        async def _mock_verify(self, image_url, model, criteria):
            return canned

        monkeypatch.setattr(VisionVerifyService, "verify", _mock_verify)

        body = {
            "image_url": "https://cdn.example.com/cat.png",
            "model": "gemini-vision",
            "criteria": {"subjects": ["cat"], "threshold": 70},
        }
        r = client.post("/api/verify/image", json=body)
        assert r.status_code == 200
        payload = r.json()["data"]
        assert payload["match_score"] == 92
        assert payload["recommendation"] == "accept"
        assert payload["cached"] is False

    def test_second_identical_request_hits_cache(self, client, monkeypatch):
        """Spec Scenario: same (url, criteria) within 300s => Redis cache, no provider call."""

        call_count = {"n": 0}

        async def _mock_verify(self, image_url, model, criteria):
            call_count["n"] += 1
            return VerifyImageResponse(
                match_score=80,
                detected_subjects=["dog"],
                missing_elements=[],
                unexpected_elements=[],
                recommendation="accept",
                reasoning="测试缓存",
                cached=False,
            )

        monkeypatch.setattr(VisionVerifyService, "verify", _mock_verify)

        body = {
            "image_url": "https://cdn.example.com/dog.png",
            "model": "gemini-vision",
            "criteria": {"subjects": ["dog"]},
        }
        r1 = client.post("/api/verify/image", json=body)
        r2 = client.post("/api/verify/image", json=body)
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r1.json()["data"]["cached"] is False
        assert r2.json()["data"]["cached"] is True
        # Provider was only called once
        assert call_count["n"] == 1


class TestCacheKey:
    def test_identical_bodies_share_key(self):
        a = VerifyImageRequest(
            image_url="https://x/1.png",
            model="gemini-vision",
            criteria=VerifyCriteria(subjects=["cat"], threshold=70),
        )
        b = VerifyImageRequest(
            image_url="https://x/1.png",
            model="gemini-vision",
            criteria=VerifyCriteria(subjects=["cat"], threshold=70),
        )
        assert verify_router._cache_key(a) == verify_router._cache_key(b)

    def test_different_thresholds_produce_different_keys(self):
        a = VerifyImageRequest(
            image_url="https://x/1.png",
            model="gemini-vision",
            criteria=VerifyCriteria(threshold=70),
        )
        b = VerifyImageRequest(
            image_url="https://x/1.png",
            model="gemini-vision",
            criteria=VerifyCriteria(threshold=80),
        )
        assert verify_router._cache_key(a) != verify_router._cache_key(b)

    def test_key_uses_sha256_prefix(self):
        req = VerifyImageRequest(
            image_url="https://x/1.png",
            model="gemini-vision",
            criteria=VerifyCriteria(),
        )
        key = verify_router._cache_key(req)
        assert key.startswith("prism:verify:image:")
        # sha256 hex digest is 64 chars
        assert len(key) == len("prism:verify:image:") + 64
