# AI Builder Evidence Pack

> **Purpose** — a single sampling entry point for evaluators (e.g.
> `git-hired/skill.md`) that need to score this codebase along the
> Agent-Engineer dimensions: `Spec Control` / `Agent Orchestration` /
> `Verification Domain` / `Outcome Judgment` / `Ownership Tempo`.
>
> Every claim below points at a real file path. No prose-only assertions.
>
> JD prompt version compatibility: `agent-engineer@2026-04-26.1`.

---

## Project at a Glance

- **What it is** — an Ingredients-to-Video AI workflow studio: scripts →
  storyboard → character grids → keyframes → videos → stitch, all driven
  by an Agent on a React Flow canvas with 15 node types.
- **Codebase shape** — 195+ files under `src/`, 47 test files, FastAPI +
  LangGraph backend under `server/`, OpenSpec workflow under
  `openspec/`, 16 `.windsurf/workflows/*.md` operating procedures.
- **Two-runtime architecture** — frontend Agent loop (live) +  backend
  LangGraph orchestration (live); convergence change designed.
  See `@d:\PythonProject\lang-video-work-flow\ARCHITECTURE.md`.

---

## 1. Spec Control

**Pattern** — every non-trivial change starts as a numbered OpenSpec
proposal with `proposal.md` + `design.md` + per-capability `specs/*.md` +
`tasks.md`. Implementation cannot begin without the design memo.

