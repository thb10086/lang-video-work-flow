"""
TaskService — 异步任务状态管理（Redis 驱动）

替代前端 taskManager.ts 的任务跟踪功能。
Redis Key: prism:gentask:{task_id} → Hash

前端通过 GET /api/tasks/{task_id} 轮询任务状态。
"""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger("prism.services.task")

TASK_KEY_PREFIX = "prism:gentask:"
TASK_TTL = 7200  # 2 hours


class TaskService:
    """异步任务状态管理"""

    def __init__(self, redis: Any) -> None:
        self.redis = redis

    async def register_task(
        self,
        task_id: str,
        model_id: str,
        channel_id: str,
        channel_model_id: str,
    ) -> None:
        """注册新任务到 Redis"""
        key = f"{TASK_KEY_PREFIX}{task_id}"
        data = {
            "task_id": task_id,
            "model_id": model_id,
            "channel_id": channel_id,
            "channel_model_id": channel_model_id,
            "status": "pending",
            "output_url": "",
            "error": "",
        }
        await self.redis.hset(key, mapping=data)
        await self.redis.expire(key, TASK_TTL)
        logger.info("Task registered: %s (model=%s, channel=%s)", task_id, model_id, channel_id)

    async def get_task(self, task_id: str) -> dict[str, str] | None:
        """获取任务元数据"""
        key = f"{TASK_KEY_PREFIX}{task_id}"
        data = await self.redis.hgetall(key)
        if not data:
            return None
        # Redis returns bytes or str depending on decode_responses
        return {k if isinstance(k, str) else k.decode(): v if isinstance(v, str) else v.decode() for k, v in data.items()}

    async def update_task(
        self,
        task_id: str,
        status: str | None = None,
        output_url: str | None = None,
        error: str | None = None,
    ) -> None:
        """更新任务状态"""
        key = f"{TASK_KEY_PREFIX}{task_id}"
        updates: dict[str, str] = {}
        if status is not None:
            updates["status"] = status
        if output_url is not None:
            updates["output_url"] = output_url
        if error is not None:
            updates["error"] = error
        if updates:
            await self.redis.hset(key, mapping=updates)

    async def delete_task(self, task_id: str) -> None:
        """删除任务记录"""
        await self.redis.delete(f"{TASK_KEY_PREFIX}{task_id}")
