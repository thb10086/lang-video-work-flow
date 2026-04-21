"""
Shared fixtures for Prism AI backend tests.

Uses the REAL database (prism_ai) since we need to verify seed data integrity.
Builds a minimal FastAPI app (avoids importing LangGraph/langchain which have
dependency issues in test env).

Uses synchronous TestClient to avoid Windows ProactorEventLoop / aiomysql
loop mismatch issues.
"""

import asyncio
from contextlib import asynccontextmanager
from typing import Generator

import pytest
import pytest_asyncio
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import redis.asyncio as aioredis
from app.config import settings
from app.db.redis import init_redis, redis_pool, get_redis


def _build_test_app() -> FastAPI:
    """Build a minimal FastAPI app with only the routers under test."""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await init_redis()
        yield

    test_app = FastAPI(lifespan=lifespan)

    from app.routers.health import router as health_router
    from app.routers.models import router as models_router
    from app.routers.channels import router as channels_router
    from app.routers.generate import router as generate_router
    from app.routers.upload import router as upload_router
    from app.routers.tasks import router as tasks_router

    test_app.include_router(health_router)
    test_app.include_router(models_router)
    test_app.include_router(channels_router)
    test_app.include_router(generate_router)
    test_app.include_router(upload_router)
    test_app.include_router(tasks_router)
    return test_app


_test_app = _build_test_app()


@pytest.fixture(scope="session")
def client() -> Generator[TestClient, None, None]:
    """Synchronous TestClient — handles event loop internally."""
    with TestClient(_test_app) as c:
        yield c


@pytest.fixture(scope="session")
def redis_sync():
    """Synchronous Redis client for direct Redis tests."""
    import redis as sync_redis
    r = sync_redis.Redis(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        password=settings.REDIS_PASSWORD or None,
        db=settings.REDIS_DB,
        decode_responses=True,
    )
    yield r
    r.close()


@pytest.fixture(scope="session")
def db_sync():
    """Synchronous DB connection for direct DB tests."""
    import pymysql
    conn = pymysql.connect(
        host=settings.DB_HOST,
        port=settings.DB_PORT,
        user=settings.DB_USER,
        password=settings.DB_PASSWORD,
        database=settings.DB_NAME,
        cursorclass=pymysql.cursors.DictCursor,
    )
    yield conn
    conn.close()
