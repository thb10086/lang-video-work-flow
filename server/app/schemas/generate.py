"""Pydantic schemas for generation proxy endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


# ── Image Generation ──

class ImageGenerateRequest(BaseModel):
    model_id: str = Field(description="统一模型标识 e.g. gemini-3.1-flash-image-preview")
    prompt: str
    reference_images: list[str] | None = Field(default=None, description="base64 或 URL 参考图")
    params: dict[str, Any] | None = Field(default=None, description="模型特定参数")


class GeneratedImage(BaseModel):
    data: str = Field(description="base64 编码")
    mime_type: str = "image/png"
    url: str | None = Field(default=None, description="COS URL (如已上传)")


class ImageGenerateResponse(BaseModel):
    images: list[GeneratedImage]
    text: str | None = None
    usage: dict[str, int] | None = None


# ── Video Generation (async task) ──

class VideoGenerateRequest(BaseModel):
    model_id: str = Field(description="统一模型标识 e.g. veo3.1-fast")
    prompt: str
    images: list[str] | None = Field(default=None, description="首帧/尾帧图片 URL")
    params: dict[str, Any] | None = Field(default=None, description="模型特定参数")


class VideoTaskResponse(BaseModel):
    task_id: str
    status: str = "pending"


# ── Task Query ──

class TaskStatusResponse(BaseModel):
    task_id: str
    status: str
    progress: float | None = None
    output_url: str | None = None
    output_urls: list[str] | None = None
    error: str | None = None


# ── LLM Chat ──

class LLMChatRequest(BaseModel):
    model_id: str = Field(default="gemini-3.1-pro-preview", description="LLM 模型标识")
    prompt: str
    system_prompt: str | None = None
    temperature: float = 0.7
    max_tokens: int = 2000
    params: dict[str, Any] | None = None


class LLMChatResponse(BaseModel):
    text: str
    usage: dict[str, int] | None = None


# ── Upload ──

class ImageUploadRequest(BaseModel):
    data: str = Field(description="base64 编码的图片数据 (可含 data:image/xxx;base64, 前缀)")
    filename: str | None = Field(default=None, description="自定义文件名")


class ImageUploadResponse(BaseModel):
    url: str
    key: str


class BatchUploadRequest(BaseModel):
    images: list[ImageUploadRequest]


class BatchUploadResponse(BaseModel):
    results: list[ImageUploadResponse]
