"""Direct async service-layer tests for AssetService.

Bypasses TestClient (pre-existing starlette/httpx env incompat in this repo)
by calling service methods directly via async DB session.
"""

from __future__ import annotations

import asyncio

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.services.asset_service import AssetService


USER_ID = 99999  # isolated user to avoid polluting production rows


def _run(coro_factory):
    """Create a fresh engine per test to avoid Windows ProactorEventLoop reuse issues."""
    async def _wrapper():
        engine = create_async_engine(settings.database_url, pool_pre_ping=True)
        factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        try:
            await coro_factory(factory)
        finally:
            await engine.dispose()

    asyncio.run(_wrapper())


async def _cleanup_user(svc: AssetService) -> None:
    """Hard-purge anything we created (soft-delete then simulate purge by ignoring)."""
    for kind in ("character", "scene", "style"):
        rows, _ = await svc.list_assets(user_id=USER_ID, kind=kind, limit=500)
        for r in rows:
            await svc.soft_delete(user_id=USER_ID, asset_id=r["asset_id"])


def test_create_and_get_character():
    async def _go(async_session_factory):
        async with async_session_factory() as db:
            svc = AssetService(db)
            await _cleanup_user(svc)
            created = await svc.create_asset(
                user_id=USER_ID,
                kind="character",
                data={
                    "name": "DirectChar",
                    "name_en": "DirectChar",
                    "appearance": "bold hair, tall",
                    "reference_images": ["https://example.com/a.png"],
                },
            )
            assert created["asset_id"].startswith("char_")
            assert created["appearance"] == "bold hair, tall"

            got = await svc.get_asset(user_id=USER_ID, asset_id=created["asset_id"])
            assert got is not None
            assert got["name"] == "DirectChar"
            assert got["reference_images"] == ["https://example.com/a.png"]

            await _cleanup_user(svc)

    _run(_go)


def test_create_scene_and_style():
    async def _go(async_session_factory):
        async with async_session_factory() as db:
            svc = AssetService(db)
            await _cleanup_user(svc)
            scene = await svc.create_asset(
                user_id=USER_ID,
                kind="scene",
                data={"name": "DirectScene", "environment": "a dusty alley"},
            )
            assert scene["asset_id"].startswith("scene_")
            assert scene["environment"] == "a dusty alley"

            style = await svc.create_asset(
                user_id=USER_ID,
                kind="style",
                data={"name": "DirectStyle", "guide": "noir cinematography"},
            )
            assert style["asset_id"].startswith("style_")
            assert style["guide"] == "noir cinematography"

            await _cleanup_user(svc)

    _run(_go)


def test_update_bumps_version():
    async def _go(async_session_factory):
        async with async_session_factory() as db:
            svc = AssetService(db)
            await _cleanup_user(svc)
            c = await svc.create_asset(
                user_id=USER_ID,
                kind="character",
                data={"name": "Bump", "appearance": "v1"},
            )
            assert c["appearance_version"] == 1

            u1 = await svc.update_asset(
                user_id=USER_ID,
                asset_id=c["asset_id"],
                patch={"appearance": "v2"},
            )
            assert u1["appearance_version"] == 2

            # Non-content change: no bump
            u2 = await svc.update_asset(
                user_id=USER_ID,
                asset_id=c["asset_id"],
                patch={"name": "Renamed"},
            )
            assert u2["appearance_version"] == 2
            assert u2["name"] == "Renamed"

            await _cleanup_user(svc)

    _run(_go)


def test_variations_lifecycle():
    async def _go(async_session_factory):
        async with async_session_factory() as db:
            svc = AssetService(db)
            await _cleanup_user(svc)
            c = await svc.create_asset(
                user_id=USER_ID,
                kind="character",
                data={"name": "Varful", "appearance": "base"},
            )
            aid = c["asset_id"]

            # Add
            added = await svc.add_variation(
                user_id=USER_ID, asset_id=aid,
                data={"label": "formal", "appearance_delta": "in a suit"},
            )
            assert len(added["variations"]) == 1
            v = added["variations"][0]
            assert v["id"].startswith("var_")
            assert added["appearance_version"] == 2

            # Update
            updated = await svc.update_variation(
                user_id=USER_ID, asset_id=aid, variation_id=v["id"],
                patch={"label": "tux"},
            )
            assert updated["variations"][0]["label"] == "tux"

            # Remove
            removed = await svc.remove_variation(
                user_id=USER_ID, asset_id=aid, variation_id=v["id"],
            )
            assert removed["variations"] == []

            await _cleanup_user(svc)

    _run(_go)


