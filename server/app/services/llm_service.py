"""
LLMService — LLM Chat 服务

升级版 generation_tools.py，通过 ChannelService 获取适配器，
支持非流式和流式调用。
"""

from __future__ import annotations

import logging
from typing import Any, AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.channel_service import ChannelService
from app.services.model_service import ModelService
from app.services.adapters.openai_adapter import OpenAIAdapter

logger = logging.getLogger("prism.services.llm")


class LLMService:
    """LLM Chat 代理"""

    def __init__(self, db: AsyncSession) -> None:
        self.model_svc = ModelService(db)
        self.channel_svc = ChannelService(db)

    async def chat(
        self,
        model_id: str,
        prompt: str,
        system_prompt: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 2000,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """非流式 LLM Chat"""
        model = await self.model_svc.get_model(model_id)
        if not model:
            raise ValueError(f"Model not found: {model_id}")

        channels = await self.channel_svc.get_channels_for_model(model.id)
        if not channels:
            raise RuntimeError(f"No channels for model: {model_id}")

        gen_params = {
            "prompt": prompt,
            "system_prompt": system_prompt,
            "temperature": temperature,
            "max_tokens": max_tokens,
            **(params or {}),
        }

        last_error: str | None = None
        for channel, mapping in channels:
            adapter = self.channel_svc.create_adapter(channel)
            result = await adapter.generate(mapping.channel_model_id, gen_params)

            if result.success and result.data:
                return {
                    "text": result.data.get("text", ""),
                    "usage": result.usage,
                }

            last_error = result.error
            logger.warning("Channel %s failed for LLM: %s", channel.channel_id, result.error)

        raise RuntimeError(f"All channels failed for {model_id}: {last_error}")

    async def chat_stream(
        self,
        model_id: str,
        prompt: str,
        system_prompt: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 2000,
        params: dict[str, Any] | None = None,
    ) -> AsyncIterator[str]:
        """流式 LLM Chat（SSE 格式）"""
        model = await self.model_svc.get_model(model_id)
        if not model:
            raise ValueError(f"Model not found: {model_id}")

        channels = await self.channel_svc.get_channels_for_model(model.id)
        if not channels:
            raise RuntimeError(f"No channels for model: {model_id}")

        gen_params = {
            "prompt": prompt,
            "system_prompt": system_prompt,
            "temperature": temperature,
            "max_tokens": max_tokens,
            **(params or {}),
        }

        for channel, mapping in channels:
            adapter = self.channel_svc.create_adapter(channel)
            if not isinstance(adapter, OpenAIAdapter):
                continue
            try:
                async for chunk in adapter.generate_stream(mapping.channel_model_id, gen_params):
                    yield chunk
                return
            except Exception as e:
                logger.warning("Channel %s stream failed: %s", channel.channel_id, e)

        raise RuntimeError(f"No streaming channels for {model_id}")
