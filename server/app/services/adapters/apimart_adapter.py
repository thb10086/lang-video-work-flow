"""
APIMartAdapter — APIMart 视频生成适配器

API:
  Submit: POST /v1/videos/generations → { code, data: [{ task_id, status }] }
  Query:  GET  /v1/tasks/{taskId}     → { code, data: { id, status, progress, result } }

支持模型：sora-2-vip / veo3.1-fast / veo3.1-quality / kling-v3 / doubao-seedance-2-0 等

移植自前端 APIMartVideoAdapter.ts
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

logger = logging.getLogger("prism.adapters.apimart")

MAX_RETRIES = 3
RETRY_DELAYS = [3.0, 8.0, 15.0]


def _map_status(status: str) -> str:
    """统一任务状态映射"""
    s = (status or "").lower()
    if s in ("pending", "queued", "submitted"):
        return "pending"
    if s in ("processing", "running", "in_progress"):
        return "processing"
    if s in ("completed", "done", "succeeded"):
        return "completed"
    if s in ("error", "failed"):
        return "failed"
    return "pending"


class APIMartAdapter(BaseAdapter):
    """APIMart 视频生成适配器（异步任务模型）"""

    async def generate(self, model_id: str, params: dict[str, Any]) -> GenerateResult:
        """APIMart 是异步任务模型，不支持同步生成"""
        return GenerateResult(success=False, error=f"{model_id} is async. Use submit_task().")

    async def submit_task(self, model_id: str, params: dict[str, Any]) -> TaskSubmitResult:
        """带重试的视频任务提交"""
        last_err: Exception | None = None
        for attempt in range(MAX_RETRIES + 1):
            try:
                if attempt > 0:
                    import asyncio
                    delay = RETRY_DELAYS[min(attempt - 1, len(RETRY_DELAYS) - 1)]
                    logger.info("APIMart/%s retry %d/%d after %.1fs", model_id, attempt, MAX_RETRIES, delay)
                    await asyncio.sleep(delay)
                return await self._do_submit(model_id, params)
            except Exception as e:
                last_err = e
                msg = str(e)
                retryable = any(s in msg for s in ("429", "500", "502", "503", "504", "timeout", "rate"))
                if not retryable or attempt >= MAX_RETRIES:
                    return TaskSubmitResult(success=False, error=msg)
                logger.warning("APIMart/%s attempt %d failed: %s", model_id, attempt + 1, msg[:120])
        return TaskSubmitResult(success=False, error=str(last_err) if last_err else "Unknown error")

    async def _do_submit(self, model_id: str, params: dict[str, Any]) -> TaskSubmitResult:
        """执行单次任务提交"""
        body: dict[str, Any] = {
            "model": model_id,
            "prompt": params.get("prompt", ""),
        }

        # Common params
        if "duration" in params:
            body["duration"] = params["duration"]
        if "aspect_ratio" in params:
            body["aspect_ratio"] = params["aspect_ratio"]

        # Image URLs
        images: list[str] = params.get("images") or []
        if images:
            urls = [img for img in images if img.startswith("http")]
            if urls:
                body["image_urls"] = urls

        # Model-specific params
        if model_id.startswith("doubao-seedance"):
            body.pop("aspect_ratio", None)
            body["size"] = params.get("size", "16:9")
            for key in ("resolution", "generate_audio", "camera_fixed", "return_last_frame"):
                if key in params and params[key] is not None:
                    body[key] = params[key]
            if "seed" in params and params["seed"] not in (None, "", ""):
                body["seed"] = int(params["seed"])
            if "image_with_roles" in params:
                body["image_with_roles"] = params["image_with_roles"]
                body.pop("image_urls", None)
            for key in ("video_urls", "audio_urls", "tools"):
                if key in params:
                    body[key] = params[key]

        elif model_id.startswith("sora-2"):
            for key in ("watermark", "style", "storyboard", "private"):
                if key in params and params[key] is not None:
                    body[key] = params[key]

        elif model_id.startswith("veo"):
            if "resolution" in params:
                body["resolution"] = params["resolution"]
            if "image_mode" in params and body.get("image_urls"):
                body["image_mode"] = params["image_mode"]

        elif model_id.startswith("kling"):
            for key in ("mode", "negative_prompt", "audio", "last_frame_image"):
                if key in params and params[key] is not None:
                    body[key] = params[key]

        resp = await self.client.post("/v1/videos/generations", json=body)
        data = resp.json()

        if resp.status_code >= 400:
            raise Exception(f"APIMart API error ({resp.status_code}): {data.get('error') or data.get('message') or resp.text[:300]}")

        if data.get("code") != 200 or not data.get("data"):
            raise Exception(f"APIMart error code={data.get('code')}: {data.get('error') or data.get('message') or str(data)[:300]}")

        first = data["data"][0]
        return TaskSubmitResult(success=True, task_id=first.get("task_id"))

    async def query_task(self, task_id: str) -> TaskQueryResult:
        """查询任务状态"""
        resp = await self.client.get(f"/v1/tasks/{task_id}", params={"language": "zh"})
        data = resp.json()

        if resp.status_code >= 400:
            raise Exception(f"APIMart query error ({resp.status_code}): {data.get('error') or resp.text[:300]}")

        task_data = data.get("data")
        if not task_data:
            raise Exception(f"No task data: {str(data)[:300]}")

        # Extract output URLs
        output_url: str | None = None
        output_urls: list[str] | None = None
        result = task_data.get("result")
        if result:
            items = result.get("videos") or result.get("images") or []
            all_urls: list[str] = []
            for item in items:
                url_val = item.get("url")
                if isinstance(url_val, list):
                    all_urls.extend(url_val)
                elif url_val:
                    all_urls.append(url_val)
            output_url = all_urls[0] if all_urls else None
            if len(all_urls) > 1:
                output_urls = all_urls

        # Extract error
        error_val = task_data.get("error")
        error_msg: str | None = None
        if error_val:
            error_msg = error_val if isinstance(error_val, str) else error_val.get("message", str(error_val))

        return TaskQueryResult(
            task_id=task_data.get("id", task_id),
            status=_map_status(task_data.get("status", "pending")),
            progress=task_data.get("progress"),
            output_url=output_url,
            output_urls=output_urls,
            error=error_msg,
            raw=data,
        )

    async def health_check(self) -> bool:
        try:
            resp = await self.client.get("/v1/models")
            return resp.status_code < 500
        except Exception:
            return False
