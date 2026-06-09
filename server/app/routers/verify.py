"""
POST /api/verify/image — vision-based semantic image verification.

Thin layer that:
  1. Validates the requested model is in the supported vision registry.
  2. Serves a cached result from Redis if the same (image_url, criteria)
     pair was verified in the last 300 seconds.
  3. Otherwise dispatches to VisionVerifyService and caches the response.

Design notes:
  - Redis cache key = sha256 of the canonical JSON payload — cheap, stable,
    no collisions. TTL = 300s (balance between staleness and cost).
  - Cache miss propagates any LLM errors only inside the service (which
    returns a degraded VerifyImageResponse instead of throwing). That means
    the HTTP layer rarely returns 500 — the response body carries the
    failure signal (score=0, recommendation='retry').
  - Strict input validation via Pydantic catches malformed URLs / out-of-
    range thresholds before the service layer.
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db, get_redis
from app.schemas.common import SuccessResponse
from app.schemas.verify import VerifyImageRequest, VerifyImageResponse
from app.services.vision_verify_service import VisionVerifyService

logger = logging.getLogger("prism.verify")
router = APIRouter(prefix="/api/verify", tags=["verify"])


# ── Cache plumbing ──

CACHE_PREFIX = "prism:verify:image:"
CACHE_TTL_SECONDS = 300  # 5 minutes — matches spec Scenario "5 分钟内命中缓存"


def _cache_key(body: VerifyImageRequest) -> str:
    """Deterministic key from the full (url, model, criteria) tuple.
    Uses sha256 over canonical JSON — order-independent and collision-safe."""
    canonical = json.dumps(
        {
            "image_url": body.image_url,
            "model": body.model,
            "criteria": body.criteria.model_dump(exclude_none=True),
        },
        sort_keys=True,
        ensure_ascii=False,
    )
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"{CACHE_PREFIX}{digest}"


async def _cache_get(redis: Any, key: str) -> dict[str, Any] | None:
    if not redis:
        return None
    try:
        raw = await redis.get(key)
        if raw:
            return json.loads(raw)
    except Exception as e:  # pragma: no cover — Redis unavailable
        logger.warning("Verify cache read failed: %s", e)
    return None


async def _cache_set(redis: Any, key: str, data: dict[str, Any]) -> None:
    if not redis:
        return
    try:
        await redis.set(key, json.dumps(data, ensure_ascii=False), ex=CACHE_TTL_SECONDS)
    except Exception as e:  # pragma: no cover — Redis unavailable
        logger.warning("Verify cache write failed: %s", e)


# ── Endpoint ──


@router.post("/image", response_model=SuccessResponse[VerifyImageResponse])
async def verify_image(
    body: VerifyImageRequest,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """Vision-based semantic image verification.

    - 200 + VerifyImageResponse on success (including degraded responses
      for provider errors — inspect `match_score` and `recommendation`).
    - 422 if the requested `model` is not in the supported vision registry.
    """
    # Guard: only accept adapters we know how to route. Surfaces the list of
    # supported ids so the caller can self-correct without reading code.
    if not VisionVerifyService.is_model_supported(body.model):
        raise HTTPException(
            status_code=422,
            detail={
                "message": f"Unsupported vision model: {body.model!r}",
                "supported": VisionVerifyService.list_supported_models(),
            },
        )

    key = _cache_key(body)

    # Fast path — Redis hit.
    cached = await _cache_get(redis, key)
    if cached is not None:
        cached_resp = VerifyImageResponse(**{**cached, "cached": True})
        return SuccessResponse(data=cached_resp)

    # Slow path — dispatch to provider, then cache.
    svc = VisionVerifyService(db)
    resp = await svc.verify(body.image_url, body.model, body.criteria)
    # Store the un-cached payload so subsequent reads can flip `cached` on.
    await _cache_set(redis, key, resp.model_dump(exclude={"cached"}))
    return SuccessResponse(data=resp)
