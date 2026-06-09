"""
媒体 URL 标准化 — 统一把 base64 / data URL 上传到 COS 转成 https URL。

为什么需要这层：
    所有适配器（toapis / puyo / etc）只接受 http(s) URL，base64 / data URL
    会被直接丢弃。这会导致：
    - 角色一致性丢失（用户上传的角色图被丢）
    - 场景一致性丢失（上一镜头的 base64 输出被丢）
    - 品牌 logo 漂移（产品参考图被丢）
    - i2v 模型降级成 t2v（首帧图被丢）

    集中在 service 层做一次 normalize，所有适配器都受益（DRY）。

调用方：
    - image_service.generate  → normalize_image_list(reference_images)
    - video_service.submit    → normalize_image_list(images) + normalize_params_inplace(params)

注意：
    - character_url 不在处理列表中 — 它是 sora 的角色 ID（vector_id），不是图片。
    - 已经是 http(s) 的项原样保留，避免重复上传。
    - cos_service 内部按 hash 做去重缓存，多次上传同一张图返回同一 URL。
"""

from __future__ import annotations

import logging
from typing import Iterable

from app.services.cos_service import cos_service

logger = logging.getLogger("prism.services.media_norm")

# 单图参数字段（i2v / character / first-frame 等）— 这些字段值可能是 base64
# 注：character_url / characterUrl 是 sora 的角色 ID，不在此列。
SINGLE_IMAGE_PARAM_KEYS: tuple[str, ...] = (
    "first_frame", "firstFrame",
    "last_frame", "lastFrame",
    "input_reference", "inputReference",
    "image",
    "first_frame_image",
)


def _is_url(s: object) -> bool:
    return isinstance(s, str) and (s.startswith("http://") or s.startswith("https://"))


def _is_uploadable(s: str) -> bool:
    """判断字符串是否像 base64 / data URL（足以送去 cos.upload）。"""
    if not isinstance(s, str) or _is_url(s):
        return False
    if s.startswith("data:"):
        return True
    # 启发式：长度足够 + 没空格 + 字符集像 base64
    if len(s) < 100 or " " in s:
        return False
    head = s[:64]
    return all(c.isalnum() or c in "+/=_-\n\r" for c in head)


async def _upload_one(s: str) -> str | None:
    """上传一张 base64 / data URL；返回 https URL 或 None（失败时）。"""
    if _is_url(s):
        return s
    if not _is_uploadable(s):
        return None
    if not cos_service.ready:
        logger.warning(
            "media_norm: COS not configured, dropping non-URL image (len=%d, head=%r)",
            len(s), s[:24],
        )
        return None
    try:
        result = await cos_service.upload(s)
        return result["url"]
    except Exception as e:
        logger.warning("media_norm: COS upload failed: %s: %s", type(e).__name__, e)
        return None


async def normalize_image_list(items: Iterable[str] | None) -> list[str]:
    """对图片列表做 base64 → URL 转换；保留 URL，丢弃失败项。

    顺序保留（重要：i2v 首张图常被适配器当 first_frame 兜底）。
    """
    if not items:
        return []
    out: list[str] = []
    for item in items:
        if not isinstance(item, str) or not item:
            continue
        if _is_url(item):
            out.append(item)
            continue
        url = await _upload_one(item)
        if url:
            out.append(url)
    return out


async def normalize_params_inplace(params: dict | None) -> None:
    """对 params 字典里所有单图字段做就地 normalize（base64 → URL）。

    上传失败时删除字段（避免适配器拿到坏值导致请求 400）。
    """
    if not params:
        return
    for key in SINGLE_IMAGE_PARAM_KEYS:
        v = params.get(key)
        if not isinstance(v, str) or not v:
            continue
        if _is_url(v):
            continue
        url = await _upload_one(v)
        if url:
            params[key] = url
        else:
            params.pop(key, None)
