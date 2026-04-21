"""initial_schema_9_tables

Revision ID: 0001
Revises: 
Create Date: 2026-04-04

Creates 9 core tables for Prism AI Video Workflow Studio.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

revision: str = '0001'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DT3 = mysql.DATETIME(fsp=3)


def upgrade() -> None:
    # 1. projects
    op.create_table('projects',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(128), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('cover_url', sa.String(512), nullable=True),
        sa.Column('scenario', sa.String(32), server_default='short_film', nullable=False),
        sa.Column('style', sa.String(64), server_default='', nullable=False),
        sa.Column('status', sa.String(16), server_default='draft', nullable=False),
        sa.Column('settings_json', sa.JSON(), nullable=True),
        sa.Column('created_at', DT3, server_default=sa.text('CURRENT_TIMESTAMP(3)'), nullable=False),
        sa.Column('updated_at', DT3, server_default=sa.text('CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)'), nullable=False),
        sa.Column('deleted_at', DT3, nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_projects_status', 'projects', ['status'])
    op.create_index('idx_projects_scenario', 'projects', ['scenario'])
    op.create_index('idx_projects_deleted', 'projects', ['deleted_at'])

    # 2. workflows
    op.create_table('workflows',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('project_id', sa.BigInteger(), nullable=False),
        sa.Column('name', sa.String(128), nullable=False),
        sa.Column('version', sa.SmallInteger(), server_default='1', nullable=False),
        sa.Column('is_current', sa.SmallInteger(), server_default='1', nullable=False),
        sa.Column('nodes_json', sa.JSON(), nullable=False),
        sa.Column('edges_json', sa.JSON(), nullable=False),
        sa.Column('metadata_json', sa.JSON(), nullable=True),
        sa.Column('thumbnail_url', sa.String(512), nullable=True),
        sa.Column('created_at', DT3, server_default=sa.text('CURRENT_TIMESTAMP(3)'), nullable=False),
        sa.Column('updated_at', DT3, server_default=sa.text('CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)'), nullable=False),
        sa.Column('deleted_at', DT3, nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id']),
    )
    op.create_index('idx_workflows_project', 'workflows', ['project_id'])
    op.create_index('idx_workflows_current', 'workflows', ['project_id', 'is_current'])

    # 3. templates
    op.create_table('templates',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(128), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('category', sa.String(32), nullable=False),
        sa.Column('scenario', sa.String(32), nullable=False),
        sa.Column('icon', sa.String(8), server_default='🎬', nullable=False),
        sa.Column('tags_json', sa.JSON(), nullable=True),
        sa.Column('nodes_json', sa.JSON(), nullable=False),
        sa.Column('edges_json', sa.JSON(), nullable=False),
        sa.Column('config_json', sa.JSON(), nullable=True),
        sa.Column('is_builtin', sa.SmallInteger(), server_default='0', nullable=False),
        sa.Column('is_public', sa.SmallInteger(), server_default='0', nullable=False),
        sa.Column('use_count', sa.Integer(), server_default='0', nullable=False),
        sa.Column('created_at', DT3, server_default=sa.text('CURRENT_TIMESTAMP(3)'), nullable=False),
        sa.Column('updated_at', DT3, server_default=sa.text('CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)'), nullable=False),
        sa.Column('deleted_at', DT3, nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_templates_category', 'templates', ['category'])
    op.create_index('idx_templates_scenario', 'templates', ['scenario'])
    op.create_index('idx_templates_public', 'templates', ['is_public', 'use_count'])

    # 4. agent_sessions
    op.create_table('agent_sessions',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('project_id', sa.BigInteger(), nullable=True),
        sa.Column('role_id', sa.String(32), server_default='default', nullable=False),
        sa.Column('model', sa.String(64), server_default='gemini-3.1-pro-preview', nullable=False),
        sa.Column('status', sa.String(16), server_default='active', nullable=False),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('metadata_json', sa.JSON(), nullable=True),
        sa.Column('created_at', DT3, server_default=sa.text('CURRENT_TIMESTAMP(3)'), nullable=False),
        sa.Column('updated_at', DT3, server_default=sa.text('CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id']),
    )
    op.create_index('idx_sessions_project', 'agent_sessions', ['project_id'])
    op.create_index('idx_sessions_status', 'agent_sessions', ['status'])

    # 5. agent_messages
    op.create_table('agent_messages',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('session_id', sa.BigInteger(), nullable=False),
        sa.Column('role', sa.String(16), nullable=False),
        sa.Column('content', sa.Text(), nullable=True),
        sa.Column('images_json', sa.JSON(), nullable=True),
        sa.Column('tool_calls_json', sa.JSON(), nullable=True),
        sa.Column('token_count', sa.Integer(), server_default='0', nullable=False),
        sa.Column('created_at', DT3, server_default=sa.text('CURRENT_TIMESTAMP(3)'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['session_id'], ['agent_sessions.id']),
    )
    op.create_index('idx_messages_session', 'agent_messages', ['session_id'])
    op.create_index('idx_messages_created', 'agent_messages', ['session_id', 'created_at'])

    # 6. agent_memories
    op.create_table('agent_memories',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('project_id', sa.BigInteger(), nullable=True),
        sa.Column('type', sa.String(32), nullable=False),
        sa.Column('title', sa.String(256), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('tags_json', sa.JSON(), nullable=True),
        sa.Column('created_at', DT3, server_default=sa.text('CURRENT_TIMESTAMP(3)'), nullable=False),
        sa.Column('updated_at', DT3, server_default=sa.text('CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)'), nullable=False),
        sa.Column('deleted_at', DT3, nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id']),
    )
    op.create_index('idx_memories_project', 'agent_memories', ['project_id'])
    op.create_index('idx_memories_type', 'agent_memories', ['type'])

    # 7. assets
    op.create_table('assets',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('project_id', sa.BigInteger(), nullable=True),
        sa.Column('workflow_id', sa.BigInteger(), nullable=True),
        sa.Column('node_id', sa.String(64), nullable=True),
        sa.Column('type', sa.String(16), nullable=False),
        sa.Column('url', sa.String(1024), nullable=False),
        sa.Column('filename', sa.String(256), nullable=True),
        sa.Column('size_bytes', sa.BigInteger(), server_default='0', nullable=False),
        sa.Column('mime_type', sa.String(64), nullable=True),
        sa.Column('width', sa.Integer(), nullable=True),
        sa.Column('height', sa.Integer(), nullable=True),
        sa.Column('duration_ms', sa.Integer(), nullable=True),
        sa.Column('metadata_json', sa.JSON(), nullable=True),
        sa.Column('created_at', DT3, server_default=sa.text('CURRENT_TIMESTAMP(3)'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id']),
        sa.ForeignKeyConstraint(['workflow_id'], ['workflows.id']),
    )
    op.create_index('idx_assets_project', 'assets', ['project_id'])
    op.create_index('idx_assets_workflow', 'assets', ['workflow_id'])
    op.create_index('idx_assets_type', 'assets', ['type'])

    # 8. task_queue
    op.create_table('task_queue',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('project_id', sa.BigInteger(), nullable=True),
        sa.Column('workflow_id', sa.BigInteger(), nullable=True),
        sa.Column('node_id', sa.String(64), nullable=True),
        sa.Column('type', sa.String(32), nullable=False),
        sa.Column('status', sa.String(16), server_default='pending', nullable=False),
        sa.Column('priority', sa.Integer(), server_default='0', nullable=False),
        sa.Column('params_json', sa.JSON(), nullable=True),
        sa.Column('result_json', sa.JSON(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('retry_count', sa.Integer(), server_default='0', nullable=False),
        sa.Column('max_retries', sa.Integer(), server_default='3', nullable=False),
        sa.Column('external_task_id', sa.String(128), nullable=True),
        sa.Column('started_at', DT3, nullable=True),
        sa.Column('completed_at', DT3, nullable=True),
        sa.Column('created_at', DT3, server_default=sa.text('CURRENT_TIMESTAMP(3)'), nullable=False),
        sa.Column('updated_at', DT3, server_default=sa.text('CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id']),
        sa.ForeignKeyConstraint(['workflow_id'], ['workflows.id']),
    )
    op.create_index('idx_tasks_status', 'task_queue', ['status', 'priority'])
    op.create_index('idx_tasks_project', 'task_queue', ['project_id'])
    op.create_index('idx_tasks_external', 'task_queue', ['external_task_id'])

    # 9. character_appearances
    op.create_table('character_appearances',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('project_id', sa.BigInteger(), nullable=False),
        sa.Column('name', sa.String(64), nullable=False),
        sa.Column('name_en', sa.String(64), nullable=True),
        sa.Column('appearance', sa.Text(), nullable=False),
        sa.Column('reference_url', sa.String(1024), nullable=True),
        sa.Column('metadata_json', sa.JSON(), nullable=True),
        sa.Column('created_at', DT3, server_default=sa.text('CURRENT_TIMESTAMP(3)'), nullable=False),
        sa.Column('updated_at', DT3, server_default=sa.text('CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id']),
        sa.UniqueConstraint('project_id', 'name', name='uk_char_project_name'),
    )
    op.create_index('idx_char_project', 'character_appearances', ['project_id'])


def downgrade() -> None:
    op.drop_table('character_appearances')
    op.drop_table('task_queue')
    op.drop_table('assets')
    op.drop_table('agent_memories')
    op.drop_table('agent_messages')
    op.drop_table('agent_sessions')
    op.drop_table('templates')
    op.drop_table('workflows')
    op.drop_table('projects')
