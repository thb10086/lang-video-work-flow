## Context

The codebase reached "LibTV-style UI parity" in the previous change (`character-asset-library` proposal + the picker work), but the audit in this proposal revealed a handful of functional gaps that undermine trust:

1. **Dead silence**: pressing 生成 on `AudioNode` does nothing. The `onClick` prop is `() => {}` with a TODO comment (`@d:\PythonProject\lang-video-work-flow\src\components\nodes\AudioNode.tsx:191`) while every other node dispatches `executeNode(id)`.
2. **Agent/UI field skew**: `create_image_edit_node` writes `args.editInstruction` → `node.data.editInstruction` (`@d:\PythonProject\lang-video-work-flow\src\providers\agentTools.ts:193`), but `ImageEditNode` reads `data.editPrompt` (`@d:\PythonProject\lang-video-work-flow\src\components\nodes\ImageEditNode.tsx:24`). Executor fallback exists (`processingExecutors.ts:225`) but the UI textarea stays empty — users think Agent failed.
3. **Orphaned `imageCrop`**: `ImageCropNode.tsx` is imported and registered in the canvas' `nodeTypes` map (`@d:\PythonProject\lang-video-work-flow\src\components\canvas\WorkflowCanvas.tsx:46`) but not in `NODE_REGISTRY` (`@d:\PythonProject\lang-video-work-flow\src\data\nodeDefinitions.ts`). No UI surface lets users add it; no Agent tool creates it; `pipeline.test.ts:297` actively asserts its absence; yet `toolScenario.ts:31` still documents it as part of `comic_drama`. Classic Chesterton's-fence situation — we now own the answer: remove it.
4. **Agent coverage holes**: `characterExtract` and `characterManager` nodes are canvas-visible and have executors (added last change), but Agent has no `create_*` tool for them. Automated workflows built via `generate_workflow` never contain them, defeating the @角色名 consistency pipeline we just built.
5. **`create_audio_node` hardcoded enum**: `toolDefinitions.ts:174` enumerates `['elevenlabs', 'fish-speech', 'cosyvoice']` instead of deriving from backend. Contradicts the DRY principle we applied to `create_video_node` / `create_image_node` via `getAgentTools(models)`.

None of these require new architecture — they are data-consistency and wiring fixes.

## Goals / Non-Goals

**Goals:**
- Every `SubmitButton` on every node dispatches `executeNode(id)`, with zero empty-handler placeholders.
- A single canonical field name per node.data slot (`editInstruction`, not `editPrompt`). Executor fallback stays only for one release to keep older saved workflows loading.
- Any node type with a runtime component (`components/nodes/*Node.tsx`) is reachable from **every** end-user surface: NodePanel, QuickNodePanel, CanvasContextMenu, SlashMenu, Agent `create_*` tool. Anything not reachable is either exposed or deleted.
- Agent-generated `comic_drama` / `short_drama` workflows include a `characterManager` node by default, using the `character-in` edge flow we built.
- `create_audio_node` schema is model-aware (derived from backend list), matching `create_video_node` / `create_image_node`.

**Non-Goals:**
- No new node types.
- No TTS adapter implementation. `AudioNode` after the fix will call `executeNode` → `executeAudioNode`, which still returns `{status:'pending'}` with the existing "TTS not yet implemented" message. That's a separate change (`audio-generation-adapter`), flagged in Open Questions.
- No IP-Adapter / FaceID / Sora Character API expansion.
- No cross-project asset sharing (owned by `character-asset-library`).

## Decisions

### 1. Rename `editPrompt` → `editInstruction`, not the other way around

**Why**: Agent-side is already `editInstruction` (matches the English verb "edit + instruction"), the tool schema field in `toolDefinitions.ts:217`, and the SKILL doc in `prompts/skills/index.ts:201`. UI side is the minority; renaming in the direction of Agent keeps the contract with the LLM stable.

**Alternatives considered**:
- Keep `editPrompt` and rename Agent side: would require updating every SKILL doc and every LLM-facing description. Agent contract is the harder thing to migrate; UI refactor is mechanical.
- Keep both permanently via adapter: encouraged by current executor fallback, but creates two ways to represent the same thing and grows in cost every time someone touches the node. Reject.

### 2. Delete `imageCrop` (don't resurrect it)

**Why**: `characterGrid` generates a single image now (not a 3×3 grid), so cell-extraction has no data source. The character consistency path is `characterGrid → ref-in` direct (full image) or `characterExtract → characterManager → character-in` (Sora-style per-character URL). No test, template, or builder creates an `imageCrop`. Keeping it is pure cost.

**Alternatives considered**:
- Re-add it to `NODE_REGISTRY` and expose via panels: would need to restore a 3×3-generating mode on `CharacterGrid`, which we deliberately removed in an earlier change. Reject — contradicts current architecture.

