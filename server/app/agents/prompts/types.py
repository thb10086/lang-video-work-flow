"""Shared dataclasses for the prompt builder + compaction modules.

These mirror the TS interfaces in `src/store/chatPromptBuilder.ts`:
  - PromptSegment         ↔  TS PromptSegment
  - BuildOptions          ↔  TS BuildAgentPromptOpts (extended with injected resources)
  - SystemContentBlock    ↔  TS SystemContentBlock
  - LLMMessage            ↔  TS LLMMessage
  - ContentPart           ↔  TS ContentPart
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, TypedDict, Union


# ============================================================
# Multimodal content
# ============================================================

class TextPart(TypedDict):
    type: Literal["text"]
    text: str


class ImageURL(TypedDict, total=False):
    url: str
    detail: str


class ImagePart(TypedDict):
    type: Literal["image_url"]
    image_url: ImageURL


# A content part is either text or image_url (OpenAI Vision schema).
ContentPart = Union[TextPart, ImagePart]


@dataclass
class LLMMessage:
    """One message in the LLM-bound conversation array.

    `content` is `None` for assistant turns that emit only tool_calls.
    `content` is `str` for plain-text turns and either user or assistant.
    `content` is `list[ContentPart]` for multimodal user turns.
    """
    role: str
    content: Union[str, None, list[ContentPart]] = None
    tool_calls: list[dict] | None = None
    tool_call_id: str | None = None


# ============================================================
# Layered prompt
# ============================================================

Stability = Literal["stable", "semi-stable", "dynamic"]


@dataclass(frozen=True)
class PromptSegment:
    """One layered system-prompt segment.

    `id` is a build-call-unique key used by tests to introspect ordering
    and by the cache_control emitter to identify breakpoints.
    `text` is the rendered text. Empty means the segment is elided.
    `stability` governs whether the backend may attach cache_control
    to this segment when forwarding to Anthropic-compatible providers.
    """
    id: str
    text: str
    stability: Stability


@dataclass
class BuildOptions:
    """All inputs to `build_segments` — strictly injection-based.

    No globals, no Zustand-style stores, no DB calls inside the builder
    itself. The runtime is responsible for resolving these strings before
    invoking the builder, which keeps the builder pure + testable.

    Required:
        role_prompt:        Output of getSystemPromptForRole(role_id) on TS side.
        canvas_snapshot:    Output of getCanvasSnapshot() on TS side.
        prompt_craft_ref:   Output of renderPromptEngineeringQuickRef().
        phase:              one of {"pre_production", "production", "post_production"}.

    Optional injection points:
        skills_prompt:      Output of buildSkillsPromptByPhase(phase, {hasImages: imageCount > 0}).
                            None or "" → the skills segment is elided.
        memory_context:     Output of memoryStore.getRelevantContext(...).
                            None or "" → the memory segment is elided.

    Per-turn knobs:
        image_count:        Triggers the dedicated image_hint segment when > 0.
        default_video_model: Substituted into the core segment's "DEFAULT_VIDEO_MODEL"
                            placeholder. Defaults to "doubao-seedance-2-0" to match
                            `src/providers/modelDefaults.ts`.
    """
    role_prompt: str
    canvas_snapshot: str
    prompt_craft_ref: str
    phase: Literal["pre_production", "production", "post_production"]
    skills_prompt: str | None = None
    memory_context: str | None = None
    image_count: int = 0
    default_video_model: str = "doubao-seedance-2-0"


# ============================================================
# Anthropic cache_control structured block (system content array)
# ============================================================

@dataclass
class CacheControl:
    """Anthropic cache_control marker. Currently only `ephemeral` is documented."""
    type: Literal["ephemeral"] = "ephemeral"


@dataclass
class SystemContentBlock:
    """One block within an Anthropic-style structured `content` array.

    When `cache_control` is set, every block from the start of the array
    up to and including this block is treated as a cache breakpoint by
    Anthropic — so we mark the *last* cacheable segment, not every one.
    """
    type: Literal["text"]
    text: str
    cache_control: CacheControl | None = None

    def to_dict(self) -> dict:
        """JSON-friendly form ready for httpx.AsyncClient.post(json=...)."""
        d: dict = {"type": self.type, "text": self.text}
        if self.cache_control is not None:
            d["cache_control"] = {"type": self.cache_control.type}
        return d


# ============================================================
# Compaction module shared types
# ============================================================

CompactionLayer = Literal[0, 1, 2, 3]


@dataclass
class SmartCompressResult:
    """Return value of `smart_compress`.

    `messages` is the (possibly mutated, possibly replaced) message list
    after applying the chosen compaction layer.
    `compressed` is True iff layer ≥ 2 (auto or full compact). Layer 1
    is in-place trimming and considered "non-compressed" for telemetry.
    """
    messages: list[LLMMessage]
    compressed: bool
    layer: CompactionLayer
