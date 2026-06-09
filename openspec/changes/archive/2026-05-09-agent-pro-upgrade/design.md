# Design — agent-pro-upgrade

## Context

The Agent sits in a frontend loop (Claude-Code style) dispatching up to 25
tool-call rounds against a backend-proxied LLM. After the previous change
(`workflow-builder-wiring-fixes`) it has:

- 41 tools with 3-tier progressive disclosure (`toolTiers.ts`)
- `discover_tools` escape hatch (always Tier 1)
- `agentMemoryStore` with `memories[]` persisted in localStorage
- Three-layer context compaction (`chatPromptBuilder.ts`)

What it *doesn't* have is Claude Code's central insight: **the Agent should
carry explicit project/session state across turns and across sessions**, and
**inputs flow as multimodal content**, not just text. Our code already has
most of the primitives (`buildMultimodalContent`, a persist middleware, a
classify_image tool); they simply aren't wired together.

This change wires them together and adds the few missing pieces: phase
machine, relevance-ranked memory injection, and an image-to-node factory.

## Goals

- Respect the invariants established by the prior change (tier partitioning,
  discover_tools as always-present Tier 1, `generate_workflow` as the hero
  tool).
- **Zero regressions**: all 356 existing tests keep passing; all features
  behind additive flags.
- **Minimum surface area** for new concepts — reuse existing zustand
  `persist` middleware, existing `classify_image`, existing tier selector.
- Keep per-turn overhead below +200 tokens; `create_from_images` schema has
  to fit in Tier 2.

## Non-Goals

- Real Vision model integration for `review_generated_image`. We ship a
  structured-observation stub and a `_reviewAdapter` seam. Hooking a real
  model (GPT-4V / Gemini-Flash) is a follow-up change.
- Distributed / server-side memory sync. Memory stays in browser
  localStorage (partitioned by scope). Server sync is a follow-up that ties
  into the asset library change.
- Rewriting the compaction layers. The three-layer strategy in
  `chatPromptBuilder.ts` stays; we only add memory-injection on top.

## Decisions

### D-1. Multimodal first-turn ingestion (new)

**Decision**: On round 0 of the Agent loop, if `images.length > 0`, the
user message becomes a `ContentPart[]` built by `buildMultimodalContent`
(already exists). The system prompt is augmented with a single sentence
(`用户本轮随消息上传了 N 张图像；你可以用 create_from_images 基于它们建节点，
或用 inject_user_images 把它们绑定到已有节点。`).

**Why**: The function `buildMultimodalContent` is already used for manual
vision calls elsewhere; reuse it. The Agent just needs to *know* images are
there — that's the only missing link.

**Alternatives rejected**: encoding images in text via base64 summaries
(tokens explode; worse for GPT-4V/Claude, which need the native content
part format).

### D-2. `create_from_images` tool (new)

**Schema**:

```jsonc
{
  "name": "create_from_images",
  "description": "根据用户上传的多张图片自动分类并创建合适的节点。每张图片独立判定为 character / scene / style / edit_input 并落到 characterGrid / sceneGrid / styleLock / imageEdit。",
  "parameters": {
    "images": { "type": "array", "items": { "type": "string" }, "description": "data-URL 或 base64 PNG 数组；留空则取最近一条用户消息的全部图片" },
    "intent": { "type": "string", "description": "可选整体意图提示：character_refs | scene_refs | mixed | style_lock" },
    "names": { "type": "array", "items": { "type": "string" }, "description": "可选：每张图片对应的命名" }
  },
  "required": []
}
```

**Execution**:
1. Resolve `images` from args or chat history (mirror of `inject_user_images`)
2. For each image, call existing `classify_image` internally (heuristic today:
   filename / size / user intent keyword; Vision model later).
3. Dispatch to the matching node:
   - `character` → `createCharacterGridFromImage(wb, {name, image})`
   - `scene` → `createSceneGridFromImage(wb, {name, image})`
   - `style` → `styleLock` with `referenceImage = image`
   - `edit_input` → `imageEdit` with `inputImage = image`
4. Return `{ createdNodeIds[], classifications[] }`.

**Guardrails**:
- No more than `MAX_IMAGES_PER_CALL = 10` to avoid runaway canvas.
- If classification confidence < 0.5, fall back to `imageEdit` (safest).

### D-3. Memory scope + relevance injection (new)

**Scope**: `session | project | global` — stored in the existing
`memories[]` array with a `scope` field. `projectId` pulled from
`flowStore.getState().workflowId` (already exists, used by import/export).