### 3. `create_character_manager_node` with no required args

**Why**: `CharacterManagerNode` is a passive registry; its only required state is an (optional) `characters: []` list. The Agent's common use case is "after I build this drama workflow, drop a Manager to collect characters, so VideoGen nodes can @-reference them". Making any arg required would force Agent to populate the list at creation time, which is rarely what we want — it's populated by edges (from CharacterExtract) or by the user clicking "Add".

```ts
create_character_manager_node({ label?: string })  // minimal surface
```

### 4. `create_character_extract_node` requires the video source

**Why**: Unlike Manager, Extract **does** need input to be meaningful (a video URL or upstream task_id). We let Agent specify `videoUrl?: string` + `timestamps?: string`, but prefer the "no args, connect upstream VideoGen by edge" flow since that's how LibTV uses it.

```ts
create_character_extract_node({
  videoUrl?: string,        // optional; usually connected from upstream videoGen
  timestamps?: string,      // default "1,3"
  label?: string,
})
```

Executor (already exists in processingExecutors) fails gracefully with a clear "缺少视频输入" message when neither is present — this stays.

### 5. `comic_drama` / `short_drama` builders emit exactly one `characterManager`

**Why**: LibTV's consistency story is "every character is a row in a library, every generation references the library". We already have the data flow; we just never tell the builder to create the library node. One `characterManager` per workflow, placed next to `characterGrid`, with an edge per character via `grid-out → character-in`.

Layout:
```
[characterGrid A] ─┐
                   ├─ character-in → [characterManager]  ─ character-out ─ (manual wire to videoGen)
[characterGrid B] ─┘
```

The `character-in` edge from a `characterGrid` to a `characterManager` works today because our propagation code uses `bestImage` as a fallback when the source is not `characterExtract` (see `nodeExecutor.ts:126`).

### 6. Fallback for `editPrompt` stays one release

**Why**: We may have saved workflows in user browsers (Zustand persist). Keep `processingExecutors.ts:225` reading `node.data.editPrompt || node.data.editInstruction` for one release, then remove in a follow-up change `remove-edit-prompt-fallback`.

## Risks / Trade-offs

- **Risk**: Deleting `imageCrop` breaks someone's local saved workflow that somehow has an `imageCrop` node (e.g. from an earlier version). → **Mitigation**: `WorkflowCanvas` `nodeTypes` map currently maps unknown types to a generic fallback via React Flow default; since our deletion removes `imageCrop: ImageCropNode` from the map, unknown nodes render as default box with their data visible. This is acceptable for legacy data. We add an `App.tsx` startup check that filters out `imageCrop`-typed nodes from loaded workflows and logs a console warning.
- **Risk**: Agent treats `create_audio_node` dynamic enum differently than the static one (prompt stability). → **Mitigation**: `getAgentTools(videoModels, imageModels, audioModels)` already uses a build-from-schema function for `create_video_node` / `create_image_node`; we extend the same helper for audio. Description format stays identical → prompt stability preserved.
- **Trade-off**: Wiring `AudioNode` to `executeNode` without a real TTS adapter means users will click 生成 and get "pending" status + an informational message. This is better than silent dead button (today) but worse than real audio output. We accept this interim UX and open a follow-up change for the adapter.

## Migration Plan

1. Land field rename and executor fallback in the same release. `ImageEditNode` reads `editInstruction` as primary, `editPrompt` as deprecated alias for reads only (write path always uses `editInstruction`). Existing saved workflows load fine.
2. `App.tsx` startup filters `imageCrop` nodes from any loaded workflow, logs `[migration] dropped legacy imageCrop node(s)`.
3. Ship `create_character_extract_node` / `create_character_manager_node` + SKILL doc update; Agent gains the knowledge via the natural SKILLS-injection flow.
4. Update `workflowBuilders.buildComicDrama` + `buildShortDrama` to emit `characterManager`.
5. Remove `imageCrop` files / port registry / canvas map entry. Run tests.
6. Follow-up change (`remove-edit-prompt-fallback`): drop the executor fallback + the App.tsx migration filter after one release cycle.

**Rollback**: Each step is independent. If #4 produces worse generated workflows, revert the builder change without touching #1–3.

## Open Questions

- **`AudioNode` real TTS execution**: out of scope. Tracked as follow-up change `audio-generation-adapter` — unblocks the "video + narration" complete pipeline. Low priority until a user explicitly asks for narrated workflows.
- **`voice` free-text input**: `AudioNode.handleVoiceChange` accepts arbitrary strings; once the audio adapter lands, this needs to become a model-derived dropdown. Noted for the same follow-up.
