"""IdentityRouter — single source of truth for routing reference payloads
to the correct fields per video model family.

Replaces ad-hoc `if model.startswith('seedance')` branches scattered across
generation services. Adding a new model is a single dispatch_table entry.

Today this is **metadata-routing only** — there is no real visual identity
embedding (IP-Adapter / FaceID / Sora Character) implementation. The
`identity_embedding` field on Asset is reserved for future use; when it
becomes populated, the routes below will prefer it over raw reference URLs.

Routes (D-12):

    Seedance 2.0  → reference_images: list[str]   (1-3 imgs)
    VEO 3.1       → image_mode='reference' + 1-2  (else first_frame fallback)
    Sora-2 VIP    → characterUrl + characterTimestamps  (drop raw refs)
    Kling v3      → first_frame_image only        (drop multi-refs)
    unknown       → first_frame fallback
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

logger = logging.getLogger("prism.identity_router")


# ============================================================
# Dataclasses
# ============================================================

@dataclass
class IdentityEmbedding:
    """Reserved metadata field on Asset. Populated by future visual ID
    generators (IP-Adapter / FaceID / Sora Character)."""
    vector_id: str
    provider: str  # 'sora_character' | 'ip_adapter' | 'face_id' | 'manual'
    created_at: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class AssetReference:
    """Concrete reference to a single asset for a generation request."""
    asset_id: str
    name: str = ""
    reference_images: list[str] = field(default_factory=list)
    identity_embedding: Optional[IdentityEmbedding] = None


@dataclass
class ReferencePayload:
    """Output of routing — model-specific keys for the generation request."""
    fields: dict[str, Any] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    dropped_refs: int = 0


# Route function: given (model_id, list[AssetReference]) → ReferencePayload
RouteFn = Callable[[str, list[AssetReference]], ReferencePayload]


# ============================================================
# Per-model routes
# ============================================================

def _seedance_route(model_id: str, refs: list[AssetReference]) -> ReferencePayload:
    images: list[str] = []
    for r in refs:
        images.extend(r.reference_images[:3])  # max 3 per asset
        if len(images) >= 3:
            images = images[:3]
            break
    payload = ReferencePayload(fields={"reference_images": images})
    if not images:
        payload.notes.append("seedance: no reference images supplied")
    return payload


def _veo_route(model_id: str, refs: list[AssetReference]) -> ReferencePayload:
    images: list[str] = []
    for r in refs:
        images.extend(r.reference_images)
    if not images:
        return ReferencePayload(notes=["veo: no refs — caller should supply first_frame"])
    use = images[:2]
    dropped = max(0, len(images) - 2)
    fields = {"image_mode": "reference", "images": use}
    notes: list[str] = []
    if dropped:
        notes.append(f"veo: dropped {dropped} extra refs (max 2)")
    return ReferencePayload(fields=fields, notes=notes, dropped_refs=dropped)


def _sora_route(model_id: str, refs: list[AssetReference]) -> ReferencePayload:
    # Sora Character API takes characterUrl, not raw images.
    char_ref: Optional[AssetReference] = None
    for r in refs:
        if r.identity_embedding and r.identity_embedding.provider == "sora_character":
            char_ref = r
            break
    if char_ref and char_ref.identity_embedding:
        return ReferencePayload(
            fields={
                "characterUrl": char_ref.identity_embedding.vector_id,
                "characterTimestamps": char_ref.identity_embedding.metadata.get("timestamps", "1,3"),
            },
            notes=[f"sora: using character_url for asset {char_ref.asset_id}"],
        )
    # No Sora character → drop refs entirely (Sora doesn't accept raw images
    # for character consistency; first_frame is best fallback at submit time).
    total_imgs = sum(len(r.reference_images) for r in refs)
    return ReferencePayload(
        notes=["sora: no Sora-character embedding — refs dropped"],
        dropped_refs=total_imgs,
    )


def _kling_route(model_id: str, refs: list[AssetReference]) -> ReferencePayload:
    images: list[str] = []
    for r in refs:
        images.extend(r.reference_images)
    if not images:
        return ReferencePayload(notes=["kling: no refs"])
    first = images[0]
    dropped = max(0, len(images) - 1)
    notes: list[str] = []
    if dropped:
        notes.append(f"kling: dropped {dropped} extra refs (only 1 first_frame supported)")
    return ReferencePayload(
        fields={"first_frame_image": first},
        notes=notes,
        dropped_refs=dropped,
    )


def _unknown_route(model_id: str, refs: list[AssetReference]) -> ReferencePayload:
    images: list[str] = []
    for r in refs:
        images.extend(r.reference_images)
    if images:
        return ReferencePayload(
            fields={"first_frame_image": images[0]},
            notes=[f"identity_router: unknown model {model_id}, fell back to first_frame"],
            dropped_refs=max(0, len(images) - 1),
        )
    return ReferencePayload(notes=[f"identity_router: unknown model {model_id}, no refs"])


# ============================================================
# Router
# ============================================================

class IdentityRouter:
    """Process-wide router. Use `IdentityRouter.route(model_id, refs)`."""

    DISPATCH_TABLE: dict[str, RouteFn] = {}

    @classmethod
    def register_route(cls, prefix: str, route_fn: RouteFn) -> None:
        cls.DISPATCH_TABLE[prefix] = route_fn

    @classmethod
    def route(cls, model_id: str, refs: list[AssetReference]) -> ReferencePayload:
        for prefix, fn in cls.DISPATCH_TABLE.items():
            if model_id.startswith(prefix):
                return fn(model_id, refs)
        return _unknown_route(model_id, refs)


# ── Built-in routes ──
IdentityRouter.register_route("doubao-seedance", _seedance_route)
IdentityRouter.register_route("seedance", _seedance_route)
IdentityRouter.register_route("veo", _veo_route)
IdentityRouter.register_route("sora", _sora_route)
IdentityRouter.register_route("kling", _kling_route)
