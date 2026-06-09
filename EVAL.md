# Evaluation

> Quantitative regression baseline for the Agent loop. Every change to
> prompts, tools, or skill modules must clear `npm run eval` before merge.
> Full DSL reference: `@d:\PythonProject\lang-video-work-flow\docs\agent-eval.md`.

---

## 1. Why a Dedicated Eval Harness

Unit tests assert "function X returns Y for input Z". The eval harness
asserts "given **prompt P** and **canvas C**, the Agent reaches outcome O
within budget B". This is the difference Anthropic flags in *Effective
Harnesses for Long-Running Agents* — without it, prompt edits ship "by
feel".

Three properties the harness gives us that unit tests cannot:

1. **End-to-end coverage** — drives the real `chatStore` agent loop
   through tool dispatch + canvas mutations, not a mocked subset.
2. **Deterministic replay** — `mockLLMScript` returns identical
   `tool_calls` every run; CI is bit-stable, regressions are bisectable.
3. **Quantitative regression gate** — `eval-baseline.json` rejects any
   metric drop > 5 % (configurable via `--tolerance`).

---

## 2. Current Baseline (2026-05-10)

`@d:\PythonProject\lang-video-work-flow\eval-baseline.json`

| Scenario | Score | Tool calls | Tokens | Elapsed (ms) |
|----------|-------|------------|--------|---------------|
| `01-product-ad` Product Ad One-Shot | **100** | 4 | 174 | 6 |
| `02-short-story` Three-Shot Cyberpunk Short | **100** | 3 | 129 | 3 |
| `03-character-fix` Update Character Appearance | **100** | 2 | 58 | 1 |
| `04-batch-execute` Direct Image Node Creation | **100** | 1 | 33 | 1 |
| `08-discover-tools` Tier-3 Reveal | **100** | 1 | 1213 | 0 |
| `11-vision-accept` Vision Verify — Accept | **100** | 2 | 162 | 1 |
| `12-vision-retry` Vision Verify — Retry | **100** | 3 | 183 | 42 |
| `13-vision-edit-prompt` Vision Verify — Edit Prompt | **100** | 4 | 225 | 0 |
| **Summary** | 8/8 passed · avg **100** | 20 | **2177** | 54 |

The `0x` series exercises canvas creation, workflow generation, direct
node dispatch (`04`), and tool-discovery (`08`); the `1[1-3]` series
exercises the three Vision Verify branches (`accept` / `retry` /
`edit_prompt`). Six more scenarios are drafted in
`@d:\PythonProject\lang-video-work-flow\src\__tests__\eval\scenarios\PLANNED.md`.

---

## 3. Running Locally

```bash
# Full suite, compared against baseline (CI-equivalent)
npm run eval

# Filter by id glob
npm run eval -- --only 01-product-ad
npm run eval -- --only 1*

# Stricter tolerance (default 5 %)
npm run eval -- --tolerance 0.02

# Approve a deliberate drift after intentional behaviour change
npm run eval:update

# Custom output path
npm run eval -- --output /tmp/my-eval.json
```

Exit codes:

| Code | Meaning |
|------|---------|
| 0    | All scenarios passed and no regressions |
| 1    | A scenario failed its verifier **or** a metric regressed > tolerance |
| 2    | CLI usage error |

---

## 4. Scenario Anatomy

Drop a file into `src/__tests__/eval/scenarios/NN-name.ts`, no other
wiring — `runEval.ts` discovers it via `import.meta.glob`. Each scenario
declares **inputs**, **a deterministic LLM script**, **a budget**, and
**a verifier**. Excerpt from `01-product-ad`:

```typescript
const scenario: Scenario = {
  id: '01-product-ad',
  userMessage: '帮我做一个 15 秒护肤品广告...',
  expectedToolCalls: ['classify_image', 'detect_scenario', 'generate_workflow', 'verify_task'],
  toolCallOrder: 'ordered',
  budget: { maxToolCalls: 5, maxTokens: 15_000, maxElapsedMs: 3_000 },
  mockLLMScript: [ /* 4 rounds */ ],
  verifier: ({ canvas, toolLog }) => { /* 0-100 score */ },
}
```

