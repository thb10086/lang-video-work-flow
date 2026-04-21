"""
GeminiAdapter — Gemini 图片生成适配器

API: POST /v1beta/models/{model}:generateContent
支持：文生图、图编辑、九宫图生成（参考图通过 inlineData 传入）

移植自前端 GeminiImageAdapter.ts
"""

from __future__ import annotations

import base64
import logging
from typing import Any

from app.services.adapters.base import BaseAdapter, AdapterConfig, GenerateResult

logger = logging.getLogger("prism.adapters.gemini")

MAX_RETRIES = 3
RETRY_DELAYS = [2.0, 5.0, 10.0]
RETRYABLE_STATUS = {429, 500, 502, 503, 504}


class GeminiAdapter(BaseAdapter):
    """Gemini generateContent API 适配器（图片生成）"""

    async def generate(self, model_id: str, params: dict[str, Any]) -> GenerateResult:
        """带重试的图片生成"""
        last_err: Exception | None = None
        for attempt in range(MAX_RETRIES + 1):
            try:
                if attempt > 0:
                    import asyncio
                    delay = RETRY_DELAYS[min(attempt - 1, len(RETRY_DELAYS) - 1)]
                    logger.info("Gemini retry %d/%d after %.1fs", attempt, MAX_RETRIES, delay)
                    await asyncio.sleep(delay)
                return await self._do_generate(model_id, params)
            except Exception as e:
                last_err = e
                msg = str(e)
                retryable = any(str(s) in msg for s in RETRYABLE_STATUS) or "timeout" in msg.lower()
                if not retryable or attempt >= MAX_RETRIES:
                    return GenerateResult(success=False, error=msg)
                logger.warning("Gemini attempt %d failed: %s", attempt + 1, msg[:120])
        return GenerateResult(success=False, error=str(last_err) if last_err else "Unknown error")

    async def _do_generate(self, model_id: str, params: dict[str, Any]) -> GenerateResult:
        """执行单次 Gemini generateContent 调用"""
        url = f"/v1beta/models/{model_id}:generateContent"

        parts: list[dict[str, Any]] = []

        # 参考图片
        reference_images: list[str] = params.get("reference_images") or []
        for img in reference_images:
            try:
                mime_type, data = await self._parse_image(img)
                parts.append({"inlineData": {"mimeType": mime_type, "data": data}})
            except Exception as e:
                logger.warning("Skipping unparseable reference image: %s", e)

        # 文本 prompt
        parts.append({"text": params.get("prompt", "")})

        aspect_ratio = params.get("aspectRatio", "1:1")
        image_size = params.get("imageSize", "2k")

        body = {
            "contents": [{"parts": parts}],
            "generationConfig": {
                "responseModalities": ["TEXT", "IMAGE"],
                "imageConfig": {
                    "aspectRatio": aspect_ratio,
                    "imageSize": image_size,
                },
            },
        }

        resp = await self.client.post(url, json=body)

        if resp.status_code >= 400:
            raise Exception(f"Gemini API error ({resp.status_code}): {resp.text[:200]}")

        data = resp.json()
        if "error" in data and data["error"]:
            raise Exception(f"Gemini API error: {data['error'].get('message', str(data['error']))}")

        images: list[dict[str, str]] = []
        text_parts: list[str] = []

        candidate = (data.get("candidates") or [{}])[0] if data.get("candidates") else {}
        for part in (candidate.get("content", {}).get("parts") or []):
            if part.get("text"):
                text_parts.append(part["text"])
            inline = part.get("inlineData") or part.get("inline_data")
            if inline:
                mime = inline.get("mimeType") or inline.get("mime_type", "image/png")
                images.append({"data": inline.get("data", ""), "mimeType": mime})

        if not images:
            parts_count = len(candidate.get("content", {}).get("parts") or [])
            text_preview = "".join(text_parts)[:200] if text_parts else "(no text)"
            raise Exception(f"未返回图片 (parts={parts_count}, text={text_preview})")

        return GenerateResult(
            success=True,
            data={"images": images, "text": "\n".join(text_parts) if text_parts else None},
        )

    async def _parse_image(self, img: str) -> tuple[str, str]:
        """解析图片：data URL / HTTP URL / 纯 base64"""
        if img.startswith("data:"):
            # data:image/png;base64,xxxxx
            header, b64 = img.split(",", 1)
            mime = header.split(":")[1].split(";")[0]
            return mime, b64
        if img.startswith("http://") or img.startswith("https://"):
            resp = await self.client.get(img, timeout=30.0)
            resp.raise_for_status()
            mime = resp.headers.get("content-type", "image/png").split(";")[0]
            return mime, base64.b64encode(resp.content).decode()
        # 纯 base64
        return "image/png", img

    async def health_check(self) -> bool:
        """Gemini 没有专用健康端点，用 list models 替代"""
        try:
            resp = await self.client.get("/v1beta/models")
            return resp.status_code < 400
        except Exception:
            return False
