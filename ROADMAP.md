# Roadmap

> Status of every OpenSpec change. The convention is `proposal → design →
> tasks → implement → verify → archive`. A change stays in
> `openspec/changes/` until its delta specs are merged into
> `openspec/specs/`. Then it moves to `openspec/changes/archive/<date>-<id>/`.

---

## Status Legend

| Badge | Meaning | Action needed |
|-------|---------|---------------|
| 🟢 **shipped, ready-to-archive** | Tasks done, tests green, behaviour live in `main`. Pending the formal archive step. | Run `/opsx-archive`. |
| 🟡 **shipping** | Implementation in progress; tasks partially checked. | Keep working through `tasks.md`. |
| 🔵 **designed** | `proposal.md` + `design.md` complete; implementation not started. | Decide priority vs. competing work. |
| ✅ **archived** | Delta specs merged into `openspec/specs/`. Lives under `changes/archive/`. | None — historical reference. |

---

## Archived (Done · Lives in `openspec/changes/archive/`)

### ✅ `2026-05-09-agent-pro-upgrade`

Five capability gaps closed: Agent multimodal first-turn awareness,
`create_from_images` arbitrary-count image-to-node spawning, `inject_user_images`
round-robin auto-distribute, three-scope memory (`session` / `project` /
`global`) with auto-summarisation past 20 entries, top-K relevance
injection per turn, explicit phase state with `set_phase` and phase-gated
tool reveal, `review_generated_image` Tier-2 stub for future Vision hook.

Delta specs synced into `openspec/specs/` 2026-05-09:
`agent-memory-management` · `agent-multimodal-input` · `agent-phase-state`.

Evidence:
`@d:\PythonProject\lang-video-work-flow\openspec\changes\archive\2026-05-09-agent-pro-upgrade\design.md`.

### ✅ `2026-05-09-multi-model-param-adaptation`

Backend `ai_models.param_schema` becomes the single source of "what params
each model accepts". Frontend node UI + Agent tool schemas read from it
at runtime; `schema_version` invalidates frontend cache; new
`get_model_params(model_id)` Agent tool for niche-model introspection.
Backend adapters validate at boundary, returning structured HTTP 422
on violations.

Delta specs synced into `openspec/specs/` 2026-05-09:
`model-param-registry` · `agent-tool-schemas` · `video-generation-node`.

Evidence: `paramSanitizer.test.ts`, `modelReferenceAdapter.test.ts`,
`modelReferenceAdapter.integration.test.ts`, `toolSchemaGenerator.test.ts`.

### ✅ `2026-04-24-agent-anthropic-alignment`

Closed 4 quantifiable gaps vs. Anthropic Agent best practices: zero-coverage
eval harness → declarative scenario DSL with regression gate; string-match
verify → semantic vision verify with adapter registry; monolithic system
prompt → 4-layer segments with cache breakpoints; unbounded tool responses
→ unified `withResponseBudget` helper. Spawned the original four specs in
`openspec/specs/`.

Evidence:
`@d:\PythonProject\lang-video-work-flow\openspec\changes\archive\2026-04-24-agent-anthropic-alignment\design.md`
(D1–D4 with rationale + alternatives considered).

---

### ✅ `2026-05-10-character-asset-library`

First-class Asset Library (characters / scenes / styles) with cross-project
persistence, `@assetId` autocomplete in prompts, and a per-video-model
reference adapter (Seedance native multi-ref, VEO `image_mode=reference`,
Sora Character API, Kling first-frame fallback). LibTV-style side panel.

Delta specs synced into `openspec/specs/` 2026-05-10:
`asset-library` · `at-reference-system` · `libtv-asset-panel` ·
`model-reference-adapter` · `video-generation-node` (appended 2 reqs:
Asset Tag Chip Row + Backend Unreachable UX).

Evidence: `assetStore.test.ts`, `agentAssetTools.test.ts`,
`assetReferenceResolver.test.ts`, `useAssetAutocomplete.test.ts`,
`workflowMigrationCharacterAsset.test.ts`,
`propagationCharacterAsset.test.ts`, `characterAssetNode.test.ts`.

### ✅ `2026-05-10-node-functional-parity-cleanup`

Two BREAKING fixes: removed orphan `imageCrop` node (was visually present,
unreachable from any builder); renamed `imageEdit.editPrompt` →
`editInstruction` to match Agent expectation. Wired `AudioNode` submit
button. Added `create_character_extract_node` /
`create_character_manager_node` Agent tools. `comic_drama` + `short_drama`
builders now emit `characterManager` by default.

