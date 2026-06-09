## 1. Builder Wiring Fixes (Critical Bugs)

- [x] 1.1 Read `@d:\PythonProject\lang-video-work-flow\src\providers\workflowBuilders.ts` to locate `addScenes` and all 6 builders; read `@d:\PythonProject\lang-video-work-flow\src\types\portRegistry.ts` to confirm `imageGen` exposes `scene-in` (or fallback `ref-in`) and `textNode` has NO `text-in`. **Verify**: grep shows the exact line numbers.
- [x] 1.2 In `workflowBuilders.ts`, add helper `linkScenesToImages(wb, sceneIds, imgIds)` that wires every scene to every imageGen. Use `scene-in` when the imageGen port registry has it; otherwise fallback to `ref-in`. **Verify**: `tsc --noEmit`.
- [x] 1.3 Call `linkScenesToImages(...)` inside `buildShortDrama` right after `addScenes(...)`. **Verify**: new `agentGenerationEvaluation` short_drama test shows 0 isolated sceneGrid.
- [x] 1.4 Call `linkScenesToImages(...)` inside `buildStoreTour` right after `addScenes(...)`. **Verify**: store_tour D3 dimension hits 10.
- [x] 1.5 In `buildMusicVideo`, after `addCharacters(...)`, insert a `characterManager` node and wire every grid → manager via `grid-out → character-in`, mirroring the pattern in `buildShortDrama` / `buildComicDrama`. **Verify**: D6 score = 10 for music_video.
- [x] 1.6 In `buildMusicVideo`, wire storyboard: create a sibling textNode seeded with `args.description`, connect `textNode.text-out → storyboard.script-in`. **Verify**: D3 shows no isolated storyboard.
- [x] 1.7 In `buildTutorial`, remove the `wb.connect(llmId, textId, 'text-out', 'text-in')` line; after creating the llm + text nodes, synchronously set `textNode.data.content` from the description so the flow works without the illegal edge. **Verify**: D2 port contract = 10/10 for tutorial.
- [x] 1.8 Update `@d:\PythonProject\lang-video-work-flow\src\__tests__\workflowQuality.test.ts` node count assertion for short_drama if the scene wiring changes node count (it should not, only edges). **Verify**: `npx vitest run workflowQuality`.

## 2. Agent Tool Tiering (New Capability)

- [x] 2.1 Create `@d:\PythonProject\lang-video-work-flow\src\providers\toolTiers.ts` with three exported arrays: `TIER_1_CORE` (8 names), `TIER_2_CREATION` (14 names + regex), `TIER_3_ADVANCED` (18 names). **Verify**: unit test counts each tier.
- [x] 2.2 In `toolTiers.ts`, export `selectTier(message: string, ctx?: { canvasEmpty?: boolean }): TierId[]` with the heuristic table from `design.md`. **Verify**: 4 scenarios (creation / navigation / asset / default) produce the expected tier arrays.
- [x] 2.3 In `@d:\PythonProject\lang-video-work-flow\src\providers\toolDefinitions.ts`, extend `getAgentTools` signature to accept an options object `{ videoModels?, imageModels?, audioModels?, tier?: TierId[], includeAll?: boolean, context?: {...} }`. Filter the returned `AGENT_TOOLS` by the resolved tier names plus always-present `discover_tools`. Preserve the existing replacement logic for `create_{video,image,audio}_node`. **Verify**: `tsc --noEmit`.
- [x] 2.4 Add new tool schema `discover_tools` to `AGENT_TOOLS` in `toolDefinitions.ts` with the spec from `design.md`. **Verify**: agentNodeParity test still passes (no new node type implied).
- [x] 2.5 Add `handleDiscoverTools` branch inside `agentTools.ts` switch: return a filtered summary of the 40-tool list filtered by optional `query` substring and `tier` number. **Verify**: `tsc --noEmit`.
- [x] 2.6 Add dev-only `console.info` telemetry at the end of `getAgentTools`: `[agent-tools] tier=… tools=N ~Xtok`. Guard with `import.meta.env.DEV`. **Verify**: run `npm run dev` and click an Agent message → see the log.
- [x] 2.7 Find every call site of `getAgentTools(...)`; keep the old positional signature working via a thin adapter (e.g. accept `(videoModels, imageModels, audioModels)` OR the new options object). **Verify**: `tsc --noEmit`; no callers break.

## 3. Utilization + Parameter-Effectiveness Tests

- [x] 3.1 Create `src/__tests__/nodeAgentToolUtilization.test.ts`:
  - For each name in `AGENT_TOOLS`, assert the executor switch in `agentTools.ts` handles it (read source via `fs`, regex `case '<name>'` or delegate import).
  - For each NODE_REGISTRY type, assert it appears at least once as an argument to `store.addNode('<type>', ...)` across `src/providers/**` or `src/__tests__/**`.
  **Verify**: `npx vitest run nodeAgentToolUtilization` green.
- [x] 3.2 Create `src/__tests__/agentParamEffective.test.ts`:
  - For each `create_*_node` tool, build a non-default `args` from its schema `properties` (string → 'X', enum → first value, number → 42, boolean → true).
  - Execute via `executeToolCall`, assert `useFlowStore.getState().nodes[last].data[key]` matches the passed value.
  **Verify**: `npx vitest run agentParamEffective` green.
- [x] 3.3 Add Tier tests to `src/__tests__/toolTiers.test.ts` covering the 4 heuristic scenarios + parity check that Tier 2 covers NODE_REGISTRY. **Verify**: green.
- [x] 3.4 Update `src/__tests__/agentGenerationEvaluation.test.ts`: bump every scenario threshold from 80 to 90, and overall avg from 85 to 96. **Verify**: green after Section 1 fixes land.

## 4. Agent Tool Utilization Review (Read-only Audit)

- [x] 4.1 Grep-based review of `AGENT_TOOLS`: for each tool name, list its referencing files (handlers, tests, prompts/skills, UI). Produce a `progress.txt` section "Tool Utilization Audit" summarizing dead/live status. **Verify**: every tool has ≥1 non-test reference.
- [x] 4.2 If any tool is dead (no references outside its own definition), flag in the audit and recommend removal for a follow-up change. Do NOT remove in this change. **Verify**: audit file exists.

## 5. Final Verification

- [x] 5.1 `npx vitest run`. **Verify**: 310+N tests pass (where N = new tests from Sections 2-3).
- [x] 5.2 `npx tsc --noEmit -p .`. **Verify**: exit 0.
- [x] 5.3 `openspec validate workflow-builder-wiring-fixes`. **Verify**: prints "is valid".
- [x] 5.4 Browser smoke test: in live dev, trigger a music_video generation via Agent → confirm `角色管理器` node present + storyboard has upstream input. **Verify**: visible in the canvas.
- [x] 5.5 Token budget sanity: in dev console, log shows Tier 1+2 ≤ 4500 tokens; `includeAll:true` ≈ 10000 tokens. **Verify**: screenshots in `progress.txt`.
