"""
ChannelService — 渠道管理 + 适配器工厂

核心职责：
  1. 渠道 CRUD
  2. 根据 adapter_type 创建适配器实例（工厂模式）
  3. 按模型查询可用渠道（含映射表）并按优先级排序
  4. 渠道健康检查
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_channel import AiChannel
from app.models.channel_model_mapping import ChannelModelMapping
from app.services.adapters.base import BaseAdapter, AdapterConfig

logger = logging.getLogger("prism.services.channel")

# ── 适配器类型注册表（工厂模式）──
_ADAPTER_REGISTRY: dict[str, type[BaseAdapter]] = {}


def register_adapter(adapter_type: str, cls: type[BaseAdapter]) -> None:
    """注册适配器类型"""
    _ADAPTER_REGISTRY[adapter_type] = cls


def _ensure_adapters_registered() -> None:
    """延迟注册，避免循环导入"""
    if _ADAPTER_REGISTRY:
        return
    from app.services.adapters.gemini_adapter import GeminiAdapter
    from app.services.adapters.openai_adapter import OpenAIAdapter
    from app.services.adapters.apimart_adapter import APIMartAdapter
    from app.services.adapters.puyo_adapter import PuyoAdapter
    register_adapter("gemini", GeminiAdapter)
    register_adapter("openai", OpenAIAdapter)
    register_adapter("apimart", APIMartAdapter)
    register_adapter("puyo", PuyoAdapter)


class ChannelService:
    """渠道管理 + 适配器工厂"""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._adapter_cache: dict[int, BaseAdapter] = {}

    async def list_channels(self, enabled_only: bool = True) -> list[AiChannel]:
        query = select(AiChannel).where(AiChannel.deleted_at.is_(None))
        if enabled_only:
            query = query.where(AiChannel.is_enabled == 1)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_channel(self, channel_id: str) -> AiChannel | None:
        result = await self.db.execute(
            select(AiChannel).where(AiChannel.channel_id == channel_id, AiChannel.deleted_at.is_(None))
        )
        return result.scalar_one_or_none()

    async def get_channels_for_model(self, model_db_id: int) -> list[tuple[AiChannel, ChannelModelMapping]]:
        """获取支持指定模型的所有渠道（按优先级排序）"""
        result = await self.db.execute(
            select(AiChannel, ChannelModelMapping)
            .join(ChannelModelMapping, ChannelModelMapping.channel_id == AiChannel.id)
            .where(
                ChannelModelMapping.model_id == model_db_id,
                ChannelModelMapping.is_enabled == 1,
                AiChannel.is_enabled == 1,
                AiChannel.deleted_at.is_(None),
            )
            .order_by(ChannelModelMapping.priority)
        )
        return list(result.all())

    def create_adapter(self, channel: AiChannel, extra: dict[str, Any] | None = None) -> BaseAdapter:
        """工厂方法：根据 adapter_type 创建适配器实例"""
        _ensure_adapters_registered()

        # 缓存复用
        if channel.id in self._adapter_cache:
            return self._adapter_cache[channel.id]

        cls = _ADAPTER_REGISTRY.get(channel.adapter_type)
        if not cls:
            raise ValueError(f"Unknown adapter type: {channel.adapter_type}")

        config_json = channel.config_json or {}
        config = AdapterConfig(
            base_url=channel.base_url,
            api_key=channel.api_key,
            timeout=config_json.get("timeout", 120),
            max_retries=config_json.get("max_retries", 2),
            extra=extra or {},
        )
        adapter = cls(config)
        self._adapter_cache[channel.id] = adapter
        return adapter

    async def health_check(self, channel_id: str) -> bool:
        """执行渠道健康检查并更新 DB"""
        channel = await self.get_channel(channel_id)
        if not channel:
            return False

        adapter = self.create_adapter(channel)
        healthy = await adapter.health_check()

        channel.health_status = "ok" if healthy else "error"
        channel.last_health_check = datetime.now(timezone.utc)
        await self.db.commit()
        return healthy

    async def create_channel(self, data: dict[str, Any]) -> AiChannel:
        channel = AiChannel(**data)
        self.db.add(channel)
        await self.db.commit()
        await self.db.refresh(channel)
        return channel

    async def update_channel(self, db_id: int, data: dict[str, Any]) -> AiChannel | None:
        result = await self.db.execute(
            select(AiChannel).where(AiChannel.id == db_id, AiChannel.deleted_at.is_(None))
        )
        channel = result.scalar_one_or_none()
        if not channel:
            return None
        for key, value in data.items():
            if hasattr(channel, key) and value is not None:
                setattr(channel, key, value)
        await self.db.commit()
        await self.db.refresh(channel)
        # Invalidate adapter cache
        self._adapter_cache.pop(db_id, None)
        return channel

    async def delete_channel(self, db_id: int) -> bool:
        result = await self.db.execute(
            select(AiChannel).where(AiChannel.id == db_id, AiChannel.deleted_at.is_(None))
        )
        channel = result.scalar_one_or_none()
        if not channel:
            return False
        channel.deleted_at = datetime.now(timezone.utc)
        await self.db.commit()
        self._adapter_cache.pop(db_id, None)
        return True

    async def close_all(self) -> None:
        """释放所有适配器连接"""
        for adapter in self._adapter_cache.values():
            await adapter.close()
        self._adapter_cache.clear()