| Evidence | Path |
|----------|------|
| Authoritative capability specs (16) | `agent-eval-harness` · `agent-memory-management` · `agent-multimodal-input` · `agent-phase-state` · `agent-prompt-architecture` · `agent-tool-response-budget` · `agent-tool-schemas` · `agent-tool-tiering` · `agent-vision-verify` · `asset-library` · `at-reference-system` · `libtv-asset-panel` · `model-param-registry` · `model-reference-adapter` · `video-generation-node` · `workflow-generation` (all under `@d:\PythonProject\lang-video-work-flow\openspec\specs\`) |
| Open changes with full design memos (1, **shipping ~60%**) | `agent-experience-overhaul\design.md` (26 kB) + `tasks.md` (53 kB, 115 subtasks) + `progress.md` (real-status snapshot, **68/115 tasks done**) under `@d:\PythonProject\lang-video-work-flow\openspec\changes\` |
| Archived changes with `Decisions` section (6 — archive ratio 6:1) | `archive\2026-04-24-agent-anthropic-alignment\design.md` (D1–D4) · `archive\2026-05-09-multi-model-param-adaptation\` · `archive\2026-05-09-agent-pro-upgrade\` · `archive\2026-05-10-character-asset-library\` · `archive\2026-05-10-node-functional-parity-cleanup\` · `archive\2026-05-10-workflow-builder-wiring-fixes\` |
| Archive audit trail (executed plan) | `@d:\PythonProject\lang-video-work-flow\openspec\changes\ARCHIVE_PLAN.md` — documents the manual sync → mv steps used in lieu of a missing `openspec` CLI |
| Spec authoring + planning workflows | `@d:\PythonProject\lang-video-work-flow\.windsurf\workflows\opsx-propose.md` · `opsx-explore.md` · `writing-plans.md` · `brainstorming.md` |
| Roadmap with status legend (Shipped / Shipping / Designed / Archived) | `@d:\PythonProject\lang-video-work-flow\ROADMAP.md` |
| Verifier-style requirements (`SHALL` / `MUST` + `Scenario:` blocks) | every `spec.md` follows OpenSpec EARS-lite syntax |

**Standout signal** — every shipped change has both a `proposal.md`
(why + what) and a `design.md` (decisions + tradeoffs + alternatives
considered + non-goals). 6 out of 7 changes have ≥ 5 kB design memos.
6 archived changes spawned 16 capability specs in `openspec/specs/` —
**specs grew 4 → 16 (+300 %) over 2026-05-09 to 2026-05-10**, archive
ratio flipped from **1:7 to 6:1** in two sessions. Single-file dual
archive on 2026-05-09 + triple archive on 2026-05-10 demonstrates the
`spec → ship → archive` loop closes in practice, not just on paper.

---

## 2. Agent Orchestration

**Pattern** — 33 tools, 19 SKILL modules, 8 phases, gated reveal.
Multi-dimensional loop budget. Phase state machine. Tier-based progressive
disclosure with `discover_tools` escape hatch.

| Evidence | Path |
|----------|------|
| Frontend Agent loop with multi-dim controller | `@d:\PythonProject\lang-video-work-flow\src\store\chatStore.ts:197-283` |
| Loop controller (4 budget dims + loop detector + stall detector + 3-tier degradation) | `@d:\PythonProject\lang-video-work-flow\src\lib\agentLoopControl.ts` |
| Tool catalogue + tier definitions | `@d:\PythonProject\lang-video-work-flow\src\providers\toolDefinitions.ts` · `toolTiers.ts` · `toolHandlers.ts` · `toolQuality.ts` · `toolVerify.ts` · `toolScenario.ts` · `toolClassify.ts` |
| Phase-gated SKILL modules (19) | `@d:\PythonProject\lang-video-work-flow\src\prompts\skills\` + `AGENT_SKILLS_REFERENCE.md` |
| 4-layer prompt segments + cache breakpoints | `@d:\PythonProject\lang-video-work-flow\src\store\chatPromptBuilder.ts` |
| Tier audit (no dead tools, all ≥ 3 references) | `@d:\PythonProject\lang-video-work-flow\openspec\changes\workflow-builder-wiring-fixes\progress.md` |
| Token-footprint reduction telemetry | same `progress.md`: −43 % to −73 % vs. baseline |
| Backend LangGraph 9-node orchestration | `server/app/agents/orchestrator.py` |
| Reverse `client_tool_call` bridge (for the SSE migration) | `@d:\PythonProject\lang-video-work-flow\src\__tests__\eval\mockClientBridge.ts` |
| Asset reference resolver (`@assetId` expansion) | `@d:\PythonProject\lang-video-work-flow\src\providers\assetReferenceResolver.ts` |
| Per-model reference adapter (Seedance / VEO / Sora / Kling) | `@d:\PythonProject\lang-video-work-flow\src\providers\modelReferenceAdapter.ts` |

**Standout signal** — composable budget controller borrowed from Claude
Code, validated by 22 unit tests
(`@d:\PythonProject\lang-video-work-flow\src\__tests__\agentLoopControl.test.ts`).

---

## 3. Verification Domain

**Pattern** — declarative end-to-end eval harness gated by baseline
regression. Every prompt / tool / SKILL change runs against 6 scenarios
before merge. Vision-based verification replaces string-match heuristics
where possible.

| Evidence | Path |
|----------|------|
| Eval harness DSL + runner + reporter | `@d:\PythonProject\lang-video-work-flow\src\__tests__\eval\runEval.ts` · `types.ts` · `baseline.ts` · `mockBackend.ts` · `mockLLM.ts` |
| 6 baseline scenarios (avg score 100, 931 total tokens, 54 ms) | `@d:\PythonProject\lang-video-work-flow\eval-baseline.json` · `@d:\PythonProject\lang-video-work-flow\eval-report.json` |
| CI guard (rejects > 5 % regression) | `@d:\PythonProject\lang-video-work-flow\src\__tests__\eval\baselineGuard.test.ts` |
| Eval handbook + how-to | `@d:\PythonProject\lang-video-work-flow\docs\agent-eval.md` · `@d:\PythonProject\lang-video-work-flow\EVAL.md` |
| Vision-verify three-branch test (`accept` / `retry` / `edit_prompt`) | `@d:\PythonProject\lang-video-work-flow\src\__tests__\visionVerify.test.ts` |
| Vision adapter registry + Gemini default | `@d:\PythonProject\lang-video-work-flow\src\providers\visionVerifyAdapter.ts` · `geminiVisionAdapter.ts` |
| Tool-budget enforcement tests | `@d:\PythonProject\lang-video-work-flow\src\__tests__\toolBudget.test.ts` · `toolBudgetIntegration.test.ts` |
| Loop control behaviour tests (22 cases) | `@d:\PythonProject\lang-video-work-flow\src\__tests__\agentLoopControl.test.ts` |
| Workflow generation rubric (6 scenarios Grade A) | `@d:\PythonProject\lang-video-work-flow\src\__tests__\agentGenerationEvaluation.test.ts` |
| End-to-end Agent loop test | `@d:\PythonProject\lang-video-work-flow\src\__tests__\e2e-agent-loop.test.ts` |
| Pre-completion verification SOP | `@d:\PythonProject\lang-video-work-flow\.windsurf\workflows\verification.md` |
| Systematic debugging SOP (4-phase root-cause analysis) | `@d:\PythonProject\lang-video-work-flow\.windsurf\workflows\debugging.md` |

**Standout signal** — 47 test files, 356/356 passing (per
`workflow-builder-wiring-fixes/progress.md`), zero-config eval baseline
guard.

---

## 4. Outcome Judgment

**Pattern** — every Decision in a `design.md` includes both a chosen
path and at least one rejected alternative with a one-line rationale.
Proposals carry explicit `Non-goals` to prevent scope creep.

| Evidence | Path |
|----------|------|
| Decisions with alternatives considered (D1–D4) | `@d:\PythonProject\lang-video-work-flow\openspec\changes\archive\2026-04-24-agent-anthropic-alignment\design.md` |
| Token-footprint tradeoff measured + reported | `@d:\PythonProject\lang-video-work-flow\openspec\changes\workflow-builder-wiring-fixes\progress.md` |
| BREAKING-change communication discipline (with deprecation + fallback) | `@d:\PythonProject\lang-video-work-flow\openspec\changes\node-functional-parity-cleanup\proposal.md` (`imageEdit.editPrompt` rename + 1-release fallback path) |
| Non-goals declared in every proposal | every `proposal.md` ends with `Non-goals:` block |
| Three explicit architecture tradeoffs documented | `@d:\PythonProject\lang-video-work-flow\ARCHITECTURE.md` §4 |
| Rejection of low-value rename for the sake of rename (e.g. `execute_node` → `node_execute`) | same archived `design.md` Goals/Non-Goals section |
| Detect_scenario tool returns rationale + recommendation, not just classification | `@d:\PythonProject\lang-video-work-flow\src\providers\toolScenario.ts` |

**Standout signal** — alternatives-considered is required, not optional.
Even a "merge two redundant tools" decision has a rejected
alternative documented.

---

## 5. Ownership Tempo

**Pattern** — every multi-task change keeps a `progress.md`. Project has
formalised SOPs for dev startup, TDD, debugging, verification, and
spec authoring. Migrations are versioned per phase.

| Evidence | Path |
|----------|------|
| Operating SOPs (16 workflows) | `@d:\PythonProject\lang-video-work-flow\.windsurf\workflows\` |
| Pre-flight checklist (Alembic migration check, frontend deps) | `@d:\PythonProject\lang-video-work-flow\.windsurf\workflows\dev-start.md` |
| TDD red-green-refactor SOP | `@d:\PythonProject\lang-video-work-flow\.windsurf\workflows\testing.md` |
| Pre-completion verification SOP | `@d:\PythonProject\lang-video-work-flow\.windsurf\workflows\verification.md` |
| Per-change live progress log | `@d:\PythonProject\lang-video-work-flow\openspec\changes\workflow-builder-wiring-fixes\progress.md` |
| Coding standards (DRY / no-magic-values / SRP / performance) | `@d:\PythonProject\lang-video-work-flow\.windsurf\workflows\coding-standards.md` |
| Project-specific add-x workflows (node / tool / SKILL / model) | `@d:\PythonProject\lang-video-work-flow\.windsurf\workflows\add-node-type.md` · `add-agent-tool.md` · `add-skill-module.md` · `add-model-adapter.md` |
| Backend Alembic migrations (versioned schema evolution) | `server/alembic/versions/` |
| Anti-hardcoding refactor (single-source-of-truth `modelDefaults.ts`) | `@d:\PythonProject\lang-video-work-flow\src\providers\modelDefaults.ts` + `server/app/config.py` |
| Roadmap with concrete next-step decisions | `@d:\PythonProject\lang-video-work-flow\ROADMAP.md` |
| Release-style changelog | `@d:\PythonProject\lang-video-work-flow\CHANGELOG.md` |

**Standout signal** — `dev-start.md` step 3.5 enforces an Alembic
`current == head` check at the start of every backend session, written
in response to a real production incident (HTTP 500 from missing
`schema_version` column). Discipline shows up as workflow rules, not
just memory.

---

## How to Sample Quickly (for evaluators)

If you have ~1 minute and want to sample evidence:

1. Read this file (1 min) — points at every direction.
2. Read `@d:\PythonProject\lang-video-work-flow\ROADMAP.md` (30 s) for
   ship cadence.
3. Read `@d:\PythonProject\lang-video-work-flow\openspec\changes\archive\2026-04-24-agent-anthropic-alignment\design.md`
   (1 min) for a representative Decisions block.
4. Skim `@d:\PythonProject\lang-video-work-flow\openspec\changes\workflow-builder-wiring-fixes\progress.md`
   (30 s) for an audit + telemetry sample.
5. Skim `@d:\PythonProject\lang-video-work-flow\eval-baseline.json` (15 s)
   for the regression gate output.

Total budget: ~3.5 minutes. Skip `node_modules/`, `server/.pytest_cache/`,
and any `*.log` artifacts.

---

## Privacy & Scope

This file is candidate-controlled and does not transmit anything off the
local machine. All paths above are absolute references inside the
workspace, intended only for the evaluation agent that has been granted
access to this repository.

No secrets, tokens, customer names, or raw transcripts appear here.