Full grammar: `@d:\PythonProject\lang-video-work-flow\src\__tests__\eval\types.ts`.

---

## 5. Regression Gate

Built on top of `src/__tests__/eval/baseline.ts:hasRegressions`. For each
scenario in the baseline, current run is compared metric-by-metric:

- `score` drop > 5 % → fail
- `tokensUsed` rise > 5 % → fail
- `toolCallCount` rise → fail (any increase, not %)
- `elapsedMs` rise > 5 % → warn (not fail; CI noise)

Common causes when red:

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `tokensUsed` up across most scenarios | Prompt segment grew | Audit `chatPromptBuilder` + `skills/*.ts` token counts |
| `toolCallCount` up on one scenario | Tool tier reshuffle exposed a new tool to the LLM | Decide intentional → `npm run eval:update` |
| `score` down to 0 on one scenario | Verifier asserts a field the Agent stopped writing | Read `toolLog` in the report, find the missing tool call |
| Mock backend mismatch | `mockBackend.ts` return shape changed | Audit `MockVerifyResponse` / `MockImageResponse` first |

---

## 6. Mock Backend + Mock LLM

The harness has zero external dependencies. Two layers replace real
services:

- **`mockLLM.ts`** — replays `mockLLMScript` per round, supports
  branching on prior tool result and failure injection.
- **`mockBackend.ts`** — sandboxes `backendApi.*` (image/video/audio
  generate, vision verify, COS upload, model list). Per-scenario overrides
  via `scenario.mockBackend`. Tested by `mockBackend.test.ts`.

This is the same pattern the upcoming SSE migration
(`agent-experience-overhaul`) builds on — `mockClientBridge.ts` already
exists for the reverse `client_tool_call` RPC.

---

## 7. CI Hookup

`baselineGuard.test.ts` is gated behind `EVAL_HARNESS=1`, so the default
`npm test` run is unaffected. Recommended job:

```yaml
eval:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 22, cache: 'npm' }
    - run: npm ci
    - run: npm run eval
    - uses: actions/upload-artifact@v4
      if: always()
      with: { name: eval-report, path: eval-report.json }
```

Keep allow-fail until 2–3 weeks of green; flip to required afterwards.

---

## 8. Adding Coverage

Three signals it is time to add a scenario:

- a new tool was registered (every tool needs ≥ 1 happy-path scenario)
- a new SKILL phase was introduced (verify it is gated correctly)
- a regression slipped through (lock it down with a scenario before fixing)

Anti-patterns:

- **Mega-scenarios** — split by intent, one focused goal per file.
- **Verifier > 15 assertions** — score arithmetic becomes unreadable.
- **Hardcoded ids in `mockLLMScript`** — use the same id constants as
  `initialCanvas` so refactor only touches one place.

---

## 9. Field Reports (Dogfood Telemetry)

> The harness gives us deterministic regression coverage. It does **not**
> tell us whether the Agent feels useful when a real user steers it.
> This section captures dogfood runs — the maintainer or invited testers
> running the system end-to-end on the live UI, not the mock backend.
>
> Append entries here. Do not delete entries unless their workflow is no
> longer reproducible (in which case move to a new § 9.x "Retired").

### 9.0 How to run a dogfood pass

```bash
# Terminal 1 — backend
cd server
alembic upgrade head      # MUST be done before first run
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# Terminal 2 — frontend
npm install               # if not done
npm run dev               # http://localhost:3001
```

Then exercise **5 different scenarios** end-to-end (one per row of the
table below). Each pass records:

- **Round-trip wall time** — stopwatch from "send first message" to
  "final video shown / Agent says done"
- **Tool calls** — read off the chat panel's tool log
- **Tokens (estimate)** — either via the dev console
  (`[agent-tools] tier=auto tools=N ~Xtok` is logged on every turn) or
  the LLM provider dashboard if available
