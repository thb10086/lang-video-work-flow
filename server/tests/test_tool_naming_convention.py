"""Naming-convention tests for the agent tool registry (task 3.2.1).

Phase 3.2 makes `<noun>.<verb>` the canonical form for every tool.
Legacy snake_case names are kept as `aliases` (Phase 4 will retire
them). This module pins the contract:

  1. Every canonical tool name matches `^[a-z][a-z_]*\\.[a-z][a-z_]*$`.
  2. Every namespace is one of the approved set.
  3. Canonical names and alias names share a single flat namespace —
     no collisions.
  4. Each tool has tier / risk_level / scope set to a known value.
  5. Server-scope tools must carry a handler; client-scope tools must
     not (their execution lives in `clientToolBridge.ts`).
  6. The full set of canonical names is recorded as a snapshot — when
     the snapshot drifts, this test fails so the change is reviewed.

Why the snapshot? It catches the most common Phase-3 hazard — silently
adding a tool that doesn't follow the convention or accidentally
removing one that the SKILL docs reference. The set is small (≤ 30
tools) so reviewing the diff is trivial.
"""
from __future__ import annotations

import re

import pytest

from app.agents.tool_registry import RiskLevel, TierId, ToolScope, get_registry
from app.agents.tools import register_all_tools


# Canonical name shape: `<namespace>.<verb>`.
# Both halves are lowercase snake_case (letters + underscores), the
# leading char must be a letter so we never accidentally accept
# `_foo.bar` or `1foo.bar`. Single dot only.
_CANONICAL_RE = re.compile(r"^[a-z][a-z_]*\.[a-z][a-z_]*$")

# Approved namespaces. Adding a new namespace requires explicit review:
# a new namespace usually means a new product surface area, and the
# SKILL docs / approval policies need to be updated to match.
_APPROVED_NAMESPACES = frozenset({
    "agent",      # subagent delegation (delegate / parallel_delegate)
    "asset",      # asset library writes (admin/internal)
    "canvas",     # canvas mutation primitives (client tools)
    "character",  # character workflow nodes (design/extract/registry)
    "images",     # image upload / collection
    "memory",     # persistent agent memory
    "model",      # model catalog queries
    "phase",      # agent phase machine
    "plan",       # task planning
    "timeline",   # timeline assembly
    "ui",         # client-side UI affordances (diff / approval prompts)
})

_VALID_TIERS = frozenset({"tier1", "tier2", "tier3"})
_VALID_RISK = frozenset({"safe", "low", "medium", "high", "critical"})
_VALID_SCOPES = frozenset({"server", "client"})


@pytest.fixture(scope="module")
def registry():
    """Idempotent registry seed — `register_all_tools` is itself idempotent."""
    register_all_tools()
    return get_registry()


# ---------------------------------------------------------------------------
# Convention tests
# ---------------------------------------------------------------------------

class TestCanonicalNames:
    def test_every_canonical_matches_noun_dot_verb(self, registry) -> None:
        """`^[a-z][a-z_]*\\.[a-z][a-z_]*$` — strict regex on every tool."""
        offenders = [
            name for name in registry.all_canonical_names()
            if not _CANONICAL_RE.match(name)
        ]
        assert offenders == [], (
            f"Tool names violating <noun>.<verb> convention: {offenders}"
        )

    def test_every_namespace_is_approved(self, registry) -> None:
        bad = [
            (t.name, t.namespace)
            for t in registry.list_tools()
            if t.namespace not in _APPROVED_NAMESPACES
        ]
        assert bad == [], (
            f"Tools using unapproved namespace: {bad}. "
            f"Approved namespaces: {sorted(_APPROVED_NAMESPACES)}. "
            "If you really need a new namespace, update _APPROVED_NAMESPACES "
            "in this file AND the SKILL docs."
        )

    def test_no_collision_between_canonicals_and_aliases(self, registry) -> None:
        canonicals = registry.all_canonical_names()
        aliases = set(registry.all_aliases().keys())
        overlap = canonicals & aliases
        assert overlap == set(), (
            f"Names appearing as both canonical and alias: {overlap}"
        )


