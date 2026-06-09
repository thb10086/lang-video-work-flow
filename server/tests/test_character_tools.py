"""Backend tool registry assertions for the character.* namespace.

Covers task 2.4.5 of the agent-experience-overhaul change:

    "更新 Agent 工具：character.create_grid / character.create_extract /
    character.create_registry 替代旧 create_character_* 工具。Legacy 名作 alias。"

Why this is its own test file:
    * The character tools are *client-scope* (handler runs in the
      browser via reverse RPC) so they can't be exercised end-to-end
      from a backend pytest. What we *can* assert here — and what
      task 2.4.5 actually demands — is that the registry surface is
      shaped correctly: canonical names exist, aliases resolve, tier
      and risk metadata are aligned with the legacy behaviour, and
      the OpenAI tools[] payload contains both surfaces while
      aliases are still on (Phase 2-3 dual-write window).

    * Importing `app.agents.tools.client_tools.register()` is
      idempotent because each test fixture starts with a fresh
      ToolRegistry — that lets us inspect the post-registration
      state without any mutual interference with module-level
      singletons.
"""
from __future__ import annotations

import pytest

from app.agents.tool_registry import ToolRegistry
from app.agents.tools import client_tools


# ────────────────────────────────────────────────────────────────────
# Fixture: build an isolated registry per test.
#
# `client_tools.register()` reads the module-level singleton via
# `get_registry()`, so we monkeypatch that to point at a private
# instance. This avoids cross-test pollution and keeps these
# assertions independent of `register_all_tools()` ordering.
# ────────────────────────────────────────────────────────────────────


@pytest.fixture
def registry(monkeypatch: pytest.MonkeyPatch) -> ToolRegistry:
    fresh = ToolRegistry()
    monkeypatch.setattr(client_tools, "get_registry", lambda: fresh)
    client_tools.register()
    return fresh


CHARACTER_TOOLS = (
    ("character.create_grid", "create_character_grid"),
    ("character.create_extract", "create_character_extract_node"),
    ("character.create_registry", "create_character_manager_node"),
)


# ════════════════════════════════════════════════════════════════════
# Canonical registration
# ════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize("canonical,_legacy", CHARACTER_TOOLS)
def test_canonical_name_registered(registry: ToolRegistry, canonical: str, _legacy: str) -> None:
    tool = registry.resolve(canonical)
    assert tool is not None, f"missing canonical tool: {canonical}"
    assert tool.name == canonical


@pytest.mark.parametrize("canonical,_legacy", CHARACTER_TOOLS)
def test_canonical_in_namespace_character(registry: ToolRegistry, canonical: str, _legacy: str) -> None:
    tool = registry.resolve(canonical)
    assert tool is not None
    assert tool.namespace == "character"


@pytest.mark.parametrize("canonical,_legacy", CHARACTER_TOOLS)
def test_canonical_is_client_scope(registry: ToolRegistry, canonical: str, _legacy: str) -> None:
    tool = registry.resolve(canonical)
    assert tool is not None
    # All three character tools mutate the React Flow canvas; they
    # must run in the browser.
    assert tool.scope == "client"
    # Client-scope tools have no in-process handler.
    assert tool.handler is None


@pytest.mark.parametrize("canonical,_legacy", CHARACTER_TOOLS)
def test_canonical_metadata_matches_legacy_tier_and_risk(
    registry: ToolRegistry, canonical: str, _legacy: str,
) -> None:
    tool = registry.resolve(canonical)
    assert tool is not None
    # Tier 2 because they're node-creation tools (mirrors the
    # frontend `TIER_2_CREATION` membership in `toolTiers.ts`).
    assert tool.tier == "tier2"
    # Creation is non-destructive; matches the safety class of the
    # legacy `create_character_*` calls.
    assert tool.risk_level == "low"


# ════════════════════════════════════════════════════════════════════
# Alias resolution (legacy → canonical)
# ════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize("canonical,legacy", CHARACTER_TOOLS)
def test_legacy_alias_resolves_to_canonical(
    registry: ToolRegistry, canonical: str, legacy: str,
) -> None:
    via_alias = registry.resolve(legacy)
    via_canonical = registry.resolve(canonical)
    assert via_alias is not None, f"legacy alias {legacy} did not resolve"
    assert via_alias is via_canonical, (
        f"alias {legacy} resolved to {via_alias.name}, "
        f"expected to share identity with {canonical}"
    )


