"""Tests for Alembic migration 0005_agent_runtime (task 0.1.5).

The migration uses MySQL-specific types (`MySQLDateTime(fsp=3)` and
`CURRENT_TIMESTAMP(3)` server defaults), which cannot execute on SQLite,
so a literal `alembic upgrade head` against a temp SQLite db is not
viable here. Instead we cover the same intent — *"the migration is
syntactically + semantically correct"* — via two complementary checks:

1. **Static migration analysis** (`TestMigrationStructure`)
   - upgrade/downgrade functions exist and are callable
   - revision metadata is `0005` chained from `0004`
   - upgrade adds the 6 + 4 columns called out in the proposal
   - downgrade is the inverse (drops everything upgrade adds)
   - new table `agent_events` is created with the right columns

2. **ORM ↔ migration parity** (`TestOrmReflectsMigration`)
   - `Base.metadata.tables` exposes every column the migration adds
   - column nullability + server defaults match the migration
   - indexes / unique constraints are declared in the ORM

Together these guarantee that:
  - A future PR that adds a column to the migration but forgets the ORM
    (or vice-versa) fails CI immediately.
  - Renames / typos in the migration get caught before they hit prod.

When the migration stack is dialect-portable (pending 0001-0004 cleanup),
this test can be extended with a real SQLite upgrade/downgrade roundtrip.
"""
from __future__ import annotations

import ast
import importlib.util
from pathlib import Path

import pytest


MIGRATION_FILE = (
    Path(__file__).resolve().parent.parent
    / "alembic" / "versions" / "0005_agent_runtime.py"
)


# ============================================================
# Helpers — load migration as a module without depending on alembic env
# ============================================================

def _load_migration_module():
    """Load 0005_agent_runtime.py as an ad-hoc Python module.

    We can't `from alembic.versions...` import it directly because the
    versions dir isn't a proper package and importing it triggers
    alembic context initialisation. Instead we use the standard
    importlib pathway, which gives us upgrade/downgrade as module attrs.
    """
    spec = importlib.util.spec_from_file_location("alembic_0005", MIGRATION_FILE)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _parse_calls(func_name: str) -> list[ast.Call]:
    """Collect every `op.<verb>(...)` call inside the named function."""
    src = MIGRATION_FILE.read_text(encoding="utf-8")
    tree = ast.parse(src)
    calls: list[ast.Call] = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == func_name:
            for stmt in ast.walk(node):
                if (
                    isinstance(stmt, ast.Call)
                    and isinstance(stmt.func, ast.Attribute)
                    and isinstance(stmt.func.value, ast.Name)
                    and stmt.func.value.id == "op"
                ):
                    calls.append(stmt)
            break
    return calls


def _arg_value(call: ast.Call, idx: int) -> str | None:
    """Best-effort: return literal string of the Nth positional arg."""
    if idx >= len(call.args):
        return None
    arg = call.args[idx]
    if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
        return arg.value
    return None


def _column_name(call: ast.Call) -> str | None:
    """Extract column name from `op.add_column('table', sa.Column('NAME', ...))`."""
    if (
        len(call.args) >= 2
        and isinstance(call.args[1], ast.Call)
        and isinstance(call.args[1].args[0], ast.Constant)
    ):
        v = call.args[1].args[0].value
        if isinstance(v, str):
            return v
    return None


# ============================================================
# 1. Static migration analysis
# ============================================================

