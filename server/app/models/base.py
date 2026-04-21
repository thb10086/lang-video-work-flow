"""
SQLAlchemy declarative base with common mixins.
"""

from datetime import datetime

from sqlalchemy import BigInteger, func, text
from sqlalchemy.dialects.mysql import DATETIME as MySQLDateTime
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Base class for all ORM models."""
    pass


# MySQL DATETIME with millisecond precision
DT3 = MySQLDateTime(fsp=3)


class TimestampMixin:
    """Mixin that adds created_at and updated_at columns."""

    created_at: Mapped[datetime] = mapped_column(
        DT3,
        server_default=text("CURRENT_TIMESTAMP(3)"),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DT3,
        server_default=text("CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)"),
        nullable=False,
    )


class SoftDeleteMixin:
    """Mixin that adds soft-delete via deleted_at column."""

    deleted_at: Mapped[datetime | None] = mapped_column(
        DT3,
        nullable=True,
        default=None,
    )


class IDMixin:
    """Mixin that adds BIGINT auto-increment primary key."""

    id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        autoincrement=True,
    )
