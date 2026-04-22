"""
AiModel — 模型注册表

存储所有可用的 AI 模型定义，包括参数 schema（JSON）。
前端通过 /api/models 接口获取列表和动态参数定义。
"""

from sqlalchemy import BigInteger, Integer, String, Text, JSON, SmallInteger, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, IDMixin, TimestampMixin, SoftDeleteMixin


class AiModel(Base, IDMixin, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "ai_models"

    model_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, comment="统一模型标识")
    name: Mapped[str] = mapped_column(String(128), nullable=False, comment="显示名")
    provider: Mapped[str] = mapped_column(String(64), nullable=False, comment="提供商")
    capability: Mapped[str] = mapped_column(String(32), nullable=False, comment="text|image|video|audio")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    param_schema: Mapped[dict] = mapped_column(JSON, nullable=False, comment="ParamField[] 动态参数定义")
    schema_version: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False, comment="参数 schema 版本，param_schema 更新时自增")
    is_enabled: Mapped[int] = mapped_column(SmallInteger, default=1, comment="启用/禁用")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, comment="排序权重")

    __table_args__ = (
        Index("idx_ai_models_capability", "capability"),
        Index("idx_ai_models_enabled", "is_enabled"),
    )