@pytest.mark.parametrize("canonical,legacy", CHARACTER_TOOLS)
def test_legacy_alias_is_listed_in_aliases_field(
    registry: ToolRegistry, canonical: str, legacy: str,
) -> None:
    tool = registry.resolve(canonical)
    assert tool is not None
    assert legacy in tool.aliases


def test_no_alias_collisions(registry: ToolRegistry) -> None:
    """Each character.* alias should be unique across the whole registry."""
    seen: set[str] = set()
    for alias in registry.all_aliases().keys():
        assert alias not in seen, f"duplicate alias: {alias}"
        seen.add(alias)
    # Sanity: the three legacy names *are* in the alias map.
    for _canonical, legacy in CHARACTER_TOOLS:
        assert legacy in registry.all_aliases(), f"alias {legacy} missing"


# ════════════════════════════════════════════════════════════════════
# JSON Schema sanity
# ════════════════════════════════════════════════════════════════════


def test_create_grid_schema_requires_name(registry: ToolRegistry) -> None:
    tool = registry.resolve("character.create_grid")
    assert tool is not None
    params = tool.parameters
    assert params["type"] == "object"
    assert "name" in params["properties"]
    # The whole UX hinges on having an anchored character name; if
    # the schema accidentally drops it, downstream prompt anchoring
    # would silently degrade.
    assert "name" in params.get("required", [])


def test_create_grid_schema_has_style_enum(registry: ToolRegistry) -> None:
    tool = registry.resolve("character.create_grid")
    assert tool is not None
    style = tool.parameters["properties"].get("style")
    assert style is not None
    # Mirrors the legacy enum — losing options here would silently
    # change LLM behaviour because the model uses enum values to
    # decide whether to pass `style`.
    assert "anime" in style["enum"]
    assert "realistic" in style["enum"]


def test_create_extract_schema_optional_video_url(registry: ToolRegistry) -> None:
    tool = registry.resolve("character.create_extract")
    assert tool is not None
    params = tool.parameters
    # `video_url` should be available but NOT required — the executor
    # auto-injects it from the upstream videoGen edge.
    assert "video_url" in params["properties"]
    assert "video_url" not in params.get("required", [])


def test_create_registry_has_no_required_fields(registry: ToolRegistry) -> None:
    tool = registry.resolve("character.create_registry")
    assert tool is not None
    # Registry node only needs a label — and even that has a
    # default — so calling `character.create_registry({})` should be
    # valid.
    assert tool.parameters.get("required", []) == []


# ════════════════════════════════════════════════════════════════════
# OpenAI tools[] surface (dual-listing during alias window)
# ════════════════════════════════════════════════════════════════════


def test_openai_tools_includes_canonical_names(registry: ToolRegistry) -> None:
    schema = registry.to_openai_schema(include_aliases=False)
    names = {entry["function"]["name"] for entry in schema}
    for canonical, _legacy in CHARACTER_TOOLS:
        assert canonical in names, f"{canonical} missing from OpenAI tools[]"


def test_openai_tools_with_aliases_includes_legacy_names(registry: ToolRegistry) -> None:
    schema = registry.to_openai_schema(include_aliases=True)
    names = {entry["function"]["name"] for entry in schema}
    for canonical, legacy in CHARACTER_TOOLS:
        assert canonical in names
        assert legacy in names, f"alias {legacy} missing from OpenAI tools[]"


def test_alias_entries_are_marked_deprecated(registry: ToolRegistry) -> None:
    schema = registry.to_openai_schema(include_aliases=True)
    legacy_set = {legacy for _canonical, legacy in CHARACTER_TOOLS}
    for entry in schema:
        if entry["function"]["name"] in legacy_set:
            # Alias surface should make the deprecation explicit so
            # the LLM prefers the canonical name and downstream
            # tooling can monitor `tool_alias_used` events.
            assert "deprecated" in entry["function"]["description"]
