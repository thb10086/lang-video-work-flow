"""Unit tests for IdentityRouter (0.9.2 + 0.9.5).

Goal:
  - Lock down the per-family routing behaviour (seedance / veo / sora /
    kling / unknown) so future refactors can't silently regress.
  - Prove the extensibility contract: registering a route for a new model
    family is a single dispatch_table entry — no caller-side change.

These tests deliberately avoid touching DB or HTTP. Every fixture is
constructed in-memory and reused across cases; the registry is restored
in each test via a fresh AssetReference list and snapshot/restore of
DISPATCH_TABLE around the extensibility test.
"""
from __future__ import annotations

import pytest

from app.services.identity_router import (
    AssetReference,
    IdentityEmbedding,
    IdentityRouter,
    ReferencePayload,
)


# ============================================================
# Fixtures — small, deterministic, reused across cases
# ============================================================

@pytest.fixture
def char_a() -> AssetReference:
    return AssetReference(
        asset_id="char-A",
        name="Hero",
        reference_images=["https://cdn/example/A1.png", "https://cdn/example/A2.png"],
    )


@pytest.fixture
def char_b() -> AssetReference:
    return AssetReference(
        asset_id="char-B",
        name="Villain",
        reference_images=["https://cdn/example/B1.png"],
    )


@pytest.fixture
def char_with_sora_embedding() -> AssetReference:
    return AssetReference(
        asset_id="char-C",
        name="Cameo",
        reference_images=["https://cdn/example/C1.png"],
        identity_embedding=IdentityEmbedding(
            vector_id="https://sora/character/abcdef",
            provider="sora_character",
            metadata={"timestamps": "2,4"},
        ),
    )


# ============================================================
# Seedance — up to 3 reference images, no drop logging required
# ============================================================

class TestSeedanceRoute:
    def test_two_assets_under_limit(self, char_a: AssetReference, char_b: AssetReference) -> None:
        out = IdentityRouter.route("doubao-seedance-2-0", [char_a, char_b])
        assert out.fields["reference_images"] == [
            "https://cdn/example/A1.png",
            "https://cdn/example/A2.png",
            "https://cdn/example/B1.png",
        ]
        assert out.dropped_refs == 0

    def test_caps_at_three(self) -> None:
        ref = AssetReference(
            asset_id="x",
            reference_images=[f"https://cdn/x{i}.png" for i in range(5)],
        )
        out = IdentityRouter.route("seedance-pro", [ref])
        assert len(out.fields["reference_images"]) == 3

    def test_no_refs(self) -> None:
        out = IdentityRouter.route("seedance", [])
        assert out.fields == {"reference_images": []}
        assert any("no reference images" in n for n in out.notes)


# ============================================================
# VEO — up to 2 images in reference mode, dropped tracked
# ============================================================

class TestVeoRoute:
    def test_two_refs_used_no_drop(self, char_a: AssetReference) -> None:
        out = IdentityRouter.route("veo3.1", [char_a])
        assert out.fields == {
            "image_mode": "reference",
            "images": ["https://cdn/example/A1.png", "https://cdn/example/A2.png"],
        }
        assert out.dropped_refs == 0

    def test_three_refs_drops_extras(self, char_a: AssetReference, char_b: AssetReference) -> None:
        out = IdentityRouter.route("veo3.1", [char_a, char_b])
        assert len(out.fields["images"]) == 2
        assert out.dropped_refs == 1
        assert any("dropped 1" in n for n in out.notes)

    def test_no_refs_returns_notes(self) -> None:
        out = IdentityRouter.route("veo3.1", [])
        assert out.fields == {}
        assert any("no refs" in n for n in out.notes)


# ============================================================
# Sora — characterUrl from identity_embedding only; raw refs dropped
# ============================================================

