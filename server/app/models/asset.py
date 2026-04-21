"""Asset ORM model — images, videos, audio files."""

from datetime import datetime

from sqlalchemy import JSON, BigInteger, ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, DT3, IDMixin


class Asset(Base, IDMixin):
    __tablename__ = "assets"

    project_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("projects.id"), nullable=True)
    workflow_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("workflows.id"), nullable=True)
    node_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    url: Mapped[str] = mapped_column(String(1024), nullable=False)
    filename: Mapped[str | None] = mapped_column(String(256), nullable=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    mime_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    width: Mapped[int | None] = mapped_column(nullable=True)
    height: Mapped[int | None] = mapped_column(nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DT3, server_default=text("CURRENT_TIMESTAMP(3)"), nullable=False
    )

    __table_args__ = (
        Index("idx_assets_project", "project_id"),
        Index("idx_assets_workflow", "workflow_id"),
        Index("idx_assets_type", "type"),
    )
