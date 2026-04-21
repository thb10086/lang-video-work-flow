"""
ImageService — 图片生成服务

通过 ChannelService 获取适配器，调用 Gemini API 生成图片。
生成后自动上传到 COS（如果配置了 COS）。
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.channel_service import ChannelService
from app.services.cos_service import cos_service
from app.services.model_service import ModelService

logger = logging.getLogger("prism.services.image")


class ImageService:
    """图片生成代理"""

    def __init__(self, db: AsyncSession) -> None:
        self.model_svc = ModelService(db)
        self.channel_svc = ChannelService(db)

    async def generate(
        self,
        model_id: str,
        prompt: str,
        reference_images: list[str] | None = None,
        params: dict[str, Any] | None = None,
        auto_upload: bool = True,
    ) -> dict[str, Any]:
        """
        生成图片并可选上传到 COS。

        Returns:
            {
                "images": [{"data": "base64...", "mimeType": "image/png", "url": "https://..."}],
                "text": "...",
            }
        """
        model = await self.model_svc.get_model(model_id)
        if not model:
            raise ValueError(f"Model not found: {model_id}")

        # 获取可用渠道
        channels = await self.channel_svc.get_channels_for_model(model.id)
        if not channels:
            raise RuntimeError(f"No channels available for model: {model_id}")

        # 构建参数
        gen_params = {
            "prompt": prompt,
            "reference_images": reference_images or [],
            **(params or {}),
        }

        # 按优先级尝试各渠道
        last_error: str | None = None
        for channel, mapping in channels:
            adapter = self.channel_svc.create_adapter(channel)
            result = await adapter.generate(mapping.channel_model_id, gen_params)

            if result.success and result.data:
                images = result.data.get("images", [])

                # Auto-upload to COS
                if auto_upload and cos_service.ready:
                    for img in images:
                        try:
                            upload_result = await cos_service.upload(img["data"])
                            img["url"] = upload_result["url"]
                        except Exception as e:
                            logger.warning("COS upload failed: %s", e)

                return {
                    "images": images,
                    "text": result.data.get("text"),
                    "usage": result.usage,
                }

            last_error = result.error
            logger.warning("Channel %s failed for image gen: %s", channel.channel_id, result.error)

        raise RuntimeError(f"All channels failed for {model_id}: {last_error}")
