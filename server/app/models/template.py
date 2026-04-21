"""Template ORM model."""

from sqlalchemy import JSON, Index, SmallInteger, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, IDMixin, TimestampMixin, SoftDeleteMixin


class Template(Base, IDMixin, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "templates"

    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    scenario: Mapped[str] = mapped_column(String(32), nullable=False)
    icon: Mapped[str] = mapped_column(String(8), default="🎬")
    tags_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    nodes_json: Mapped[list] = mapped_column(JSON, nullable=False)
    edges_json: Mapped[list] = mapped_column(JSON, nullable=False)
    config_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    is_builtin: Mapped[bool] = mapped_column(SmallInteger, default=0)
    is_public: Mapped[bool] = mapped_column(SmallInteger, default=0)
    use_count: Mapped[int] = mapped_column(default=0)

    __table_args__ = (
        Index("idx_templates_category", "category"),
        Index("idx_templates_scenario", "scenario"),
        Index("idx_templates_public", "is_public", "use_count"),
    )
