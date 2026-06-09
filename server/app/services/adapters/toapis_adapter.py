"""
ToApisAdapter — toapis.com 聚合网关适配器

API 形态（OpenAI 兼容网关，统一异步任务模型）：

  Image:
    Submit: POST /v1/images/generations  body={ model, prompt, size?, n?, reference_images?, metadata? }
    Poll:   GET  /v1/images/generations/{task_id}
    返回结构：
      { id, object: "generation.task", status: queued|in_progress|completed|failed,
        progress, result: { type: "image", data: [{url}] } }

  Video:
    Submit: POST /v1/videos/generations  body={ model, prompt, ... }
    Poll:   GET  /v1/videos/generations/{task_id}  （ToApis 标准）
    Fallback poll: GET /v1/tasks/{task_id}  （兼容 APIMart 路径）

支持模型（在 channel_model_mappings 中映射）：
  - 图片：gpt-image-2 / gemini-3.1-flash-image-preview-official / gemini-3-pro-image-preview-official / gpt-4o-image
  - 视频：sora-2-vip / veo3.1 / veo3.1-fast / kling-v3 / doubao-seedance-2.0 / 等

设计要点：
  1. ImageService 调用同步 generate()，因此 image 路径内部 poll 到完成再返回。
  2. VideoService 通过 submit_task / query_task 异步流程，由前端定时轮询。
  3. Image 结果是 URL（不是 base64），因此 GenerateResult.data.images[*].url 直接可用，
     无需再走 COS 上传（已是公网 CDN）。
"""

from __future__ import annotations

import asyncio
import base64
import logging
from typing import Any

import httpx

from app.services.adapters.base import (
    BaseAdapter,
    GenerateResult,
    TaskQueryResult,
    TaskSubmitResult,
)

logger = logging.getLogger("prism.adapters.toapis")

# ── 重试配置（仅适用提交阶段；轮询阶段由 _poll_image_task 内部循环负责）──
MAX_SUBMIT_RETRIES = 3
SUBMIT_RETRY_DELAYS = [2.0, 5.0, 10.0]
RETRYABLE_STATUS = ("429", "500", "502", "503", "504", "timeout")

# ── 异步任务轮询参数（仅 image 同步化路径用）──
IMAGE_POLL_INTERVAL_S = 2.0
IMAGE_POLL_MAX_ATTEMPTS = 90  # 90 * 2s = 180s ≈ 3 min 上限

TERMINAL_STATUSES = {"completed", "failed", "succeeded", "error"}


def _map_status(status: str) -> str:
    """Normalize provider status to: pending | processing | completed | failed."""
    s = (status or "").lower()
    if s in ("queued", "pending", "submitted"):
        return "pending"
    if s in ("in_progress", "processing", "running"):
        return "processing"
    if s in ("completed", "succeeded", "done"):
        return "completed"
    if s in ("failed", "error"):
        return "failed"
    return "pending"


