## Context

**Existing infrastructure (keep as-is)**
- DB table `ai_models` already has `param_schema JSON` column and is seeded per model in `@d:/PythonProject/lang-video-work-flow/server/app/db/seed.py:70-315` with correct per-model fields (Seedance has 7-ratio size, VEO has 3-ratio aspect_ratio, Kling has mode/negative_prompt, etc.).
- Redis cache + `ModelService.list_models` already working (`@d:/PythonProject/lang-video-work-flow/server/app/services/model_service.py`).
- `useBackendModels` hook and typed `ParamField` (`@d:/PythonProject/lang-video-work-flow/src/providers/types.ts:32-44`) are the frontend contract.
- `VideoGenNode` is already schema-driven: dynamic controls, model-switch default injection, and schema-filtered payload on execute (`@d:/PythonProject/lang-video-work-flow/src/components/nodes/VideoGenNode.tsx:224-309`).

**Gaps identified**
1. **Agent tool schemas flat** — `create_video_node` / `create_image_node` / `create_audio_node` in `@d:/PythonProject/lang-video-work-flow/src/providers/toolDefinitions.ts:55-167` hardcode all params with "XX 专用" markers in descriptions; the LLM has no reliable way to pick legal fields per model.
2. **No backend validation at adapter boundary** — `video_service.submit` / `image_service.generate` pass `params` dict through without schema validation.
3. **No `schema_version`** on `ai_models` — forcing manual cache purge.
4. **Stale param cleanup incomplete** — `VideoGenNode.handleModelChange` applies new defaults but does NOT remove leftover fields from previous model. `VideoGenNode.handleGenerate` filters at send time, so runtime works, but `node.data` keeps dead fields bloating storage.
5. **ImageGenNode / AudioNode not yet fully schema-driven** — need audit after `VideoGenNode` pattern is canonicalized.
6. **`get_model_params` tool missing** — Agent cannot inspect niche model schemas on demand.
7. **Workflow templates** (`@d:/PythonProject/lang-video-work-flow/src/prompts/workflowTemplates.ts`) still emit hardcoded `duration`/`aspect_ratio` etc. at template authoring time.

## Goals / Non-Goals

**Goals:**
- Single source of truth: DB param_schema drives UI + Agent tools + backend validation.
- Per-model tool schemas generated at runtime, not hardcoded.
- Validation at adapter boundary rejects illegal params with 422 + structured error.
- Zero manual cache work after schema edits.

**Non-Goals:**
- Not introducing model auto-selection logic.
- Not changing node port / connection system.
- Not touching character consistency or @-reference (tracked as separate change).
- Not a full UI redesign — preserve current look and keybindings.

## Decisions

### D1. Schema version field on `ai_models`
Add `schema_version: int` (default 1). Bumps on each `param_schema` write. `list_models` API response includes it; frontend passes it on model fetch so stale browser tab gets server-push invalidation via WebSocket (optional phase 2).

Rationale: zero-downtime schema upgrades. Cheap to implement, high ROI.

### D2. Adapter-layer param validator
New module `server/app/services/param_validator.py` exposes `validate_params(model_id, params) -> (clean_params, errors)`. Called by `video_service.submit`, `image_service.generate`, and audio service when it lands. Returns HTTP 422 on errors.

Data shape:
```python
def validate_params(schema: list[ParamField], params: dict) -> tuple[dict, list[dict]]:
    """Returns (clean_params dropping unknown keys, list of violations)"""
```

Rationale: one validator, consumed in three services, prevents bug scatter.

### D3. Agent tool schema generator (frontend)
New module `@d:/PythonProject/lang-video-work-flow/src/providers/toolSchemaGenerator.ts` exports:
```ts
buildCreateVideoNodeTool(models: AiModelResponse[]): FunctionTool
buildCreateImageNodeTool(models: AiModelResponse[]): FunctionTool
buildCreateAudioNodeTool(models: AiModelResponse[]): FunctionTool
```
Generation strategy: present **union of all currently-registered models' params** with `model: enum` as the discriminator; each field's `description` includes `"Only for: [<model_ids>]"` annotation. This gives LLM a clear mapping without requiring it to call `get_model_params` every turn.

Fallback: `get_model_params(model_id)` tool returns canonical JSON for out-of-band inspection.

