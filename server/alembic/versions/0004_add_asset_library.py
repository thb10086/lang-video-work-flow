"""add_asset_library

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-22

Creates four tables for the cross-project asset library:
  - character_assets, scene_assets, style_assets (common envelope + kind fields)
  - workflow_asset_refs (link table for analytics + cleanup)

All three primary tables support:
  - soft delete via `deleted_at`
  - optional `project_id` (null = global for user)
  - `variations` JSON array of { id, label, appearance_delta, reference_images }
  - `appearance_version` integer bumped by service layer on content change
  - `metadata` JSON for flexible per-kind extensions (e.g. imported_from)

Unique constraint on (user_id, name_en) per kind prevents accidental duplicates.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME as MySQLDateTime

revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


DT3 = MySQLDateTime(fsp=3)


def _common_columns() -> list:
    """Columns shared by all three asset tables."""
    return [
        sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.BigInteger(), nullable=False, server_default='1', comment='owning user (single-tenant default=1)'),
        sa.Column('project_id', sa.BigInteger(), nullable=True, comment='null = global for user'),
        sa.Column('asset_id', sa.String(32), nullable=False, comment='prefixed nanoid, e.g. char_Ab12'),
        sa.Column('name', sa.String(128), nullable=False),
        sa.Column('name_en', sa.String(128), nullable=True, comment='english alias, used for @ resolution'),
        sa.Column('reference_images', sa.JSON(), nullable=False, comment='[url, ...]'),
        sa.Column('variations', sa.JSON(), nullable=False, comment='[{id,label,appearance_delta,reference_images}]'),
        sa.Column('appearance_version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('metadata_json', sa.JSON(), nullable=False, comment='free-form metadata'),
        sa.Column('created_at', DT3, server_default=sa.text("CURRENT_TIMESTAMP(3)"), nullable=False),
        sa.Column('updated_at', DT3, server_default=sa.text("CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)"), nullable=False),
        sa.Column('deleted_at', DT3, nullable=True),
    ]


def upgrade() -> None:
    # ── character_assets ──
    op.create_table(
        'character_assets',
        *_common_columns(),
        sa.Column('appearance', sa.Text(), nullable=False, comment='character appearance description'),
        sa.UniqueConstraint('asset_id', name='uq_character_assets_asset_id'),
    )
    op.create_index('idx_character_assets_user_scope', 'character_assets', ['user_id', 'project_id', 'deleted_at'])
    op.create_index('idx_character_assets_name_en', 'character_assets', ['user_id', 'name_en'])

    # ── scene_assets ──
    op.create_table(
        'scene_assets',
        *_common_columns(),
        sa.Column('environment', sa.Text(), nullable=False, comment='scene environment description'),
        sa.UniqueConstraint('asset_id', name='uq_scene_assets_asset_id'),
    )
    op.create_index('idx_scene_assets_user_scope', 'scene_assets', ['user_id', 'project_id', 'deleted_at'])
    op.create_index('idx_scene_assets_name_en', 'scene_assets', ['user_id', 'name_en'])

    # ── style_assets ──
    op.create_table(
        'style_assets',
        *_common_columns(),
        sa.Column('guide', sa.Text(), nullable=False, comment='style guide description'),
        sa.UniqueConstraint('asset_id', name='uq_style_assets_asset_id'),
    )
    op.create_index('idx_style_assets_user_scope', 'style_assets', ['user_id', 'project_id', 'deleted_at'])
    op.create_index('idx_style_assets_name_en', 'style_assets', ['user_id', 'name_en'])

    # ── workflow_asset_refs (link table) ──
    op.create_table(
        'workflow_asset_refs',
        sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column('workflow_id', sa.BigInteger(), nullable=False),
        sa.Column('asset_kind', sa.String(16), nullable=False, comment='character|scene|style'),
        sa.Column('asset_id', sa.String(32), nullable=False),
        sa.Column('node_id', sa.String(64), nullable=True, comment='react-flow node id'),
        sa.Column('created_at', DT3, server_default=sa.text("CURRENT_TIMESTAMP(3)"), nullable=False),
    )
    op.create_index('idx_workflow_asset_refs_workflow', 'workflow_asset_refs', ['workflow_id'])
    op.create_index('idx_workflow_asset_refs_asset', 'workflow_asset_refs', ['asset_kind', 'asset_id'])


def downgrade() -> None:
    op.drop_index('idx_workflow_asset_refs_asset', table_name='workflow_asset_refs')
    op.drop_index('idx_workflow_asset_refs_workflow', table_name='workflow_asset_refs')
    op.drop_table('workflow_asset_refs')

    op.drop_index('idx_style_assets_name_en', table_name='style_assets')
    op.drop_index('idx_style_assets_user_scope', table_name='style_assets')
    op.drop_table('style_assets')

    op.drop_index('idx_scene_assets_name_en', table_name='scene_assets')
    op.drop_index('idx_scene_assets_user_scope', table_name='scene_assets')
    op.drop_table('scene_assets')

    op.drop_index('idx_character_assets_name_en', table_name='character_assets')
    op.drop_index('idx_character_assets_user_scope', table_name='character_assets')
    op.drop_table('character_assets')
