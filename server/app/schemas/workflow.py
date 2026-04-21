"""Workflow request/response schemas."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class WorkflowCreate(BaseModel):
    name: str
    nodes_json: list[dict[str, Any]]
    edges_json: list[dict[str, Any]]
    metadata_json: dict[str, Any] | None = None
    thumbnail_url: str | None = None


class WorkflowUpdate(BaseModel):
    name: str | None = None
    nodes_json: list[dict[str, Any]] | None = None
    edges_json: list[dict[str, Any]] | None = None
    metadata_json: dict[str, Any] | None = None
    thumbnail_url: str | None = None


class WorkflowResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    name: str
    version: int
    is_current: bool
    nodes_json: list[dict[str, Any]]
    edges_json: list[dict[str, Any]]
    metadata_json: dict[str, Any] | None = None
    thumbnail_url: str | None = None
    created_at: datetime
    updated_at: datetime


class WorkflowListResponse(BaseModel):
    items: list[WorkflowResponse]
    total: int
