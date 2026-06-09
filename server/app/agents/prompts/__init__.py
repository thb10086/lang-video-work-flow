"""Prompt construction utilities — Python parity of `src/store/chatPromptBuilder.ts`.

Public surface (re-exported for convenience):

    PromptSegment      — dataclass for one layered prompt segment
    BuildOptions       — kwargs container for `build_segments`
    build_segments()   — primary builder, returns ordered list[PromptSegment]
    flatten_segments() — flatten list[PromptSegment] -> single string
    build_system_content_blocks() — Anthropic cache_control structured blocks

    estimate_tokens / estimate_message_tokens / estimate_total_tokens
    micro_compact / auto_compact / full_compact / smart_compress

Design rationale:
  - Python builder is *pure* — does NOT touch Redis, DB, or any global state.
    All canvas/memory/role/skills text comes in via BuildOptions, exactly
    parallel to how the TS version reads them from Zustand stores. This
    keeps the builder testable and lets the runtime swap data sources.
  - Token estimation uses the same `chars / 3.5` heuristic as the TS
    version so per-segment token budgets stay byte-equivalent.
"""

from .types import PromptSegment, BuildOptions, SystemContentBlock, LLMMessage, ContentPart
from .builder import (
    build_segments,
    flatten_segments,
    build_system_content_blocks,
    CORE_TEMPLATE,
    ESSENTIALS_TEXT,
)
from .token_estimator import (
    estimate_tokens,
    estimate_message_tokens,
    estimate_total_tokens,
)
from .compaction import (
    micro_compact,
    auto_compact,
    full_compact,
    smart_compress,
    SmartCompressResult,
)

__all__ = [
    "PromptSegment",
    "BuildOptions",
    "SystemContentBlock",
    "LLMMessage",
    "ContentPart",
    "build_segments",
    "flatten_segments",
    "build_system_content_blocks",
    "CORE_TEMPLATE",
    "ESSENTIALS_TEXT",
    "estimate_tokens",
    "estimate_message_tokens",
    "estimate_total_tokens",
    "micro_compact",
    "auto_compact",
    "full_compact",
    "smart_compress",
    "SmartCompressResult",
]
