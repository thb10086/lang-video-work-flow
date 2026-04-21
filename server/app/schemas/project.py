"""Project request/response schemas."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class ProjectCreate(BaseModel):
    name: str
    description: str | None = None
    scenario: str = "short_film"
    style: str = ""
    settings_json: dict[str, Any] | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    cover_url: str | None = None
    scenario: str | None = None
    style: str | None = None
    status: str | None = None
    settings_json: dict[str, Any] | None = None


class ProjectResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None = None
    cover_url: str | None = None
    scenario: str
    style: str
    status: str
    settings_json: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime


class ProjectListResponse(BaseModel):
    items: list[ProjectResponse]
    total: int
    page: int = 1
    page_size: int = 20
