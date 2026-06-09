## 0. Hotfixes from /review

- [ ] 0.1 In `@d:\PythonProject\lang-video-work-flow\src\providers\executors\processingExecutors.ts`, replace the line reading `store.nodes.find(n => n.id === downstreamTextNodeId)` with a fresh `useFlowStore.getState().nodes.find(...)` call so we don't use a stale snapshot. **Verify**: `npx vitest run processingExecutors` (no test regressions; existing workflowMigrations + agentGenerationEvaluation tests still green).
- [ ] 0.2 In `@d:\PythonProject\lang-video-work-flow\src\providers\agentTools.ts`, change `handleDiscoverTools` signature to accept a `sessionTools?: typeof AGENT_TOOLS` parameter. When present, iterate that array instead of the static `AGENT_TOOLS`. Update the `case 'discover_tools':` branch in `executeToolCall` to pass through `_sessionTools` (a new internal state slot populated by `chatStore` just before dispatch). **Verify**: `npx vitest run discoverTools` green.
- [ ] 0.3 In `chatStore.ts`, right after `agentTools = getAgentTools(...)`, stash the value on a module-scoped `sessionToolsRef` so `executeToolCall`'s `discover_tools` branch can read it without prop-drilling. **Verify**: manual browser check — call `discover_tools` with a seeded dynamic video model list → schema shows the dynamic enum.

## 1. Multimodal First-Turn

- [ ] 1.1 In `chatStore.processUserMessage`, at the point where `llmMessages` is assembled for round 0, if the user message has `images && images.length > 0`, convert the last user LLMMessage's `content` to a `ContentPart[]` via `buildMultimodalContent`. **Verify**: unit test in `src/__tests__/agentMultimodal.test.ts` asserts the structure.
- [ ] 1.2 In `@d:\PythonProject\lang-video-work-flow\src\store\chatPromptBuilder.ts`, extend `buildAgentSystemPrompt(role, opts?)` to accept `opts.imageCount?: number`. When `imageCount > 0`, append a one-line hint: `本轮用户上传了 N 张图像；可用 create_from_images 建节点或 inject_user_images 绑定到已有节点。` **Verify**: unit test covers both branches.
- [ ] 1.3 Update `chatStore.processUserMessage` to pass the actual `images.length` into `buildAgentSystemPrompt`. **Verify**: `tsc --noEmit`.
- [ ] 1.4 Bump `agentStats` to carry `imageTokensApprox?: number` (`Math.round(imageCount * 258)` per OpenAI-low-detail heuristic). **Verify**: unit test.

## 2. `create_from_images` Tool

- [ ] 2.1 In `toolDefinitions.ts`, insert a new tool `create_from_images` with the schema from `design.md` D-2. Put it in Tier 2. **Verify**: `toolTiers.test.ts` parity check (tier 2 still covers every `create_*_node` + the new tool).
- [ ] 2.2 In `toolTiers.ts`, add `'create_from_images'` to `TIER_2_CREATION`. **Verify**: allTierToolNames test.
- [ ] 2.3 In a new file `@d:\PythonProject\lang-video-work-flow\src\providers\imageClassifier.ts`, export `classifyImageHeuristic(image: string, hintIntent?: string): {kind: 'character'|'scene'|'style'|'edit_input', confidence: number, reason: string}`. Heuristic: if `hintIntent === 'style_lock'` → style; else if image data URL size > 1.5MB → scene (usually higher-res); else character is the default with confidence 0.6. (Pluggable later for real Vision.) **Verify**: unit tests hit every branch.
- [ ] 2.4 In `agentTools.ts`, add `case 'create_from_images'` handler that: resolves images (from args or chat history), applies cap=10, iterates `classifyImageHeuristic`, dispatches per-kind to factory helpers `createCharacterGridFromImage` / `createSceneGridFromImage` / `createStyleLockFromImage` / `createImageEditFromImage` (tiny helpers in `workflowBuilders.ts` that wrap `useFlowStore.addNode`). Return `{createdNodeIds, classifications}` serialised in message. **Verify**: `src/__tests__/createFromImages.test.ts` covers 4 scenarios from spec.

## 3. Round-Robin `inject_user_images`

- [ ] 3.1 In `toolDefinitions.ts`, add `autoDistribute: {type: boolean}` property to `inject_user_images` schema with doc. **Verify**: `tsc --noEmit`.
- [ ] 3.2 In `handleInjectUserImages` (toolHandlers.ts), when `args.autoDistribute === true`, wrap per-target image selection with `selectedImages = [allUserImages[targetIdx % allUserImages.length]]` (pick one image per target in round-robin order). **Verify**: `imageUpload.test.ts` adds a round-robin test case.

## 4. Memory Scope + Relevance

- [ ] 4.1 In `agentMemoryStore.ts`, extend the `Memory` type with `scope: 'session'|'project'|'global'` (default 'session'), `projectId?: string`, `pinned?: boolean`, `lastAccessedAt?: number`. **Verify**: `tsc --noEmit`.
- [ ] 4.2 Update `saveMemory(...)` signature to accept optional `scope` + `pinned` + `projectId` (projectId auto-filled from flowStore when scope='project'). **Verify**: unit test.
- [ ] 4.3 In the zustand `persist` config, add an `onRehydrateStorage` migration that stamps `scope = 'global'` onto any legacy entry missing `scope`. **Verify**: unit test seeds legacy state → reload → assert migration ran.
- [ ] 4.4 Add helper `rankMemories(message: string, memories: Memory[], k=5): Memory[]` that scores by tag overlap with message tokens + recency half-life of 7 days + `pinned` boosts. Pinned entries always included. **Verify**: unit test with fixtures.
- [ ] 4.5 In `buildAgentSystemPrompt`, inject a `## 相关记忆 (top-K)` section after SKILLS using the ranked list, capped at 800 chars with truncation footer. **Verify**: unit test.
- [ ] 4.6 In `chatStore.processUserMessage`, pass current user `message` to `buildAgentSystemPrompt` so ranker has context. **Verify**: `tsc --noEmit`.

