"""agent_runtime: extend agent_sessions/agent_memories + add agent_events

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-28

Schema changes for the `agent-experience-overhaul` change:

1. **agent_sessions** — add 6 columns:
   - `user_id BIGINT NOT NULL DEFAULT 1`              tenant scoping
   - `phase VARCHAR(32) NOT NULL DEFAULT 'idle'`      explicit FSM
   - `budget_state JSON NULL`                          BudgetTracker serialized
   - `loop_state JSON NULL`                            LoopDetector + StallDetector
   - `parent_session_id BIGINT NULL FK->self`          subagent → parent
   - `last_event_seq INT NOT NULL DEFAULT 0`           SSE replay cursor

2. **agent_memories** — add 4 columns:
   - `user_id BIGINT NOT NULL DEFAULT 1`              tenant scoping
   - `scope VARCHAR(16) NOT NULL DEFAULT 'session'`    session|project|global
   - `pinned BOOLEAN NOT NULL DEFAULT 0`               always-include flag
   - `last_accessed_at DATETIME(3) NULL`               recency decay input

3. **agent_events** — new table for SSE event log:
   - Append-only, ordered by (session_id, seq)
   - Unique on (session_id, seq) guarantees no duplicate replay
   - Used for: SSE reconnect replay, audit log, eval offline analysis

Backward compatibility: All new columns have safe defaults so existing rows
continue to work. No data migration needed for existing agent_sessions /
agent_memories rows.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME as MySQLDateTime

revision: str = '0005'
down_revision: Union[str, Sequence[str], None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


DT3 = MySQLDateTime(fsp=3)


def upgrade() -> None:
    # ── agent_sessions: add 6 columns + 2 indexes ──
    op.add_column('agent_sessions', sa.Column('user_id', sa.BigInteger(), nullable=False, server_default='1', comment='tenant scoping (single-tenant default=1)'))
    op.add_column('agent_sessions', sa.Column('phase', sa.String(32), nullable=False, server_default='idle', comment='FSM: idle|planning|designing|building|reviewing|executing'))
    op.add_column('agent_sessions', sa.Column('budget_state', sa.JSON(), nullable=True, comment='serialized BudgetTracker'))
    op.add_column('agent_sessions', sa.Column('loop_state', sa.JSON(), nullable=True, comment='serialized LoopDetector + StallDetector'))
    op.add_column('agent_sessions', sa.Column('parent_session_id', sa.BigInteger(), nullable=True, comment='FK to spawning session when this is a subagent'))
    op.add_column('agent_sessions', sa.Column('last_event_seq', sa.Integer(), nullable=False, server_default='0', comment='max seq of emitted events'))
    op.create_foreign_key(
        'fk_sessions_parent',
        'agent_sessions', 'agent_sessions',
        ['parent_session_id'], ['id'],
        ondelete='SET NULL',
    )
    op.create_index('idx_sessions_user_status', 'agent_sessions', ['user_id', 'status'])
    op.create_index('idx_sessions_parent', 'agent_sessions', ['parent_session_id'])

    # ── agent_memories: add 4 columns + 2 indexes ──
    op.add_column('agent_memories', sa.Column('user_id', sa.BigInteger(), nullable=False, server_default='1', comment='tenant scoping'))
    op.add_column('agent_memories', sa.Column('scope', sa.String(16), nullable=False, server_default='session', comment='session|project|global'))
    op.add_column('agent_memories', sa.Column('pinned', sa.Boolean(), nullable=False, server_default=sa.text('0'), comment='always include in relevance ranker top-K'))
    op.add_column('agent_memories', sa.Column('last_accessed_at', DT3, nullable=True, comment='recency decay input'))
    op.create_index('idx_memories_user_scope', 'agent_memories', ['user_id', 'scope', 'project_id'])
    op.create_index('idx_memories_pinned', 'agent_memories', ['user_id', 'pinned'])

    # ── agent_events: new table ──
    op.create_table(
        'agent_events',
        sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column('session_id', sa.BigInteger(), nullable=False, comment='FK -> agent_sessions.id'),
        sa.Column('seq', sa.Integer(), nullable=False, comment='monotonically increasing per session'),
        sa.Column('type', sa.String(32), nullable=False, comment='session_start|reasoning_delta|tool_call|...'),
        sa.Column('payload', sa.JSON(), nullable=False, comment='event-type-specific payload'),
        sa.Column('created_at', DT3, server_default=sa.text("CURRENT_TIMESTAMP(3)"), nullable=False),
        sa.UniqueConstraint('session_id', 'seq', name='uq_agent_events_session_seq'),
        sa.ForeignKeyConstraint(['session_id'], ['agent_sessions.id'], name='fk_events_session', ondelete='CASCADE'),
    )
    op.create_index('idx_events_session_seq', 'agent_events', ['session_id', 'seq'])
    op.create_index('idx_events_type', 'agent_events', ['type'])


def downgrade() -> None:
    # ── agent_events: drop table ──
    op.drop_index('idx_events_type', table_name='agent_events')
    op.drop_index('idx_events_session_seq', table_name='agent_events')
    op.drop_table('agent_events')

    # ── agent_memories: drop columns + indexes ──
    op.drop_index('idx_memories_pinned', table_name='agent_memories')
    op.drop_index('idx_memories_user_scope', table_name='agent_memories')
    op.drop_column('agent_memories', 'last_accessed_at')
    op.drop_column('agent_memories', 'pinned')
    op.drop_column('agent_memories', 'scope')
    op.drop_column('agent_memories', 'user_id')

    # ── agent_sessions: drop columns + FK + indexes ──
    op.drop_index('idx_sessions_parent', table_name='agent_sessions')
    op.drop_index('idx_sessions_user_status', table_name='agent_sessions')
    op.drop_constraint('fk_sessions_parent', 'agent_sessions', type_='foreignkey')
    op.drop_column('agent_sessions', 'last_event_seq')
    op.drop_column('agent_sessions', 'parent_session_id')
    op.drop_column('agent_sessions', 'loop_state')
    op.drop_column('agent_sessions', 'budget_state')
    op.drop_column('agent_sessions', 'phase')
    op.drop_column('agent_sessions', 'user_id')