Delta specs synced into `openspec/specs/` 2026-05-10:
`workflow-generation` (NEW) · `agent-tool-schemas` (appended 3 reqs:
parity, schema derivation, no-dangling-refs) · `video-generation-node`
(appended 2 reqs: SubmitButton contract, canonical field per slot).

Evidence: `agentNodeParity.test.ts`, updates to `pipeline.test.ts` +
`agentTools.test.ts`.

### ✅ `2026-05-10-workflow-builder-wiring-fixes`

Two threads: (a) fixed 4 builder wiring bugs surfaced by the new
`agentGenerationEvaluation` rubric — `sceneGrid` orphan, missing
`characterManager` in `music_video`, dangling `storyboard`, port
violation in `tutorial`; (b) introduced **Tier-aware tool disclosure**
(Tier 1 always-on, Tier 2 on creation intent, Tier 3 explicit keywords)
plus `discover_tools` escape hatch.

Result (from `progress.md`):

- 41 tools audited — 0 dead, all ≥ 3 references
- First-turn token footprint: **−43 % to −73 %** depending on intent
- All 6 generation scenarios Grade A (avg **99/100**)
- Test suite: **356/356 passing** (+46 from 310 baseline)

Delta specs synced into `openspec/specs/` 2026-05-10:
`agent-tool-tiering` (NEW) · `agent-tool-schemas` (appended 4 reqs:
tiering factory, parity-under-tier, utilization guard, param effectiveness) ·
`workflow-generation` (appended 5 reqs: scene propagation, MV character
pipeline, storyboard wiring, port legality, scenario grade thresholds).

Evidence: `toolTiers.test.ts` (24), `agentParamEffective.test.ts`
(13), `nodeAgentToolUtilization.test.ts` (4), `discoverTools.test.ts`
(5).

---

## Shipped, Ready-to-Archive (1 change)

### 🟢 `agent-e2e-test-grok-luckin`

xAI Grok Video 3 接入 toapis 网关 + E2E 验证。三处字段差异已闭环：
`seconds`（字符串时长，非 `duration`） · `images`（grok 字段名，与 `image_urls` 双写）
· 最多 3 张参考图（前后端各做一层截断）。

**实现**：
- 后端 `seed.py` 注册 21 个模型 + 19 个 channel mapping（grok → toapis）
- 后端 `toapis_adapter.py` 字段透传白名单加 `seconds`，images 双写到 `images` +
  `image_urls`，超过 3 张截断 + warning
- 前端 `KNOWN_VIDEO_MODELS` 加 `grok-video-3`；`modelReferenceAdapter.ts` 新增
  `grokStrategy`（merge existingImages + referenceImages + characterUrls，取前 3）

**验证**：
- pytest `test_toapis_adapter.py` 6/6 passed（含 `test_seedance_unchanged` 回归保护）
- vitest 全栈 53 文件 / 679 passed
- UI puppeteer 三层证据：模型下拉含 Grok Video 3 · 节点 chip 切换 ·
  `node.data.seconds = "10"` + `aspect_ratio = "16:9"` + duration/resolution sanitize 为 undefined

**附带修复**：
- BUG-001 `seed.py` 末尾死代码（裸 `await` 在 `if __name__` 块）→ 已删
- 反思报告标记两个待办 change：`db-seed-strict-validation`（BUG-002）+
  `adapter-field-mapping-layer`（DESIGN-001）

Evidence:
`@d:\PythonProject\lang-video-work-flow\openspec\changes\agent-e2e-test-grok-luckin\tasks.md`
`@d:\PythonProject\lang-video-work-flow\reports\agent-reflection-report-luckin.md`

---

## Shipping (1 change · ~60% complete)

### � `agent-experience-overhaul`

The convergence change. Migrates the main Agent loop from the frontend
(`chatStore.ts:244-472`) to the backend (FastAPI + LangGraph upgraded
runtime), introduces SSE streaming for token-level reasoning + tool-call
bubbles, adds subagent delegation (`delegate_to_subagent`), wires the
canvas ↔ chat bidirectional binding, gates high-risk tools behind user
approval, and replaces string `ToolCallResult.message` with structured
`{ ok, data, hints[], next_step? }`.

Scope (from `proposal.md`): 9 new capabilities + 3 modified.
`tasks.md` is **53 kB** with **115 subtasks** — the largest change in
the project.

**Real status — 68 / 115 tasks done (59%)**. Detail:
`@d:\PythonProject\lang-video-work-flow\openspec\changes\agent-experience-overhaul\progress.md`.