## 5. `forget_memory` Tool + Auto-Compact

- [ ] 5.1 Add `forget_memory` schema (Tier 3) to `toolDefinitions.ts`. **Verify**: parity test.
- [ ] 5.2 Add `TIER_3_ADVANCED` entry for `forget_memory` in `toolTiers.ts`. **Verify**: parity.
- [ ] 5.3 Add `case 'forget_memory'` in `agentTools.ts` dispatching to `handleForgetMemory` in `toolHandlers.ts`. Requires ≥1 filter param; else returns `success:false`. **Verify**: spec scenarios in `forgetMemory.test.ts`.
- [ ] 5.4 In `agentMemoryStore.saveMemory`, after push, if session-scoped count > 20, collapse oldest 10 into a rollup entry titled `会话上下文摘要 (10 条)` (body joined + capped 600 chars). **Verify**: unit test.

## 6. Phase State Machine

- [ ] 6.1 In `agentMemoryStore.ts`, add `currentPhase` + `phaseHistory` + `setPhase` action. Persist both via `partialize`. **Verify**: unit test.
- [ ] 6.2 Add `set_phase` tool schema (Tier 1) to `toolDefinitions.ts`. **Verify**: parity + tier1 test.
- [ ] 6.3 Add `'set_phase'` to `TIER_1_CORE`. **Verify**: parity.
- [ ] 6.4 Add `case 'set_phase'` handler — validate enum, call `setPhase`, return confirmation. **Verify**: spec scenarios in `setPhase.test.ts`.
- [ ] 6.5 Extend `getAgentTools` options with `phase?: PhaseId`. When phase is `idle`, no-op; else apply whitelist + denylist per D-4 table. **Verify**: 4 new test cases in `toolTiers.test.ts` (planning / designing / building / reviewing).
- [ ] 6.6 In `chatStore.processUserMessage`, read `currentPhase` from `agentMemoryStore` and pass it into `getAgentTools`. **Verify**: browser check — phase=`planning` → `create_video_node` absent.

## 7. `review_generated_image` Tool

- [ ] 7.1 Create `@d:\PythonProject\lang-video-work-flow\src\providers\reviewAdapter.ts` exporting `reviewImage(node): Observation` that computes `promptTokenCount`, `referencedAssets[]`, a handful of static `observations[]`, and leaves `visionScore: null`. Export a stub hook `_reviewAdapter` so future code can swap in real Vision. **Verify**: unit tests.
- [ ] 7.2 Add `review_generated_image` schema (Tier 2) to `toolDefinitions.ts`. **Verify**: parity.
- [ ] 7.3 Add `'review_generated_image'` to `TIER_2_CREATION` (creation-adjacent? better: add to both Tier 2 and the phase whitelist for 'reviewing'). Final call: add to `TIER_2_CREATION` because most users run it during the build loop. **Verify**: parity.
- [ ] 7.4 Add `case 'review_generated_image'` handler in `agentTools.ts` → call `reviewAdapter.reviewImage` → return `{ success, message: JSON }`. **Verify**: spec scenarios.

## 8. Tests + Regression

- [ ] 8.1 New test files: `agentMultimodal.test.ts`, `createFromImages.test.ts`, `memoryScope.test.ts`, `memoryRanker.test.ts`, `setPhase.test.ts`, `phaseAwareTools.test.ts`, `reviewGeneratedImage.test.ts`, `forgetMemory.test.ts`. Each ≥ 3 scenarios matching the spec.
- [ ] 8.2 Update `toolTiers.test.ts`: +4 scenarios for the new phase filter and +1 for Tier 2 containing `create_from_images` + `review_generated_image` and Tier 3 containing `forget_memory`.
- [ ] 8.3 Update `nodeAgentToolUtilization.test.ts`: expect ≥ 44 tools now (41 + 3 new).
- [ ] 8.4 Update `agentGenerationEvaluation.test.ts` thresholds stay at Grade A; no regression expected (new tools are additive, existing scenarios untouched).

## 9. Final Verification

- [ ] 9.1 `npx tsc --noEmit -p .` exit 0.
- [ ] 9.2 `npx vitest run` — all previous 356 tests pass + new tests (expected ≥ 400 total).
- [ ] 9.3 `openspec validate agent-pro-upgrade --strict` — is valid.
- [ ] 9.4 Browser smoke: upload 3 images + send "帮我按这些图造一个漫剧" → Agent calls `create_from_images` → 3 nodes appear on canvas with images attached.
- [ ] 9.5 Browser smoke: call `set_phase({phase:'planning'})` then try creating a video → Agent either declines or escapes via `discover_tools`.
- [ ] 9.6 Browser smoke: telemetry shows `imageTokensApprox` in agentStats when images uploaded.
- [ ] 9.7 Token budget regression: `getAgentTools({phase:'planning'})` returns ≤ 12 tools (~1800 tok).
