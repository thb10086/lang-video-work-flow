"""Backend Agent tool registry — single source of truth for all tools.

A tool is one of two kinds:
  - **server tool**: handler runs in the FastAPI process (memory ops,
    LLM calls, model queries, generation submission, asset CRUD, …)
  - **client tool**: handler runs in the user's browser via reverse RPC
    (canvas mutation, image upload, UI affordances). Their schemas are
    declared here so the LLM can call them; execution happens in the
    frontend `clientToolBridge.ts`.

Each registered tool carries:
  - `name`            — `<noun>.<verb>` canonical name (e.g. `canvas.add_node`)
  - `aliases`         — legacy snake_case names accepted as fallback
  - `description`     — Chinese, ≤ 120 chars (for LLM tool selection)
  - `parameters`      — JSON Schema for arguments
  - `handler`         — callable for server tools; None for client tools
  - `tier`            — `tier1|tier2|tier3` for progressive disclosure
  - `risk_level`      — `safe|low|medium|high|critical` for approval flow
  - `scope`           — `server|client`
  - `namespace`       — first segment of name (`canvas`, `node`, `memory`, …)

This file ships the registry shell + the alias resolver. Individual tool
handlers live under `app/agents/tools/<namespace>.py` and are registered
during runtime startup.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Literal, Optional

logger = logging.getLogger("prism.agent.tool_registry")

ToolHandler = Callable[[dict[str, Any], Any], Awaitable[dict[str, Any]]]
"""Server tool handler signature: (args, context) → ToolResult dict."""

RiskLevel = Literal["safe", "low", "medium", "high", "critical"]
TierId = Literal["tier1", "tier2", "tier3"]
ToolScope = Literal["server", "client"]


@dataclass
class Tool:
    """Single tool definition. Frozen after registration."""
    name: str
    description: str
    parameters: dict[str, Any]
    tier: TierId
    risk_level: RiskLevel
    scope: ToolScope = "server"
    handler: Optional[ToolHandler] = None
    aliases: tuple[str, ...] = field(default_factory=tuple)

    @property
    def namespace(self) -> str:
        return self.name.split(".")[0] if "." in self.name else self.name


class ToolRegistry:
    """Process-wide tool registry. Singleton via module-level instance."""

    def __init__(self):
        self._tools: dict[str, Tool] = {}
        self._aliases: dict[str, str] = {}  # legacy → canonical

    def register(self, tool: Tool) -> None:
        """Register a tool. Raises if name already taken."""
        if tool.name in self._tools:
            raise ValueError(f"Tool already registered: {tool.name}")
        if tool.scope == "server" and tool.handler is None:
            raise ValueError(f"Server tool {tool.name} requires a handler")
        self._tools[tool.name] = tool
        for alias in tool.aliases:
            if alias in self._aliases or alias in self._tools:
                raise ValueError(f"Alias {alias} collides with existing tool/alias")
            self._aliases[alias] = tool.name
        logger.debug("registered tool: %s (tier=%s, risk=%s, scope=%s)", tool.name, tool.tier, tool.risk_level, tool.scope)

    def resolve(self, name: str) -> Optional[Tool]:
        """Resolve a name (canonical or alias) to a Tool. None if unknown."""
        if name in self._tools:
            return self._tools[name]
        canonical = self._aliases.get(name)
        if canonical:
            logger.warning("tool_alias_used: old=%s new=%s", name, canonical)
            return self._tools.get(canonical)
        return None

    def list_tools(
        self,
        *,
        tier: Optional[TierId] = None,
        scope: Optional[ToolScope] = None,
        namespace: Optional[str] = None,
    ) -> list[Tool]:
        """Filter the registry. Returns canonical tools only (no aliases)."""
        out: list[Tool] = []
        for t in self._tools.values():
            if tier and t.tier != tier:
                continue
            if scope and t.scope != scope:
                continue
            if namespace and t.namespace != namespace:
                continue
            out.append(t)
        return out

    def all_canonical_names(self) -> set[str]:
        return set(self._tools.keys())

    def all_aliases(self) -> dict[str, str]:
        return dict(self._aliases)

    def to_openai_schema(
        self,
        *,
        tier: Optional[TierId] = None,
        include_aliases: bool = True,
    ) -> list[dict[str, Any]]:
        """Render the registry as OpenAI-compatible tools[] for LLM calls.

        When `include_aliases=True`, each legacy alias also appears as a
        separate function entry (with `description` prefixed `[deprecated:
        use <canonical>]`). After Phase 4 cleanup, set this to False.
        """
        out: list[dict[str, Any]] = []
        for tool in self.list_tools(tier=tier):
            out.append({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                },
            })
        if include_aliases:
            for alias, canonical in self._aliases.items():
                tool = self._tools[canonical]
                if tier and tool.tier != tier:
                    continue
                out.append({
                    "type": "function",
                    "function": {
                        "name": alias,
                        "description": f"[deprecated: use {canonical}] {tool.description}",
                        "parameters": tool.parameters,
                    },
                })
        return out


# ── Module-level singleton ──
_REGISTRY = ToolRegistry()


def get_registry() -> ToolRegistry:
    """Return the process-wide tool registry singleton."""
    return _REGISTRY


def reset_registry_for_tests() -> None:
    """Clear the registry. ONLY for use in tests."""
    global _REGISTRY
    _REGISTRY = ToolRegistry()
