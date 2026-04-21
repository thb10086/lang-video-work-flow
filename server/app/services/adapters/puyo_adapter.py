"""
PuyoAdapter — Puyo 视频生成适配器

API:
  Submit: POST /{channelModelId}/video_generation → { success, taskId, status }
  Query:  GET  /{channelModelId}/video_task/{taskId} → { success, taskId, status, progress, videoUrl }

注意: Puyo 使用 input_reference (单个 URL) 而非 image_urls 数组

移植自前端 PuyoVideoAdapter.ts
"""

from __future__ import annotations

import logging
from typing import Any

from app.services.adapters.base import (
    BaseAdapter,
    GenerateResult,
    TaskSubmitResult,
    TaskQueryResult,
)

logger = logging.getLogger("prism.adapters.puyo")

MAX_RETRIES = 3
RETRY_DELAYS = [3.0, 8.0, 15.0]


def _map_status(status: str) -> str:
    s = (status or "").lower()
    if s in ("queued", "pending"):
        return "pending"
    if s == "processing":
        return "processing"
    if s == "completed":
        return "completed"
    if s == "failed":
        return "failed"
    return "pending"


class PuyoAdapter(BaseAdapter):
    """Puyo 视频生成适配器（异步任务模型）"""

    async def generate(self, model_id: str, params: dict[str, Any]) -> GenerateResult:
        return GenerateResult(success=False, error=f"Puyo/{model_id} is async. Use submit_task().")

    async def submit_task(self, model_id: str, params: dict[str, Any]) -> TaskSubmitResult:
        """带重试的任务提交"""
        last_err: Exception | None = None
        for attempt in range(MAX_RETRIES + 1):
            try:
                if attempt > 0:
                    import asyncio
                    delay = RETRY_DELAYS[min(attempt - 1, len(RETRY_DELAYS) - 1)]
                    logger.info("Puyo/%s retry %d/%d after %.1fs", model_id, attempt, MAX_RETRIES, delay)
                    await asyncio.sleep(delay)
                return await self._do_submit(model_id, params)
            except Exception as e:
                last_err = e
                msg = str(e)
                import re
                if not re.search(r"429|50[0234]|timeout", msg, re.I) or attempt >= MAX_RETRIES:
                    return TaskSubmitResult(success=False, error=msg)
                logger.warning("Puyo/%s attempt %d failed: %s", model_id, attempt + 1, msg[:120])
        return TaskSubmitResult(success=False, error=str(last_err) if last_err else "Unknown error")

    async def _do_submit(self, model_id: str, params: dict[str, Any]) -> TaskSubmitResult:
        """model_id 此处为 channel_model_id (如 'veo-3-1-fast')"""
        body: dict[str, Any] = {
            "prompt": params.get("prompt", ""),
            "aspect_ratio": params.get("aspect_ratio", "16:9"),
        }

        # Puyo: input_reference (单个 URL)
        images: list[str] = params.get("images") or []
        if images:
            first_url = next((img for img in images if img.startswith("http")), None)
            if first_url:
                body["input_reference"] = first_url

        resp = await self.client.post(f"/{model_id}/video_generation", json=body)
        data = resp.json()

        if resp.status_code >= 400 or not data.get("success"):
            raise Exception(f"Puyo API error ({resp.status_code}): {data.get('error') or data.get('message') or ''}")

        task_id = data.get("taskId")
        if not task_id:
            raise Exception("Puyo: no taskId in response")

        return TaskSubmitResult(success=True, task_id=task_id)

    async def query_task(self, task_id: str) -> TaskQueryResult:
        """查询需要 channel_model_id 路径前缀，但这里简化：从 config.extra 或推断"""
        # channel_model_id 在 submit 时已知，query 时需要
        # 方案：task_service 在 Redis 中存储 channel_model_id，query 时传入
        channel_model_id = self.config.extra.get("channel_model_id", "")
        if not channel_model_id:
            raise Exception("Puyo query requires channel_model_id in config.extra")

        resp = await self.client.get(f"/{channel_model_id}/video_task/{task_id}")
        data = resp.json()

        if resp.status_code >= 400:
            raise Exception(f"Puyo query error ({resp.status_code}): {data.get('error') or ''}")

        return TaskQueryResult(
            task_id=data.get("taskId", task_id),
            status=_map_status(data.get("status", "pending")),
            progress=data.get("progress"),
            output_url=data.get("videoUrl") or None,
            error=data.get("error"),
            raw=data,
        )

    async def health_check(self) -> bool:
        try:
            resp = await self.client.get("/")
            return resp.status_code < 500
        except Exception:
            return False
