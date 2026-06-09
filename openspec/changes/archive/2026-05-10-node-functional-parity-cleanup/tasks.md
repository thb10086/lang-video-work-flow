## 1. AudioNode SubmitButton Wiring (Critical Fix)

- [x] 1.1 Replace the empty `onClick={() => {}}` in `src/components/nodes/AudioNode.tsx` with `onClick={handleGenerate}`; implement `handleGenerate` that dispatches `executeNode(id)`. **Verify**: tsc clean, unit test passes.
- [x] 1.2 `executeNode` tests cover audioNode path — existing tests in `src/__tests__/executeNode.test.ts` already exercise the dispatcher case for `audioNode` (status transitions to `pending`). **Verify**: `npx vitest run executeNode` green.
- [x] 1.3 Grep-based guard in `src/__tests__/nodeComponentContract.test.ts` asserting no `*Node.tsx` contains the `"wired via runtime engine"` placeholder. **Verify**: `npx vitest run nodeComponentContract` green.

## 2. imageEdit Field Rename (BREAKING)

- [x] 2.1 `src/components/nodes/ImageEditNode.tsx`: rename every `editPrompt` reference to `editInstruction` (5 occurrences). **Verify**: `tsc --noEmit` clean.
- [x] 2.2 `src/data/nodeDefinitions.ts`: change `editPrompt: ''` to `editInstruction: ''` in the imageEdit default data. **Verify**: `tsc --noEmit`.
- [x] 2.3 `src/providers/executors/processingExecutors.ts`: reorder fallback to `node.data.editInstruction || node.data.editPrompt`. Added TODO for removal. **Verify**: `tsc --noEmit`; existing executor test still passes.
- [x] 2.4 `src/providers/toolDefinitions.ts`: confirmed `editInstruction` already correct (no edit needed).
- [ ] 2.5 Unit test `__tests__/imageEdit.fieldConsistency.test.ts` — **deferred**. Browser smoke test covered this via `create_image_edit_node({editInstruction:"X"})` producing a node whose `data.editInstruction === "X"` and `editPrompt === undefined`. Follow-up task to add a formal render-level test with `@testing-library/react`.

## 3. Delete imageCrop (Legacy Removal)

- [x] 3.1 Deleted `src/components/nodes/ImageCropNode.tsx`.
- [x] 3.2 `src/components/canvas/WorkflowCanvas.tsx`: removed import, `nodeTypes` map entry, and minimap switch case. **Verify**: `tsc --noEmit`.
- [x] 3.3 `src/types/portRegistry.ts`: removed the `imageCrop` key. **Verify**: `tsc --noEmit`.
- [x] 3.4 `src/providers/toolScenario.ts`: updated `comic_drama` pipeline description from imageCrop-based to characterManager-based. **Verify**: grep for `imageCrop` in `src/**/*.ts*` → only shows the migration's `REMOVED_NODE_TYPES` set entry + test assertions.
- [x] 3.5 Added startup migration in `src/store/workflowMigrations.ts` (`dropRemovedNodeTypes`) and called from `src/App.tsx` useEffect. Silent no-op for clean workflows; logs dropped count when imageCrop nodes are found. **Verify**: `npx vitest run workflowMigrations` green (3 tests).
- [x] 3.6 `src/__tests__/pipeline.test.ts`: existing "no imageCrop" assertion preserved.

## 4. Agent Tool Parity — CharacterExtract + CharacterManager

- [x] 4.1 `src/providers/toolDefinitions.ts`: added `create_character_extract_node` and `create_character_manager_node` tool definitions. **Verify**: `tsc --noEmit`; `AGENT_TOOLS.length` grew by 2.
- [x] 4.2 `src/providers/agentTools.ts`: added two executor switch cases invoking `store.addNode` with appropriate defaults. **Verify**: `tsc --noEmit`.
- [x] 4.3 Created parity test `src/__tests__/agentNodeParity.test.ts` with an explicit NODE_REGISTRY → AGENT_TOOL name map. **Verify**: all 14 node types pass parity check.
- [x] 4.4 Added 3 behavior tests in `src/__tests__/agentTools.test.ts` covering the two new tools + short_drama/comic_drama workflow emitting characterManager. **Verify**: `npx vitest run agentTools` green.
- [ ] 4.5 SKILL doc update in `src/prompts/skills/index.ts` — **deferred**. Agent discovers the new tools via schema already; explicit SKILL doc can be added in the next Agent-tuning change.

## 5. Agent Tool Parity — Dynamic Audio Schema (DEFERRED)

This entire task group is deferred to a follow-up change `dynamic-audio-tool-schema` because the real blocker for audio workflows is the missing TTS adapter (tracked separately as `audio-generation-adapter`). Touching the schema surface without a working backend is premature optimisation.

- [ ] 5.1 `src/providers/toolSchemaGenerator.ts`: add `buildCreateAudioNodeTool` helper. **Target**: next change `dynamic-audio-tool-schema`.
- [ ] 5.2 `src/providers/toolDefinitions.ts`: consume `audioModels` in `getAgentTools`. **Target**: next change.
- [ ] 5.3 Test in `src/__tests__/toolSchemaGenerator.test.ts`. **Target**: next change.

## 6. Workflow Builders — Emit CharacterManager

- [x] 6.1 `src/providers/workflowBuilders.ts` `buildComicDrama`: inserts a `characterManager` node and `grid-out → character-in` edge per character. **Verify**: `tsc --noEmit`.
- [x] 6.2 Same in `buildShortDrama`. **Verify**: `tsc --noEmit`.
- [x] 6.3 Updated `wb.summary` messages in both builders to mention "角色库". **Verify**: string grep confirms.
- [x] 6.4 Extended `src/__tests__/agentTools.test.ts` with short_drama + comic_drama assertions (1 manager, N character-in edges). Updated `src/__tests__/workflowQuality.test.ts` expected node count 13 → 14. **Verify**: `npx vitest run` green.

## 7. Final Verification

- [x] 7.1 Full test suite: **303/303 tests pass** (up from 278, +25 new tests).
- [x] 7.2 `npx tsc --noEmit -p .` clean (exit 0).
- [x] 7.3 Browser smoke test in live Vite dev: all 6 fixes verified (AudioNode wiring, imageEdit field, imageCrop migration removing 1 node + 2 edges, new Agent tools work, short_drama emits 1 manager + 2 character-in edges).
- [x] 7.4 Follow-up changes identified below.

## Follow-up Changes Created as Separate openspec Proposals

- `audio-generation-adapter` — wire a real TTS backend so audioNode produces actual audio. Currently executor returns `pending` with informational message.
- `remove-edit-prompt-fallback` — drop the `editPrompt` legacy alias from `processingExecutors.ts` after one release cycle.
- `dynamic-audio-tool-schema` — make `create_audio_node` model enum derive from backend list (deferred from Task 5 above).
- `skill-doc-character-tools` — document `create_character_extract_node` / `create_character_manager_node` usage patterns in SKILL docs.
