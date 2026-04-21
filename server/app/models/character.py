"""CharacterAppearance ORM model — character visual registry per project."""

from sqlalchemy import JSON, BigInteger, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, IDMixin, TimestampMixin


class CharacterAppearance(Base, IDMixin, TimestampMixin):
    __tablename__ = "character_appearances"

    project_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("projects.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    name_en: Mapped[str | None] = mapped_column(String(64), nullable=True)
    appearance: Mapped[str] = mapped_column(Text, nullable=False)
    reference_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    __table_args__ = (
        Index("idx_char_project", "project_id"),
        UniqueConstraint("project_id", "name", name="uk_char_project_name"),
    )
