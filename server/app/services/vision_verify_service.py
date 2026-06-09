"""
VisionVerifyService — semantic verification of generated images.

The service routes a `(image_url, criteria)` pair through a vision-capable
LLM model (default Gemini) and normalises the structured reply into a
`VerifyImageResponse`. Callers should NOT touch provider-specific prompting
directly — that lives here so swapping providers is a model-registry change.

Adding a new adapter (e.g. claude-vision):
  1. Make sure the model exists in `ai_models` DB with capability='vision'.
  2. Map `settings.visionVerifyModel` on the frontend to the same id.
  3. If the model needs a bespoke prompt, extend `_MODEL_PROMPT_OVERRIDES`.

All other call sites remain unchanged.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.schemas.verify import VerifyCriteria, VerifyImageResponse
from app.services.llm_service import LLMService
from app.services.model_service import ModelService

logger = logging.getLogger("prism.services.vision_verify")

# ── Configurable defaults ──

DEFAULT_THRESHOLD = 70
# Known vision adapter ids the backend recognises. When frontend sends a
# model not in this set, the router rejects with 422. Keep this list in sync
# with registered frontend adapters.
SUPPORTED_VISION_MODELS: set[str] = {
    "gemini-vision",
}

# Maps a vision adapter id to an OVERRIDE model_id in the DB. Falls back to
# `settings.DEFAULT_LLM_MODEL` when the adapter id is not in this dict — so
# changing the env-level default LLM model automatically picks up here
# without a code change. Populate overrides only when a specific adapter
# must route to a non-default provider (e.g. `claude-vision` → some Claude
# channel id that differs from the default LLM).
_ADAPTER_MODEL_OVERRIDES: dict[str, str] = {}


# Model-specific prompt overrides. Empty by default — the generic template
# works for Gemini and Claude Vision alike.
_MODEL_PROMPT_OVERRIDES: dict[str, str] = {}


# ── Prompt builder ──


def _build_prompt(criteria: VerifyCriteria) -> str:
    """Render the criteria into a structured LLM prompt that asks for strict
    JSON output. The strict-JSON contract is what lets us parse the reply
    reliably across providers.
    """
    subjects_line = (
        "- Expected subjects: " + ", ".join(criteria.subjects)
        if criteria.subjects
        else "- Expected subjects: (not specified)"
    )
    style_line = (
        f"- Expected style: {criteria.style}"
        if criteria.style
        else "- Expected style: (not specified)"
    )
    threshold = criteria.threshold if criteria.threshold is not None else DEFAULT_THRESHOLD

    return f"""You are a strict visual QC inspector. Compare the provided image to the criteria below and return ONE JSON object (no markdown fences, no prose).

Criteria:
{subjects_line}
{style_line}
- Threshold (retry below): {threshold}

Return exactly this JSON shape:
{{
  "match_score": <integer 0-100>,
  "detected_subjects": [<strings you see in the image>],
  "missing_elements": [<expected subjects you do NOT see>],
  "unexpected_elements": [<notable subjects present but not expected>],
  "recommendation": "accept" | "retry" | "edit_prompt",
  "reasoning": "<Chinese explanation, ≤120 characters>"
}}

