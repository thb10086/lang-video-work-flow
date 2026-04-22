"""AssetService — Asset Library CRUD + variations + resolve.

Three kinds (character / scene / style) share a common envelope but live in
separate tables for clean indexing and kind-specific fields. Variations are
stored inline in the `variations` JSON column (bounded <20 per asset).

`appearance_version` is auto-bumped on any content mutation (appearance /
environment / guide / reference_images / variations) so clients can cheaply
invalidate caches.
"""

from __future__ import annotations

import logging
import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset_library import (
    CharacterAsset,
    SceneAsset,
    StyleAsset,
)

logger = logging.getLogger("prism.services.asset_library")

NANOID_ALPHABET = string.ascii_letters + string.digits
TRASH_WINDOW_DAYS = 30


def _nanoid(length: int = 8) -> str:
    return "".join(secrets.choice(NANOID_ALPHABET) for _ in range(length))


def _kind_model(kind: str):
    if kind == "character":
        return CharacterAsset
    if kind == "scene":
        return SceneAsset
    if kind == "style":
        return StyleAsset
    raise ValueError(f"Unknown asset kind: {kind!r}")


def _kind_content_field(kind: str) -> str:
    return {"character": "appearance", "scene": "environment", "style": "guide"}[kind]


def _prefix(kind: str) -> str:
    return {"character": "char", "scene": "scene", "style": "style"}[kind]


