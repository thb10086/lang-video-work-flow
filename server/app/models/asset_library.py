"""Asset Library ORM models — characters / scenes / styles.

Distinct from `Asset` (media files) and `CharacterAppearance` (legacy
project-scoped registry). These three tables support cross-project reuse,
variations, soft delete, and a common envelope. See migration 0004.
"""

from datetime import datetime

from sqlalchemy import JSON, BigInteger, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, IDMixin, TimestampMixin, SoftDeleteMixin, DT3


class _AssetLibraryMixin(IDMixin, TimestampMixin, SoftDeleteMixin):
    """Common columns for all three asset tables."""

    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1, server_default="1")
    project_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    asset_id: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    name_en: Mapped[str | None] = mapped_column(String(128), nullable=True)
    reference_images: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    variations: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    appearance_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    metadata_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


class CharacterAsset(Base, _AssetLibraryMixin):
    __tablename__ = "character_assets"

    appearance: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        Index("idx_character_assets_user_scope", "user_id", "project_id", "deleted_at"),
        Index("idx_character_assets_name_en", "user_id", "name_en"),
    )


class SceneAsset(Base, _AssetLibraryMixin):
    __tablename__ = "scene_assets"

    environment: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        Index("idx_scene_assets_user_scope", "user_id", "project_id", "deleted_at"),
        Index("idx_scene_assets_name_en", "user_id", "name_en"),
    )


class StyleAsset(Base, _AssetLibraryMixin):
    __tablename__ = "style_assets"

    guide: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        Index("idx_style_assets_user_scope", "user_id", "project_id", "deleted_at"),
        Index("idx_style_assets_name_en", "user_id", "name_en"),
    )


class WorkflowAssetRef(Base, IDMixin):
    """Link table: which workflow uses which asset (for analytics + cleanup)."""
    __tablename__ = "workflow_asset_refs"

    workflow_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    asset_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    asset_id: Mapped[str] = mapped_column(String(32), nullable=False)
    node_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DT3, server_default=text("CURRENT_TIMESTAMP(3)"), nullable=False
    )

    __table_args__ = (
        Index("idx_workflow_asset_refs_workflow", "workflow_id"),
        Index("idx_workflow_asset_refs_asset", "asset_kind", "asset_id"),
    )