- **Failures observed** — every reload / dead button / wrong output;
  free-form
- **What we learned** — one sentence; the part you want future-you to
  remember

### 9.1 Dogfood checklist (5 scenarios)

| # | Type | Suggested ask | Why this case |
|---|------|--------------|---------------|
| D1 | Product ad (single shot) | "做一个 15 秒护肤品广告，补水修护，清新极简" | covers `detect_scenario` → `generate_workflow` → `execute_canvas` happy path; mirrors `01-product-ad` mock |
| D2 | Multi-shot character story | "3 镜头赛博朋克，主角林夏，霓虹雨夜" | exercises `characterManager` + cross-shot consistency; mirrors `02-short-story` |
| D3 | Character edit on existing canvas | start from D2's canvas, then "把林夏的头发改成白色" | exercises `update_node` minimal-edit reflex; mirrors `03-character-fix` |
| D4 | Asset library + `@`-ref | save D2's 林夏 as a character asset, then in a new project type "@林夏 走进咖啡馆" | exercises the entire `asset-library` + `at-reference-system` + `model-reference-adapter` chain |
| D5 | Vision verify on real image | after D1 finishes generating, run `verify_image_semantic` from chat | exercises real `gemini-vision` adapter (not the mock) and the three-branch routing in production |

### 9.2 Field Report Template (one entry per scenario)

Copy this block and fill the angle-bracketed fields. Append the result
to § 9.3 below.

```markdown
#### D? · <short-title> · <yyyy-mm-dd> · <tester-handle>

- **Ask** — <verbatim user prompt>
- **Outcome** — <✅ shipped / ⚠ partial / ❌ blocked>
- **Wall time** — <Xs> from first user message to last assistant turn
- **Tool calls observed** — <N> (e.g. `detect_scenario`, `generate_workflow`, `execute_canvas`)
- **Estimated tokens** — <X> (source: dev console / provider dashboard)
- **Failures** — <one bullet per discrete issue, copy stack/error if any>
- **Learned** — <one sentence the next session should benefit from>
- **Action items** — <bug ids / proposal ids spawned, e.g. "opened
  `agent-experience-overhaul/tasks.md` task 4.2 about reload race">
```

### 9.3 Reports

*No entries yet — first dogfood pass pending.* The 5 entries below will
be filled by the next session running `npm run dev` against the live
backend. Until then, the eval harness alone is the verification floor.

<!-- TEMPLATE
#### D1 · Skincare ad · 2026-mm-dd · maintainer
- **Ask** — ...
- **Outcome** — ...
...
-->

### 9.4 Aggregate (auto-fill once § 9.3 has entries)

| Metric | Mock baseline (§ 2) | Dogfood (§ 9.3) | Delta |
|--------|--------------------|------------------|-------|
| Avg tool calls / scenario | 2.5 | _t.b.d._ | _t.b.d._ |
| Avg tokens / scenario | 272 | _t.b.d._ | _t.b.d._ |
| Avg wall time / scenario | 7 ms (mock) | _t.b.d._ | _t.b.d._ |
| Failure rate | 0/8 | _t.b.d._ | _t.b.d._ |

Significant deltas point to areas where the mock harness is over-fitted
(too easy) or under-fitted (missing realistic latency / failure modes).

---

## See Also

- `@d:\PythonProject\lang-video-work-flow\docs\agent-eval.md` — full DSL
- `@d:\PythonProject\lang-video-work-flow\openspec\specs\agent-eval-harness\spec.md`
- `@d:\PythonProject\lang-video-work-flow\src\__tests__\eval\runEval.ts`
- `@d:\PythonProject\lang-video-work-flow\src\__tests__\eval\scenarios\PLANNED.md` — 6 next scenarios drafted
- `@d:\PythonProject\lang-video-work-flow\AI_BUILDER_EVIDENCE.md` — full Verification Domain evidence pack
- `@d:\PythonProject\lang-video-work-flow\CASE_STUDIES.md` — the 8 baseline scenarios told as user stories
