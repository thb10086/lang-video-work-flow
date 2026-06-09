# Agent Evaluation Harness

Declarative, deterministic end-to-end test runner for the Agent loop. Every
scenario is a single TypeScript file under
`src/__tests__/eval/scenarios/` that describes a user request, a mocked LLM
script, optional canvas seeding, and a verifier function. The CI entry
point is `npm run eval`.

---

## Why a dedicated harness (vs. regular unit tests)?

- **End-to-end coverage** — a scenario drives the real `chatStore` through
  the full Agent loop (tool dispatch, canvas mutations, response parsing),
  not a mocked subset.
- **Deterministic replay** — scripted `mockLLMScript` returns identical
  tool_calls on every run, so CI is stable and regressions are bisectable.
- **Quantitative baselines** — each run writes `eval-report.json` with
  tokens, tool-call counts, elapsed time, and per-scenario scores. The
  baseline guard (`eval-baseline.json`) rejects any drop of > 5 %.
- **No external dependencies** — `mockBackend` replaces `backendApi.*` so
  scenarios never hit the network, COS, or the LLM gateway.

---

## Running scenarios

```bash
# Full suite, compared against baseline
npm run eval

# Filter by id glob (supports `*`)
npm run eval -- --only 01-product-ad
npm run eval -- --only 1*               # all 10+ scenarios

# Strict regression tolerance (default 5 %)
npm run eval -- --tolerance 0.02

# Refresh the baseline (use after intentional behaviour changes)
npm run eval:update
# equivalent to
npm run eval -- --update-baseline

# Write the run report to a custom path
npm run eval -- --output /tmp/my-eval.json
```

Exit codes:

| Code | Meaning |
|------|---------|
| 0    | All scenarios passed and no regressions |
| 1    | A scenario failed its verifier **or** a baseline regression was detected |
| 2    | CLI usage error (unknown flag) |

---

## Writing a new scenario

Drop a file into `src/__tests__/eval/scenarios/NN-name.ts`. No other wiring
— `runEval.ts` auto-discovers it via `import.meta.glob`.

Minimal template:

```ts
import { roundCall, roundFinish } from '../mockLLM'
import type { Scenario } from '../types'

const scenario: Scenario = {
  id: '14-my-scenario',                      // kebab-case, filename prefix
  name: 'Human-Readable Name',
  userMessage: '用中文写清楚用户在聊天框会发的那段话。',

  // (optional) Seed the canvas before the user message is processed.
  initialCanvas: {
    nodes: [
      { id: 'seed_1', type: 'characterGrid', position: { x: 0, y: 0 }, data: { label: '角色: 林夏', name: '林夏' } },
    ],
    edges: [],
  },

  // Which tool names the Agent is *expected* to dispatch.
  // Used for the verifier sanity-check — not a hard allowlist.
  expectedToolCalls: ['get_canvas_state', 'update_node'],
  toolCallOrder: 'ordered',    // 'any' if ordering doesn't matter

  // Hard budgets — exceeding any one fails the scenario.
  budget: {
    maxToolCalls: 5,
    maxTokens: 15_000,
    maxElapsedMs: 3_000,
  },

  // Deterministic LLM replay. Each round describes what the mock LLM
  // "returns" for the next agent step.
  mockLLMScript: [
    roundCall('get_canvas_state', {}),
    roundCall('update_node', { nodeId: 'seed_1', updates: { name: '新名字' } }),
    roundFinish('已更新。'),
  ],

  // (optional) Override the default mock backend responses per-service.
  mockBackend: {
    verify: { response: { matchScore: 85, detectedSubjects: [], missingElements: [], unexpectedElements: [], recommendation: 'accept', reasoning: 'ok' } },
    image:  { response: { images: [{ url: 'mock://img.png', mime_type: 'image/png' }] } },
    video:  { response: { task_id: 't', status: 'succeeded', output_url: 'mock://v.mp4' } },
  },

  // Your verifier — called after the Agent loop ends. Must return
  // { passed, score (0-100), issues[] }.
  verifier: ({ canvas, toolLog, finalMessage }) => {
    const issues: string[] = []
    if (!toolLog.some(t => t.tool === 'update_node' && t.success)) {
      issues.push('update_node did not succeed')
    }
    const seed = canvas.nodes.find(n => n.id === 'seed_1')
    if (seed?.data.name !== '新名字') issues.push('canvas name not updated')
    return { passed: issues.length === 0, score: 100 - issues.length * 20, issues }
  },
}

export default scenario
```

### Rules of thumb

- **One focused intent per scenario.** Split into multiple files rather
  than writing a mega-scenario.
- **Assertion budget:** keep the verifier under ~15 assertions so score
  arithmetic remains legible in the report.
