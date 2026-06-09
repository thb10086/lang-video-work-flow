## Why

Two hotfixes from /review plus three major capability gaps blocking the Agent
from operating at the level of Claude Code:

1. (hotfix) `executeLLMChat` uses a stale store snapshot when writing to the
   tagged downstream textNode — latent race if user mutates canvas mid-LLM.
2. (hotfix) `discover_tools` meta-tool returns the **static** `AGENT_TOOLS`
   schema, losing the dynamic `create_{video,image,audio}_node` enums that
   `getAgentTools` just substituted with the backend model list.
3. **The Agent is blind to uploaded images**. `ChatMessage.images` flows into
   the message UI + the `inject_user_images` tool, but the LLM itself never
   receives the multimodal content on the first reasoning turn, so it has to
   guess intent from text alone. There is also **no way** for the Agent to
   create new nodes from fresh images — `inject_user_images` only attaches
   pixels to *existing* nodes.
4. Agent memory is a flat localStorage blob. All canvases share one
   namespace (no `project` scope), no relevance filter runs before injection,
   and there's no auto-summarisation or forget mechanism. This is exactly the
   failure mode Claude Code's hierarchical `CLAUDE.md` / `/memory` avoid.
5. Agent has no explicit phase state. The SKILLS registry assumes phases
   (`plan → design → build → review`) but the LLM doesn't self-report where
   it is, so tools like `verify_task` can fire too early and Tier 3 tools
   aren't actually gated by phase.

## What Changes

- **(hotfix) A1** — Replace the snapshot read in `executeLLMChat`'s
  downstream lookup with a fresh `useFlowStore.getState()` call.
- **(hotfix) A2** — `handleDiscoverTools` accepts the live tool array from
  the calling session instead of reading static `AGENT_TOOLS`.
- **(new capability) B1** — On round 0 of the Agent loop, attach uploaded
  images to the first LLM request as multimodal content parts. Record the
  count in `agentStats`.
- **(new capability) B2** — New tool `create_from_images({ images[], intent? })`
  that classifies each image via `classify_image` and spawns the matching
  node (character / scene / style-reference / image-edit input). Returns
  the new node IDs + classification rationale so the Agent can keep
  planning. Works for *arbitrary count* of images in one call.
- **(new capability) B3** — `inject_user_images` extended with
  `autoDistribute: true` mode that maps N images across M target nodes
  round-robin (useful when Agent says "use these 6 refs across 6 shots").
- **(new capability) C1** — Memory `scope` field: `session` / `project` /
  `global`. `project` scope keyed by `projectId` from flowStore. Persisted
  via the same zustand middleware but partitioned by scope in storage.
- **(new capability) C2** — Auto-inject top-K relevant memories into the
  system prompt on each turn, ranked by tag overlap with the user message.
  K = 5 by default, configurable in settings.
- **(new capability) C3** — `forget_memory({ id | tag | olderThan })` tool
  plus automatic summarisation when `memories.length > 20` (LLM-free: keeps
  last-accessed 10 as-is, collapses the older ones into a single rollup
  entry). Mirrors Claude Code's `/memory compact` flow.
- **(new capability) D1** — `agentMemoryStore.currentPhase`:
  `idle | planning | designing | building | reviewing | executing`.
  Defaults to `idle`. New tool `set_phase({phase, reason})` to flip it.
- **(new capability) D2** — `getAgentTools(options)` gains a `phase`
  parameter that (optionally) further narrows the tier selection. E.g.
  `phase=planning` restricts to read-only + memory tools; `phase=building`
  enables Tier 2 creation; `phase=executing` gates retry/batch.
- **(new capability) E1** — `review_generated_image({ nodeId })` tool that
  returns a structured observation (size, presence of refs, prompt-vs-
  output token overlap, seed lineage). Vision model hook is pluggable via
  `_reviewAdapter` module for future upgrade — stub today.

## Impact

- Affected specs:
  - `agent-multimodal-input` (new) — first-class Agent image awareness
  - `agent-memory-management` (new) — Claude-Code-style scoping/relevance
  - `agent-phase-state` (new) — phase-gated tool disclosure
  - `agent-tool-tiering` (modified) — tier selector combines with phase
- Affected code:
  - `src/providers/executors/processingExecutors.ts` (A1)
  - `src/providers/agentTools.ts` (A2 + B2 + C3 + D1 + E1 new handlers)
  - `src/providers/toolDefinitions.ts` (B2/B3/C3/D1/E1 schemas)
  - `src/store/chatStore.ts` (B1 multimodal first-turn)
  - `src/store/agentMemoryStore.ts` (C1 scopes + C2 relevance + C3 forget)
  - `src/store/chatPromptBuilder.ts` (C2 memory injection + buildSystemPrompt)
  - `src/providers/toolTiers.ts` (D2 phase filter)
  - `src/providers/workflowBuilders.ts` (B2 builder helper for image-seeded nodes)
- Backward compatibility:
  - All new tools are optional additions — Tier 1/2/3 lists only grow.
  - Memory `scope` defaults to `'session'` for pre-existing entries.
  - Phase defaults to `idle`, which = no phase gating, i.e. behaves like today.
