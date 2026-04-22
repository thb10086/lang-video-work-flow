## Why

Each AI model supports a **different parameter set** (Seedance 2.0 has `generate_audio`/`camera_fixed`/`return_last_frame`/`resolution`/`size` with 7 aspect ratios; VEO uses `aspect_ratio` with 3 ratios; Sora has its own; Kling uses `mode`). Today these are conflated in three places:

1. **Frontend node `videoGen`** (`@d:/PythonProject/lang-video-work-flow/src/components/nodes/VideoGenNode.tsx`) renders a `DynamicParams` component but the driving `param_schema` coming from `ai_models` table is under-populated and not strictly partitioned per model.
2. **Agent tool** `create_video_node` (`@d:/PythonProject/lang-video-work-flow/src/providers/toolDefinitions.ts:77-107`) flattens all models' params into a single schema with "Seedance 专用" markers in descriptions — the LLM has no reliable way to pick correct params for the chosen model.
3. **Backend `generate/video` adapters** accept loose `params` dicts with minimal per-model validation, so wrong fields silently degrade or error out at provider.

**User-visible pain**: switching model in a node does not restructure the visible fields; Agent created videos frequently fail or ignore requested features (audio, last-frame) because params never reached the model-specific adapter correctly.

## What Changes

Introduce a **Model Param Registry** (backend DB + typed frontend catalog) as the single source of truth for "what params each model accepts", and make both the node UI and the Agent tool schemas query it at runtime.

- Backend: populate `ai_models.param_schema` for every video/image/audio model with per-model ParamField[] + declarative constraint metadata (enum, min/max, required, depends_on).
- Frontend: `useBackendModels` hook exposes per-model schema; `VideoGenNode`/`ImageGenNode`/`AudioNode` re-render controls when model changes and strip/migrate stale fields.
- Agent tools: `create_video_node` / `create_image_node` / `create_audio_node` schemas generated per model capability; introduce `get_model_params(model_id)` helper tool so LLM can inspect schema on demand.
- Validation: backend adapter validates incoming params against the model's schema and returns structured 4xx on violation.

## Capabilities

### New Capabilities
- `model-param-registry`: authoritative per-model parameter schema used by UI and Agent tooling with validation.

### Modified Capabilities
- `video-generation-node`: now adapts visible controls to selected model's schema and drops unsupported params on model switch.
- `agent-tool-schemas`: `create_video_node`/`create_image_node`/`create_audio_node` become model-aware via runtime schema lookup.

## Impact

- DB: one-time data migration to populate `param_schema` for existing rows.
- Frontend: saved workflows with legacy `data.duration` etc. must be migrated when loaded (non-breaking: unknown params ignored).
- Agent: tool schemas change → retrain prompt rules; verify regression with existing workflow templates.
- Non-goals: no change to character consistency, no new node types, no pricing/routing changes.
