"""Pydantic schemas for Asset Library (character / scene / style) + variations."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


AssetKind = Literal["character", "scene", "style"]


# ── Variation ──

class VariationBase(BaseModel):
    label: str = Field(max_length=64)
    appearance_delta: str = Field(default="", max_length=2000)
    reference_images: list[str] = Field(default_factory=list)


class VariationCreate(VariationBase):
    pass


class VariationResponse(VariationBase):
    id: str


# ── Common asset envelope (used for request & response) ──

class AssetBase(BaseModel):
    name: str = Field(max_length=128)
    name_en: str | None = Field(default=None, max_length=128)
    reference_images: list[str] = Field(default_factory=list)
    # On create, clients may omit `id` — the service stamps a uuid4 per variation.
    variations: list[VariationCreate] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    project_id: int | None = None


class CharacterAssetCreate(AssetBase):
    kind: Literal["character"] = "character"
    appearance: str = Field(max_length=2000)


class SceneAssetCreate(AssetBase):
    kind: Literal["scene"] = "scene"
    environment: str = Field(max_length=2000)


class StyleAssetCreate(AssetBase):
    kind: Literal["style"] = "style"
    guide: str = Field(max_length=2000)


AssetCreate = CharacterAssetCreate | SceneAssetCreate | StyleAssetCreate


class AssetUpdate(BaseModel):
    name: str | None = None
    name_en: str | None = None
    reference_images: list[str] | None = None
    appearance: str | None = None
    environment: str | None = None
    guide: str | None = None
    metadata: dict[str, Any] | None = None
    project_id: int | None = None


# ── Response shapes ──

class AssetResponse(BaseModel):
    id: int
    asset_id: str
    kind: AssetKind
    user_id: int
    project_id: int | None = None
    name: str
    name_en: str | None = None
    appearance: str | None = None
    environment: str | None = None
    guide: str | None = None
    reference_images: list[str] = Field(default_factory=list)
    variations: list[VariationResponse] = Field(default_factory=list)
    appearance_version: int = 1
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class AssetListResponse(BaseModel):
    items: list[AssetResponse]
    total: int


class ResolvedAssetResponse(BaseModel):
    asset_id: str
    kind: AssetKind
    appearance: str = Field(description="merged full text (base + variation delta if any)")
    reference_images: list[str]
    variation_id: str | None = None
