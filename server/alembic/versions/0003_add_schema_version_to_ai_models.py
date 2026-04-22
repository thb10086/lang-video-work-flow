"""add_schema_version_to_ai_models

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-08

Adds `schema_version INT NOT NULL DEFAULT 1` to `ai_models`.
Bumped automatically by ModelService whenever `param_schema` is updated,
enabling client-side cache invalidation without manual intervention.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '0003'
down_revision: Union[str, Sequence[str], None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'ai_models',
        sa.Column(
            'schema_version',
            sa.Integer(),
            nullable=False,
            server_default='1',
            comment='Param schema version, bumped on param_schema update',
        ),
    )


def downgrade() -> None:
    op.drop_column('ai_models', 'schema_version')
