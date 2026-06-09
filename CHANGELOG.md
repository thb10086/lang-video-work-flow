# Changelog

> Release-style history. Each entry maps 1:1 to an OpenSpec change. Format
> follows [Keep a Changelog](https://keepachangelog.com/) loosely.
>
> For the full proposal + design + tasks per entry, see
> `@d:\PythonProject\lang-video-work-flow\openspec\changes\` (open) and
> `@d:\PythonProject\lang-video-work-flow\openspec\changes\archive\` (closed).

---

## [2026-05-10] — triple archive ✅

All three remaining ready-to-archive changes synced and moved on the
same day. `openspec/specs/` grows 10 → 16 (+6); `openspec/changes/archive/`
grows 3 → 6 (+3); active changes drops to 1 (the in-design
`agent-experience-overhaul`). Archive ratio: **6:1**.

### Archived

- **`character-asset-library`** →
  `archive/2026-05-10-character-asset-library/`. Delta specs synced:
  `asset-library` (NEW), `at-reference-system` (NEW), `libtv-asset-panel`
  (NEW), `model-reference-adapter` (NEW), `video-generation-node`
  (appended 2 reqs).
- **`node-functional-parity-cleanup`** →
  `archive/2026-05-10-node-functional-parity-cleanup/`. Delta specs
  synced: `workflow-generation` (NEW), `agent-tool-schemas` (appended
  3 reqs), `video-generation-node` (appended 2 more reqs).
- **`workflow-builder-wiring-fixes`** →
  `archive/2026-05-10-workflow-builder-wiring-fixes/`. Delta specs
  synced: `agent-tool-tiering` (NEW), `agent-tool-schemas` (appended
  4 reqs), `workflow-generation` (appended 5 reqs).

### Documentation

- `openspec/changes/ARCHIVE_PLAN.md` rewritten as audit trail (was a
  forward-looking plan).
- `EVAL.md` baseline guarded scenarios: 6 → 8 (added `04-batch-execute`
  and `08-discover-tools` after `npm run eval:update`).

---

## [Unreleased] — `agent-experience-overhaul` shipping (~60%)

### Shipping behind feature flag `AGENT_BACKEND_RUNTIME`

- **Backend Agent runtime** — LangGraph 5-node StateGraph in
  `server/app/agents/runtime.py` with full `AgentLoopController`
  (Python translation of `agentLoopControl.ts`); 6-segment prompt
  builder + 3-tier compaction; **core slim from 420 → 261 tokens**.
- **SSE transport** — `/api/agent/sessions` endpoint with
  `Last-Event-ID` reconnect, `?transport=poll` fallback, 15 typed
  events, reverse-RPC for client-scope tools, approval round-trip.
- **Subagent + Identity routing** — `agent.delegate` /
  `agent.parallel_delegate` with depth guard + `asyncio.Semaphore`
  concurrency cap (default 5, tested 9 ways); 4-family
  `IdentityRouter` (Seedance / VEO / Sora / Kling) extensible by
  prefix.
- **Frontend thin client** — `agentSseClient.ts` +
  `clientToolBridge.ts` + `agentSessionStore.ts` ship with 9 client
  tools (canvas / images / ui) and `node.locked` guard.
- **UI upgrade** — `ProgressTimeline` (phase cards + tool bubbles +
  retry collapse), `ApprovalDialog` (Cmd+Enter / Esc / batch list),
  canvas ↔ chat double binding (hover highlight + Ctrl+Click anchor),
  `characterAsset` thin-dispatcher node merger with workflow migration,
  `Timeline` multi-track node, 9 motion-polish keyframes.

### Status

- **68 / 115 tasks done (59%)** — see
  `@d:\PythonProject\lang-video-work-flow\openspec\changes\agent-experience-overhaul\progress.md`
  for the per-section snapshot.
- **Feature flag default**: `AGENT_BACKEND_RUNTIME=false` — opt-in via
  SettingsPanel "后端 Agent Runtime（实验）".
- **What blocks GA**: § 0.12 acceptance gates + § 1.2 dogfood week +
  § 3.2 tool naming canonicalisation (12 pytest ERRORs in
  `test_tool_naming_convention.py` are the spec asserting that
  rename) + § 4.x legacy cleanup.

---

## [2026-05-09] — dual archive ✅

### Archived

- **`agent-pro-upgrade`** →
  `archive/2026-05-09-agent-pro-upgrade/`. Delta specs synced into
  `openspec/specs/`: `agent-memory-management`, `agent-multimodal-input`,
  `agent-phase-state`. Net effect: Agent gains scoped memory + phase
  state machine + multimodal first-turn + 4 new tools, all spec-anchored.
- **`multi-model-param-adaptation`** →
  `archive/2026-05-09-multi-model-param-adaptation/`. Delta specs synced:
  `model-param-registry`, `agent-tool-schemas`, `video-generation-node`.
  Net effect: per-model parameter system documented end-to-end (DB →
  Agent schema → node UI → backend validation).

### Documentation

- New: `@d:\PythonProject\lang-video-work-flow\openspec\changes\ARCHIVE_PLAN.md`
  enumerates the remaining 3 ready-to-archive changes' sync routes +
  known capability conflicts.
- `openspec/specs/` capabilities: 4 → 10 (+6).
- `openspec/changes/archive/` entries: 1 → 3 (+2).

---

## [2026-04-24] — `agent-anthropic-alignment` ✅ archived

Closed 4 quantifiable gaps vs. Anthropic Agent best practices.

### Added

- **`agent-eval-harness`** — declarative scenario DSL + Mock LLM + Mock
  backend + per-run report (`eval-report.json`) + baseline regression
  guard (`eval-baseline.json`, > 5 % drop fails CI). 6 baseline scenarios
  at average **100/100**. Spec:
  `@d:\PythonProject\lang-video-work-flow\openspec\specs\agent-eval-harness\spec.md`.
- **`agent-vision-verify`** — `verify_image_semantic` Agent tool +
  adapter registry (`gemini-vision` default, switchable via
  `settings.visionVerifyModel`) + backend `POST /api/verify/image` with
  300 s Redis cache. Three branches: `accept` / `retry` / `edit_prompt`.
  Spec: `agent-vision-verify/spec.md`.
- **`agent-prompt-architecture`** — 4-layer system prompt segments
  (`core` / `role` / `skills` / `dynamic`) with stability tags;
  conditional `cache_control` injection (≥ 92 % cache hit when
  enabled); pipeline instructions extracted to phase-gated SKILL
  modules `video_workflow_recipe` and `multimodal_input`.
  Spec: `agent-prompt-architecture/spec.md`.
- **`agent-tool-response-budget`** — `withResponseBudget()` higher-order
  wrapper auto-injects `response_format: 'concise' | 'detailed'` into
  query-tool schemas; default `DEFAULT_TOOL_RESPONSE_MAX_TOKENS = 25000`
  hard cap. 7 tools wrapped today. Spec:
  `agent-tool-response-budget/spec.md`.

### Changed

- `verify_task` now optionally delegates the "appearance consistency"
  dimension to vision verify when `useVisionVerify: true` is passed;
  string-match path retained as fallback.
- `chatPromptBuilder.buildAgentSystemPrompt()` returns
  `PromptSegment[]` instead of a single string. Backward-compatible
  string path still served when `settings.enablePromptCaching = false`.

### Documented

- New: `@d:\PythonProject\lang-video-work-flow\docs\agent-eval.md`.
- Updated: SKILLs catalogue references in
  `@d:\PythonProject\lang-video-work-flow\AGENT_SKILLS_REFERENCE.md`.

---

## See Also

- `@d:\PythonProject\lang-video-work-flow\ROADMAP.md` — current statuses + next changes
- `@d:\PythonProject\lang-video-work-flow\ARCHITECTURE.md` — design rationale and tradeoffs
- `@d:\PythonProject\lang-video-work-flow\EVAL.md` — quantitative regression baseline
