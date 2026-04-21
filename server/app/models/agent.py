"""Agent session, message, and memory ORM models."""

from datetime import datetime

from sqlalchemy import JSON, BigInteger, ForeignKey, Index, SmallInteger, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, DT3, IDMixin, TimestampMixin, SoftDeleteMixin


class AgentSession(Base, IDMixin, TimestampMixin):
    __tablename__ = "agent_sessions"

    project_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("projects.id"), nullable=True)
    role_id: Mapped[str] = mapped_column(String(32), default="default")
    model: Mapped[str] = mapped_column(String(64), default="gemini-3.1-pro-preview")
    status: Mapped[str] = mapped_column(String(16), default="active")
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    __table_args__ = (
        Index("idx_sessions_project", "project_id"),
        Index("idx_sessions_status", "status"),
    )


class AgentMessage(Base, IDMixin):
    __tablename__ = "agent_messages"

    session_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("agent_sessions.id"), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    images_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    tool_calls_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    token_count: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(
        DT3,
        server_default=text("CURRENT_TIMESTAMP(3)"),
        nullable=False,
    )

    __table_args__ = (
        Index("idx_messages_session", "session_id"),
        Index("idx_messages_created", "session_id", "created_at"),
    )


class AgentMemory(Base, IDMixin, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "agent_memories"

    project_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("projects.id"), nullable=True)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    tags_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # embedding: reserved for future semantic search

    __table_args__ = (
        Index("idx_memories_project", "project_id"),
        Index("idx_memories_type", "type"),
    )