- **Deterministic IDs:** use fixed node/asset ids in `initialCanvas` and
  reference them from `mockLLMScript` args.
- **Budgets as guardrails:** set `maxToolCalls` only ~20 % above the
  expected count so runaway loops fail fast.
- **Mock backend precedence:** `customResponse(callIndex)` > `response` >
  baked-in default. Use `customResponse` for scenarios that need varying
  responses across calls (e.g. retry after failure).

---

## Reading the report

`eval-report.json` (written on every run):

```jsonc
{
  "generatedAt": "2026-04-24T01:49:50.947Z",
  "scenarios": [
    {
      "id": "11-vision-accept",
      "name": "Vision Verify — Accept (high matchScore)",
      "passed": true,
      "score": 100,
      "toolCallCount": 2,
      "tokensUsed": 162,         // total tokens across the whole run
      "toolResponseTokens": 137, // subset: tool_result payloads only
      "elapsedMs": 1,
      "issues": [],
      "overBudget": { "toolCalls": false, "tokens": false, "elapsed": false },
      "toolLog": [ /* ordered trace */ ]
    }
  ],
  "summary": { "total": 6, "passed": 6, "failed": 0, "averageScore": 100, ... }
}
```

Key metrics:

- **`tokensUsed`** — the headline number for regression detection.
  Expected to drop after Phase-2 (`toolBudget`) and Phase-3 (prompt
  caching) optimisations. Use `toolResponseTokens` to isolate the
  tool-budget effect.
- **`elapsedMs`** — deterministic in CI (mocked latency), but still useful
  for spotting runaway loops. Budgets should scale with the expected
  number of tool rounds.
- **`toolLog`** — full ordered trace with args, success flag, and
  per-call elapsed. First place to look when a scenario fails.

---

## Baseline workflow

`eval-baseline.json` is checked into the repo. Every scenario in the
baseline is compared against the current run using a per-metric
regression detector (`src/__tests__/eval/baseline.ts:hasRegressions`).

| Intent | Command |
|--------|---------|
| Validate PR does not regress | `npm run eval` |
| Approve a score change (refactor, scenario update) | `npm run eval:update` |
| Temporary stricter check on a hot path | `npm run eval -- --tolerance 0.02` |

If a regression is detected, the output includes a per-scenario diff
table (see `renderComparison()` in `src/__tests__/eval/baseline.ts`). The
most common causes:

1. **Prompt drift** — a change to `chatPromptBuilder.ts` or a `skills/*`
   module nudged tool selection or token counts beyond the tolerance.
   *Fix:* re-read the offending scenario, decide if the change is
   intentional; if yes, `npm run eval:update`.
2. **Mock backend drift** — updating `mockBackend.ts` return shapes may
   change parsed token counts.
   *Fix:* audit `MockVerifyResponse` / `MockImageResponse` types before
   rewriting scenarios.
3. **Tool tier reshuffle** — moving a tool from Tier 3 → Tier 2 can
   expose it to more turns and increase tool call counts.
   *Fix:* re-baseline if intentional.

---

## CI integration

The harness is a single vitest test file (`baselineGuard.test.ts`) gated
by `EVAL_HARNESS=1` env var, so it's a no-op during the default
`npm test` run. Recommended CI job:

```yaml
# .github/workflows/eval.yml (example)
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
      with:
        name: eval-report
        path: eval-report.json
```

Keep the job out of the critical merge path at first (allow failures),
flip to required once 2–3 weeks of green runs establish confidence.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|--------|-------------|-----|
| `No scenarios matched "…"` | Typo in `--only` glob | Check the filename prefix (`NN-*.ts`). |
| `TypeError: backendApi.X is not a function` | `mockBackend.install()` not installed for that service | Extend the controller in `mockBackend.ts`. |
| Vitest "transform failed" for a scenario file | Import path typo or missing default export | Scenario files MUST `export default scenario`. |
| Scenario hangs past 120s | Mock LLM script never yields `roundFinish` | Every script must end with a `finish` round. |
| Regression detected but no code change | Non-deterministic ordering in `toolCallOrder: 'any'` | Pin the order or set `toolCallOrder: 'ordered'`. |

---

## See Also

- `src/__tests__/eval/types.ts` — full TypeScript contract for scenarios.
- `src/__tests__/eval/runEval.ts` — the runner (scenario discovery, canvas
  seeding, mock install, metric collection).
- `src/__tests__/eval/mockBackend.ts` — backend API sandbox.
- `src/__tests__/eval/mockLLM.ts` — deterministic LLM replay.
- `scripts/run-eval.mjs` — thin CLI wrapper that maps `--flags` to env vars.
