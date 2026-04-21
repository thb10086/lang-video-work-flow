"""TaskQueue ORM model — async job tracking."""

from datetime import datetime

from sqlalchemy import JSON, BigInteger, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, DT3, IDMixin, TimestampMixin


class TaskQueue(Base, IDMixin, TimestampMixin):
    __tablename__ = "task_queue"

    project_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("projects.id"), nullable=True)
    workflow_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("workflows.id"), nullable=True)
    node_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    priority: Mapped[int] = mapped_column(default=0)
    params_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    result_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    retry_count: Mapped[int] = mapped_column(default=0)
    max_retries: Mapped[int] = mapped_column(default=3)
    external_task_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DT3, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DT3, nullable=True)

    __table_args__ = (
        Index("idx_tasks_status", "status", "priority"),
        Index("idx_tasks_project", "project_id"),
        Index("idx_tasks_external", "external_task_id"),
    )
