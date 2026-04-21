"""
AiChannel — 渠道注册表

存储 API 渠道配置（base_url、api_key、适配器类型等）。
密钥加密存储，运行时解密使用。
"""

from datetime import datetime

from sqlalchemy import String, Text, JSON, SmallInteger, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, IDMixin, TimestampMixin, SoftDeleteMixin, DT3


class AiChannel(Base, IDMixin, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "ai_channels"

    channel_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, comment="渠道标识")
    name: Mapped[str] = mapped_column(String(128), nullable=False, comment="显示名")
    base_url: Mapped[str] = mapped_column(String(512), nullable=False, comment="API基础URL")
    api_key: Mapped[str] = mapped_column(String(512), nullable=False, comment="API Key")
    adapter_type: Mapped[str] = mapped_column(String(64), nullable=False, comment="适配器类型")
    is_enabled: Mapped[int] = mapped_column(SmallInteger, default=1, comment="启用/禁用")
    health_status: Mapped[str] = mapped_column(String(32), default="unknown", comment="健康状态")
    last_health_check: Mapped[datetime | None] = mapped_column(DT3, nullable=True)
    config_json: Mapped[dict | None] = mapped_column(JSON, nullable=True, comment="渠道特殊配置")