def _row_to_dict(row: Any, kind: str) -> dict[str, Any]:
    """ORM row → API response dict (kind-aware content field + timestamps)."""
    content_field = _kind_content_field(kind)
    return {
        "id": row.id,
        "asset_id": row.asset_id,
        "kind": kind,
        "user_id": row.user_id,
        "project_id": row.project_id,
        "name": row.name,
        "name_en": row.name_en,
        "appearance": getattr(row, "appearance", None),
        "environment": getattr(row, "environment", None),
        "guide": getattr(row, "guide", None),
        content_field: getattr(row, content_field),  # always set for the row's kind
        "reference_images": list(row.reference_images or []),
        "variations": list(row.variations or []),
        "appearance_version": row.appearance_version or 1,
        "metadata": dict(row.metadata_json or {}),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


class AssetService:
    """Asset Library CRUD + search + variations + soft delete."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ── List / get ──

    async def list_assets(
        self,
        *,
        user_id: int,
        kind: str,
        q: str | None = None,
        project_id: int | None = None,
        include_global: bool = True,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        Model = _kind_model(kind)
        query = select(Model).where(Model.user_id == user_id, Model.deleted_at.is_(None))

        # Scope: either global (project_id IS NULL) or pinned to the given project
        if project_id is not None:
            if include_global:
                query = query.where(or_(Model.project_id == project_id, Model.project_id.is_(None)))
            else:
                query = query.where(Model.project_id == project_id)

        if q:
            like = f"%{q.lower()}%"
            content_col = getattr(Model, _kind_content_field(kind))
            query = query.where(
                or_(
                    Model.name.ilike(like),
                    Model.name_en.ilike(like),
                    content_col.ilike(like),
                )
            )

        query = query.order_by(Model.updated_at.desc()).limit(limit).offset(offset)
        result = await self.db.execute(query)
        rows = list(result.scalars().all())
        return [_row_to_dict(r, kind) for r in rows], len(rows)

    async def get_asset(self, *, user_id: int, asset_id: str) -> dict[str, Any] | None:
        kind = self._infer_kind(asset_id)
        if not kind:
            return None
        Model = _kind_model(kind)
        query = select(Model).where(
            Model.user_id == user_id,
            Model.asset_id == asset_id,
            Model.deleted_at.is_(None),
        )
        result = await self.db.execute(query)
        row = result.scalar_one_or_none()
        return _row_to_dict(row, kind) if row else None

    # ── Create / update / delete ──

    async def create_asset(
        self,
        *,
        user_id: int,
        kind: str,
        data: dict[str, Any],
    ) -> dict[str, Any]:
        Model = _kind_model(kind)
        content_field = _kind_content_field(kind)

        asset_id = f"{_prefix(kind)}_{_nanoid(8)}"
        # Stamp a uuid-style id for any variation that came in without one.
        incoming_variations = data.get("variations") or []
        stamped_variations: list[dict[str, Any]] = []
        for v in incoming_variations:
            if not isinstance(v, dict):
                continue
            new_v = dict(v)
            if not new_v.get("id"):
                new_v["id"] = _nanoid(12)
            stamped_variations.append(new_v)

        payload: dict[str, Any] = {
            "user_id": user_id,
            "project_id": data.get("project_id"),
            "asset_id": asset_id,
            "name": data["name"],
            "name_en": data.get("name_en"),
            "reference_images": data.get("reference_images") or [],
            "variations": stamped_variations,
            "appearance_version": 1,
            "metadata_json": data.get("metadata") or {},
            content_field: data.get(content_field, ""),
        }
        row = Model(**payload)
        self.db.add(row)
        await self.db.commit()
        await self.db.refresh(row)
        return _row_to_dict(row, kind)

    async def update_asset(
        self,
        *,
        user_id: int,
        asset_id: str,
        patch: dict[str, Any],
    ) -> dict[str, Any] | None:
        kind = self._infer_kind(asset_id)
        if not kind:
            return None
        Model = _kind_model(kind)
        content_field = _kind_content_field(kind)

        result = await self.db.execute(
            select(Model).where(
                Model.user_id == user_id,
                Model.asset_id == asset_id,
                Model.deleted_at.is_(None),
            )
        )
        row = result.scalar_one_or_none()
        if not row:
            return None

        content_changed = False
        content_fields = {"appearance", "environment", "guide", "reference_images"}

        for key, value in patch.items():
            if value is None:
                continue
            if key == "metadata":
                row.metadata_json = dict(value) if isinstance(value, dict) else value
            elif key == "reference_images":
                # New list to trigger JSON change detection
                row.reference_images = list(value)
                content_changed = True
            elif key == content_field:
                setattr(row, key, value)
                content_changed = True
            elif hasattr(row, key) and key not in content_fields:
                setattr(row, key, value)

        if content_changed:
            row.appearance_version = (row.appearance_version or 0) + 1

        await self.db.commit()
        await self.db.refresh(row)
        return _row_to_dict(row, kind)

    async def soft_delete(self, *, user_id: int, asset_id: str) -> bool:
        kind = self._infer_kind(asset_id)
        if not kind:
            return False
        Model = _kind_model(kind)
        result = await self.db.execute(
            select(Model).where(
                Model.user_id == user_id,
                Model.asset_id == asset_id,
                Model.deleted_at.is_(None),
            )
        )
        row = result.scalar_one_or_none()
        if not row:
            return False
        row.deleted_at = datetime.now(timezone.utc)
        await self.db.commit()
        return True

    async def restore(self, *, user_id: int, asset_id: str) -> dict[str, Any] | None:
        kind = self._infer_kind(asset_id)
        if not kind:
            return None
        Model = _kind_model(kind)
        result = await self.db.execute(
            select(Model).where(
                Model.user_id == user_id,
                Model.asset_id == asset_id,
                Model.deleted_at.is_not(None),
            )
        )
        row = result.scalar_one_or_none()
        if not row:
            return None
        row.deleted_at = None
        await self.db.commit()
        await self.db.refresh(row)
        return _row_to_dict(row, kind)

    async def list_trash(self, *, user_id: int, kind: str | None = None) -> list[dict[str, Any]]:
        cutoff = datetime.now(timezone.utc) - timedelta(days=TRASH_WINDOW_DAYS)
        kinds = [kind] if kind else ["character", "scene", "style"]
        out: list[dict[str, Any]] = []
        for k in kinds:
            Model = _kind_model(k)
            query = select(Model).where(
                Model.user_id == user_id,
                Model.deleted_at.is_not(None),
                Model.deleted_at >= cutoff,
            )
            rows = (await self.db.execute(query)).scalars().all()
            out.extend(_row_to_dict(r, k) for r in rows)
        out.sort(key=lambda r: r.get("updated_at") or datetime.min, reverse=True)
        return out

    # ── Variations ──

    async def add_variation(
        self,
        *,
        user_id: int,
        asset_id: str,
        data: dict[str, Any],
    ) -> dict[str, Any] | None:
        kind = self._infer_kind(asset_id)
        if not kind:
            return None
        Model = _kind_model(kind)
        row = (
            await self.db.execute(
                select(Model).where(
                    Model.user_id == user_id,
                    Model.asset_id == asset_id,
                    Model.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if not row:
            return None

        # Build a fresh list so SQLAlchemy detects JSON mutation
        new_var = {
            "id": f"var_{_nanoid(6)}",
            "label": data["label"],
            "appearance_delta": data.get("appearance_delta", ""),
            "reference_images": data.get("reference_images") or [],
        }
        row.variations = [dict(v) for v in (row.variations or [])] + [new_var]
        row.appearance_version = (row.appearance_version or 0) + 1
        await self.db.commit()
        await self.db.refresh(row)
        return _row_to_dict(row, kind)

    async def update_variation(
        self,
        *,
        user_id: int,
        asset_id: str,
        variation_id: str,
        patch: dict[str, Any],
    ) -> dict[str, Any] | None:
        kind = self._infer_kind(asset_id)
        if not kind:
            return None
        Model = _kind_model(kind)
        row = (
            await self.db.execute(
                select(Model).where(
                    Model.user_id == user_id,
                    Model.asset_id == asset_id,
                    Model.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if not row:
            return None

        # Build a new list of new dicts so SQLAlchemy detects the JSON change.
        new_variations: list[dict[str, Any]] = []
        found = False
        for v in (row.variations or []):
            if v.get("id") == variation_id:
                updated = dict(v)
                for key in ("label", "appearance_delta", "reference_images"):
                    if key in patch and patch[key] is not None:
                        updated[key] = patch[key]
                new_variations.append(updated)
                found = True
            else:
                new_variations.append(dict(v))
        if not found:
            return None
        row.variations = new_variations
        row.appearance_version = (row.appearance_version or 0) + 1
        await self.db.commit()
        await self.db.refresh(row)
        return _row_to_dict(row, kind)

    async def remove_variation(
        self,
        *,
        user_id: int,
        asset_id: str,
        variation_id: str,
    ) -> dict[str, Any] | None:
        kind = self._infer_kind(asset_id)
        if not kind:
            return None
        Model = _kind_model(kind)
        row = (
            await self.db.execute(
                select(Model).where(
                    Model.user_id == user_id,
                    Model.asset_id == asset_id,
                    Model.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if not row:
            return None

        original = list(row.variations or [])
        new_variations = [dict(v) for v in original if v.get("id") != variation_id]
        if len(new_variations) == len(original):
            return None
        row.variations = new_variations
        row.appearance_version = (row.appearance_version or 0) + 1
        await self.db.commit()
        await self.db.refresh(row)
        return _row_to_dict(row, kind)

    # ── Resolve (for @ reference pre-execute resolver) ──

    async def resolve_asset(
        self,
        *,
        user_id: int,
        asset_id: str,
        variation_id: str | None = None,
    ) -> dict[str, Any] | None:
        record = await self.get_asset(user_id=user_id, asset_id=asset_id)
        if not record:
            return None
        kind = record["kind"]
        base_text = record[_kind_content_field(kind)] or ""
        reference_images = list(record.get("reference_images") or [])

        if variation_id:
            var = next((v for v in record["variations"] if v.get("id") == variation_id), None)
            if not var:
                return None
            delta = var.get("appearance_delta") or ""
            appearance = f"{base_text}, {delta}".strip(", ") if delta else base_text
            var_refs = list(var.get("reference_images") or [])
            # Variation images take precedence, then fall back to parent refs
            merged_refs = var_refs + [img for img in reference_images if img not in var_refs]
            return {
                "asset_id": asset_id,
                "kind": kind,
                "appearance": appearance,
                "reference_images": merged_refs,
                "variation_id": variation_id,
            }

        return {
            "asset_id": asset_id,
            "kind": kind,
            "appearance": base_text,
            "reference_images": reference_images,
            "variation_id": None,
        }

    # ── Internal helpers ──

    @staticmethod
    def _infer_kind(asset_id: str) -> str | None:
        if asset_id.startswith("char_"):
            return "character"
        if asset_id.startswith("scene_"):
            return "scene"
        if asset_id.startswith("style_"):
            return "style"
        return None
