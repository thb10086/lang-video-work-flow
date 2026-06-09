## Why

**User-visible problem**: The canvas is "visually LibTV but functionally half-wired". Hitting 生成 on an AudioNode silently does nothing. Agent-created Image Edit nodes show an empty textarea because Agent writes `editInstruction` while the UI reads `editPrompt`. An `imageCrop` node exists in the runtime but is unreachable from Node Panel, Quick Menu, Slash Menu, Agent tools, **and** the existing `pipeline.test.ts` actively asserts it should not appear — yet `toolScenario.ts:31` still advertises it as part of `comic_drama`. Agent cannot create `characterExtract` / `characterManager`, the two nodes that implement LibTV-style character consistency.

**Why now**: The @角色名 / character-in edge flow we just landed makes the story "pick from CharacterManager → auto-flow URL to VideoGen" real — but Agent-driven workflows never construct that graph, and a user who clicks "生成" on the audio step gives up.

## What Changes

- **BREAKING**: Rename `imageEdit.editPrompt` → `imageEdit.editInstruction` across UI, defaults, tests (single source of truth; Agent was already correct).
- **BREAKING**: Remove the orphaned `imageCrop` node (component + port registry + canvas type + minimap color + scenario doc reference). Character workflows now rely on the `characterExtract` + `characterManager` path, which is the real LibTV pattern.
- Fix `AudioNode` SubmitButton to dispatch `executeNode(id)` (all other nodes already do this).
- Add **two** missing Agent tools: `create_character_extract_node`, `create_character_manager_node`.
- Update `workflowBuilders.buildComicDrama` + `buildShortDrama` to include a `characterManager` registry node wired via `character-in`, so generated workflows actually use the consistency mechanism we built.
- Clean `toolScenario.ts:31` to reflect the actual comic_drama pipeline (characterGrid → characterManager → keyframe direct refs).
- Add Agent SKILL docs for the two new tools so the LLM knows when to create them.

## Capabilities

### New Capabilities
(none — all behaviour changes are extensions of existing capabilities)

### Modified Capabilities
- `video-generation-node`: no requirement change to video-gen itself, but the dispatcher contract (`onClick` → `executeNode`) needs to hold for **every** node with a SubmitButton.
- `agent-tool-schemas`: gains `create_character_extract_node`, `create_character_manager_node`; `create_image_edit_node` rename of its field; removal of any `imageCrop` references.
- `workflow-generation`: comic_drama + short_drama builders now emit a `characterManager` node by default, with a single edge `characterGrid → characterManager (character-in)` per character.

## Impact

- Deleted files: `src/components/nodes/ImageCropNode.tsx`, its port registry entry, canvas type map entry, minimap switch case.
- Modified: `AudioNode.tsx` (wire SubmitButton), `ImageEditNode.tsx` + `nodeDefinitions.ts` + executor fallback path (rename `editPrompt`→`editInstruction`), `agentTools.ts` + `toolDefinitions.ts` (add 2 tools, remove Audio model hardcoded enum), `workflowBuilders.ts` (comic_drama + short_drama include manager node), `toolScenario.ts` (doc fix).
- Tests: update `pipeline.test.ts` assertion (still no `imageCrop`, but also add positive assertion that comic_drama emits exactly one `characterManager`); add `executeNode.test.ts` case for `audioNode` SubmitButton dispatch; add `agentTools.test.ts` cases for the two new tools.
- **Non-goals**: no new model integrations; no TTS adapter implementation (audio node stays "pending" — separate concern); no IP-Adapter / FaceID; no cross-project asset sharing (covered by `character-asset-library` change).
- Backward compatibility: existing workflows with `imageEdit.editPrompt` read through an executor fallback for one release, then the fallback is removed in a follow-up change.
