"""Tests for `asset.update_identity` (task 3.3.2).

The tool is admin/internal — it lets the future visual identity service
(Sora Character / IP-Adapter / FaceID) write its embedding payload back
onto the asset library row. Until task 0.9.3 lands a dedicated DB
column, the embedding is tunneled through `metadata_json["identity_embedding"]`.

Two flavors of tests live here:

  1. Pure-function unit tests for the input validation helpers
     (`_validate_embedding`, `_model_for_asset_id`) — these exercise
     every error branch without any DB roundtrip.
  2. End-to-end DB tests against the real database, mirroring the
     `test_asset_service.py` pattern (creates and cleans up its own
     rows under an isolated `USER_ID`).

Also pins the registry contract (name / scope / tier / risk / schema).
"""
from __future__ import annotations

import asyncio
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.agents.tools.asset_tools import (
    _handle_update_identity,
    _model_for_asset_id,
    _validate_embedding,
)
from app.config import settings
from app.models.asset_library import CharacterAsset, SceneAsset, StyleAsset
from app.services.asset_service import AssetService


USER_ID = 99998  # isolated user; distinct from test_asset_service.py's 99999


def _run(coro_factory):
    """Run a coroutine in a fresh asyncio loop with a per-test engine.

    Mirrors `test_asset_service.py:_run` — fresh engine per test avoids
    Windows ProactorEventLoop reuse issues.
    """
    async def _wrapper():
        engine = create_async_engine(settings.database_url, pool_pre_ping=True)
        factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        try:
            await coro_factory(factory)
        finally:
            await engine.dispose()

    asyncio.run(_wrapper())


async def _cleanup_user(svc: AssetService) -> None:
    for kind in ("character", "scene", "style"):
        rows, _ = await svc.list_assets(user_id=USER_ID, kind=kind, limit=500)
        for r in rows:
            await svc.soft_delete(user_id=USER_ID, asset_id=r["asset_id"])


# ===========================================================================
# Pure-function tests — no DB
# ===========================================================================

class TestValidateEmbedding:
    def test_accepts_minimal_payload(self) -> None:
        norm, err = _validate_embedding({"vector_id": "v1", "provider": "sora_character"})
        assert err is None
        assert norm == {"vector_id": "v1", "provider": "sora_character", "metadata": {}}

    def test_accepts_full_payload(self) -> None:
        norm, err = _validate_embedding({
            "vector_id": "https://sora/character/abc",
            "provider": "sora_character",
            "metadata": {"timestamps": "2,4", "score": 0.92},
        })
        assert err is None
        assert norm["vector_id"] == "https://sora/character/abc"
        assert norm["metadata"] == {"timestamps": "2,4", "score": 0.92}

    def test_strips_whitespace(self) -> None:
        norm, err = _validate_embedding({"vector_id": "  v1  ", "provider": " p "})
        assert err is None
        assert norm["vector_id"] == "v1"
        assert norm["provider"] == "p"

    def test_non_dict_returns_error(self) -> None:
        for bad in (None, "not-a-dict", 42, ["v1"]):
            norm, err = _validate_embedding(bad)
            assert norm is None
            assert err is not None and "对象" in err

    def test_missing_vector_id_returns_error(self) -> None:
        norm, err = _validate_embedding({"provider": "p"})
        assert norm is None
        assert err is not None and "vector_id" in err

    def test_empty_vector_id_returns_error(self) -> None:
        norm, err = _validate_embedding({"vector_id": "   ", "provider": "p"})
        assert norm is None
        assert err is not None and "vector_id" in err

    def test_missing_provider_returns_error(self) -> None:
        norm, err = _validate_embedding({"vector_id": "v"})
        assert norm is None
        assert err is not None and "provider" in err

    def test_non_dict_metadata_normalises_to_empty(self) -> None:
        # Strings / lists for `metadata` are silently dropped, not rejected.
        norm, err = _validate_embedding({
            "vector_id": "v", "provider": "p", "metadata": "not-a-dict",
        })
        assert err is None
        assert norm["metadata"] == {}


