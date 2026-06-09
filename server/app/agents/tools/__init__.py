"""Server-side agent tools — registered into the global ToolRegistry.

Importing this package triggers registration of all built-in tools via the
`register_all_tools()` call at module load. Frontend client-scope tools
(`canvas.*`, `images.*`, `ui.*`) are also declared here (with no handler)
so the registry has one source of truth for the LLM's tools[] array.
"""
from __future__ import annotations

import logging

from app.agents import subagent
from app.agents.tools import asset_tools, client_tools, memory_tools, model_tools, plan_tools

logger = logging.getLogger("prism.agent.tools")

_REGISTERED = False


def register_all_tools() -> None:
    """Idempotent: register every built-in tool. Safe across hot-reloads and
    test orderings — individual tool modules may have been registered earlier
    (e.g. `test_asset_identity_update.py:test_registry_pins_tool_metadata`
    calls `asset_tools.register()` directly), so we swallow re-registration
    `ValueError`s instead of relying solely on the `_REGISTERED` gate.
    """
    global _REGISTERED
    if _REGISTERED:
        return
    for fn in (
        client_tools.register,
        memory_tools.register,
        model_tools.register,
        plan_tools.register,
        asset_tools.register,
        subagent.register,
    ):
        try:
            fn()
        except ValueError as e:
            # Already partially registered (test isolation gap). Tool is
            # guaranteed to exist in the registry after this point.
            logger.debug("register_all_tools: %s — assumed already done", e)
    _REGISTERED = True
    logger.info("Agent tool registry populated with built-in tools")
