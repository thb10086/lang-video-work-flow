"""Pydantic schemas for AiChannel CRUD and API responses."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# ── Request schemas ──

class AiChannelCreate(BaseModel):
    channel_id: str = Field(max_length=64)
    name: str = Field(max_length=128)
    base_url: str = Field(max_length=512)
    api_key: str = Field(max_length=512)
    adapter_type: str = Field(max_length=64)
    is_enabled: int = 1
    config_json: dict[str, Any] | None = None


class AiChannelUpdate(BaseModel):
    name: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    adapter_type: str | None = None
    is_enabled: int | None = None
    config_json: dict[str, Any] | None = None


# ── Response schemas ──

class AiChannelResponse(BaseModel):
    id: int
    channel_id: str
    name: str
    base_url: str
    adapter_type: str
    is_enabled: int
    health_status: str
    last_health_check: datetime | None = None
    config_json: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AiChannelListResponse(BaseModel):
    items: list[AiChannelResponse]
    total: int


# ── Channel-Model Mapping schemas ──

class ChannelModelMappingCreate(BaseModel):
    model_id: int
    channel_id: int
    channel_model_id: str = Field(max_length=128)
    priority: int = 0
    is_enabled: int = 1


class ChannelModelMappingResponse(BaseModel):
    id: int
    model_id: int
    channel_id: int
    channel_model_id: str
    priority: int
    is_enabled: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
