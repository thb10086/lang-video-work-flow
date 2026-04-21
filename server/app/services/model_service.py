"""ModelService — 模型注册表服务

提供模型列表查询、参数 schema 获取、CRUD 操作。
查询结果通过 Redis 缓存 (JSON 序列化)，避免每次请求都查库。

缓存策略:
  - key 格式: prism:models:{capability}  或  prism:models:__all__
  - TTL: 1 小时
  - 写操作 (create/update/delete) 触发全量失效
"""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_model import AiModel

logger = logging.getLogger("prism.services.model")

CACHE_PREFIX = "prism:models:"
CACHE_TTL = 3600  # 1 hour


def _cache_key(capability: str | None) -> str:
    return f"{CACHE_PREFIX}{capability or '__all__'}"


class ModelService:
    """模型注册表 CRUD + Redis 缓存"""

    def __init__(self, db: AsyncSession, redis: Any = None) -> None:
        self.db = db
        self.redis = redis

    async def list_models(
        self,
        capability: str | None = None,
        enabled_only: bool = True,
    ) -> list[dict[str, Any]]:
        """获取模型列表。优先从 Redis 缓存读取 (JSON)，未命中时查 DB 并回填缓存。"""
        key = _cache_key(capability)

        # 1. Try Redis cache
        if self.redis:
            try:
                cached = await self.redis.get(key)
                if cached:
                    logger.debug("Cache HIT: %s", key)
                    return json.loads(cached)
            except Exception as e:
                logger.warning("Redis read error, fallback to DB: %s", e)

        # 2. Query DB
        query = select(AiModel).where(AiModel.deleted_at.is_(None))
        if enabled_only:
            query = query.where(AiModel.is_enabled == 1)
        if capability:
            query = query.where(AiModel.capability == capability)
        query = query.order_by(AiModel.capability, AiModel.sort_order)

        result = await self.db.execute(query)
        rows = list(result.scalars().all())

        # 3. Serialize + cache
        serialized = [self._model_to_dict(m) for m in rows]
        if self.redis:
            try:
                await self.redis.set(key, json.dumps(serialized, default=str), ex=CACHE_TTL)
                logger.debug("Cache SET: %s (%d items, TTL=%ds)", key, len(serialized), CACHE_TTL)
            except Exception as e:
                logger.warning("Redis write error: %s", e)

        return serialized

    async def get_model(self, model_id: str) -> AiModel | None:
        """按 model_id 获取单个模型"""
        result = await self.db.execute(
            select(AiModel).where(
                AiModel.model_id == model_id,
                AiModel.deleted_at.is_(None),
            )
        )
        return result.scalar_one_or_none()

    async def get_param_schema(self, model_id: str) -> list[dict[str, Any]]:
        """获取模型参数 schema"""
        model = await self.get_model(model_id)
        if not model:
            return []
        return model.param_schema if isinstance(model.param_schema, list) else []

    async def create_model(self, data: dict[str, Any]) -> AiModel:
        """创建模型"""
        model = AiModel(**data)
        self.db.add(model)
        await self.db.commit()
        await self.db.refresh(model)
        await self._invalidate_cache()
        return model

    async def update_model(self, db_id: int, data: dict[str, Any]) -> AiModel | None:
        """更新模型"""
        result = await self.db.execute(
            select(AiModel).where(AiModel.id == db_id, AiModel.deleted_at.is_(None))
        )
        model = result.scalar_one_or_none()
        if not model:
            return None
        for key, value in data.items():
            if hasattr(model, key) and value is not None:
                setattr(model, key, value)
        await self.db.commit()
        await self.db.refresh(model)
        await self._invalidate_cache()
        return model

    async def delete_model(self, db_id: int) -> bool:
        """软删除模型"""
        from datetime import datetime, timezone
        result = await self.db.execute(
            select(AiModel).where(AiModel.id == db_id, AiModel.deleted_at.is_(None))
        )
        model = result.scalar_one_or_none()
        if not model:
            return False
        model.deleted_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self._invalidate_cache()
        return True

    @staticmethod
    def _model_to_dict(m: AiModel) -> dict[str, Any]:
        """ORM -> dict (与 AiModelResponse schema 对齐)"""
        return {
            "id": m.id,
            "model_id": m.model_id,
            "name": m.name,
            "provider": m.provider,
            "capability": m.capability,
            "description": m.description,
            "param_schema": m.param_schema if isinstance(m.param_schema, list) else [],
            "is_enabled": m.is_enabled,
            "sort_order": m.sort_order,
            "created_at": str(m.created_at) if m.created_at else None,
            "updated_at": str(m.updated_at) if m.updated_at else None,
        }

    async def _invalidate_cache(self) -> None:
        """清除所有模型缓存 key (模式匹配 prism:models:*)"""
        if not self.redis:
            return
        try:
            keys = []
            async for k in self.redis.scan_iter(match=f"{CACHE_PREFIX}*", count=100):
                keys.append(k)
            if keys:
                await self.redis.delete(*keys)
                logger.info("Cache invalidated: %d keys", len(keys))
        except Exception as e:
            logger.warning("Redis invalidation error: %s", e)