What's already shipped behind `AGENT_BACKEND_RUNTIME=true` feature flag:

- **Backend runtime + SSE transport** (Phase 0, 35/41 tasks): LangGraph
  5-node StateGraph in `server/app/agents/runtime.py`, full
  `AgentLoopController` Python translation with FNV-1a fingerprinting,
  6-segment prompt builder + 3-tier compaction, slim 261-token core
  (was 420), `/api/agent/sessions` SSE endpoint with `Last-Event-ID`
  reconnect + long-poll fallback, reverse-RPC for client-scope tools,
  approval round-trip, structured `ToolResult[T]`.
- **Subagent + Identity routing** (Phase 0.7 + 0.9): `agent.delegate` /
  `agent.parallel_delegate` with depth guard + concurrency cap; 4-family
  `IdentityRouter` (Seedance / VEO / Sora / Kling) extensible by
  prefix.
- **Frontend thin client** (Phase 0.10, 6/6 tasks): `agentSseClient.ts`
  + `clientToolBridge.ts` + `agentSessionStore.ts`; 9 client tools
  registered with `node.locked` guard.
- **Phase 1.1 feature flag wired** (4/4): `useBackendRuntime` in
  settings store v3 + chatStore dual-route + SettingsPanel toggle.
- **Phase 2 UI upgrade** (27/30 tasks, 90%): ProgressTimeline +
  canvas-chat double binding (hover highlight + Ctrl+Click anchor) +
  ApprovalDialog (Cmd+Enter / Esc / batch list collapse) +
  `characterAsset` node merger with thin-dispatcher migration +
  Timeline node + 9 motion polish CSS keyframes (mount / success /
  error / pulse / dialog).
- **Phase 3 spot landings**: `parallel_delegate` concurrency tested
  (3.1.2 — 9 tests); `asset.update_identity` server tool wired (3.3.2 —
  22 tests).

What's left (in execution order):

1. **§ 0.12 acceptance gates** — `alembic upgrade head` + clean pytest
   (resolve 12 fail / 12 error in `test_tool_naming_convention.py` and
   `test_models_api.py`) + clean vitest + eval-parity + `openspec
   validate strict`.
2. **§ 1.2 dogfood** — flip flag for maintainer, 5 real workflows for a
   week, fill `EVAL.md` § 9.3 Field Reports.
3. **§ 3.2 tool naming canonicalisation** — unblocks the 12 ERROR
   tests above.
4. **§ 4.x cleanup** — delete legacy frontend `chatStore` for-loop,
   alias deprecation.
5. **V.x cross-phase verification** — bundle-size, latency p50/p99,
   smoke-test script.

Not a paper change. Reading `progress.md` first will save evaluators a
53 kB read of `tasks.md`.

---

## Open Questions / Future Directions

Captured but not yet proposed:

- **True identity embedding** — IP-Adapter / FaceID / Sora Character
  embeddings beyond prompt-anchor + reference-image. Today
  `verify_image_semantic` checks semantic match, not identity match.
- **Subagent parallelism** — proposed inside `agent-experience-overhaul`
  but could be split into a smaller standalone change.
- **Audio ↔ video rhythm binding** — BPM / beat alignment for `audioNode`
  output to `videoStitch` cuts; mentioned as a long-term gap, no
  proposal.
- **Cross-tenant asset sharing** — `Non-goal` of `character-asset-library`,
  may resurface for team workspace use cases.
- **Storyboard → timeline mapping** — explicit time-axis node so
  `videoStitch` can do beat-synced cuts instead of pure sequential
  concat.

---

## Working Cadence

- New work always starts with a proposal in `openspec/changes/<id>/`.
  Use `/opsx-explore` to gather context, then `/opsx-propose` to draft
  the proposal + design + delta specs + tasks in one step.
- Implementation follows TDD per task (`/testing` workflow). Multi-task
  changes maintain a `progress.md` (see `workflow-builder-wiring-fixes/`
  as the canonical example).
- A change cannot archive until: (a) all tasks checked, (b) added/changed
  tests green, (c) `npm run eval` clear of regressions, (d) delta specs
  merged into `openspec/specs/`. Archive via `/opsx-archive`.

---

## See Also

- `@d:\PythonProject\lang-video-work-flow\openspec\specs\` — current authoritative specs (16)
- `@d:\PythonProject\lang-video-work-flow\openspec\changes\` — open changes (1) + archive (6)
- `@d:\PythonProject\lang-video-work-flow\CHANGELOG.md` — release-style history
- `@d:\PythonProject\lang-video-work-flow\ARCHITECTURE.md` — design rationale
