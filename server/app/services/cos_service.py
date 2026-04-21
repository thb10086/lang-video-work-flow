"""
COS Service — 腾讯云对象存储上传服务

替代前端 cosUploader.ts，所有 COS 操作在后端完成。
支持 base64 图片上传，自动去重（hash 缓存）。

使用 httpx 直接调 COS XML API (PUT Object)，无需 SDK 依赖。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import httpx

from app.config import settings

logger = logging.getLogger("prism.services.cos")

# ── Upload cache (hash → URL) ──
_upload_cache: dict[str, str] = {}


def _strip_data_url(data: str) -> tuple[str, bytes]:
    """从 data URL 或纯 base64 提取 MIME type 和二进制数据"""
    if data.startswith("data:"):
        header, b64 = data.split(",", 1)
        mime = header.split(":")[1].split(";")[0]
    else:
        b64 = data
        mime = "image/png"
    raw = base64.b64decode(b64)
    return mime, raw


def _cos_sign(
    method: str,
    path: str,
    secret_id: str,
    secret_key: str,
    headers: dict[str, str],
    expire: int = 600,
) -> str:
    """生成 COS 请求签名 (HMAC-SHA1)"""
    now = int(time.time())
    key_time = f"{now};{now + expire}"
    sign_key = hmac.new(secret_key.encode(), key_time.encode(), "sha1").hexdigest()

    # HttpString
    http_string = f"{method.lower()}\n{path}\n\nhost={_cos_host()}\n"
    string_to_sign = f"sha1\n{key_time}\n{hashlib.sha1(http_string.encode()).hexdigest()}\n"
    signature = hmac.new(sign_key.encode(), string_to_sign.encode(), "sha1").hexdigest()

    return (
        f"q-sign-algorithm=sha1&q-ak={secret_id}&q-sign-time={key_time}"
        f"&q-key-time={key_time}&q-header-list=host&q-url-param-list="
        f"&q-signature={signature}"
    )


def _cos_host() -> str:
    return f"{settings.COS_BUCKET}.cos.{settings.COS_REGION}.myqcloud.com"


def _ext_from_mime(mime: str) -> str:
    mapping = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp"}
    return mapping.get(mime, "png")


class COSService:
    """COS 上传单例服务"""

    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None

    @property
    def ready(self) -> bool:
        return bool(settings.COS_SECRET_ID and settings.COS_SECRET_KEY and settings.COS_BUCKET)

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=60.0)
        return self._client

    async def upload(self, data: str, filename: str | None = None) -> dict[str, str]:
        """
        上传 base64 图片到 COS，返回 { url, key }。
        自动去重：相同 base64 hash 返回缓存 URL。
        """
        if not self.ready:
            raise RuntimeError("COS not configured")

        # Hash for dedup
        data_hash = hashlib.md5(data[:200].encode()).hexdigest()[:16]
        if data_hash in _upload_cache:
            cached_url = _upload_cache[data_hash]
            logger.debug("COS cache hit: %s", cached_url)
            return {"url": cached_url, "key": cached_url.split("/")[-1]}

        mime, raw_bytes = _strip_data_url(data)
        ext = _ext_from_mime(mime)

        # Generate unique key
        if filename:
            key = f"prism/{filename}"
        else:
            date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
            unique = uuid.uuid4().hex[:12]
            key = f"prism/{date_str}/{unique}.{ext}"

        path = f"/{key}"
        host = _cos_host()
        url = f"https://{host}{path}"

        headers = {
            "Host": host,
            "Content-Type": mime,
            "Content-Length": str(len(raw_bytes)),
        }
        headers["Authorization"] = _cos_sign(
            "put", path, settings.COS_SECRET_ID, settings.COS_SECRET_KEY, headers
        )

        resp = await self.client.put(url, content=raw_bytes, headers=headers)
        if resp.status_code not in (200, 204):
            raise RuntimeError(f"COS upload failed ({resp.status_code}): {resp.text[:200]}")

        _upload_cache[data_hash] = url
        logger.info("COS uploaded: %s (%d bytes)", key, len(raw_bytes))
        return {"url": url, "key": key}

    async def upload_batch(self, items: list[dict[str, Any]]) -> list[dict[str, str]]:
        """批量上传，每个 item 含 data 和可选 filename"""
        results = []
        for item in items:
            result = await self.upload(item["data"], item.get("filename"))
            results.append(result)
        return results

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None


# ── Singleton ──
cos_service = COSService()