class ToApisAdapter(BaseAdapter):
    """toapis.com 适配器：image 异步任务 + video 异步任务。"""

    # ============================================================
    # Image — sync interface, internally polls to completion
    # ============================================================

    async def generate(self, model_id: str, params: dict[str, Any]) -> GenerateResult:
        """
        提交图片任务并轮询直到完成（同步接口）。

        使 ImageService 无需改动即可调用 toapis 异步图片 API。
        """
        try:
            task_id = await self._submit_image_with_retry(model_id, params)
        except Exception as e:
            logger.warning("ToApis image submit failed for %s: %s", model_id, e)
            return GenerateResult(success=False, error=f"submit_failed: {e}")

        try:
            return await self._poll_image_task(task_id)
        except Exception as e:
            logger.warning("ToApis image poll failed for task %s: %s", task_id, e)
            return GenerateResult(success=False, error=f"poll_failed: {e}")

    async def _submit_image_with_retry(self, model_id: str, params: dict[str, Any]) -> str:
        """带退避重试的图片任务提交，返回 task_id。"""
        last_err: Exception | None = None
        for attempt in range(MAX_SUBMIT_RETRIES + 1):
            try:
                if attempt > 0:
                    delay = SUBMIT_RETRY_DELAYS[min(attempt - 1, len(SUBMIT_RETRY_DELAYS) - 1)]
                    logger.info(
                        "ToApis image %s retry %d/%d after %.1fs",
                        model_id, attempt, MAX_SUBMIT_RETRIES, delay,
                    )
                    await asyncio.sleep(delay)
                return await self._do_submit_image(model_id, params)
            except Exception as e:
                last_err = e
                msg = str(e)
                if not any(s in msg for s in RETRYABLE_STATUS) or attempt >= MAX_SUBMIT_RETRIES:
                    raise
                logger.warning("ToApis image %s attempt %d failed: %s", model_id, attempt + 1, msg[:160])
        # 不应到达此处
        raise last_err if last_err else RuntimeError("submit failed without error")

    async def _do_submit_image(self, model_id: str, params: dict[str, Any]) -> str:
        """单次图片任务提交，返回 task_id。"""
        body: dict[str, Any] = {
            "model": model_id,
            "prompt": params.get("prompt", ""),
            "n": int(params.get("n", 1) or 1),
        }

        # size 字段：toapis 接受 "1024x1024" 或比例 "1:1" / "16:9"。
        # 优先用上层传入的 size；否则把比例字段（aspectRatio）翻译成默认 size。
        size = params.get("size") or params.get("imageSize")
        aspect = params.get("aspectRatio") or params.get("aspect_ratio")
        if size:
            body["size"] = size
        elif aspect:
            # 简单映射：常见比例 → 1024 系列尺寸
            ratio_to_size = {
                "1:1": "1024x1024",
                "16:9": "1792x1024",
                "9:16": "1024x1792",
                "4:3": "1280x1024",
                "3:4": "1024x1280",
            }
            body["size"] = ratio_to_size.get(str(aspect), "1024x1024")

        # 分辨率/质量提示放进 metadata（toapis 文档示例）
        metadata: dict[str, Any] = {}
        for key in ("resolution", "quality", "style"):
            value = params.get(key)
            if value not in (None, "", []):
                metadata[key] = value
        if metadata:
            body["metadata"] = metadata

        # 参考图片：toapis 要求 URL 数组；调用方需保证已上传
        ref_images = await self._normalize_reference_images(params.get("reference_images") or [])
        if ref_images:
            body["reference_images"] = ref_images

        if params.get("response_format"):
            body["response_format"] = params["response_format"]

        resp = await self.client.post("/v1/images/generations", json=body)
        if resp.status_code >= 400:
            raise Exception(
                f"toapis submit error ({resp.status_code}): {resp.text[:400]}"
            )

        data = resp.json()
        task_id = data.get("id")
        if not task_id:
            raise Exception(f"toapis: no task id in response: {str(data)[:300]}")
        return task_id

    async def _poll_image_task(self, task_id: str) -> GenerateResult:
        """轮询图片任务直到 completed/failed，返回 GenerateResult。"""
        for attempt in range(IMAGE_POLL_MAX_ATTEMPTS):
            await asyncio.sleep(IMAGE_POLL_INTERVAL_S)
            try:
                resp = await self.client.get(f"/v1/images/generations/{task_id}")
            except httpx.RequestError as e:
                logger.warning("ToApis poll attempt %d transient error: %s", attempt + 1, e)
                continue

            if resp.status_code >= 400:
                raise Exception(
                    f"toapis poll error ({resp.status_code}): {resp.text[:300]}"
                )

            data = resp.json()
            status = _map_status(data.get("status", ""))
            if status == "failed":
                err = data.get("error") or data.get("message") or "task failed"
                err_msg = err if isinstance(err, str) else str(err)
                return GenerateResult(success=False, error=err_msg)

            if status == "completed":
                result = data.get("result") or {}
                items = result.get("data") or []
                images: list[dict[str, str]] = []
                text_parts: list[str] = []
                for item in items:
                    if isinstance(item, dict):
                        url = item.get("url")
                        if url:
                            images.append({"url": url, "mimeType": item.get("mimeType", "image/png")})
                        if item.get("text"):
                            text_parts.append(item["text"])
                if not images:
                    return GenerateResult(
                        success=False,
                        error=f"toapis: no images in completed result: {str(result)[:200]}",
                    )
                usage = data.get("usage")
                return GenerateResult(
                    success=True,
                    data={"images": images, "text": "\n".join(text_parts) if text_parts else None},
                    usage=usage if isinstance(usage, dict) else None,
                )
            # else: still pending / processing — continue polling

        raise TimeoutError(
            f"toapis image task {task_id} did not complete in {IMAGE_POLL_MAX_ATTEMPTS * IMAGE_POLL_INTERVAL_S:.0f}s"
        )

    async def _normalize_reference_images(self, refs: list[str]) -> list[str]:
        """toapis 仅接受 URL；过滤掉非 URL 的引用并打 warning。"""
        urls: list[str] = []
        for ref in refs:
            if not isinstance(ref, str):
                continue
            if ref.startswith("http://") or ref.startswith("https://"):
                urls.append(ref)
            else:
                # base64 / data url / 本地路径 — toapis 不接受
                logger.warning(
                    "toapis: dropping non-URL reference image (len=%d, starts=%r); upload first",
                    len(ref), ref[:24],
                )
        return urls

    # ============================================================
    # Video — async task interface (matches APIMart shape)
    # ============================================================

    async def submit_task(self, model_id: str, params: dict[str, Any]) -> TaskSubmitResult:
        """提交视频任务（带重试），返回 task_id。"""
        last_err: Exception | None = None
        for attempt in range(MAX_SUBMIT_RETRIES + 1):
            try:
                if attempt > 0:
                    delay = SUBMIT_RETRY_DELAYS[min(attempt - 1, len(SUBMIT_RETRY_DELAYS) - 1)]
                    logger.info(
                        "ToApis video %s retry %d/%d after %.1fs",
                        model_id, attempt, MAX_SUBMIT_RETRIES, delay,
                    )
                    await asyncio.sleep(delay)
                return await self._do_submit_video(model_id, params)
            except Exception as e:
                last_err = e
                msg = str(e)
                if not any(s in msg for s in RETRYABLE_STATUS) or attempt >= MAX_SUBMIT_RETRIES:
                    return TaskSubmitResult(success=False, error=msg)
                logger.warning("ToApis video %s attempt %d failed: %s", model_id, attempt + 1, msg[:160])
        return TaskSubmitResult(success=False, error=str(last_err) if last_err else "Unknown error")

    async def _do_submit_video(self, model_id: str, params: dict[str, Any]) -> TaskSubmitResult:
        """单次视频任务提交。"""
        body: dict[str, Any] = {
            "model": model_id,
            "prompt": params.get("prompt", ""),
        }
        # 通用字段（snake_case 直传）
        for key in ("duration", "aspect_ratio", "resolution", "size", "image_mode",
                    "watermark", "style", "storyboard", "private",
                    "negative_prompt", "audio", "mode", "camera_fixed",
                    "return_last_frame", "generate_audio",
                    # Sora 系列：参考角色 ID + 时间戳；OpenAI 标准 input_reference
                    "character_url", "character_timestamps", "input_reference",
                    # Wan / Hailuo / Seedance i2v：单张参考图字段
                    "image", "first_frame", "last_frame",
                    # Grok Video 3：时长字段叫 seconds（字符串"6"/"10"/"15"/"20"/"25"/"30"），
                    # 与其他视频模型用的 duration（int）共存，互不冲突 — 模型只用自己 schema 里的字段
                    "seconds"):
            value = params.get(key)
            if value not in (None, "", []):
                body[key] = value
        # camelCase 兼容（前端策略层有时直接吐 camelCase）
        camel_to_snake = {
            "characterUrl": "character_url",
            "characterTimestamps": "character_timestamps",
            "inputReference": "input_reference",
            "firstFrame": "first_frame",
            "lastFrame": "last_frame",
            "negativePrompt": "negative_prompt",
            "imageMode": "image_mode",
            "aspectRatio": "aspect_ratio",
        }
        for src_key, dst_key in camel_to_snake.items():
            if dst_key in body:
                continue  # snake_case 已有，优先
            value = params.get(src_key)
            if value not in (None, "", []):
                body[dst_key] = value
        if "seed" in params and params["seed"] not in (None, "", []):
            try:
                body["seed"] = int(params["seed"])
            except (TypeError, ValueError):
                pass

        # 图片输入：双写 images + image_urls（model 各取所需，多余字段网关丢弃）
        # - sora / seedance / veo / kling 用 image_urls
        # - grok-video-3 文档要求 images（最多 3 张）
        # 不按 model 分支 if/elif，保持 adapter 字段映射在一处闭环（DRY）
        images_in: list[str] = params.get("images") or []
        urls = [img for img in images_in if isinstance(img, str) and img.startswith("http")]
        # grok docs: 最多 3 张参考图；超过截断 + warning。其他模型一般也用不到 >3 张。
        if len(urls) > 3:
            logger.warning(
                "ToApis video %s: %d reference images exceed limit, truncating to 3",
                model_id, len(urls),
            )
            urls = urls[:3]
        if urls:
            body["images"] = urls           # grok-video-3 + 未来兼容 OpenAI 风格
            body["image_urls"] = urls       # sora / veo / kling / seedance / wan / hailuo（现有）
            # Sora i2v 通常用 input_reference 携带主图（OpenAI 风格）；
            # 没显式给 input_reference 时把第一张图填入，提高兼容性。
            if "input_reference" not in body:
                body["input_reference"] = urls[0]
        logger.info(
            "ToApis submit video: model=%s images=%d sora=%s wan=%s",
            model_id, len(urls),
            bool(body.get("character_url")),
            bool(body.get("image") or body.get("first_frame")),
        )

        resp = await self.client.post("/v1/videos/generations", json=body)
        if resp.status_code >= 400:
            raise Exception(
                f"toapis video submit error ({resp.status_code}): {resp.text[:400]}"
            )
        data = resp.json()

        # toapis 视频返回有两种可能：
        #   (a) {"id": "tsk_vid_xxx", "object": "generation.task", "status": "queued"}  （新）
        #   (b) {"code": 200, "data": [{"task_id": "..."}]}                              （APIMart 兼容旧）
        task_id = data.get("id")
        if not task_id and isinstance(data.get("data"), list) and data["data"]:
            task_id = data["data"][0].get("task_id") or data["data"][0].get("id")
        if not task_id:
            raise Exception(f"toapis: no task id in video response: {str(data)[:300]}")

        return TaskSubmitResult(success=True, task_id=task_id)

    async def query_task(self, task_id: str) -> TaskQueryResult:
        """查询视频任务状态。先试 toapis 标准路径，再回退 apimart 兼容路径。"""
        last_exc: Exception | None = None
        for path in (f"/v1/videos/generations/{task_id}", f"/v1/tasks/{task_id}"):
            try:
                resp = await self.client.get(path, params={"language": "zh"})
            except httpx.RequestError as e:
                last_exc = e
                continue
            if resp.status_code == 404:
                last_exc = Exception(f"404 at {path}")
                continue  # 试下一个 path
            if resp.status_code >= 400:
                raise Exception(
                    f"toapis query error ({resp.status_code}) at {path}: {resp.text[:300]}"
                )
            return self._parse_task_query(task_id, resp.json())
        raise last_exc if last_exc else Exception("toapis: all query paths failed")

    def _parse_task_query(self, task_id: str, data: dict[str, Any]) -> TaskQueryResult:
        """统一解析任务查询响应（兼容两种返回结构）。"""
        # 形态 A：toapis 标准 generation.task
        if data.get("object") == "generation.task" or "status" in data and "result" in data:
            status_str = data.get("status", "pending")
            status = _map_status(status_str)
            result = data.get("result") or {}
            items = result.get("data") or result.get("videos") or []
            urls = [item.get("url") for item in items if isinstance(item, dict) and item.get("url")]
            output_url = urls[0] if urls else None
            output_urls = urls if len(urls) > 1 else None
            error_val = data.get("error") or (data.get("message") if status == "failed" else None)
            error_msg = error_val if isinstance(error_val, str) else (
                error_val.get("message") if isinstance(error_val, dict) else None
            )
            return TaskQueryResult(
                task_id=data.get("id", task_id),
                status=status,
                progress=data.get("progress"),
                output_url=output_url,
                output_urls=output_urls,
                error=error_msg,
                raw=data,
            )

        # 形态 B：APIMart 兼容包装 {"code": 200, "data": {...}}
        task_data = data.get("data") if isinstance(data.get("data"), dict) else data
        status_str = task_data.get("status", "pending")
        status = _map_status(status_str)
        result = task_data.get("result") or {}
        items = result.get("videos") or result.get("images") or []
        all_urls: list[str] = []
        for item in items:
            url_val = item.get("url") if isinstance(item, dict) else None
            if isinstance(url_val, list):
                all_urls.extend(url_val)
            elif url_val:
                all_urls.append(url_val)
        error_val = task_data.get("error")
        error_msg: str | None = None
        if error_val:
            error_msg = error_val if isinstance(error_val, str) else error_val.get("message", str(error_val))
        return TaskQueryResult(
            task_id=task_data.get("id", task_id),
            status=status,
            progress=task_data.get("progress"),
            output_url=all_urls[0] if all_urls else None,
            output_urls=all_urls if len(all_urls) > 1 else None,
            error=error_msg,
            raw=data,
        )

    async def health_check(self) -> bool:
        """健康检查：toapis 应答 GET /v1/models 即视为健康。"""
        try:
            resp = await self.client.get("/v1/models")
            return resp.status_code < 500
        except Exception:
            return False
