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
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.session import get_db
from app.db.redis import get_redis
from app.services.model_service import ModelService

logger = logging.getLogger("prism.agent_chat")
router = APIRouter(prefix="/api/agent", tags=["agent"])


# ============================================================
# Prompt-cache adaptation
# ============================================================
# Frontend may ship the system prompt as a structured content array when the
# user enabled the prompt-caching setting:
#
#   {
#     "role": "system",
#     "content": [
#       {"type": "text", "text": "...", "cache_control": {"type": "ephemeral"}},
#       {"type": "text", "text": "..."},
#     ]
#   }
#
# Anthropic's native /v1/messages endpoint accepts this form. OpenAI-compatible
# chat completions (the path we use through yunwu.ai) expects a plain string.
# We detect the structured form on the wire and flatten it back to a joined
# string whenever the target model isn't an Anthropic one, stripping the
# cache_control markers so upstream never sees an unsupported field.


def _is_anthropic_model(model_id: str) -> bool:
    """Return True if the model ID routes through Anthropic's native API.
    The OpenAI-compatible gateway handles claude-* models via its own adapter,
    but our gateway doesn't support cache_control pass-through — so for now
    we treat everything as non-Anthropic and always flatten.
    Swap this heuristic to True for claude-* once the gateway is verified.
    """
    _ = model_id  # reserved for future routing
    return False


def _flatten_system_blocks(block_list: list[dict[str, Any]]) -> str:
    """Collapse a content-block array into a single newline-joined string.
    Non-text blocks are dropped (none exist today in system-role messages).
    cache_control fields are stripped implicitly."""
    parts: list[str] = []
    for blk in block_list:
        if not isinstance(blk, dict):
            continue
        if blk.get("type") != "text":
            continue
        text = blk.get("text")
        if isinstance(text, str) and text:
            parts.append(text)
    return "\n\n".join(parts)


def adapt_messages_for_provider(
    messages: list[dict[str, Any]],
    model: str,
) -> list[dict[str, Any]]:
    """Normalise system-role messages so the upstream provider always receives
    a format it accepts. Called at the top of every /chat request.

    - Anthropic-native models: leave structured content as-is.
    - OpenAI-compatible models: flatten system content-block arrays to string
      and drop cache_control markers.
    """
    if _is_anthropic_model(model):
        return messages
    normalised: list[dict[str, Any]] = []
    for msg in messages:
        if not isinstance(msg, dict):
            normalised.append(msg)
            continue
        if msg.get("role") == "system" and isinstance(msg.get("content"), list):
            flat = _flatten_system_blocks(msg["content"])
            normalised.append({**msg, "content": flat})
        else:
            normalised.append(msg)
    return normalised


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


# ── Endpoints ──

@router.get("/config", response_model=AgentConfigResponse)
async def get_agent_config(db: AsyncSession = Depends(get_db)):
    """返回 Agent 配置（前端用于初始化，无密钥）。
    LLM 模型列表从 DB 动态查询，无硬编码。"""
    llm_models: list[str] = []
    try:
        redis = await get_redis()
        svc = ModelService(db, redis=redis)
        rows = await svc.list_models(capability="text")
        llm_models = [r["model_id"] for r in rows]
    except Exception as e:
        logger.warning("Failed to query LLM models from DB, returning default only: %s", e)
        llm_models = [settings.DEFAULT_LLM_MODEL]

    # Ensure default model is always in the list and comes first
    if settings.DEFAULT_LLM_MODEL not in llm_models:
        llm_models.insert(0, settings.DEFAULT_LLM_MODEL)
    elif llm_models[0] != settings.DEFAULT_LLM_MODEL:
        llm_models.remove(settings.DEFAULT_LLM_MODEL)
        llm_models.insert(0, settings.DEFAULT_LLM_MODEL)

    return AgentConfigResponse(
        default_llm_model=settings.DEFAULT_LLM_MODEL,
        default_image_model=settings.DEFAULT_IMAGE_MODEL,
        default_video_model=settings.DEFAULT_VIDEO_MODEL,
        llm_models=llm_models,
    )


@router.post("/chat")
async def agent_chat(body: AgentChatRequest):
    """
    非流式 Agent Chat — OpenAI-compatible passthrough。

    前端发送完整的 messages + tools 定义，
    后端透传到 LLM API 并返回结果（含 tool_calls）。
    """
    model = body.model or settings.DEFAULT_LLM_MODEL
    adapted_messages = adapt_messages_for_provider(body.messages, model)

    payload: dict[str, Any] = {
        "model": model,
        "messages": adapted_messages,
        "temperature": body.temperature,
        "max_tokens": body.max_tokens,
    }
    if body.tools:
        payload["tools"] = body.tools
        if body.tool_choice:
            payload["tool_choice"] = body.tool_choice

    try:
        # timeout=300s: 含图片 multi-modal 输入时，LLM (e.g. claude-opus-4.7) 处理慢，
        # 120s 经常 ReadTimeout。300s 是 Claude / OpenAI 推荐的 vision 调用上限。
        async with httpx.AsyncClient(timeout=300.0) as client:
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
        logger.exception("Agent chat error: %s", e)
        raise HTTPException(status_code=502, detail=f"LLM API 不可达: {type(e).__name__}: {str(e)[:200]}")


@router.post("/chat/stream")
async def agent_chat_stream(body: AgentChatRequest):
    """
    SSE 流式 Agent Chat — 透传 LLM 流式响应。
    """
    model = body.model or settings.DEFAULT_LLM_MODEL
    adapted_messages = adapt_messages_for_provider(body.messages, model)

    payload: dict[str, Any] = {
        "model": model,
        "messages": adapted_messages,
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
            # timeout=300s: 多模态 stream 同样需要更长 read window。
            async with httpx.AsyncClient(timeout=300.0) as client:
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
