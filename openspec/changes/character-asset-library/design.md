## Context

**Existing primitives (reuse, do not replace)**
- `flowStore.characterAppearances: Record<string, string>` (`@d:/PythonProject/lang-video-work-flow/src/store/flowStore.ts:35`) — flat, canvas-local registry used by `buildCharacterAnchorPrefix` (`@d:/PythonProject/lang-video-work-flow/src/providers/executors/generationExecutors.ts:26-48`) to auto-prepend `[Character Anchor]` to prompts. Works well, but has no UI for discovery, no variations, no persistence across projects.
- `characterGrid` / `sceneGrid` / `styleLock` nodes already carry name/description/reference image. We will bridge them to the new library instead of replacing them.
- `characterExtract` / `characterManager` nodes already model Sora Character API (`characterUrl`, `timestamps`). Reuse the data shape for Sora injection.
- `ai_models.param_schema` (JSON) declares each model's legal fields. The multi-model-param-adaptation change gives us a backend `param_validator` + frontend `sanitizeForExecute` — the reference adapter must cooperate, not fight, with these.

**Gaps addressed by this change**
1. No cross-project persistence of characters/scenes/styles.
2. No `@` tagging UI; users copy-paste names with typos that break anchor matching.
3. No per-model injection layer; same payload silently drops the wrong keys depending on model.
4. `VideoGenNode` falls back to a single-model dropdown silently when backend is unreachable — gives the wrong impression that "other models were removed".
5. LibTV-style Elements panel missing.

## Goals / Non-Goals

**Goals:**
- Backend persistence of assets with variations.
- `@` autocomplete that writes structured `@{assetId}` tokens.
- One adapter module (`modelReferenceAdapter.ts`) that knows every registered video/image model's reference field conventions.
- LibTV-parity sidebar panel, drag-to-canvas, detail modal, keyboard shortcut.
- Fix the "only Seedance shows" UX by surfacing fetch errors in node UI.

**Non-Goals:**
- No face-embedding / IP-Adapter / LoRA — pure reference-image + prompt-anchor.
- No multi-user sharing; assets are per-tenant/per-user (tenant column included for future use but not exposed).
- No real-time presence/collaboration.
- No change to existing `verify_task` scoring semantics (future Vision-self-check change extends it).
- No change to video model list itself (registered models stay as in seed.py).

## Decisions

### D1. DB schema — three asset tables + link table
Three separate tables so we can index kind-specific hot paths without JSON field digging:

```
character_assets(id, user_id, project_id nullable, name, name_en, appearance TEXT, reference_images JSON, variations JSON, appearance_version INT, metadata JSON, created_at, updated_at, deleted_at)
scene_assets(id, user_id, project_id nullable, name, name_en, environment TEXT, reference_images JSON, variations JSON, appearance_version INT, metadata JSON, timestamps)
style_assets(id, user_id, project_id nullable, name, name_en, guide TEXT, reference_images JSON, variations JSON, appearance_version INT, metadata JSON, timestamps)
workflow_asset_refs(id, workflow_id, asset_kind, asset_id, node_id, created_at)  -- for analytics / cleanup
```

`variations` JSON shape: `[{ id: "var_001", label, appearance_delta, reference_images }]`. Keep inside JSON instead of a separate table — variations are always loaded with parent and are bounded (<20 typical).

Rationale: three tables cost O(3 migrations) but give clean scope + faster search per kind; variations-as-JSON avoids N+1. Soft delete on `deleted_at`. `project_id=NULL` = global for user.

### D2. ID prefixes and addressability
- Character: `char_<nanoid8>` e.g. `char_Abc12xyZ`
- Scene: `scene_<nanoid8>`
- Style: `style_<nanoid8>`
- Variation: parent-prefixed, e.g. `char_Abc12xyZ:var_01`

Rationale: a glance at the token tells you the kind without a lookup; `:` is unambiguous (not valid in nanoid alphabet).

### D3. Backend endpoints
```
GET    /api/assets                    ?kind=character&q=&project_id=&limit=&offset=
POST   /api/assets                    create (kind in body)
GET    /api/assets/{asset_id}
GET    /api/assets/{asset_id}/resolve ?variation=var_01   -> { appearance, reference_images, kind }
PATCH  /api/assets/{asset_id}
DELETE /api/assets/{asset_id}         soft
POST   /api/assets/{asset_id}/variations
PATCH  /api/assets/{asset_id}/variations/{var_id}
DELETE /api/assets/{asset_id}/variations/{var_id}
GET    /api/assets/trash              list soft-deleted within 30 days
POST   /api/assets/{asset_id}/restore
```

Rationale: REST with tiny deviation — `/resolve` is the helper consumed by the pre-execute resolver to avoid two round-trips.

