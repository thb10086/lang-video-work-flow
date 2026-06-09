"""
Application configuration via pydantic-settings.
All values read from environment variables or .env file.
"""

from urllib.parse import quote_plus

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # ── MySQL ──
    DB_HOST: str = "127.0.0.1"
    DB_PORT: int = 3306
    DB_USER: str = "root"
    DB_PASSWORD: str = ""
    DB_NAME: str = "prism_ai_flow"

    # ── Redis ──
    REDIS_HOST: str = "127.0.0.1"
    REDIS_PORT: int = 6379
    REDIS_PASSWORD: str = ""
    REDIS_DB: int = 0

    # ── LLM API ──
    LLM_BASE_URL: str = "https://yunwu.ai"
    LLM_API_KEY: str = ""

    # ── COS ──
    COS_SECRET_ID: str = ""
    COS_SECRET_KEY: str = ""
    COS_REGION: str = "ap-guangzhou"
    COS_BUCKET: str = ""

    # ── 视频/图片渠道 ──
    CHANNEL_PUYO_URL: str = "https://api.puyoai.com/puyo-image-api/v1"
    CHANNEL_PUYO_KEY: str = ""
    # APIMart 渠道（已下线，被 toapis 取代；保留字段仅供回滚）
    CHANNEL_APIMART_URL: str = "https://api.apimart.ai"
    CHANNEL_APIMART_KEY: str = ""
    # ToApis 聚合网关（OpenAI 兼容；image + video 统一异步任务模型）
    CHANNEL_TOAPIS_URL: str = "https://toapis.com"
    CHANNEL_TOAPIS_KEY: str = ""

    # ── 默认模型 ──
    DEFAULT_IMAGE_MODEL: str = "gpt-image-2"
    # ToApis 当前未配置 doubao-seedance/sora SKU；默认改为 toapis 支持的 veo3.1-fast
    DEFAULT_VIDEO_MODEL: str = "veo3.1-fast"
    DEFAULT_LLM_MODEL: str = "claude-opus-4-7"

    # ── 任务管理 ──
    TASK_POLL_INTERVAL: int = 5
    TASK_MAX_CONCURRENT: int = 3
    TASK_MAX_RETRIES: int = 3

    # ── Agent Runtime (Phase 1 feature flag) ──
    # When True, the new backend SSE-driven Agent runtime is the canonical
    # path. Frontend `useBackendRuntime` setting overrides this per-user, but
    # the server respects this default for unconfigured clients.
    AGENT_BACKEND_RUNTIME: bool = False

    # ── Server ──
    SERVER_HOST: str = "0.0.0.0"
    SERVER_PORT: int = 8000
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:3002",
        "http://127.0.0.1:5173",
    ]

    @property
    def database_url(self) -> str:
        pwd = quote_plus(self.DB_PASSWORD)
        return (
            f"mysql+aiomysql://{self.DB_USER}:{pwd}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}?charset=utf8mb4"
        )

    @property
    def database_url_sync(self) -> str:
        """Sync URL for Alembic migrations."""
        pwd = quote_plus(self.DB_PASSWORD)
        return (
            f"mysql+pymysql://{self.DB_USER}:{pwd}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}?charset=utf8mb4"
        )

    @property
    def redis_url(self) -> str:
        pwd = quote_plus(self.REDIS_PASSWORD) if self.REDIS_PASSWORD else ""
        if pwd:
            return f"redis://:{pwd}@{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"


settings = Settings()
