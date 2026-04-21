"""add_ai_models_channels

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-07

Creates 3 new tables for dynamic model/channel management:
  - ai_models: 模型注册表
  - ai_channels: 渠道注册表
  - channel_model_mappings: 渠道-模型映射表
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

revision: str = '0002'
down_revision: Union[str, Sequence[str], None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DT3 = mysql.DATETIME(fsp=3)


def upgrade() -> None:
    # ── ai_models ──
    op.create_table(
        'ai_models',
        sa.Column('id', sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column('model_id', sa.String(64), unique=True, nullable=False, comment='统一模型标识'),
        sa.Column('name', sa.String(128), nullable=False, comment='显示名'),
        sa.Column('provider', sa.String(64), nullable=False, comment='提供商'),
        sa.Column('capability', sa.String(32), nullable=False, comment='text|image|video|audio'),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('param_schema', mysql.JSON, nullable=False, comment='ParamField[] 动态参数定义'),
        sa.Column('is_enabled', sa.SmallInteger, server_default='1', comment='启用/禁用'),
        sa.Column('sort_order', sa.Integer, server_default='0', comment='排序权重'),
        sa.Column('created_at', DT3, server_default=sa.text('CURRENT_TIMESTAMP(3)'), nullable=False),
        sa.Column('updated_at', DT3, server_default=sa.text('CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)'), nullable=False),
        sa.Column('deleted_at', DT3, nullable=True),
    )
    op.create_index('idx_ai_models_capability', 'ai_models', ['capability'])
    op.create_index('idx_ai_models_enabled', 'ai_models', ['is_enabled'])

    # ── ai_channels ──
    op.create_table(
        'ai_channels',
        sa.Column('id', sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column('channel_id', sa.String(64), unique=True, nullable=False, comment='渠道标识'),
        sa.Column('name', sa.String(128), nullable=False, comment='显示名'),
        sa.Column('base_url', sa.String(512), nullable=False, comment='API基础URL'),
        sa.Column('api_key', sa.String(512), nullable=False, comment='API Key'),
        sa.Column('adapter_type', sa.String(64), nullable=False, comment='适配器类型'),
        sa.Column('is_enabled', sa.SmallInteger, server_default='1', comment='启用/禁用'),
        sa.Column('health_status', sa.String(32), server_default='unknown', comment='健康状态'),
        sa.Column('last_health_check', DT3, nullable=True),
        sa.Column('config_json', mysql.JSON, nullable=True, comment='渠道特殊配置'),
        sa.Column('created_at', DT3, server_default=sa.text('CURRENT_TIMESTAMP(3)'), nullable=False),
        sa.Column('updated_at', DT3, server_default=sa.text('CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)'), nullable=False),
        sa.Column('deleted_at', DT3, nullable=True),
    )

    # ── channel_model_mappings ──
    op.create_table(
        'channel_model_mappings',
        sa.Column('id', sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column('model_id', sa.BigInteger, nullable=False, comment='FK → ai_models.id'),
        sa.Column('channel_id', sa.BigInteger, nullable=False, comment='FK → ai_channels.id'),
        sa.Column('channel_model_id', sa.String(128), nullable=False, comment='渠道实际API模型标识'),
        sa.Column('priority', sa.Integer, server_default='0', comment='优先级(数字越小越优先)'),
        sa.Column('is_enabled', sa.SmallInteger, server_default='1', comment='启用/禁用'),
        sa.Column('created_at', DT3, server_default=sa.text('CURRENT_TIMESTAMP(3)'), nullable=False),
        sa.Column('updated_at', DT3, server_default=sa.text('CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)'), nullable=False),
        sa.UniqueConstraint('model_id', 'channel_id', name='uk_model_channel'),
    )
    op.create_index('idx_cmm_model', 'channel_model_mappings', ['model_id'])
    op.create_index('idx_cmm_channel', 'channel_model_mappings', ['channel_id'])


def downgrade() -> None:
    op.drop_table('channel_model_mappings')
    op.drop_table('ai_channels')
    op.drop_table('ai_models')
