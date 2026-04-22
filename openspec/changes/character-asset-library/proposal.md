## Why

**User-visible problem**: Today a "character" is just a `characterGrid` node living in one canvas. To reuse the same protagonist in another project you must re-enter the appearance, regenerate a 3×3 sheet, and manually wire edges to every new `imageGen` / `videoGen`. There is no `@-tag` autocomplete, no centralized library, and no per-video-model injection path — so reference images often reach the model in a shape it does not understand (e.g. passing Seedance's native `reference_images` keys to VEO, or vice-versa).

**Tooling gap**: `flowStore.characterAppearances` is a flat `Record<string, string>`, keyed on Chinese/English name collisions, and lives inside the workflow JSON (lost on project switch). `CharacterManagerNode` (`@d:/PythonProject/lang-video-work-flow/src/components/nodes/CharacterManagerNode.tsx:6-17`) is a canvas-local list with no persistence beyond the project.

**UX gap**: LibTV's Elements panel, `@protagonist` tagging, and cross-project Asset Library are the industry standard for AI-video storyboarding. We need the same to close the consistency gap and shorten the time-to-first-frame.

## What Changes

Introduce a first-class **Asset Library** (characters / scenes / styles) as a backend capability, plus a prompt-time `@assetId` reference system and a per-model injection adapter.

- **Backend**: new tables `character_assets`, `scene_assets`, `style_assets` (global scope, optionally project-scoped); CRUD + search endpoints; asset `variations` (e.g. `sarah_casual` vs `sarah_formal`).
- **Frontend library panel**: new `AssetLibraryPanel` (mimicking LibTV Elements) — three tabs, drag-into-canvas, detail modal.
- **@ reference**: textarea/prompt inputs gain `@` autocomplete; prompt stores `@{assetId}` placeholders; pre-execute resolver expands to full appearance text + injects reference images according to capability.
- **Per-model injection adapter**: new module routing asset reference payload to the correct model-specific fields (Seedance native `reference_images`; VEO `image_mode=reference` or first-frame fallback; Sora Character API via existing `characterExtract`; Kling first-frame fallback).
- **Better model-list UX**: `useBackendModels` surfaces `error` to UI; `VideoGenNode` shows "⚠ backend unreachable" + retry button instead of silently reducing the model dropdown to a single default.
- **Cross-project**: assets persist independently of workflow JSON; moving between projects keeps your character library.

## Capabilities

### New Capabilities
- `asset-library`: backend-persisted characters / scenes / styles with CRUD, search, variations, and reference-image attachments.
- `at-reference-system`: `@assetId` syntax in prompt inputs, autocomplete UI, pre-execute resolver.
- `model-reference-adapter`: routes an asset's reference payload to the correct fields per video-capability model.

### Modified Capabilities
- `video-generation-node`: gains an "asset tag chip" row showing which assets are referenced by the current prompt; uses the reference adapter at submit time.
- `agent-tool-schemas`: adds `create_asset`, `update_asset`, `list_assets`, `link_asset_to_node`, `resolve_prompt_refs`; existing `create_video_node` / `create_image_node` accept an `assetRefs: string[]` parameter handled by the adapter.

## Impact

- DB: three new tables + a `workflow_asset_refs` link table for analytics.
- Frontend: one new side panel, one new modal, minor changes to prompt inputs (existing `textarea`s get a lightweight `@` picker), two node UIs (tag chips).
- Agent: tool list grows by 5; LLM learns to use assets via SKILL docs (Phase 1 of this change).
- Backward compatibility: workflows without `@` refs and models not recognizing specific fields continue to work via the adapter's fallback rules; existing `characterAppearances` registry bridges to asset library via a one-shot migration on load.
- **Non-goals**: no IP-Adapter/FaceID embedding (kept for a later vision-consistency change); no actual cross-user sharing (all assets are per-user/per-tenant local); no editing of past reference images (new `variations` replace).
