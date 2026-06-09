# AGENTS.md — Entry Point for AI Work Agents

> Read this **first** if you are an AI assistant (Claude Code / Codex /
> Windsurf Cascade / Copilot) about to operate on this codebase. Then
> branch into the deeper docs as needed. Keep this file ≤ 200 lines.

---

## What This Project Is (30 seconds)

An Ingredients-to-Video AI workflow studio: scripts → storyboard →
character grids → keyframes → videos → stitch, all driven by an Agent
on a React Flow canvas. **15 node types**, **33 Agent tools**,
**19 SKILL modules**, and a **dual runtime** (frontend Agent loop +
backend FastAPI/LangGraph orchestration).

If you need more breadth → `@d:\PythonProject\lang-video-work-flow\README.md`.
If you need design rationale → `@d:\PythonProject\lang-video-work-flow\ARCHITECTURE.md`.
If you need open work → `@d:\PythonProject\lang-video-work-flow\ROADMAP.md`.

---

## Operating Procedures (start here every session)

1. **`/dev-start`** — pre-flight checklist. **Always run first.** Includes
   step 3.5 Alembic `current == head` check (skipping it produces HTTP
   500 from missing `schema_version` column).
2. **Use `code_search` over `grep` / `find`** — Cascade has a Fast Context
   subagent for codebase exploration; do not shell out.
3. **One change at a time** — never modify both client and server in the
   same edit cluster without explicit user OK.
4. **Search before write** — every new helper must first verify there is
   no existing one (DRY). `shared/` and `src/providers/` are common
   homes for utilities.
5. **No silent broadening** — if the user said "fix X", do not refactor Y
   "while you are there".

---

## Workflow Slash Commands

| Command | Use when |
|---------|----------|
| `/dev-start` | Start of every session (pre-flight checks) |
| `/opsx-explore` | Idea is fuzzy, need to investigate code first |
| `/opsx-propose` | Have a concrete idea, want proposal+design+specs+tasks in one step |
| `/opsx-apply` | Implement tasks from an existing change |
| `/opsx-archive` | Land delta specs into `openspec/specs/` after change ships |
| `/brainstorming` | Refine a rough idea into a design |
| `/writing-plans` | Decompose design into 2–5 min execution tasks |
| `/testing` | TDD red-green-refactor for a feature |
| `/debugging` | 4-phase systematic root-cause analysis |
| `/verification` | Pre-completion checklist (build + tests + manual smoke) |
| `/coding-standards` | DRY / no-magic-values / SRP / performance reminders |
| `/add-node-type`, `/add-agent-tool`, `/add-skill-module`, `/add-model-adapter` | Project-specific extension recipes |

Source: `@d:\PythonProject\lang-video-work-flow\.windsurf\workflows\`.

---

## Key Files at a Glance

### Frontend Agent Runtime

- `@d:\PythonProject\lang-video-work-flow\src\store\chatStore.ts` — main
  Agent loop, tool dispatch
- `@d:\PythonProject\lang-video-work-flow\src\store\chatPromptBuilder.ts` —
  4-layer prompt segments (`core` / `role` / `skills` / `dynamic`)
- `@d:\PythonProject\lang-video-work-flow\src\lib\agentLoopControl.ts` —
  multi-dim budget controller + 3-tier degradation
- `@d:\PythonProject\lang-video-work-flow\src\providers\toolDefinitions.ts` —
  33 tool schemas (OpenAI function-calling format)
- `@d:\PythonProject\lang-video-work-flow\src\providers\toolTiers.ts` —
  Tier 1/2/3 disclosure logic
- `@d:\PythonProject\lang-video-work-flow\src\prompts\skills\` — 19 SKILL
  modules (phase-gated)

### Backend

- `server/app/agents/orchestrator.py` — LangGraph 9-node StateGraph
- `server/app/routers/` — FastAPI routes
- `server/app/services/param_validator.py` — backend schema validation
- `server/alembic/versions/` — DB migrations (Alembic)

### State Management (5 stores, hard partitioned)

| Store | Owns |
|-------|------|
| `flowStore` | nodes / edges / undo-redo / clipboard |
| `chatStore` | Agent loop, tool dispatch, role |
| `chatPromptBuilder` | prompt segments + compaction (stateless view) |
| `settingsStore` | API keys, defaults, feature flags (persisted, versioned) |
| `agentMemoryStore` | scoped memories, plan, phase, summary (persisted) |

### Specs & Changes

- `openspec/specs/` — 4 authoritative capability specs
- `openspec/changes/` — 7 open changes (5 ready-to-archive, 1 in-design)
- `openspec/changes/archive/` — 1 closed change (the canonical example)

### Tests

- 47 test files under `src/__tests__/`
- E2E Agent loop: `e2e-agent-loop.test.ts`
- Eval harness: `src/__tests__/eval/` + `npm run eval`

---

## Commands

```bash
# Frontend
npm install
npm run dev          # http://localhost:3001
npm test             # full Vitest run
npm run test:ui      # visual UI