### D4. Frontend store — dedicated `useAssetStore`
New Zustand store `@d:/PythonProject/lang-video-work-flow/src/store/assetStore.ts`:
```ts
interface AssetState {
  characters: Record<string, CharacterAsset>
  scenes:     Record<string, SceneAsset>
  styles:     Record<string, StyleAsset>
  loading:    boolean
  error:      string | null
  // Actions
  fetchAll(): Promise<void>
  create(kind, data): Promise<Asset>
  update(id, patch): Promise<void>
  resolve(assetIdOrToken): ResolvedAsset | null   // cheap; synchronous cache hit
  // ...
}
```
Keep it separate from `flowStore` so asset lifecycle is independent of workflow selection. Bridge to legacy `characterAppearances`: on `fetchAll`, populate `flowStore.characterAppearances` from character assets (one-way, toward legacy, for anchor-prefix compat).

### D5. `@` autocomplete — `useAssetAutocomplete` hook
Not a React-Flow concern. Isolated hook attaches to any textarea / contenteditable:
- Detect `@` at caret; show popover; keyboard nav; on select, replace `@<typed>` with `@<fullAssetId>`.
- Uses `assetStore.search(text, kindHint)` for ranking (recency + substring + tags).
- A shared `PromptInput` React component wraps `textarea` and renders chips row.

Rationale: isolate so `storyboard` script editor, `llmChat` userInput, and future `TimelineNote` all share the same UX.

### D6. Pre-execute resolver in `nodeExecutor`
New module `@d:/PythonProject/lang-video-work-flow/src/providers/assetReferenceResolver.ts`:
```ts
resolvePromptRefs(prompt: string, assetStore, assetRefsExtra: string[] = []): {
  expandedPrompt: string,
  referenceImages: string[],
  characterUrls: string[],
  timestamps: string | null,
  refs: string[],             // resolved asset ids (for analytics)
  unresolved: string[]        // tokens we could not match
}
```
Called by `executeNode` for `videoGen` / `imageGen` BEFORE `sanitizeForExecute`. Output feeds the next module.

### D7. `modelReferenceAdapter` — strategy pattern
New module `@d:/PythonProject/lang-video-work-flow/src/providers/modelReferenceAdapter.ts`:
```ts
interface InjectionPayload {
  referenceImages?: string[]
  characterUrls?: string[]
  timestamps?: string | null
}

type Strategy = (payload: InjectionPayload, model: AiModelResponse) => Record<string, unknown>

const STRATEGIES: Record<string /* match pattern */, Strategy> = {
  // Native reference field
  'doubao-seedance-*': seedanceStrategy,
  // image_mode switch
  'veo3.1*': veoStrategy,
  // Character API
  'sora-*': soraStrategy,
  // Kling first-frame
  'kling-*': klingStrategy,
  // Image capability default
  '*:image': imageDefaultStrategy,
  // Fallback
  '*': firstFrameFallback,
}

injectReferences(modelId: string, model: AiModelResponse, payload: InjectionPayload): Record<string, unknown>
```

Matching by glob on `model_id` + a secondary key `capability`. Each strategy returns only param fields the model's schema declares (consults `model.param_schema`). The caller then merges the returned partial into the submission params, which flow through the existing sanitizer.

Rationale: explicit pattern-match table beats `if/else` sprawl; new models just add a row. Strategies hold no business logic for prompt — only routing reference images and character urls.

### D8. `VideoGenNode` / `ImageGenNode` UX
- Header gains a `useBackendModels` error banner (conditional on `error !== null`).
- Add asset-tag chip row above prompt textarea.
- Replace plain `<textarea>` with shared `<PromptInput>` component (adds `@` autocomplete).
- `handleGenerate` pipeline becomes: `resolvePromptRefs` → `injectReferences` → `sanitizeForExecute` → `backendApi.submitVideo`.

### D9. Agent tools
New tools (schema-driven, exposed in `getAgentTools` from the multi-model-param-adaptation change):
- `list_assets(kind?, query?)` — returns matching assets
- `create_asset(kind, data)` — persists; returns asset id and stored data
- `update_asset(asset_id, patch)` — partial update
- `link_asset_to_node(nodeLabel|nodeId, asset_ids[])` — appends to node.data.assetRefs
- `resolve_prompt_refs(prompt)` — dev/debug helper that returns the resolved prompt + images for a given raw prompt

Extend existing `create_video_node` / `create_image_node` schemas with `assetRefs: string[]` parameter (append to the auto-generated union from `toolSchemaGenerator`).

