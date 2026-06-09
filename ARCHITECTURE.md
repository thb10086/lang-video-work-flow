# Architecture

> What this document is — the **design rationale** behind the codebase: why the
> two-runtime split exists, what each store/layer is responsible for, and the
> three explicit tradeoffs we made along the way. For node/tool catalogues see
> `@d:\PythonProject\lang-video-work-flow\README.md`. For evidence trails per
> capability see `@d:\PythonProject\lang-video-work-flow\AI_BUILDER_EVIDENCE.md`.

---

## 1. Two-Runtime Split (current state)

The project deliberately ships **two Agent runtimes side-by-side**:

| Runtime | Where | Loop driver | Purpose today |
|---------|-------|-------------|---------------|
| **Frontend Agent loop** | `@d:\PythonProject\lang-video-work-flow\src\store\chatStore.ts:197-283` | `for (round=0; ; round++)` + `agentLoopControl.evaluate()` | Fast prototyping surface; UI-tight tool calls (canvas mutations, `inject_user_images`); 25-round budget |
| **Backend LangGraph orchestration** | `server/app/agents/orchestrator.py` | StateGraph 9 nodes | Long-running pipelines, model routing, DB-persisted assets |

**Why both exist** — the frontend loop was the v0.1 quick-validate path (gets
the user from `npm run dev` to a generated workflow in <5 min, no backend
needed). The backend LangGraph runtime came later for production multi-model
orchestration. They share **prompts, tools, and skill modules** (single
source-of-truth in `src/prompts/skills/` and `src/providers/toolDefinitions.ts`)
to avoid the "two truths" failure mode.

**Convergence direction** — `openspec/changes/agent-experience-overhaul/` is
the active proposal to migrate the main loop to the backend (SSE streaming +
subagents + approval gates). It is **designed but not started** — see
`@d:\PythonProject\lang-video-work-flow\ROADMAP.md` for status.

---

## 2. Pipeline Stages (4 phases, gated tooling)

Every workflow flows through four phases. Each phase **gates** which Agent
tools and which SKILL prompt modules are loaded — this is the core mechanism
that keeps the system prompt small.

```
pre_production  →  production  →  post_production  →  reviewing
   ↑                                                       ↓
   └──── replan loop (if verify_task fails) ───────────────┘
```

| Phase | Tools loaded (Tier 1+2 example) | SKILLs loaded |
|-------|---------------------------------|----------------|
| `pre_production` / `planning` / `designing` | `detect_scenario`, `plan_task`, `create_*_node`, `connect_nodes` | `character_design`, `scene_design`, `style_lock`, `storyboard`, `video_workflow_recipe` |
| `production` / `building` / `executing` | `execute_node`, `parallel_execute`, `update_node`, `inject_user_images` | `image_generation`, `image_edit`, `video_generation`, `prompt_craft` |
| `post_production` / `reviewing` | `verify_task`, `verify_image_semantic`, `review_content` | `continuity_check`, `video_stitch`, `vision_verify`, `quality_control` |

Authoritative mapping: `src/prompts/skills/index.ts:PHASE_SKILL_MAP`. Phase
state lives in `agentMemoryStore.currentPhase` and is mutated only by the
`set_phase` tool.

---

## 3. State Management — 5 Zustand Stores

Hard partitioned by concern. Cross-store mutation goes through the public
setters; no store reaches into another store's `set()`.

| Store | File | Owns | Cross-cuts |
|-------|------|------|------------|
| `flowStore` | `@d:\PythonProject\lang-video-work-flow\src\store\flowStore.ts` | nodes / edges / undo-redo (50 layers) / clipboard / characterAppearances registry | Source of truth for canvas; consumed by chatPromptBuilder snapshot |
| `chatStore` | `@d:\PythonProject\lang-video-work-flow\src\store\chatStore.ts` | Agent loop, tool dispatch, role switching, streaming, agentStats | Drives the frontend runtime; reads flowStore + agentMemoryStore |
| `chatPromptBuilder` | `@d:\PythonProject\lang-video-work-flow\src\store\chatPromptBuilder.ts` | 4-layer prompt segments (`core` / `role` / `skills` / `dynamic`) + 3-tier compaction | Stateless view over flowStore + agentMemoryStore + settings |
| `settingsStore` | `@d:\PythonProject\lang-video-work-flow\src\store\settingsStore.ts` | API keys, default models, cache toggles, response-budget toggle | Persisted (versioned migration); affects chat payload shape |
| `agentMemoryStore` | `@d:\PythonProject\lang-video-work-flow\src\store\agentMemoryStore.ts` | long-term memories (scoped session/project/global), task plan, phase, compaction summary | Persisted; auto-injects top-K relevant memories per turn |

