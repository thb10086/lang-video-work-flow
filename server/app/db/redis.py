"""
Async Redis connection pool.
"""

import redis.asyncio as aioredis

from app.config import settings

redis_pool: aioredis.Redis | None = None


async def init_redis() -> aioredis.Redis:
    """Initialize the global Redis connection pool."""
    global redis_pool
    redis_pool = aioredis.from_url(
        settings.redis_url,
        encoding="utf-8",
        decode_responses=True,
        max_connections=20,
    )
    return redis_pool


async def close_redis() -> None:
    """Close the Redis connection pool."""
    global redis_pool
    if redis_pool:
        await redis_pool.aclose()
        redis_pool = None


def get_redis() -> aioredis.Redis:
    """Dependency: returns the Redis client. Must be initialized first."""
    if redis_pool is None:
        raise RuntimeError("Redis pool not initialized. Call init_redis() first.")
    return redis_pool
