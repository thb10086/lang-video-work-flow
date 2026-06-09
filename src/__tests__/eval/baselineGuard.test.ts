/**
 * Eval Harness — Baseline Guard (CI entrypoint)
 *
 * This file is the runtime target of `npm run eval`. It is env-driven and
 * self-skips during the default `npm test` run, so adding/removing scenarios
 * does not slow down the regular test suite.
 *
 * Environment variables (set by scripts/run-eval.mjs):
 *   EVAL_HARNESS=1          Required flag — enables this test
 *   EVAL_ONLY=<glob>        Filter scenarios by id (supports *)
 *   EVAL_UPDATE_BASELINE=1  Overwrite baseline instead of comparing
 *   EVAL_OUTPUT=<path>      Custom report path (default eval-report.json)
 *   EVAL_BASELINE=<path>    Custom baseline path (default eval-baseline.json)
 *   EVAL_TOLERANCE=<0-1>    Regression score tolerance (default 0.05)
 *
 * Exit semantics (via Vitest):
 *   - Any scenario failure OR baseline regression => test fails => vitest exit 1
 *   - Missing baseline on first run => auto-create, pass
 *   - EVAL_UPDATE_BASELINE=1 => always overwrite baseline, skip comparison
 */

import { describe, it, expect } from 'vitest'
import { filterScenarios, loadAllScenarios, runScenario } from './runEval'
import { renderConsoleReport } from './reporters/consoleReporter'
import { writeJsonReport } from './reporters/jsonReporter'
import {
  compareToBaseline,
  hasBaseline,
  hasRegressions,
  loadBaseline,
  renderComparison,
  writeBaseline,
} from './baseline'

const ENABLED = process.env.EVAL_HARNESS === '1'
const ONLY = process.env.EVAL_ONLY || undefined
const UPDATE_BASELINE =
  process.env.EVAL_UPDATE_BASELINE === '1' || process.env.EVAL_UPDATE_BASELINE === 'true'
const OUTPUT_PATH = process.env.EVAL_OUTPUT || 'eval-report.json'
const BASELINE_PATH = process.env.EVAL_BASELINE || 'eval-baseline.json'
const TOLERANCE = Number(process.env.EVAL_TOLERANCE ?? 0.05)
const LATENCY_TOLERANCE = Number(process.env.EVAL_LATENCY_TOLERANCE ?? 0.10)
// `EVAL_PATHWAY` ∈ {'legacy', 'backend'} — set by eval-parity.mjs to tag
// each report with which Agent runtime drove it. Default is `legacy` to
// match historical behaviour.
const PATHWAY = (process.env.EVAL_PATHWAY === 'backend' ? 'backend' : 'legacy') as 'legacy' | 'backend'

describe.skipIf(!ENABLED)('Eval Harness — Baseline Guard', () => {
  it(
    'runs all scenarios and guards the baseline',
    async () => {
      // ── Discover ──
      const all = await loadAllScenarios()
      const scenarios = filterScenarios(all, ONLY)
      expect(
        scenarios.length,
        `No scenarios matched "${ONLY ?? '(all)'}" under src/__tests__/eval/scenarios/`,
      ).toBeGreaterThan(0)

      console.log(
        `\nEval Harness — running ${scenarios.length} scenario(s)${ONLY ? ` (filter: ${ONLY})` : ''}`,
      )

      // ── Execute ──
      const results = []
      for (const scn of scenarios) {
        process.stdout.write(`  [${scn.id}] `)
        const r = await runScenario(scn)
        process.stdout.write(
          `${r.passed ? 'PASS' : 'FAIL'} score=${r.score} tools=${r.toolCallCount} tokens=${r.tokensUsed} ${r.elapsedMs}ms\n`,
        )
        results.push(r)
      }

      // ── Write run report ──
      const { path: reportPath, report } = writeJsonReport(results, {
        outputPath: OUTPUT_PATH,
        pathway: PATHWAY,
      })
      console.log('\n' + renderConsoleReport(report))
      console.log(`\nReport written to ${reportPath}`)

      // ── Baseline update mode — overwrite and return early ──
      if (UPDATE_BASELINE) {
        writeBaseline(results, BASELINE_PATH)
        console.log(`Baseline updated at ${BASELINE_PATH}`)
        return
      }

      // ── Baseline comparison mode ──
      if (!hasBaseline(BASELINE_PATH)) {
        console.log(`\nNo baseline at ${BASELINE_PATH} — creating one from this run.`)
        writeBaseline(results, BASELINE_PATH)
      } else {
        const baseline = loadBaseline(BASELINE_PATH)
        const comparisons = compareToBaseline(results, baseline, {
          tolerance: TOLERANCE,
          latencyTolerance: LATENCY_TOLERANCE,
        })
        console.log('\n' + renderComparison(comparisons))
        const regressed = hasRegressions(comparisons)
        expect(
          regressed,
          `Baseline regression detected (score tolerance ${TOLERANCE * 100}% / ` +
            `latency tolerance ${LATENCY_TOLERANCE * 100}%). ` +
            `Run with --update-baseline to refresh intentionally.`,
        ).toBe(false)
      }

      // ── Fail on any scenario that did not pass ──
      const failed = results.filter(r => !r.passed)
      if (failed.length > 0) {
        const detail = failed
          .map(r => `[${r.id}] score=${r.score}\n  - ${r.issues.join('\n  - ')}`)
          .join('\n')
        throw new Error(`${failed.length} scenario(s) failed:\n${detail}`)
      }
    },
    120_000, // 2 min ceiling for the full baseline run
  )
})