Rationale: static-union + discriminator is simpler than true JSON Schema `oneOf`, widely supported, and LLM-friendly. We preserve existing Chinese descriptions; the tool description itself notes the union pattern.

### D4. Node data sanitizer (frontend)
New module `@d:/PythonProject/lang-video-work-flow/src/providers/paramSanitizer.ts`:
```ts
sanitizeNodeParams(
  nodeType: 'videoGen' | 'imageGen' | 'audioNode',
  modelId: string,
  currentData: Record<string, unknown>,
  schemas: ParamField[]
): { clean: Record<string, unknown>; removed: string[] }
```
Used by: `handleModelChange` (cleanup stale + apply new defaults), `handleGenerate` (payload filter), and Agent handler for `update_node` / `execute_node` on video/image/audio nodes.

### D5. Workflow templates become model-capability references
Templates in `src/prompts/workflowTemplates.ts` will store `model: '@default:video'` placeholder instead of concrete model id. Template instantiator resolves placeholder from `modelDefaults.ts` and applies that model's default params from the backend schema.

### D6. Backward compatibility
- **Saved workflows**: unknown params are tolerated in node data (ignored by UI + filtered by executor). On next save after model switch, stale fields are removed by sanitizer.
- **Seed script already correct** — no migration needed beyond adding `schema_version`.
- **Agent prompt templates** in `chatPromptBuilder.ts` — update references to "Seedance 专用" markers that now live inside tool descriptions only.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Tool schema union may confuse LLM on param applicability | Add explicit `description: "[仅适用于 doubao-seedance-*]"` suffix per param; maintain plan_task discipline in agent prompt |
| `schema_version` bumps trigger cache floods | Redis TTL 1h + scan-based invalidation already safe; bump is rare |
| Backend 422 breaks existing client libs that swallow errors | Keep response body compatible with existing error format `{ error, message }`; add extra `field` key for violations |
| Audio node schemas currently `[]` in seed — validation would be a no-op | Acceptable; will be filled when audio feature lands |
| Frontend `useBackendModels` cache is process-level, not per-tab | Existing, unchanged; acceptable trade-off for simplicity |

## Files To Touch (Rationale)

**Backend**
- `server/alembic/versions/0003_add_schema_version_to_ai_models.py` — new migration (D1)
- `server/app/models/ai_model.py` — add `schema_version` column (D1)
- `server/app/schemas/ai_model.py` — expose field in Pydantic schemas (D1)
- `server/app/services/model_service.py` — bump version on update; include in list response (D1)
- `server/app/services/param_validator.py` — NEW (D2)
- `server/app/services/video_service.py` — wire validator, return 422 (D2)
- `server/app/services/image_service.py` — wire validator, return 422 (D2)
- `server/app/db/seed.py` — set `schema_version=1` for all rows (D1)

**Frontend**
- `src/providers/paramSanitizer.ts` — NEW (D4)
- `src/providers/toolSchemaGenerator.ts` — NEW (D3)
- `src/providers/toolDefinitions.ts` — remove hardcoded `create_video_node` / `create_image_node` / `create_audio_node`; call generator at module init with cached backend models (D3)
- `src/providers/agentTools.ts` — add `get_model_params` tool handler (D3)
- `src/components/nodes/VideoGenNode.tsx` — call sanitizer in `handleModelChange`, `handleGenerate` (D4)
- `src/components/nodes/ImageGenNode.tsx` — audit + align with sanitizer (D4)
- `src/components/nodes/AudioNode.tsx` — audit + align with sanitizer (D4)
- `src/prompts/workflowTemplates.ts` — remove hardcoded model params; use `@default:video` placeholder (D5)
- `src/prompts/chatPromptBuilder.ts` — prune "Seedance 专用" markers migrated into tool descriptions (D3)
- `src/hooks/useBackendModels.ts` — expose `schema_version` usable by consumers (D1)

**Tests (add alongside)**
- `server/tests/services/test_param_validator.py` — unknown field, out-of-range, required-missing
- `src/providers/__tests__/paramSanitizer.test.ts` — stale cleanup, default application, unknown model fallback
- `src/providers/__tests__/toolSchemaGenerator.test.ts` — union schema, discriminator, description annotation
