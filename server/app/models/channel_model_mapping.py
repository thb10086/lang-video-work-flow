"""
ChannelModelMapping — 渠道-模型映射表

定义哪些渠道支持哪些模型，以及优先级。
video_service 根据此表实现多渠道降级容错。
"""

from sqlalchemy import BigInteger, Integer, String, SmallInteger, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, IDMixin, TimestampMixin


class ChannelModelMapping(Base, IDMixin, TimestampMixin):
    __tablename__ = "channel_model_mappings"

    model_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="FK → ai_models.id")
    channel_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="FK → ai_channels.id")
    channel_model_id: Mapped[str] = mapped_column(String(128), nullable=False, comment="渠道实际API模型标识")
    priority: Mapped[int] = mapped_column(Integer, default=0, comment="优先级(数字越小越优先)")
    is_enabled: Mapped[int] = mapped_column(SmallInteger, default=1, comment="启用/禁用")

    __table_args__ = (
        UniqueConstraint("model_id", "channel_id", name="uk_model_channel"),
        Index("idx_cmm_model", "model_id"),
        Index("idx_cmm_channel", "channel_id"),
    )
