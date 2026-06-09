"""
Prism AI Video Workflow Studio — FastAPI Backend
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.db.redis import close_redis, init_redis
from app.db.session import engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("prism")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown: init DB engine + Redis pool + Agent tool registry."""
    logger.info("Starting Prism AI Server...")
    logger.info(f"DB: {settings.DB_HOST}:{settings.DB_PORT}/{settings.DB_NAME}")
    logger.info(f"Redis: {settings.REDIS_HOST}:{settings.REDIS_PORT}/{settings.REDIS_DB}")

    # Init Redis
    await init_redis()
    logger.info("Redis pool initialized")

    # Populate Agent tool registry (idempotent — safe across hot reloads)
    from app.agents.tools import register_all_tools
    register_all_tools()

    yield

    # Shutdown
    await close_redis()
    await engine.dispose()
    logger.info("Prism AI Server stopped")


app = FastAPI(
    title="Prism AI Server",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — auto-expand origins so both localhost and 127.0.0.1 variants are
# always included, preventing preflight 400 errors when the browser uses a
# different hostname than what the user put in CORS_ORIGINS.
def _expand_cors_origins(origins: list[str]) -> list[str]:
    expanded: set[str] = set()
    for o in origins:
        expanded.add(o)
        if "://localhost:" in o:
            expanded.add(o.replace("://localhost:", "://127.0.0.1:"))
        elif "://127.0.0.1:" in o:
            expanded.add(o.replace("://127.0.0.1:", "://localhost:"))
    return list(expanded)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_expand_cors_origins(settings.CORS_ORIGINS),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Global exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"code": -1, "data": None, "message": str(exc)},
    )


# Register routers
from app.routers.health import router as health_router
from app.routers.projects import router as projects_router
from app.routers.workflows import router as workflows_router
from app.routers.templates import router as templates_router
from app.routers.chat import router as chat_router
from app.routers.models import router as models_router
from app.routers.channels import router as channels_router
from app.routers.generate import router as generate_router
from app.routers.upload import router as upload_router
from app.routers.tasks import router as tasks_router
from app.routers.agent_chat import router as agent_chat_router
from app.routers.agent_runtime import router as agent_runtime_router
from app.routers.assets import router as assets_router
from app.routers.verify import router as verify_router

app.include_router(health_router)
app.include_router(projects_router)
app.include_router(workflows_router)
app.include_router(templates_router)
app.include_router(chat_router)
app.include_router(models_router)
app.include_router(channels_router)
app.include_router(generate_router)
app.include_router(upload_router)
app.include_router(tasks_router)
app.include_router(agent_chat_router)
app.include_router(agent_runtime_router)
app.include_router(assets_router)
app.include_router(verify_router)
