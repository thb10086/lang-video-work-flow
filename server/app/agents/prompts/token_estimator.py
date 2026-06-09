"""Token estimation — byte-equivalent port of TS `estimateTokens`.

The TS version uses `Math.ceil(text.length / 3.5)`. We replicate that
exact formula so per-segment token budgets and compaction trigger
thresholds compute identically across both runtimes.

When swapping in a real tokeniser (`tiktoken` / Anthropic's), keep this
heuristic alongside as the offline-friendly fallback.
"""

from __future__ import annotations

import json
import math

from .types import LLMMessage


def estimate_tokens(text: str | None) -> int:
    """≈ tokens for a single string. `None` and empty return 0.

    Equivalent to TS `Math.ceil(text.length / 3.5)`; the TS .length is
    UTF-16 code units while Python `len(str)` counts Unicode code points.
    For ASCII / BMP characters the two are equal; for surrogate-pair
    emoji or rare CJK extension B chars the values can differ by 1. The
    Agent prompt copy is BMP-only so this gap is irrelevant in practice.
    """
    if not text:
        return 0
    return math.ceil(len(text) / 3.5)


def estimate_message_tokens(msg: LLMMessage) -> int:
    """≈ tokens for one `LLMMessage` including a 4-token overhead.

    Overhead matches TS — accounts for role/content delimiters that
    every provider emits. Image parts contribute a flat 1000-token
    estimate (matches TS, which treats a "high-detail" image upload as
    roughly equivalent to a 1k-token text span).
    """
    tokens = 4  # message overhead
    content = msg.content
    if isinstance(content, str):
        tokens += estimate_tokens(content)
    elif isinstance(content, list):
        for part in content:
            if part.get("type") == "text":
                tokens += estimate_tokens(part.get("text"))  # type: ignore[arg-type]
            elif part.get("type") == "image_url":
                tokens += 1000
    if msg.tool_calls:
        # JSON-serialise the tool_calls payload to count it the same way
        # TS does (`estimateTokens(JSON.stringify(msg.tool_calls))`).
        # Use compact separators to match JSON.stringify default.
        tokens += estimate_tokens(json.dumps(msg.tool_calls, ensure_ascii=False, separators=(",", ":")))
    return tokens


def estimate_total_tokens(messages: list[LLMMessage]) -> int:
    """Sum of `estimate_message_tokens` across the message list."""
    return sum(estimate_message_tokens(m) for m in messages)
