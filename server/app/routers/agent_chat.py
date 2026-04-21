"""
Agent Chat Proxy — OpenAI-compatible chat completions passthrough

前端 Agent 循环通过此端点调用 LLM，支持 tool_calls。
所有 API Key 仅在后端，前端零密钥暴露。

POST /api/agent/chat          非流式
POST /api/agent/chat/stream   SSE 流式
GET  /api/agent/config        返回 Agent 配置（默认模型、可用模型列表等）
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.config import settings

logger = logging.getLogger("prism.agent_chat")
router = APIRouter(prefix="/api/agent", tags=["agent"])


# ── Schemas ──

class AgentChatRequest(BaseModel):
    """OpenAI-compatible chat completions request (subset)."""
    model: str = Field(default="", description="LLM 模型 ID，空则使用后端默认")
    messages: list[dict[str, Any]]
    temperature: float = 0.3
    max_tokens: int = 4096
    tools: list[dict[str, Any]] | None = None
    tool_choice: str | None = "auto"
    stream: bool = False


class AgentConfigResponse(BaseModel):
    """返回给前端的 Agent 配置（无密钥）。"""
    default_llm_model: str
    default_image_model: str
    default_video_model: str
    llm_models: list[str]
    backend_version: str = "0.1.0"


# ── Known LLM models (hardcoded for now, future: from DB) ──
KNOWN_LLM_MODELS = [
    "gpt-5.4",
    "gemini-3.1-pro-preview",
    "claude-sonnet-4-20250514",
]


# ── Endpoints ──

@router.get("/config", response_model=AgentConfigResponse)
async def get_agent_config():
    """返回 Agent 配置（前端用于初始化，无密钥）。"""
    return AgentConfigResponse(
        default_llm_model=settings.DEFAULT_LLM_MODEL,
        default_image_model=settings.DEFAULT_IMAGE_MODEL,
        default_video_model=settings.DEFAULT_VIDEO_MODEL,
        llm_models=KNOWN_LLM_MODELS,
    )


@router.post("/chat")
async def agent_chat(body: AgentChatRequest):
    """
    非流式 Agent Chat — OpenAI-compatible passthrough。

    前端发送完整的 messages + tools 定义，
    后端透传到 LLM API 并返回结果（含 tool_calls）。
    """
    model = body.model or settings.DEFAULT_LLM_MODEL

    payload: dict[str, Any] = {
        "model": model,
        "messages": body.messages,
        "temperature": body.temperature,
        "max_tokens": body.max_tokens,
    }
    if body.tools:
        payload["tools"] = body.tools
        if body.tool_choice:
            payload["tool_choice"] = body.tool_choice

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{settings.LLM_BASE_URL}/v1/chat/completions",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {settings.LLM_API_KEY}",
                },
                json=payload,
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as e:
        logger.error("LLM API error: %s %s", e.response.status_code, e.response.text[:500])
        raise HTTPException(status_code=e.response.status_code, detail=f"LLM API error: {e.response.text[:200]}")
    except Exception as e:
        logger.error("Agent chat error: %s", e)
        raise HTTPException(status_code=502, detail=f"LLM API 不可达: {str(e)[:200]}")


@router.post("/chat/stream")
async def agent_chat_stream(body: AgentChatRequest):
    """
    SSE 流式 Agent Chat — 透传 LLM 流式响应。
    """
    model = body.model or settings.DEFAULT_LLM_MODEL

    payload: dict[str, Any] = {
        "model": model,
        "messages": body.messages,
        "temperature": body.temperature,
        "max_tokens": body.max_tokens,
        "stream": True,
    }
    if body.tools:
        payload["tools"] = body.tools
        if body.tool_choice:
            payload["tool_choice"] = body.tool_choice

    async def event_generator():
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream(
                    "POST",
                    f"{settings.LLM_BASE_URL}/v1/chat/completions",
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {settings.LLM_API_KEY}",
                    },
                    json=payload,
                ) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if line.strip():
                            yield f"{line}\n\n"
        except Exception as e:
            logger.error("Stream error: %s", e)
            yield f"data: {{\"error\": \"{str(e)[:200]}\"}}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