class TestToolMetadata:
    def test_every_tool_has_valid_tier(self, registry) -> None:
        bad = [(t.name, t.tier) for t in registry.list_tools() if t.tier not in _VALID_TIERS]
        assert bad == [], f"Invalid tier values: {bad}"

    def test_every_tool_has_valid_risk_level(self, registry) -> None:
        bad = [(t.name, t.risk_level) for t in registry.list_tools() if t.risk_level not in _VALID_RISK]
        assert bad == [], f"Invalid risk_level values: {bad}"

    def test_every_tool_has_valid_scope(self, registry) -> None:
        bad = [(t.name, t.scope) for t in registry.list_tools() if t.scope not in _VALID_SCOPES]
        assert bad == [], f"Invalid scope values: {bad}"

    def test_server_tools_have_handler_client_tools_do_not(self, registry) -> None:
        problems: list[str] = []
        for t in registry.list_tools():
            if t.scope == "server" and t.handler is None:
                problems.append(f"server tool {t.name} missing handler")
            if t.scope == "client" and t.handler is not None:
                problems.append(f"client tool {t.name} should not have a handler")
        assert problems == [], "; ".join(problems)

    def test_every_tool_has_non_empty_description(self, registry) -> None:
        empty = [t.name for t in registry.list_tools() if not t.description.strip()]
        assert empty == [], f"Tools with empty description: {empty}"

    def test_every_tool_has_object_parameters_schema(self, registry) -> None:
        """JSON schema must be `type: object` so OpenAI tools[] accepts it."""
        bad = [
            t.name for t in registry.list_tools()
            if t.parameters.get("type") != "object"
        ]
        assert bad == [], f"Tools with non-object parameters schema: {bad}"


class TestAliasShape:
    def test_aliases_are_snake_case_no_dots(self, registry) -> None:
        """Aliases are *legacy* names — they must be pure snake_case."""
        snake_re = re.compile(r"^[a-z][a-z0-9_]*$")
        bad = [
            alias for alias in registry.all_aliases()
            if not snake_re.match(alias) or "." in alias
        ]
        assert bad == [], f"Aliases that are not pure snake_case: {bad}"

    def test_alias_resolves_to_canonical_with_warning(
        self, registry, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Calling `resolve(alias)` must emit a `tool_alias_used` log line.

        Phase 3.2.4 will turn this log into an OpenTelemetry counter; for
        now the log is the only signal we have, so pin it.
        """
        aliases = registry.all_aliases()
        if not aliases:
            pytest.skip("no aliases registered yet")
        alias, canonical = next(iter(aliases.items()))

        caplog.clear()
        with caplog.at_level("WARNING", logger="prism.agent.tool_registry"):
            tool = registry.resolve(alias)
        assert tool is not None
        assert tool.name == canonical
        # Log line uses the literal "tool_alias_used" tag for grep-ability.
        assert any("tool_alias_used" in rec.message for rec in caplog.records)


# ---------------------------------------------------------------------------
# Snapshot — pin the full canonical set
# ---------------------------------------------------------------------------

# This snapshot is the authoritative list of every canonical tool name
# the backend exposes today. Keeping it here means:
#   - Adding a tool requires updating this list (forces review)
#   - Removing/renaming a tool requires updating this list (forces
#     migration plan via aliases)
#   - SKILL doc lints can cross-check against this list (V.10).
#
# When this test fails, do NOT just update the snapshot. First confirm:
#   1. The new name follows <noun>.<verb> convention
#   2. The old name (if any) is preserved via `aliases=("old_name",)`
#   3. The SKILL docs that reference the old name now use the new one
EXPECTED_CANONICAL_NAMES: frozenset[str] = frozenset({
    # subagent
    "agent.delegate",
    "agent.parallel_delegate",
    # asset library
    "asset.update_identity",
    # canvas mutation
    "canvas.add_node",
    "canvas.update_node",
    "canvas.delete_node",
    "canvas.connect",
    "canvas.highlight",
    "canvas.undo",
    # character workflow nodes
    "character.create_grid",
    "character.create_extract",
    "character.create_registry",
    # image utilities
    "images.collect_user_uploads",
    "images.upload_to_cos",
    # persistent memory
    "memory.save",
    "memory.recall",
    "memory.forget",
    # model catalog
    "model.list",
    "model.get_params",
    # phase machine
    "phase.set",
    # planning
    "plan.create",
    "plan.update_step",
    # timeline assembly
    "timeline.create",
    # client UI affordances
    "ui.show_diff",
})


def test_canonical_set_matches_snapshot(registry) -> None:
    actual = registry.all_canonical_names()
    missing = EXPECTED_CANONICAL_NAMES - actual
    extra = actual - EXPECTED_CANONICAL_NAMES
    assert not missing, (
        f"Tools listed in snapshot but missing from registry: {sorted(missing)}"
    )
    assert not extra, (
        f"Tools registered but not in snapshot — review and update "
        f"EXPECTED_CANONICAL_NAMES in this test: {sorted(extra)}"
    )
