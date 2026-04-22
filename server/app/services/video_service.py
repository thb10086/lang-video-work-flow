"""
VideoService — 视频生成 + 多渠道路由 + 降级容错

替代前端 channelRouter.ts + taskManager.ts 的核心逻辑。
按优先级尝试各渠道，失败自动降级到下一渠道。
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.channel_service import ChannelService
from app.services.model_service import ModelService
from app.services.param_validator import ParamValidationError, validate_params
from app.services.task_service import TaskService

logger = logging.getLogger("prism.services.video")


class VideoService:
    """视频生成代理（多渠道降级）"""

    def __init__(self, db: AsyncSession, redis: Any = None) -> None:
        self.model_svc = ModelService(db)
        self.channel_svc = ChannelService(db)
        self.task_svc = TaskService(redis) if redis else None

    async def submit(
        self,
        model_id: str,
        prompt: str,
        images: list[str] | None = None,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        提交视频生成任务（多渠道降级）。

        Returns:
            {"task_id": "...", "status": "pending", "channel": "apimart"}
        """
        model = await self.model_svc.get_model(model_id)
        if not model:
            raise ValueError(f"Model not found: {model_id}")

        # Validate params against model's schema BEFORE touching channels
        schema = model.param_schema if isinstance(model.param_schema, list) else []
        clean_params, violations = validate_params(schema, params)
        if violations:
            raise ParamValidationError(model_id, violations)

        channels = await self.channel_svc.get_channels_for_model(model.id)
        if not channels:
            raise RuntimeError(f"No channels for model: {model_id}")

        submit_params = {
            "prompt": prompt,
            "images": images or [],
            **clean_params,
        }

        last_error: str | None = None
        for channel, mapping in channels:
            extra = {"channel_model_id": mapping.channel_model_id}
            adapter = self.channel_svc.create_adapter(channel, extra=extra)

            result = await adapter.submit_task(mapping.channel_model_id, submit_params)

            if result.success and result.task_id:
                # Store task metadata in Redis for query_task
                if self.task_svc:
                    await self.task_svc.register_task(
                        task_id=result.task_id,
                        model_id=model_id,
                        channel_id=channel.channel_id,
                        channel_model_id=mapping.channel_model_id,
                    )

                logger.info("Video task submitted: %s via %s", result.task_id, channel.channel_id)
                return {
                    "task_id": result.task_id,
                    "status": "pending",
                    "channel": channel.channel_id,
                }

            last_error = result.error
            logger.warning("Channel %s failed for video: %s", channel.channel_id, result.error)

        raise RuntimeError(f"All channels failed for {model_id}: {last_error}")

    async def query_task(self, task_id: str) -> dict[str, Any]:
        """查询视频任务状态"""
        # Get task metadata from Redis
        task_meta = None
        if self.task_svc:
            task_meta = await self.task_svc.get_task(task_id)

        if not task_meta:
            raise ValueError(f"Task not found: {task_id}")

        channel = await self.channel_svc.get_channel(task_meta["channel_id"])
        if not channel:
            raise RuntimeError(f"Channel not found: {task_meta['channel_id']}")

        extra = {"channel_model_id": task_meta.get("channel_model_id", "")}
        adapter = self.channel_svc.create_adapter(channel, extra=extra)
        result = await adapter.query_task(task_id)

        # Update Redis
        if self.task_svc:
            await self.task_svc.update_task(task_id, status=result.status, output_url=result.output_url)

        return {
            "task_id": result.task_id,
            "status": result.status,
            "progress": result.progress,
            "output_url": result.output_url,
            "output_urls": result.output_urls,
            "error": result.error,
        }
