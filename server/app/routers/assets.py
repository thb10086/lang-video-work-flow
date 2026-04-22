"""Asset Library REST endpoints.

Single-tenant for now: `user_id` comes from a simple FastAPI dependency that
returns `DEFAULT_USER_ID` (config). This one place is the future auth hook.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.asset_library import (
    AssetCreate,
    AssetListResponse,
    AssetResponse,
    AssetUpdate,
    ResolvedAssetResponse,
    VariationCreate,
    VariationResponse,
)
from app.schemas.common import SuccessResponse
from app.services.asset_service import AssetService

router = APIRouter(prefix="/api/assets", tags=["assets"])


DEFAULT_USER_ID = 1  # single-tenant default; replace with real auth later


def get_current_user_id() -> int:
    """FastAPI dependency for user scoping.

    Single-tenant placeholder — future auth layer plugs in here.
    """
    return DEFAULT_USER_ID


def _get_service(db: AsyncSession = Depends(get_db)) -> AssetService:
    return AssetService(db)


# ── List & trash ──

@router.get("", response_model=SuccessResponse[AssetListResponse])
async def list_assets(
    kind: str = Query(..., description="character|scene|style"),
    q: str | None = None,
    project_id: int | None = None,
    include_global: bool = True,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user_id: int = Depends(get_current_user_id),
    svc: AssetService = Depends(_get_service),
):
    if kind not in {"character", "scene", "style"}:
        raise HTTPException(status_code=400, detail=f"Invalid kind: {kind}")
    rows, total = await svc.list_assets(
        user_id=user_id,
        kind=kind,
        q=q,
        project_id=project_id,
        include_global=include_global,
        limit=limit,
        offset=offset,
    )
    items = [AssetResponse.model_validate(r) for r in rows]
    return SuccessResponse(data=AssetListResponse(items=items, total=total))


@router.get("/trash", response_model=SuccessResponse[list[AssetResponse]])
async def list_trash(
    kind: str | None = None,
    user_id: int = Depends(get_current_user_id),
    svc: AssetService = Depends(_get_service),
):
    rows = await svc.list_trash(user_id=user_id, kind=kind)
    return SuccessResponse(data=[AssetResponse.model_validate(r) for r in rows])


# ── Get / create / update / delete / restore ──

@router.get("/{asset_id}", response_model=SuccessResponse[AssetResponse])
async def get_asset(
    asset_id: str,
    user_id: int = Depends(get_current_user_id),
    svc: AssetService = Depends(_get_service),
):
    row = await svc.get_asset(user_id=user_id, asset_id=asset_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Asset not found: {asset_id}")
    return SuccessResponse(data=AssetResponse.model_validate(row))


@router.get("/{asset_id}/resolve", response_model=SuccessResponse[ResolvedAssetResponse])
async def resolve_asset(
    asset_id: str,
    variation: str | None = None,
    user_id: int = Depends(get_current_user_id),
    svc: AssetService = Depends(_get_service),
):
    resolved = await svc.resolve_asset(
        user_id=user_id, asset_id=asset_id, variation_id=variation
    )
    if not resolved:
        raise HTTPException(status_code=404, detail="Asset or variation not found")
    return SuccessResponse(data=ResolvedAssetResponse.model_validate(resolved))


@router.post("", response_model=SuccessResponse[AssetResponse])
async def create_asset(
    body: AssetCreate,
    user_id: int = Depends(get_current_user_id),
    svc: AssetService = Depends(_get_service),
):
    data = body.model_dump()
    kind = data.pop("kind")
    # Translate Pydantic `metadata` → internal `metadata`
    row = await svc.create_asset(user_id=user_id, kind=kind, data=data)
    return SuccessResponse(data=AssetResponse.model_validate(row))


@router.patch("/{asset_id}", response_model=SuccessResponse[AssetResponse])
async def update_asset(
    asset_id: str,
    body: AssetUpdate,
    user_id: int = Depends(get_current_user_id),
    svc: AssetService = Depends(_get_service),
):
    patch = body.model_dump(exclude_none=True)
    row = await svc.update_asset(user_id=user_id, asset_id=asset_id, patch=patch)
    if not row:
        raise HTTPException(status_code=404, detail=f"Asset not found: {asset_id}")
    return SuccessResponse(data=AssetResponse.model_validate(row))


@router.delete("/{asset_id}")
async def delete_asset(
    asset_id: str,
    user_id: int = Depends(get_current_user_id),
    svc: AssetService = Depends(_get_service),
):
    ok = await svc.soft_delete(user_id=user_id, asset_id=asset_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Asset not found: {asset_id}")
    return SuccessResponse(message="deleted")


@router.post("/{asset_id}/restore", response_model=SuccessResponse[AssetResponse])
async def restore_asset(
    asset_id: str,
    user_id: int = Depends(get_current_user_id),
    svc: AssetService = Depends(_get_service),
):
    row = await svc.restore(user_id=user_id, asset_id=asset_id)
    if not row:
        raise HTTPException(status_code=404, detail="Asset not found in trash")
    return SuccessResponse(data=AssetResponse.model_validate(row))


# ── Variations ──

@router.post("/{asset_id}/variations", response_model=SuccessResponse[AssetResponse])
async def add_variation(
    asset_id: str,
    body: VariationCreate,
    user_id: int = Depends(get_current_user_id),
    svc: AssetService = Depends(_get_service),
):
    row = await svc.add_variation(user_id=user_id, asset_id=asset_id, data=body.model_dump())
    if not row:
        raise HTTPException(status_code=404, detail=f"Asset not found: {asset_id}")
    return SuccessResponse(data=AssetResponse.model_validate(row))


@router.patch("/{asset_id}/variations/{variation_id}", response_model=SuccessResponse[AssetResponse])
async def update_variation(
    asset_id: str,
    variation_id: str,
    body: VariationCreate,
    user_id: int = Depends(get_current_user_id),
    svc: AssetService = Depends(_get_service),
):
    patch = body.model_dump(exclude_none=True)
    row = await svc.update_variation(
        user_id=user_id, asset_id=asset_id, variation_id=variation_id, patch=patch
    )
    if not row:
        raise HTTPException(status_code=404, detail="Asset or variation not found")
    return SuccessResponse(data=AssetResponse.model_validate(row))


@router.delete("/{asset_id}/variations/{variation_id}", response_model=SuccessResponse[AssetResponse])
async def delete_variation(
    asset_id: str,
    variation_id: str,
    user_id: int = Depends(get_current_user_id),
    svc: AssetService = Depends(_get_service),
):
    row = await svc.remove_variation(
        user_id=user_id, asset_id=asset_id, variation_id=variation_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Asset or variation not found")
    return SuccessResponse(data=AssetResponse.model_validate(row))
