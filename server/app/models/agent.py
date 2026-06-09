"""Agent session, message, event, and memory ORM models.

Schema is the single source of truth for the backend Agent Runtime
(`app/agents/runtime.py`) and SSE streaming protocol (`app/agents/streaming.py`).

Session lifecycle:
    AgentSession (status=running|paused|completed|aborted|error)
       |-- AgentMessage (one row per LLM turn in the conversation)
       `-- AgentEvent (one row per emitted SSE event; replay buffer)

Memory lifecycle:
    AgentMemory (scope=session|project|global) — separately persisted.
"""

from datetime import datetime

from sqlalchemy import JSON, BigInteger, Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, DT3, IDMixin, TimestampMixin, SoftDeleteMixin
from app.config import settings


class AgentSession(Base, IDMixin, TimestampMixin):
    """Agent run session — one row per `POST /api/agent/sessions` invocation.

    Fields added in `agent-experience-overhaul` (migration 0005):
        - phase: explicit FSM (idle|planning|designing|building|reviewing|executing)
        - budget_state: JSON serialized BudgetTracker (for resume)
        - loop_state: JSON serialized LoopDetector + StallDetector
        - parent_session_id: when this session is a subagent, points to spawning session
        - last_event_seq: max seq of emitted events (avoids COUNT() on agent_events)
        - user_id: tenant scoping (single-tenant default = 1)
    """
    __tablename__ = "agent_sessions"

    project_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("projects.id"), nullable=True)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1, server_default="1")
    role_id: Mapped[str] = mapped_column(String(32), default="default")
    model: Mapped[str] = mapped_column(String(64), default=settings.DEFAULT_LLM_MODEL)
    status: Mapped[str] = mapped_column(String(16), default="active")
    phase: Mapped[str] = mapped_column(String(32), default="idle", server_default="idle")
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    budget_state: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    loop_state: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    parent_session_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("agent_sessions.id"), nullable=True)
    last_event_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    __table_args__ = (
        Index("idx_sessions_project", "project_id"),
        Index("idx_sessions_status", "status"),
        Index("idx_sessions_user_status", "user_id", "status"),
        Index("idx_sessions_parent", "parent_session_id"),
    )


class AgentMessage(Base, IDMixin):
    """Conversation message (user / assistant / tool). One row per LLM turn."""
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


class AgentEvent(Base, IDMixin):
    """Streamed SSE event log — append-only, ordered by `seq` per session.

    Used for:
      1. SSE replay on reconnect (`Last-Event-ID` → fetch seq > N)
      2. Audit log (approval decisions, tool failures)
      3. Eval harness offline analysis
    """
    __tablename__ = "agent_events"

    session_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("agent_sessions.id"), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DT3,
        server_default=text("CURRENT_TIMESTAMP(3)"),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("session_id", "seq", name="uq_agent_events_session_seq"),
        Index("idx_events_session_seq", "session_id", "seq"),
        Index("idx_events_type", "type"),
    )


class AgentMemory(Base, IDMixin, TimestampMixin, SoftDeleteMixin):
    """Long-term agent memory — scoped (session|project|global), pinnable, ranked.

    Fields added in `agent-experience-overhaul` (migration 0005):
        - user_id: tenant scoping
        - scope: session|project|global
        - pinned: always include in relevance ranker top-K
        - last_accessed_at: refreshed on recall, for recency decay
    """
    __tablename__ = "agent_memories"

    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1, server_default="1")
    project_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("projects.id"), nullable=True)
    scope: Mapped[str] = mapped_column(String(16), default="session", server_default="session")
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    tags_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("0"))
    last_accessed_at: Mapped[datetime | None] = mapped_column(DT3, nullable=True)
    # embedding: reserved for future semantic search

    __table_args__ = (
        Index("idx_memories_project", "project_id"),
        Index("idx_memories_type", "type"),
        Index("idx_memories_user_scope", "user_id", "scope", "project_id"),
        Index("idx_memories_pinned", "user_id", "pinned"),
    )
