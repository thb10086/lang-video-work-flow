"""Pydantic schemas for AiModel CRUD and API responses."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# ── ParamField: 动态参数定义 (与前端 ParamField 接口对齐) ──

class ParamOption(BaseModel):
    label: str
    value: str | int | float


class ParamField(BaseModel):
    key: str
    label: str
    type: str = Field(description="string|number|boolean|select|textarea|image|slider")
    required: bool = False
    default: Any = None
    options: list[ParamOption] | None = None
    min: float | None = None
    max: float | None = None
    step: float | None = None
    placeholder: str | None = None
    description: str | None = None


# ── Request schemas ──

class AiModelCreate(BaseModel):
    model_id: str = Field(max_length=64)
    name: str = Field(max_length=128)
    provider: str = Field(max_length=64)
    capability: str = Field(max_length=32)
    description: str | None = None
    param_schema: list[ParamField]
    is_enabled: int = 1
    sort_order: int = 0


class AiModelUpdate(BaseModel):
    name: str | None = None
    provider: str | None = None
    capability: str | None = None
    description: str | None = None
    param_schema: list[ParamField] | None = None
    is_enabled: int | None = None
    sort_order: int | None = None


# ── Response schemas ──

class AiModelResponse(BaseModel):
    id: int
    model_id: str
    name: str
    provider: str
    capability: str
    description: str | None = None
    param_schema: list[ParamField]
    schema_version: int = 1
    is_enabled: int
    sort_order: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AiModelListResponse(BaseModel):
    items: list[AiModelResponse]
    total: int