# Eval harness
npm run eval                       # baseline-gated CI run
npm run eval -- --only 01-product-ad
npm run eval:update                # approve drift after intentional change

# Backend
cd server
pip install -r requirements.txt
alembic upgrade head               # CRITICAL before first run
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

---

## Engineering Discipline (non-negotiable)

- **DRY** — search for existing helpers before writing new ones.
- **No magic values** — states / URLs / configs / error codes go to
  enums or `*.config.ts` / `modelDefaults.ts` / `server/app/config.py`.
- **SRP** — pure functions ≤ 30 lines, business functions ≤ 80; if
  longer, split before adding logic.
- **Reuse over rewrite** — Java mybatis-plus lambdas before raw SQL;
  TS shared mappers in `shared/`; mature npm packages over bespoke.
- **No N+1** — batch or parallelize loops crossing IPC / DB / API.
- **Root cause > symptom** — no patches at the call site; fix upstream.
- **Minimal change** — single-line fix beats multi-file refactor when
  it covers the bug.

---

## Bug Fixing

1. Reproduce first (write a failing test).
2. Identify root cause (4-phase `/debugging` if non-trivial).
3. Implement minimal upstream fix.
4. Add regression test, keep implementation scope narrow.

---

## Testing (TDD)

1. Major features and bug fixes start RED.
2. GREEN with the simplest passing implementation.
3. REFACTOR with tests as the safety net.
4. Never delete or weaken existing tests without explanation.
5. Keep mocks at I/O boundaries; pure functions get called directly.

---

## Verification (before claiming "done")

- `npm run build` passes.
- `npm test` passes.
- `npm run eval` clear of regressions (when prompt/tool/SKILL changed).
- Manual smoke of the user-visible path (or evidence path).
- Show output of the actual command run; "should work" is not done.

---

## Tool Preferences (Cascade)

- Search code → `grep_search` (not shell `grep` / `rg`).
- Find files → `find_by_name` (not shell `find` / `dir`).
- Codebase reconnaissance → `code_search` (Fast Context subagent).
- Read multiple files → **parallel** `read_file` calls.
- Single-file edit → `edit`; multi-edit same file → `multi_edit`;
  new file → `write_to_file` (never overwrites existing).
- Long command output → `Select-Object -Last N` / `Select-String`.
- **NEVER** put `cd` inside `run_command` — use the `Cwd` parameter.

---

## What This Project Is **Not**

- Not a single-runtime Agent system (frontend + backend run side-by-side
  by design; convergence proposed in `agent-experience-overhaul`).
- Not a true vision-consistency system — `verify_image_semantic` checks
  semantic match, not identity embedding.
- Not multi-tenant — assets and memories are per-user / per-project.
- Not a subagent orchestrator yet — design exists, build does not.

---

## See Also

- `@d:\PythonProject\lang-video-work-flow\README.md` — full feature catalog
- `@d:\PythonProject\lang-video-work-flow\ARCHITECTURE.md` — design rationale + 3 tradeoffs
- `@d:\PythonProject\lang-video-work-flow\AGENT_SKILLS_REFERENCE.md` — 19 SKILL modules + phase matrix
- `@d:\PythonProject\lang-video-work-flow\EVAL.md` — regression baseline + scenario DSL
- `@d:\PythonProject\lang-video-work-flow\ROADMAP.md` — open changes + status
- `@d:\PythonProject\lang-video-work-flow\CHANGELOG.md` — release-style history
- `@d:\PythonProject\lang-video-work-flow\AI_BUILDER_EVIDENCE.md` — evaluator-facing evidence pack