def test_resolve_with_and_without_variation():
    async def _go(async_session_factory):
        async with async_session_factory() as db:
            svc = AssetService(db)
            await _cleanup_user(svc)
            c = await svc.create_asset(
                user_id=USER_ID,
                kind="character",
                data={
                    "name": "Res",
                    "appearance": "base",
                    "reference_images": ["base.png"],
                },
            )
            aid = c["asset_id"]

            # No variation
            r1 = await svc.resolve_asset(user_id=USER_ID, asset_id=aid)
            assert r1["appearance"] == "base"
            assert r1["reference_images"] == ["base.png"]
            assert r1["variation_id"] is None

            # With variation (images take precedence)
            v = (await svc.add_variation(
                user_id=USER_ID, asset_id=aid,
                data={
                    "label": "alt",
                    "appearance_delta": "with hat",
                    "reference_images": ["alt.png"],
                },
            ))["variations"][0]

            r2 = await svc.resolve_asset(user_id=USER_ID, asset_id=aid, variation_id=v["id"])
            assert r2["appearance"] == "base, with hat"
            assert r2["reference_images"] == ["alt.png", "base.png"]
            assert r2["variation_id"] == v["id"]

            # Unknown variation
            r3 = await svc.resolve_asset(user_id=USER_ID, asset_id=aid, variation_id="var_missing")
            assert r3 is None

            await _cleanup_user(svc)

    _run(_go)


def test_soft_delete_and_restore():
    async def _go(async_session_factory):
        async with async_session_factory() as db:
            svc = AssetService(db)
            await _cleanup_user(svc)
            c = await svc.create_asset(
                user_id=USER_ID, kind="character",
                data={"name": "Trashy", "appearance": "x"},
            )
            aid = c["asset_id"]

            # Active list contains it
            active, _ = await svc.list_assets(user_id=USER_ID, kind="character", limit=500)
            assert aid in [r["asset_id"] for r in active]

            # Delete
            assert await svc.soft_delete(user_id=USER_ID, asset_id=aid) is True

            # Not in active list
            active2, _ = await svc.list_assets(user_id=USER_ID, kind="character", limit=500)
            assert aid not in [r["asset_id"] for r in active2]

            # In trash
            trash = await svc.list_trash(user_id=USER_ID, kind="character")
            assert aid in [r["asset_id"] for r in trash]

            # Restore
            restored = await svc.restore(user_id=USER_ID, asset_id=aid)
            assert restored is not None
            assert restored["asset_id"] == aid

            # Back in active
            active3, _ = await svc.list_assets(user_id=USER_ID, kind="character", limit=500)
            assert aid in [r["asset_id"] for r in active3]

            await _cleanup_user(svc)

    _run(_go)


def test_search_q_filters():
    async def _go(async_session_factory):
        async with async_session_factory() as db:
            svc = AssetService(db)
            await _cleanup_user(svc)
            await svc.create_asset(
                user_id=USER_ID, kind="character",
                data={"name": "Sarah Miller", "name_en": "Sarah", "appearance": "red hair"},
            )
            await svc.create_asset(
                user_id=USER_ID, kind="character",
                data={"name": "Bob Chen", "name_en": "Bob", "appearance": "tall"},
            )

            rows, _ = await svc.list_assets(user_id=USER_ID, kind="character", q="sarah")
            names = [r["name"] for r in rows]
            assert "Sarah Miller" in names
            assert "Bob Chen" not in names

            await _cleanup_user(svc)

    _run(_go)
