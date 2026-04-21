"""Project ORM model."""

from sqlalchemy import JSON, String, Text, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, IDMixin, TimestampMixin, SoftDeleteMixin


class Project(Base, IDMixin, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "projects"

    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    cover_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    scenario: Mapped[str] = mapped_column(String(32), default="short_film")
    style: Mapped[str] = mapped_column(String(64), default="")
    status: Mapped[str] = mapped_column(String(16), default="draft")
    settings_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    __table_args__ = (
        Index("idx_projects_status", "status"),
        Index("idx_projects_scenario", "scenario"),
        Index("idx_projects_deleted", "deleted_at"),
    )
