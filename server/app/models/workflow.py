"""Workflow ORM model."""

from sqlalchemy import JSON, BigInteger, ForeignKey, Index, SmallInteger, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, IDMixin, TimestampMixin, SoftDeleteMixin


class Workflow(Base, IDMixin, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "workflows"

    project_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("projects.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    version: Mapped[int] = mapped_column(SmallInteger, default=1)
    is_current: Mapped[bool] = mapped_column(SmallInteger, default=1)
    nodes_json: Mapped[list] = mapped_column(JSON, nullable=False)
    edges_json: Mapped[list] = mapped_column(JSON, nullable=False)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(String(512), nullable=True)

    __table_args__ = (
        Index("idx_workflows_project", "project_id"),
        Index("idx_workflows_current", "project_id", "is_current"),
    )