**Why 5 stores not 1** — the prompt builder is intentionally stateless so the
prompt segments are **deterministic** for a given (canvas, settings, memory)
tuple. This is a hard prerequisite for prompt caching (decision D1 below) —
any non-determinism breaks the cache breakpoint.

---

## 4. Three Decisive Tradeoffs

These are the calls that shape the codebase. All three come from
`@d:\PythonProject\lang-video-work-flow\openspec\changes\archive\2026-04-24-agent-anthropic-alignment\design.md` (D1–D4).

### D1. Backend-DB-driven model schema, not frontend hard-codes

**Choice** — `ai_models.param_schema` (MySQL) is the single source for "what
params this model accepts". Frontend `useBackendModels` hook + Agent tool
schema generator (`src/providers/toolSchemaGenerator.ts`) read from it.

**Cost** — adding a model now requires one DB row + one Alembic migration
(see `server/alembic/versions/`). No more "edit the TS enum" shortcut.

**Why we paid it** — the alternative was 6 places to update per new model
(node UI + agent tool schema + sanitizer + executor + backend adapter +
prompt). With DB-driven schema, **schema_version** invalidates frontend
cache automatically. Validated by the `multi-model-param-adaptation`
change.

### D2. Vision verify via adapter registry, not hard-coded provider

**Choice** — `src/providers/visionVerifyAdapter.ts` exposes a registry; the
default `gemini-vision` adapter is one entry, switchable via
`settings.visionVerifyModel`. Backend `POST /api/verify/image` accepts a
`model` field and dispatches.

**Cost** — adapter pattern adds one indirection layer per check; default
fallback path adds a `[vision fallback]` marker in `verify_task` output.

**Why we paid it** — main LLM is already multi-provider (OpenAI/Gemini/
Claude); vision verify cannot be the one component that locks us in. Spec:
`@d:\PythonProject\lang-video-work-flow\openspec\specs\agent-vision-verify\spec.md`.

### D3. Tool response budget via higher-order helper, not per-tool patches

**Choice** — `withResponseBudget(handler, opts)` wraps query tools at
**registration time**, auto-injects `response_format: 'concise' | 'detailed'`
into the OpenAI function schema. 7 tools wrapped today
(`get_canvas_state` / `get_node_output` / `list_models` / `get_model_params` /
`list_assets` / `recall_memory` / `discover_tools`).

**Cost** — tool authors must remember to **opt out** for write tools (they
are not wrapped by default).

**Why we paid it** — Anthropic's reference examples patch each tool
individually; that path leads to 37 duplicated truncation blocks. One helper
keeps the policy in one place. Threshold `DEFAULT_TOOL_RESPONSE_MAX_TOKENS =
25000` (configurable via `settings.enableResponseBudget`).

---

## 5. Loop Control — Multi-Dimensional Budget

Replaced the old `for (round=0; round<25; round++)` with
`createAgentLoopController()` from `src/lib/agentLoopControl.ts`. Four
budgets evaluated every round, severity is the max of all detectors:

- `BudgetTracker` — iterations / tokens / time / tool-calls (all four
  configurable, defaults `50 / 200_000 / 10min / 100`)
- `LoopDetector` — sliding-window fingerprint (same `tool+args` 3× warn,
  5× stop)
- `StallDetector` — canvas + memory signature 3 rounds no change → warn,
  5 → stop

**Three-tier graceful degradation** (Claude Code style):
- 80% of any budget → inject `[CONTROLLER] approaching budget` reflection
- 95% → disable tool calls, force a summary turn
- 100% → hard stop with a structured `StopReason`

22 test cases in
`@d:\PythonProject\lang-video-work-flow\src\__tests__\agentLoopControl.test.ts`.

---

## 6. What This Architecture is Not

- **Not** a single-runtime system — accept the dual loops are temporary; see
  `agent-experience-overhaul` for the convergence proposal.
- **Not** a "subagent" system — there is no parallel orchestration of
  short-lived agents yet. Designed in `agent-experience-overhaul.proposal.md`,
  not built.
- **Not** a true vision-consistency system — `verify_image_semantic` checks
  semantic match, not identity embedding. IP-Adapter / FaceID is explicitly
  out-of-scope for the current change set.
- **Not** a multi-tenant system — assets are per-user, no cross-tenant
  sharing.

---

## See Also

- `@d:\PythonProject\lang-video-work-flow\AGENT_SKILLS_REFERENCE.md` — SKILLs catalogue + phase mapping
- `@d:\PythonProject\lang-video-work-flow\EVAL.md` — quantitative regression baseline
- `@d:\PythonProject\lang-video-work-flow\ROADMAP.md` — open changes + status
- `@d:\PythonProject\lang-video-work-flow\openspec\specs\` — capability specs (4)
- `@d:\PythonProject\lang-video-work-flow\openspec\changes\archive\` — design memos with full Decisions section