Rules:
- match_score >= {threshold}          => recommendation = "accept"
- {max(threshold - 20, 0)} <= match_score < {threshold} => "retry"
- match_score < {max(threshold - 20, 0)}                => "edit_prompt"
- reasoning must be Simplified Chinese and self-contained.
"""


# ── Response parser ──


# Ordered fallback strategies for pulling JSON out of an LLM reply. We try
# each in turn and stop at the first successful json.loads().
#
# 1) ```json ... ``` fence (non-greedy, preferred) — LLMs default to this when
#    asked for structured output.
# 2) Balanced-brace scan anchored on the first `{` — robust against trailing
#    prose or multiple JSON blocks, unlike a raw greedy regex which grabs
#    from the first `{` to the LAST `}`.
# 3) Greedy `{...}` as a last resort — handles weird formatting where the
#    balanced scan fails (e.g. unbalanced quotes producing an unclosed span).
_FENCED_JSON_RE = re.compile(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```")
_GREEDY_JSON_RE = re.compile(r"\{[\s\S]*\}")


def _extract_balanced_json(text: str) -> str | None:
    """Return the first balanced `{...}` span in `text`, respecting strings.

    Walks character by character tracking brace depth while skipping content
    inside double-quoted strings (so a `}` inside a JSON string literal
    doesn't close the outer object). Returns None if no balanced span exists.
    """
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def _parse_llm_reply(text: str, threshold: int) -> dict[str, Any]:
    """Extract the JSON object from the LLM's response. LLMs occasionally
    wrap output in fences or leading text despite instructions, so we try
    multiple extraction strategies in order of reliability. Returns a raw
    dict — coercion to the schema happens in `_coerce_result`.
    """
    _ = threshold  # reserved for future threshold-aware heuristics
    if not text:
        return {}

    candidates: list[str] = []

    # Strategy 1: fenced JSON
    fenced = _FENCED_JSON_RE.search(text)
    if fenced:
        candidates.append(fenced.group(1))

    # Strategy 2: balanced-brace scan
    balanced = _extract_balanced_json(text)
    if balanced is not None:
        candidates.append(balanced)

    # Strategy 3: greedy regex (legacy fallback)
    greedy = _GREEDY_JSON_RE.search(text)
    if greedy:
        candidates.append(greedy.group(0))

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            continue

    logger.warning("Vision reply has no parseable JSON: %s", text[:200])
    return {}


def _derive_recommendation(score: int, threshold: int) -> str:
    if score >= threshold:
        return "accept"
    if score >= max(threshold - 20, 0):
        return "retry"
    return "edit_prompt"


def _coerce_result(raw: dict[str, Any], criteria: VerifyCriteria) -> VerifyImageResponse:
    """Normalise a provider's reply into the canonical response schema.
    Missing fields get reasonable defaults; invalid fields get snapped to
    range. Never throws."""
    threshold = criteria.threshold or DEFAULT_THRESHOLD

    try:
        score_raw = int(raw.get("match_score") or raw.get("matchScore") or 0)
    except (TypeError, ValueError):
        score_raw = 0
    match_score = max(0, min(100, score_raw))

    def _as_list(*keys: str) -> list[str]:
        for k in keys:
            v = raw.get(k)
            if isinstance(v, list):
                return [str(x) for x in v if x is not None]
        return []

    detected = _as_list("detected_subjects", "detectedSubjects")
    missing = _as_list("missing_elements", "missingElements")
    unexpected = _as_list("unexpected_elements", "unexpectedElements")

    rec_raw = str(raw.get("recommendation") or "").lower()
    recommendation = rec_raw if rec_raw in ("accept", "retry", "edit_prompt") else _derive_recommendation(match_score, threshold)

    reasoning_raw = str(raw.get("reasoning") or "")[:120]
    if not reasoning_raw:
        # Synthesize a reasoning string when the model omitted it — downstream
        # UI always expects something to show the user.
        if match_score >= threshold:
            reasoning_raw = f"图片符合预期（匹配度 {match_score}/100）"
        elif missing:
            reasoning_raw = f"缺失关键元素: {'、'.join(missing[:3])}"
        else:
            reasoning_raw = f"匹配度不足（{match_score}/{threshold}）"

    return VerifyImageResponse(
        match_score=match_score,
        detected_subjects=detected,
        missing_elements=missing,
        unexpected_elements=unexpected,
        recommendation=recommendation,  # type: ignore[arg-type]
        reasoning=reasoning_raw,
        cached=False,
    )


# ── Service ──


class VisionVerifyService:
    """Orchestrates vision adapter dispatch.

    The service depends only on `LLMService` + `ModelService`, not on any
    specific provider SDK, so new vision providers automatically work once
    they register as an `ai_models` row with capability='vision' (or 'llm').
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.llm_svc = LLMService(db)
        self.model_svc = ModelService(db)

    @staticmethod
    def is_model_supported(model: str) -> bool:
        return model in SUPPORTED_VISION_MODELS

    @staticmethod
    def list_supported_models() -> list[str]:
        return sorted(SUPPORTED_VISION_MODELS)

    async def verify(self, image_url: str, model: str, criteria: VerifyCriteria) -> VerifyImageResponse:
        """Run a single verification. Never raises — all errors surface as a
        degraded VerifyImageResponse (recommendation='retry', score=0) so
        the calling Agent can decide whether to fallback or retry."""
        target_model = _ADAPTER_MODEL_OVERRIDES.get(model) or settings.DEFAULT_LLM_MODEL
        prompt = _MODEL_PROMPT_OVERRIDES.get(model) or _build_prompt(criteria)

        # Pass the image URL through the normal vision-capable LLM adapter.
        # Provider adapters already know how to marshal `images` into the
        # multimodal content block the provider expects.
        llm_params = {"images": [image_url]}

        try:
            result = await self.llm_svc.chat(
                model_id=target_model,
                prompt=prompt,
                temperature=0.0,  # Deterministic QC output
                max_tokens=800,
                params=llm_params,
            )
        except Exception as e:  # pragma: no cover — network-layer failures
            logger.warning("Vision verify LLM call failed: %s", e)
            return VerifyImageResponse(
                match_score=0,
                detected_subjects=[],
                missing_elements=criteria.subjects or [],
                unexpected_elements=[],
                recommendation="retry",
                reasoning=f"Vision 模型调用失败: {str(e)[:60]}",
                cached=False,
            )

        text = str(result.get("text") or "")
        raw = _parse_llm_reply(text, criteria.threshold or DEFAULT_THRESHOLD)
        return _coerce_result(raw, criteria)