class TestModelForAssetId:
    def test_character_prefix(self) -> None:
        assert _model_for_asset_id("char_abc123") is CharacterAsset

    def test_scene_prefix(self) -> None:
        assert _model_for_asset_id("scene_abc123") is SceneAsset

    def test_style_prefix(self) -> None:
        assert _model_for_asset_id("style_abc123") is StyleAsset

    def test_unknown_prefix(self) -> None:
        for bad in ("foo_abc", "char-abc", "characterabc", "abc_char_xxx", ""):
            assert _model_for_asset_id(bad) is None


# ===========================================================================
# End-to-end DB tests
# ===========================================================================

def test_writes_identity_embedding_to_metadata_json():
    async def _go(async_session_factory):
        async with async_session_factory() as db:
            svc = AssetService(db)
            await _cleanup_user(svc)
            created = await svc.create_asset(
                user_id=USER_ID,
                kind="character",
                data={"name": "IdentTest", "appearance": "tall, dark hair"},
            )
            asset_id = created["asset_id"]

            result = await _handle_update_identity(
                {
                    "asset_id": asset_id,
                    "embedding": {
                        "vector_id": "https://sora/character/xyz",
                        "provider": "sora_character",
                        "metadata": {"timestamps": "1,3"},
                    },
                },
                {"db": db},
            )

            assert result.ok is True
            assert result.data["asset_id"] == asset_id
            assert result.data["embedding"]["provider"] == "sora_character"

            # Verify it round-trips through the service layer.
            got = await svc.get_asset(user_id=USER_ID, asset_id=asset_id)
            assert got is not None
            stored = got["metadata"]["identity_embedding"]
            assert stored["vector_id"] == "https://sora/character/xyz"
            assert stored["provider"] == "sora_character"
            assert stored["metadata"]["timestamps"] == "1,3"

            await _cleanup_user(svc)

    _run(_go)


def test_overwrites_existing_identity_embedding():
    async def _go(async_session_factory):
        async with async_session_factory() as db:
            svc = AssetService(db)
            await _cleanup_user(svc)
            created = await svc.create_asset(
                user_id=USER_ID,
                kind="character",
                data={"name": "Overwrite", "appearance": "x"},
            )
            asset_id = created["asset_id"]

            # First write — sora_character
            await _handle_update_identity(
                {
                    "asset_id": asset_id,
                    "embedding": {"vector_id": "v1", "provider": "sora_character"},
                },
                {"db": db},
            )

            # Second write — different provider, should replace cleanly
            result = await _handle_update_identity(
                {
                    "asset_id": asset_id,
                    "embedding": {"vector_id": "v2", "provider": "ip_adapter"},
                },
                {"db": db},
            )
            assert result.ok is True

            got = await svc.get_asset(user_id=USER_ID, asset_id=asset_id)
            stored = got["metadata"]["identity_embedding"]
            assert stored["vector_id"] == "v2"
            assert stored["provider"] == "ip_adapter"

            await _cleanup_user(svc)

    _run(_go)


def test_preserves_other_metadata_keys():
    """Writing identity_embedding must not nuke pre-existing metadata."""
    async def _go(async_session_factory):
        async with async_session_factory() as db:
            svc = AssetService(db)
            await _cleanup_user(svc)
            created = await svc.create_asset(
                user_id=USER_ID,
                kind="character",
                data={
                    "name": "MetaPreserve",
                    "appearance": "x",
                    "metadata": {"theme": "noir", "seed": 42},
                },
            )
            asset_id = created["asset_id"]

            await _handle_update_identity(
                {
                    "asset_id": asset_id,
                    "embedding": {"vector_id": "v", "provider": "p"},
                },
                {"db": db},
            )

            got = await svc.get_asset(user_id=USER_ID, asset_id=asset_id)
            md = got["metadata"]
            assert md["theme"] == "noir"
            assert md["seed"] == 42
            assert md["identity_embedding"]["vector_id"] == "v"

            await _cleanup_user(svc)

    _run(_go)