### D10. Migration for existing workflows
On first open of Asset Library per user, bridging step:
- Read `flowStore.characterAppearances` of the currently loaded workflow (if any).
- If the user has zero library entries AND the registry has entries, show a banner "Import N existing characters to your library?".
- On accept, POST each entry as a character asset with `metadata: { imported_from: "legacy", source_workflow: <id> }`.

No auto-migration; user confirms.

### D11. Seedance as first-class + fix "only Seedance" issue
Two independent fixes:
- **Symptomatic UX fix** (`VideoGenNode` error banner) — already in D8.
- **Root-cause fix**: enrich `useBackendModels` with retry + error state; update the app's initial boot to call `backendApi.listModels()` (all capabilities) once and warm the cache, so node panels mount synchronously with data present.

The symptom "only Seedance visible" is entirely caused by the empty-models fallback branch. After D8+D11 the user sees a clear warning instead of silent reduction.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| `@` autocomplete inside multi-line textarea is tricky (caret position, composition events for IME) | Build on a proven lib pattern (manual popover + `textarea.selectionStart`); test with Chinese IME explicitly |
| Over-engineering variations as JSON | Bounded (<20/char), reads always load parent — acceptable; if we need >20 we migrate to a table |
| Adapter strategies drift as new models arrive | Each strategy lives in one file with a test; adding a new model requires adding one row + one strategy test; CI fails if an untested strategy runs |
| User loses library when switching backend DB | Assets carry `user_id`; if switching environments, a future import/export CLI handles migration; out of scope here |
| Migration banner annoys users with no legacy characters | Only shown if legacy registry is non-empty; dismissible permanently per user |
| Stale chips when asset deleted externally | Chips watch `assetStore` subscription; deletion renders chip in "missing" red state with a "remove from prompt" button |

## Files To Touch (Rationale)

**Backend**
- `server/alembic/versions/0004_add_asset_library.py` — new (D1)
- `server/app/models/character_asset.py` / `scene_asset.py` / `style_asset.py` — ORM (D1)
- `server/app/models/workflow_asset_ref.py` — link table (D1)
- `server/app/schemas/asset.py` — Pydantic (D1)
- `server/app/services/asset_service.py` — CRUD + search + variations (D3)
- `server/app/routers/assets.py` — REST endpoints (D3)
- `server/app/main.py` — register router
- `server/app/db/seed.py` — OPTIONAL: one demo character per kind for new projects

**Frontend — Asset infra**
- `src/store/assetStore.ts` — NEW (D4)
- `src/api/backend.ts` — add `listAssets`, `getAsset`, `createAsset`, `updateAsset`, `deleteAsset`, `resolveAsset`, `listTrash`, `restoreAsset`, `createVariation`, etc.
- `src/providers/assetReferenceResolver.ts` — NEW (D6)
- `src/providers/modelReferenceAdapter.ts` — NEW (D7)
- `src/hooks/useAssetAutocomplete.ts` — NEW (D5)
- `src/components/ui/PromptInput.tsx` — NEW (D5)
- `src/components/ui/AssetChip.tsx` — NEW

**Frontend — Asset panel (LibTV-style)**
- `src/components/sidebar/AssetLibraryPanel.tsx` — NEW
- `src/components/sidebar/AssetCard.tsx` — NEW
- `src/components/sidebar/AssetDetailModal.tsx` — NEW
- `src/components/canvas/MainToolbar.tsx` (or sidebar entry file) — add "Assets" entry + shortcut

**Frontend — node integration**
- `src/components/nodes/VideoGenNode.tsx` — chip row, error banner, PromptInput, pipeline wire-up
- `src/components/nodes/ImageGenNode.tsx` — same pattern
- `src/components/nodes/CharacterGridNode.tsx` — add "Save to library" button bridging existing description→new asset
- `src/hooks/useBackendModels.ts` — expose `retry()` action + schema_version

**Frontend — executor + agent**
- `src/providers/nodeExecutor.ts` — wire `resolvePromptRefs` + `injectReferences` before `sanitizeForExecute`
- `src/providers/executors/generationExecutors.ts` — same, for the direct execute path
- `src/providers/toolDefinitions.ts` — add 5 new tools + extend `create_video_node`/`create_image_node` with `assetRefs`
- `src/providers/toolHandlers.ts` — 5 new handlers
- `src/prompts/skills/index.ts` — new SKILL doc on asset tooling

**Tests**
- `server/tests/test_asset_service.py` — CRUD, variations, soft delete, scope
- `server/tests/test_assets_api.py` — REST endpoints + resolve
- `src/__tests__/assetStore.test.ts`
- `src/__tests__/modelReferenceAdapter.test.ts` — all 4 model strategies
- `src/__tests__/assetReferenceResolver.test.ts` — token expansion, variation, unresolved
- `src/__tests__/useAssetAutocomplete.test.tsx` — @ detection, IME
