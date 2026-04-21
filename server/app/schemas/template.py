"""Template request/response schemas."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class TemplateCreate(BaseModel):
    name: str
    description: str | None = None
    category: str
    scenario: str
    icon: str = "🎬"
    tags_json: list[str] | None = None
    nodes_json: list[dict[str, Any]]
    edges_json: list[dict[str, Any]]
    config_json: dict[str, Any] | None = None
    is_builtin: bool = False
    is_public: bool = False


class TemplateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None = None
    category: str
    scenario: str
    icon: str
    tags_json: list[str] | None = None
    nodes_json: list[dict[str, Any]]
    edges_json: list[dict[str, Any]]
    config_json: dict[str, Any] | None = None
    is_builtin: bool
    is_public: bool
    use_count: int
    created_at: datetime
    updated_at: datetime


class TemplateListResponse(BaseModel):
    items: list[TemplateResponse]
    total: int