class TestSoraRoute:
    def test_with_sora_character_embedding(self, char_with_sora_embedding: AssetReference) -> None:
        out = IdentityRouter.route("sora-2-vip", [char_with_sora_embedding])
        assert out.fields["characterUrl"] == "https://sora/character/abcdef"
        assert out.fields["characterTimestamps"] == "2,4"

    def test_default_timestamps_when_missing(self) -> None:
        ref = AssetReference(
            asset_id="x",
            identity_embedding=IdentityEmbedding(
                vector_id="https://sora/character/xyz",
                provider="sora_character",
                metadata={},
            ),
        )
        out = IdentityRouter.route("sora-2", [ref])
        assert out.fields["characterTimestamps"] == "1,3"

    def test_drops_raw_refs_without_embedding(self, char_a: AssetReference) -> None:
        out = IdentityRouter.route("sora-2-vip", [char_a])
        assert "characterUrl" not in out.fields
        # All raw images dropped (Sora doesn't accept them for consistency).
        assert out.dropped_refs == 2
        assert any("no Sora-character embedding" in n for n in out.notes)

    def test_other_provider_embedding_treated_as_raw(self) -> None:
        # An IP-Adapter embedding shouldn't accidentally satisfy Sora's path.
        ref = AssetReference(
            asset_id="x",
            reference_images=["https://cdn/x.png"],
            identity_embedding=IdentityEmbedding(
                vector_id="ip-adapter-vec-1",
                provider="ip_adapter",
            ),
        )
        out = IdentityRouter.route("sora-2-vip", [ref])
        assert "characterUrl" not in out.fields
        assert out.dropped_refs == 1


# ============================================================
# Kling — first_frame only
# ============================================================

class TestKlingRoute:
    def test_uses_first_image(self, char_a: AssetReference) -> None:
        out = IdentityRouter.route("kling-v3", [char_a])
        assert out.fields == {"first_frame_image": "https://cdn/example/A1.png"}
        # 1 of 2 dropped
        assert out.dropped_refs == 1

    def test_no_refs(self) -> None:
        out = IdentityRouter.route("kling-v3", [])
        assert out.fields == {}
        assert any("no refs" in n for n in out.notes)


# ============================================================
# Unknown model — fall back to first_frame
# ============================================================

class TestUnknownRoute:
    def test_unknown_with_refs_falls_back(self, char_a: AssetReference) -> None:
        out = IdentityRouter.route("xyz-experimental-1.0", [char_a])
        assert out.fields == {"first_frame_image": "https://cdn/example/A1.png"}
        assert out.dropped_refs == 1
        assert any("unknown model" in n for n in out.notes)

    def test_unknown_without_refs(self) -> None:
        out = IdentityRouter.route("xyz-experimental-1.0", [])
        assert out.fields == {}
        assert any("unknown model" in n for n in out.notes)


# ============================================================
# Extensibility — register a brand-new model family with one line (0.9.5)
# ============================================================

def test_register_new_model_family_does_not_require_caller_change() -> None:
    """Adding a new family is a single `register_route` call — no edits in
    callers. This pins down the design contract from D-12 / 0.9.5.
    """
    # Snapshot the current dispatch table so the test cleans up after itself.
    snapshot = dict(IdentityRouter.DISPATCH_TABLE)
    try:
        captured: dict[str, object] = {}

        def custom_route(model_id: str, refs: list[AssetReference]) -> ReferencePayload:
            captured["model_id"] = model_id
            captured["ref_count"] = len(refs)
            return ReferencePayload(
                fields={"customField": [r.asset_id for r in refs]},
                notes=["custom-route: registered by test"],
            )

        IdentityRouter.register_route("frobnicate", custom_route)

        out = IdentityRouter.route(
            "frobnicate-v9",
            [AssetReference(asset_id="X1"), AssetReference(asset_id="X2")],
        )

        # Caller code path is unchanged: same `route(model, refs)` API,
        # but our new function ran and produced the new field shape.
        assert captured["model_id"] == "frobnicate-v9"
        assert captured["ref_count"] == 2
        assert out.fields == {"customField": ["X1", "X2"]}
        assert out.notes == ["custom-route: registered by test"]
    finally:
        IdentityRouter.DISPATCH_TABLE.clear()
        IdentityRouter.DISPATCH_TABLE.update(snapshot)


def test_dispatch_table_contains_built_in_prefixes() -> None:
    # Sanity: built-in routes must always be installed at import time
    # (covered by the module side-effects at the bottom of identity_router.py).
    keys = set(IdentityRouter.DISPATCH_TABLE.keys())
    for required in ("doubao-seedance", "seedance", "veo", "sora", "kling"):
        assert required in keys, f"built-in route missing: {required}"


def test_route_dispatch_uses_first_matching_prefix() -> None:
    """`doubao-seedance` is registered both as itself and via the shared
    `seedance` fallback. The first match wins; both should resolve to the
    same seedance handler.
    """
    out = IdentityRouter.route("doubao-seedance-2-0", [])
    assert "reference_images" in out.fields
    out2 = IdentityRouter.route("seedance-something", [])
    assert "reference_images" in out2.fields
