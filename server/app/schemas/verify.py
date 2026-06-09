"""Pydantic schemas for vision-based semantic image verification.

Mirror of the TypeScript types in `src/providers/visionVerifyAdapter.ts` +
`src/api/backend.ts`. Keep the two in sync whenever fields are added.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


# ── Request ──


class VerifyCriteria(BaseModel):
    """What the caller expects the image to depict.

    All fields are optional — an empty criteria object is still valid
    (the verifier returns a generic "describe what you see" result).
    """

    subjects: list[str] | None = Field(
        default=None,
        description="Subjects that SHOULD be depicted, in English (e.g. ['cyberpunk street', 'Character Lin Xia']).",
    )
    style: str | None = Field(
        default=None,
        description="Expected aesthetic / rendering style (e.g. 'anime, vibrant colors').",
    )
    threshold: int | None = Field(
        default=70,
        ge=0,
        le=100,
        description="matchScore below this => recommendation='retry'. Default 70.",
    )


class VerifyImageRequest(BaseModel):
    image_url: str = Field(
        description="Public URL of the image to verify. Must be reachable from the backend.",
    )
    model: str = Field(
        description="Vision adapter id (e.g. 'gemini-vision'). Validated against registry.",
    )
    criteria: VerifyCriteria = Field(default_factory=VerifyCriteria)

    @field_validator("image_url")
    @classmethod
    def _validate_url(cls, v: str) -> str:
        """Guard against obviously malformed URLs early. Full validity is
        deferred to the provider which actually fetches the bytes."""
        v = v.strip()
        if not v:
            raise ValueError("image_url must be non-empty")
        if not (v.startswith("http://") or v.startswith("https://") or v.startswith("data:image/")):
            raise ValueError("image_url must start with http(s):// or data:image/")
        return v


# ── Response ──


Recommendation = Literal["accept", "retry", "edit_prompt"]


class VerifyImageResponse(BaseModel):
    """Normalised verifier output. All provider-specific shapes are coerced
    into this schema by the service layer before hitting the wire."""

    match_score: int = Field(
        ge=0,
        le=100,
        description="0-100 similarity between expected criteria and observed content.",
    )
    detected_subjects: list[str] = Field(
        default_factory=list,
        description="Subjects the verifier believes are present in the image.",
    )
    missing_elements: list[str] = Field(
        default_factory=list,
        description="Expected subjects the verifier could NOT find.",
    )
    unexpected_elements: list[str] = Field(
        default_factory=list,
        description="Extra / unwanted subjects the verifier spotted.",
    )
    recommendation: Recommendation = Field(
        description="Actionable verdict: accept | retry | edit_prompt.",
    )
    reasoning: str = Field(
        max_length=240,
        description="Short Chinese explanation (≤120 chars after trimming).",
    )
    cached: bool = Field(
        default=False,
        description="True when the result was served from Redis cache.",
    )
