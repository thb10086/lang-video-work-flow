"""
Shared fixtures for Prism AI backend tests.

Uses the REAL database (prism_ai) since we need to verify seed data integrity.
Builds a minimal FastAPI app (avoids importing LangGraph/langchain which have
dependency issues in test env).

Uses httpx.Client + ASGITransport for synchronous testing — compatible with
httpx >=0.28 (where starlette.testclient.TestClient is broken because httpx
removed the `app` kwarg).
"""

import asyncio
from contextlib import asynccontextmanager
from typing import Generator

import pytest
from fastapi import FastAPI
import httpx

from app.config import settings
from app.db.redis import init_redis, redis_pool, get_redis


def _build_test_app() -> FastAPI:
    """Build a minimal FastAPI app with only the routers under test."""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await init_redis()
        yield

    test_app = FastAPI(lifespan=lifespan)

    # CORS — mirrors main.py's _expand_cors_origins logic
    from fastapi.middleware.cors import CORSMiddleware
    from app.main import _expand_cors_origins
    test_app.add_middleware(
        CORSMiddleware,
        allow_origins=_expand_cors_origins(settings.CORS_ORIGINS),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from app.routers.health import router as health_router
    from app.routers.models import router as models_router
    from app.routers.channels import router as channels_router
    from app.routers.generate import router as generate_router
    from app.routers.upload import router as upload_router
    from app.routers.tasks import router as tasks_router
    from app.routers.assets import router as assets_router
    from app.routers.agent_chat import router as agent_chat_router
    from app.routers.verify import router as verify_router

    test_app.include_router(health_router)
    test_app.include_router(models_router)
    test_app.include_router(channels_router)
    test_app.include_router(generate_router)
    test_app.include_router(upload_router)
    test_app.include_router(tasks_router)
    test_app.include_router(assets_router)
    test_app.include_router(agent_chat_router)
    test_app.include_router(verify_router)
    return test_app


_test_app = _build_test_app()


class _SyncASGIClient:
    """Synchronous wrapper around httpx.AsyncClient + ASGITransport.

    httpx >=0.28 removed the `app` kwarg from Client.__init__ and ASGITransport
    only supports async requests. We run each request through a private event
    loop so existing sync tests don't need any changes.
    """

    def __init__(self, app: FastAPI):
        self._transport = httpx.ASGITransport(app=app)  # type: ignore[arg-type]
        self._loop = asyncio.new_event_loop()
        # Trigger ASGI lifespan startup
        self._loop.run_until_complete(self._lifespan_startup())

    async def _lifespan_startup(self) -> None:
        """Manually drive the ASGI lifespan startup event."""
        scope = {"type": "lifespan", "asgi": {"version": "3.0"}}
        done = asyncio.Event()
        startup_sent = False

        async def receive():
            nonlocal startup_sent
            if not startup_sent:
                startup_sent = True
                return {"type": "lifespan.startup"}
            # Block forever after startup — the app is waiting for shutdown
            await asyncio.sleep(3600)
            return {"type": "lifespan.shutdown"}

        async def send(msg):
            if msg["type"] in (
                "lifespan.startup.complete",
                "lifespan.startup.failed",
            ):
                done.set()

        self._lifespan_task = asyncio.ensure_future(
            _test_app(scope, receive, send)
        )
        await asyncio.wait_for(done.wait(), timeout=10)

    def _request(self, method: str, url: str, **kw):
        async def _do():
            async with httpx.AsyncClient(
                transport=self._transport, base_url="http://testserver"
            ) as ac:
                return await ac.request(method, url, **kw)
        return self._loop.run_until_complete(_do())

    def get(self, url, **kw):    return self._request("GET", url, **kw)
    def post(self, url, **kw):   return self._request("POST", url, **kw)
    def put(self, url, **kw):    return self._request("PUT", url, **kw)
    def patch(self, url, **kw):  return self._request("PATCH", url, **kw)
    def delete(self, url, **kw): return self._request("DELETE", url, **kw)

    def close(self):
        self._lifespan_task.cancel()
        self._loop.run_until_complete(asyncio.sleep(0))
        self._loop.close()


@pytest.fixture(scope="session")
def client() -> Generator[_SyncASGIClient, None, None]:
    """Synchronous ASGI test client — compatible with httpx >=0.28."""
    c = _SyncASGIClient(_test_app)
    yield c
    c.close()


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
