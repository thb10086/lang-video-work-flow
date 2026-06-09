/**
 * Baseline comparison — persists a reference report and detects regressions.
 * Node-only; imported only by the CLI entry point.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type {
  BaselineComparison,
  EvalReport,
  LatencyDelta,
  ScenarioMetrics,
} from './types'

export interface BaselineOptions {
  baselinePath?: string
  /** Score regression tolerance (0-1). Default 0.05 = 5%. */
  tolerance?: number
  /**
   * Latency regression tolerance (0-1). Default 0.10 = 10% — see 0.11.5.
   * Applies independently to timeToFirstEvent / timeToFirstToolCall /
   * meanEventInterval. A delta beyond this fraction marks the comparison
   * as `regressed`, which the CI guard turns into a failing run.
   */
  latencyTolerance?: number
}

export function hasBaseline(path: string = 'eval-baseline.json'): boolean {
  return existsSync(path)
}

export function loadBaseline(path: string = 'eval-baseline.json'): EvalReport {
  if (!existsSync(path)) {
    throw new Error(`Baseline not found at ${path}. Run with --update-baseline first.`)
  }
  const raw = readFileSync(path, 'utf-8')
  return JSON.parse(raw) as EvalReport
}

export function writeBaseline(
  scenarios: ScenarioMetrics[],
  path: string = 'eval-baseline.json',
): void {
  const report: EvalReport = {
    generatedAt: new Date().toISOString(),
    scenarios,
    summary: summarize(scenarios),
  }
  writeFileSync(path, JSON.stringify(report, null, 2), 'utf-8')
}

export function compareToBaseline(
  current: ScenarioMetrics[],
  baseline: EvalReport,
  opts: BaselineOptions = {},
): BaselineComparison[] {
  const tolerance = opts.tolerance ?? 0.05
  const latencyTolerance = opts.latencyTolerance ?? 0.10
  const byId = new Map(baseline.scenarios.map(s => [s.id, s]))
  const comparisons: BaselineComparison[] = []
  for (const cur of current) {
    const ref = byId.get(cur.id)
    if (!ref) {
      // New scenario — not a regression, not a baseline
      continue
    }
    const delta = cur.score - ref.score
    const scoreRegressed = delta < -Math.abs(ref.score * tolerance)

    // Latency regressions — we tolerate `latencyTolerance` × baseline ms
    // worse than the recorded baseline. Older baselines may not have
    // these fields, in which case we skip latency checks for that scenario
    // (no false positives) and let the next baseline-update populate them.
    let latency: BaselineComparison['latency'] = undefined
    let latencyRegressed = false
    if (
      typeof ref.timeToFirstEventMs === 'number' &&
      typeof ref.timeToFirstToolCallMs === 'number' &&
      typeof ref.meanEventIntervalMs === 'number'
    ) {
      const t1 = computeLatencyDelta(ref.timeToFirstEventMs, cur.timeToFirstEventMs, latencyTolerance)
      const t2 = computeLatencyDelta(ref.timeToFirstToolCallMs, cur.timeToFirstToolCallMs, latencyTolerance)
      const t3 = computeLatencyDelta(ref.meanEventIntervalMs, cur.meanEventIntervalMs, latencyTolerance)
      latency = { timeToFirstEvent: t1, timeToFirstToolCall: t2, meanEventInterval: t3 }
      latencyRegressed = t1.regressed || t2.regressed || t3.regressed
    }

    comparisons.push({
      scenario: cur.id,
      baselineScore: ref.score,
      currentScore: cur.score,
      scoreDelta: delta,
      regressed: scoreRegressed || latencyRegressed,
      latency,
    })
  }
  return comparisons
}

/**
 * Compute a `LatencyDelta` for a single metric. Both sides may legitimately
 * be 0 (chat-only finish, no tool calls) — in that case we report 0 delta
 * and never flag a regression.
 */
function computeLatencyDelta(baselineMs: number, currentMs: number, tolerance: number): LatencyDelta {
  // Treat baseline=0 specially. Current going non-zero is *fine* (more
  // events tracked) — only flag when the baseline had real measurements
  // and the current run got slower.
  if (baselineMs <= 0) {
    return { baselineMs, currentMs, pctDelta: 0, regressed: false }
  }
  const pctDelta = (currentMs - baselineMs) / baselineMs
  const regressed = pctDelta > tolerance
  return {
    baselineMs,
    currentMs,
    pctDelta: Math.round(pctDelta * 1000) / 1000,
    regressed,
  }
}

export function hasRegressions(comparisons: BaselineComparison[]): boolean {
  return comparisons.some(c => c.regressed)
}

export function renderComparison(comparisons: BaselineComparison[]): string {
  if (comparisons.length === 0) return 'No baseline comparisons (new run or no overlap).'
  const lines: string[] = []
  lines.push('Baseline Comparison')
  lines.push(formatCompareRow('Scenario', 'Baseline', 'Current', 'Delta', 'Regressed'))
  lines.push('-'.repeat(70))
  for (const c of comparisons) {
    lines.push(formatCompareRow(
      c.scenario.slice(0, 24).padEnd(24),
      String(c.baselineScore).padEnd(8),
      String(c.currentScore).padEnd(7),
      (c.scoreDelta >= 0 ? '+' : '') + c.scoreDelta.toFixed(1),
      c.regressed ? 'YES' : 'no',
    ))
    if (c.latency) {
      const fmtPct = (d: LatencyDelta): string =>
        `${d.pctDelta >= 0 ? '+' : ''}${(d.pctDelta * 100).toFixed(1)}%${d.regressed ? '⚠' : ''}`
      lines.push('  latency: ' +
        `firstEvent ${c.latency.timeToFirstEvent.currentMs}ms (${fmtPct(c.latency.timeToFirstEvent)}), ` +
        `firstTool ${c.latency.timeToFirstToolCall.currentMs}ms (${fmtPct(c.latency.timeToFirstToolCall)}), ` +
        `meanInterval ${c.latency.meanEventInterval.currentMs}ms (${fmtPct(c.latency.meanEventInterval)})`)
    }
  }
  return lines.join('\n')
}

function formatCompareRow(...cells: string[]): string {
  return cells.map(c => c.toString().padEnd(10)).join(' ')
}

function summarize(scenarios: ScenarioMetrics[]): EvalReport['summary'] {
  const passed = scenarios.filter(s => s.passed).length
  return {
    total: scenarios.length,
    passed,
    failed: scenarios.length - passed,
    averageScore:
      scenarios.length > 0
        ? Math.round((scenarios.reduce((a, s) => a + s.score, 0) / scenarios.length) * 100) / 100
        : 0,
    totalTokens: scenarios.reduce((a, s) => a + s.tokensUsed, 0),
    totalElapsedMs: scenarios.reduce((a, s) => a + s.elapsedMs, 0),
  }
}