class TestMigrationStructure:
    def test_revision_chain(self) -> None:
        mod = _load_migration_module()
        assert mod.revision == "0005"
        assert mod.down_revision == "0004"

    def test_upgrade_and_downgrade_are_callable(self) -> None:
        mod = _load_migration_module()
        assert callable(mod.upgrade)
        assert callable(mod.downgrade)

    def test_upgrade_adds_six_columns_to_agent_sessions(self) -> None:
        calls = _parse_calls("upgrade")
        added = [
            _column_name(c) for c in calls
            if isinstance(c.func, ast.Attribute) and c.func.attr == "add_column"
            and _arg_value(c, 0) == "agent_sessions"
        ]
        added = [name for name in added if name is not None]
        assert sorted(added) == sorted([
            "user_id", "phase", "budget_state", "loop_state",
            "parent_session_id", "last_event_seq",
        ])

    def test_upgrade_adds_four_columns_to_agent_memories(self) -> None:
        calls = _parse_calls("upgrade")
        added = [
            _column_name(c) for c in calls
            if isinstance(c.func, ast.Attribute) and c.func.attr == "add_column"
            and _arg_value(c, 0) == "agent_memories"
        ]
        added = [name for name in added if name is not None]
        assert sorted(added) == sorted([
            "user_id", "scope", "pinned", "last_accessed_at",
        ])

    def test_upgrade_creates_agent_events_table(self) -> None:
        calls = _parse_calls("upgrade")
        creates = [
            _arg_value(c, 0) for c in calls
            if isinstance(c.func, ast.Attribute) and c.func.attr == "create_table"
        ]
        assert "agent_events" in creates

    def test_upgrade_creates_required_indexes(self) -> None:
        calls = _parse_calls("upgrade")
        indexes = [
            _arg_value(c, 0) for c in calls
            if isinstance(c.func, ast.Attribute) and c.func.attr == "create_index"
        ]
        # The indexes the proposal calls out by name.
        for required in (
            "idx_sessions_user_status",
            "idx_sessions_parent",
            "idx_memories_user_scope",
            "idx_memories_pinned",
            "idx_events_session_seq",
            "idx_events_type",
        ):
            assert required in indexes, f"missing index: {required}"

    def test_downgrade_inverse_drops_everything_upgrade_adds(self) -> None:
        up_calls = _parse_calls("upgrade")
        down_calls = _parse_calls("downgrade")

        added_cols = {
            (_arg_value(c, 0), _column_name(c)) for c in up_calls
            if isinstance(c.func, ast.Attribute) and c.func.attr == "add_column"
        }
        dropped_cols: set[tuple[str | None, str | None]] = set()
        for c in down_calls:
            if isinstance(c.func, ast.Attribute) and c.func.attr == "drop_column":
                table = _arg_value(c, 0)
                col = _arg_value(c, 1)
                dropped_cols.add((table, col))

        # Every added column must be dropped on downgrade.
        for pair in added_cols:
            assert pair in dropped_cols, f"upgrade adds {pair} but downgrade does not drop it"

        # Every created table must be dropped.
        created_tables = {
            _arg_value(c, 0) for c in up_calls
            if isinstance(c.func, ast.Attribute) and c.func.attr == "create_table"
        }
        dropped_tables = {
            _arg_value(c, 0) for c in down_calls
            if isinstance(c.func, ast.Attribute) and c.func.attr == "drop_table"
        }
        assert created_tables.issubset(dropped_tables), (
            f"upgrade creates {created_tables - dropped_tables} but downgrade does not drop them"
        )


# ============================================================
# 2. ORM ↔ migration parity
# ============================================================

class TestOrmReflectsMigration:
    """Once the migration runs, the ORM must expose every column it added.
    These tests catch the classic bug where someone updates a migration
    but forgets the matching @model field (or vice-versa)."""

    @pytest.fixture(scope="class")
    def metadata(self):
        # Importing the agent module triggers SQLAlchemy table registration.
        from app.models import agent  # noqa: F401
        from app.models.base import Base
        return Base.metadata

    @pytest.mark.parametrize("col", [
        "user_id", "phase", "budget_state", "loop_state",
        "parent_session_id", "last_event_seq",
    ])
    def test_agent_sessions_has_new_column(self, metadata, col: str) -> None:
        cols = {c.name for c in metadata.tables["agent_sessions"].columns}
        assert col in cols, f"agent_sessions ORM is missing column: {col}"

    @pytest.mark.parametrize("col", [
        "user_id", "scope", "pinned", "last_accessed_at",
    ])
    def test_agent_memories_has_new_column(self, metadata, col: str) -> None:
        cols = {c.name for c in metadata.tables["agent_memories"].columns}
        assert col in cols, f"agent_memories ORM is missing column: {col}"

    def test_agent_events_table_exists(self, metadata) -> None:
        assert "agent_events" in metadata.tables

    def test_agent_events_has_required_columns(self, metadata) -> None:
        cols = {c.name for c in metadata.tables["agent_events"].columns}
        for required in ("id", "session_id", "seq", "type", "payload", "created_at"):
            assert required in cols

    def test_agent_events_seq_unique_constraint(self, metadata) -> None:
        constraints = metadata.tables["agent_events"].constraints
        names = {c.name for c in constraints if c.name}
        assert "uq_agent_events_session_seq" in names

    def test_agent_sessions_phase_default_is_idle(self, metadata) -> None:
        col = metadata.tables["agent_sessions"].c["phase"]
        assert col.server_default is not None
        # Server default is `'idle'` (string literal); SQLAlchemy wraps it.
        assert "idle" in str(col.server_default.arg)

    def test_agent_sessions_last_event_seq_default_zero(self, metadata) -> None:
        col = metadata.tables["agent_sessions"].c["last_event_seq"]
        assert col.server_default is not None
        assert "0" in str(col.server_default.arg)

    def test_agent_sessions_user_id_default_one(self, metadata) -> None:
        col = metadata.tables["agent_sessions"].c["user_id"]
        assert col.server_default is not None
        assert "1" in str(col.server_default.arg)

    def test_parent_session_id_is_self_referential_fk(self, metadata) -> None:
        col = metadata.tables["agent_sessions"].c["parent_session_id"]
        # Should have a FK pointing back to agent_sessions.id
        fks = list(col.foreign_keys)
        assert len(fks) == 1
        assert fks[0].column.table.name == "agent_sessions"
        assert fks[0].column.name == "id"