def test_unknown_asset_returns_not_found():
    async def _go(async_session_factory):
        async with async_session_factory() as db:
            result = await _handle_update_identity(
                {
                    "asset_id": "char_doesnotexist1234",
                    "embedding": {"vector_id": "v", "provider": "p"},
                },
                {"db": db},
            )
            assert result.ok is False
            assert result.error is not None
            assert result.error.code == "not_found"

    _run(_go)


def test_soft_deleted_asset_returns_not_found():
    async def _go(async_session_factory):
        async with async_session_factory() as db:
            svc = AssetService(db)
            await _cleanup_user(svc)
            created = await svc.create_asset(
                user_id=USER_ID,
                kind="character",
                data={"name": "SoftDel", "appearance": "x"},
            )
            asset_id = created["asset_id"]
            await svc.soft_delete(user_id=USER_ID, asset_id=asset_id)

            result = await _handle_update_identity(
                {
                    "asset_id": asset_id,
                    "embedding": {"vector_id": "v", "provider": "p"},
                },
                {"db": db},
            )
            assert result.ok is False
            assert result.error is not None and result.error.code == "not_found"

            # Cleanup is implicit — already soft-deleted.

    _run(_go)


def test_unknown_prefix_returns_invalid_args():
    async def _go(async_session_factory):
        async with async_session_factory() as db:
            result = await _handle_update_identity(
                {
                    "asset_id": "foo_abc",
                    "embedding": {"vector_id": "v", "provider": "p"},
                },
                {"db": db},
            )
            assert result.ok is False
            assert result.error is not None and result.error.code == "invalid_args"

    _run(_go)


# ===========================================================================
# Failure-mode tests — no DB writes
# ===========================================================================

def test_missing_asset_id_returns_missing_args():
    async def _go(async_session_factory):
        async with async_session_factory() as db:
            for bad in (None, "", "   ", 42, []):
                result = await _handle_update_identity(
                    {"asset_id": bad, "embedding": {"vector_id": "v", "provider": "p"}},
                    {"db": db},
                )
                assert result.ok is False
                assert result.error is not None and result.error.code == "missing_args"

    _run(_go)


def test_missing_embedding_returns_missing_args():
    async def _go(async_session_factory):
        async with async_session_factory() as db:
            result = await _handle_update_identity(
                {"asset_id": "char_x"},
                {"db": db},
            )
            assert result.ok is False
            assert result.error is not None and result.error.code == "missing_args"

    _run(_go)


def test_invalid_embedding_shape_returns_invalid_args():
    async def _go(async_session_factory):
        async with async_session_factory() as db:
            for bad in (
                {"vector_id": "v"},                   # missing provider
                {"provider": "p"},                    # missing vector_id
                {"vector_id": "", "provider": "p"},   # empty vector_id
                "not-a-dict",
            ):
                result = await _handle_update_identity(
                    {"asset_id": "char_x", "embedding": bad},
                    {"db": db},
                )
                assert result.ok is False
                assert result.error is not None and result.error.code == "invalid_args"

    _run(_go)


# ===========================================================================
# Registry contract
# ===========================================================================

def test_registry_pins_tool_metadata():
    from app.agents.tools import asset_tools as _at
    from app.agents.tool_registry import get_registry

    try:
        _at.register()
    except ValueError:
        pass  # already registered by a prior test
    tool = get_registry().resolve("asset.update_identity")
    assert tool is not None

    # Internal/admin → server scope, NOT exposed to LLM tools[]
    assert tool.scope == "server"
    assert tool.tier == "tier3"
    assert tool.risk_level == "low"

    # Schema must require the two top-level fields
    props: dict[str, Any] = tool.parameters["properties"]
    assert set(tool.parameters["required"]) == {"asset_id", "embedding"}
    assert props["asset_id"]["type"] == "string"
    embed_props = props["embedding"]["properties"]
    assert set(props["embedding"]["required"]) == {"vector_id", "provider"}
    assert embed_props["vector_id"]["type"] == "string"
    assert embed_props["provider"]["type"] == "string"
    assert embed_props["metadata"]["type"] == "object"

    # Sanity: no aliases (this is a brand-new tool, no legacy form)
    assert tool.aliases == ()