**Storage**: same persist middleware, but `partialize` now bucketises:

```ts
partialize: state => ({
  memories: state.memories,          // persisted in one blob, scope is per-row
  currentPhase: state.currentPhase,  // new, see D-4
})
```

Filter on load: `state.memories = rows.filter(m => m.scope !== 'project' || m.projectId === currentProjectId)` — i.e. **other projects' memories stay in storage but aren't loaded into state** until the user opens that project. This avoids cross-project leakage.

**Relevance ranking**: plain tag-overlap + recency (`score = tagMatches * 2 +
recencyHalfLifeDays(lastAccessedAt, halfLife=7)`). Pick top-5. No
embeddings today — fine for a few-dozen-entry memory.

**Injection**: `buildAgentSystemPrompt()` gains a new section
`## 相关记忆 (top-5)` below SKILLS. Capped at 800 characters total.

### D-4. Phase state machine (new)

**States**: `idle | planning | designing | building | reviewing | executing`.

**Transitions**: LLM-driven. New tool `set_phase({phase, reason})` appends
to a `phaseHistory[]` for audit. Default on session start is `idle`.

**Tier interaction**: `getAgentTools({ phase, ... })` applies a whitelist on
top of tier filtering:

| Phase | Extra allow | Extra deny |
|-------|-------------|-----------|
| idle       | — (tier heuristic runs normally) | — |
| planning   | plan_task, save_memory, recall_memory | create_* (except character_grid as exploration) |
| designing  | create_style_lock_node, create_character_grid, create_scene_grid | execute_node, retry_node |
| building   | all create_*_node, connect_nodes | — |
| reviewing  | review_generated_image, verify_task, review_content | create_*, delete_node |
| executing  | execute_node, batch_execute, parallel_execute, retry_node, get_node_output | create_* |

If `phase=idle`, the filter is a no-op (today's behaviour).

**Why LLM-driven phases not auto**: auto-detecting phase from tool-use
history is brittle; Claude Code's pattern is to make the LLM *explicitly*
state what step it's on via tool call. That also produces good logs.

### D-5. Vision self-review stub (new)

**Schema** `review_generated_image({ nodeId, aspects? })` returns:

```json
{
  "hasOutput": true,
  "outputUrl": "...",
  "promptTokenCount": 42,
  "referencedAssets": ["char-Alice","scene-Rooftop"],
  "observations": [
    "output exists",
    "prompt references 2 registered assets (anchoring ok)",
    "no negative prompt present (risk: hands/feet artifacts)"
  ],
  "visionScore": null   // stub: real Vision hook lands here later
}
```

**Why a stub now**: gives the LLM a structured review object shape that it
can reason over today, and the field slot for visionScore means adding the
real vision call later doesn't break any callers.

### D-6. Memory forget + auto-compact (new)

`forget_memory({ id?, tag?, scope?, olderThan? })` — any of the four
parameters acts as a filter; at least one required.

Auto-compact trigger: in `saveMemory(...)`, after push, if
`memories.length > 20` and `scope === 'session'`, we collapse the oldest
10 session-scoped entries into one summary row titled "会话上下文摘要 (N
条)" — **no LLM call** today, just a textual list join capped at 600 chars.
The real LLM compaction is queued for a later change.

## Risks / Trade-offs

1. **`create_from_images` heuristic misclassifies** → Agent builds the wrong
   node. Mitigation: always log the `classifications[]` so Agent can
   `delete_node` + try another branch. Also `intent` param lets the caller
   override when they know.
2. **Memory relevance ranker starves rare-but-important memories** → every
   entry keeps a `pinned: boolean` field; pinned always injected. Up to 2
   pinned + 3 ranked = 5 total.
3. **Multimodal first-turn doubles LLM input tokens on image-heavy asks**
   → that cost is already baked into any vision call. We add an `agentStats.
   imageTokensApprox` counter for visibility.
4. **Phase gate interferes with free-form chat** → the default `idle` phase
   is a no-op, so users who never call `set_phase` see zero behavioural
   change.

## Migration

- Existing memories in localStorage lack `scope` / `projectId`. On load, a
  one-time migration sets `scope = 'global'` for anything pre-upgrade.
  Covered by a vitest unit test.
- No node type changes → no `workflowMigrations.ts` entries needed.
- `getAgentTools` picks up the new `phase` parameter but it's optional.
