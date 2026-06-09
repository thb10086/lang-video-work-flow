import { describe, it, expect, afterEach } from 'vitest'
import { rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeJsonReport, buildReport } from './reporters/jsonReporter'
import { renderConsoleReport } from './reporters/consoleReporter'
import {
  writeBaseline,
  loadBaseline,
  compareToBaseline,
  hasRegressions,
  renderComparison,
  hasBaseline,
} from './baseline'
import type { ScenarioMetrics } from './types'

function makeMetric(partial: Partial<ScenarioMetrics>): ScenarioMetrics {
  return {
    id: partial.id ?? 'x',
    name: partial.name ?? 'X',
    passed: partial.passed ?? true,
    score: partial.score ?? 90,
    toolCallCount: partial.toolCallCount ?? 3,
    tokensUsed: partial.tokensUsed ?? 1000,
    toolResponseTokens: partial.toolResponseTokens ?? 0,
    elapsedMs: partial.elapsedMs ?? 100,
    timeToFirstEventMs: partial.timeToFirstEventMs ?? 50,
    timeToFirstToolCallMs: partial.timeToFirstToolCallMs ?? 50,
    meanEventIntervalMs: partial.meanEventIntervalMs ?? 25,
    issues: partial.issues ?? [],
    overBudget: partial.overBudget ?? { toolCalls: false, tokens: false, elapsed: false },
    toolLog: partial.toolLog ?? [],
  }
}

describe('buildReport', () => {
  it('aggregates passed/failed/averageScore', () => {
    const report = buildReport([
      makeMetric({ id: 'a', passed: true, score: 80 }),
      makeMetric({ id: 'b', passed: false, score: 40 }),
      makeMetric({ id: 'c', passed: true, score: 100 }),
    ])
    expect(report.summary.total).toBe(3)
    expect(report.summary.passed).toBe(2)
    expect(report.summary.failed).toBe(1)
    expect(report.summary.averageScore).toBeCloseTo(73.33, 1)
  })
})

describe('writeJsonReport', () => {
  const tmp = join(tmpdir(), 'eval-report-test.json')
  afterEach(() => { if (existsSync(tmp)) rmSync(tmp) })

  it('writes report to disk with pretty printing', () => {
    writeJsonReport([makeMetric({ id: 'x' })], { outputPath: tmp })
    expect(existsSync(tmp)).toBe(true)
    const content = readFileSync(tmp, 'utf-8')
    expect(content).toContain('"scenarios"')
    expect(content).toContain('"x"')
    // Pretty-printed (indent 2 → has newlines)
    expect(content).toContain('\n')
  })
})

describe('renderConsoleReport', () => {
  it('includes all scenario ids', () => {
    const report = buildReport([
      makeMetric({ id: '01-a', passed: true }),
      makeMetric({ id: '02-b', passed: false, issues: ['x'] }),
    ])
    const text = renderConsoleReport(report)
    expect(text).toContain('01-a')
    expect(text).toContain('02-b')
    expect(text).toContain('Failures')
  })

  it('does not throw on empty scenarios', () => {
    expect(() => renderConsoleReport(buildReport([]))).not.toThrow()
  })
})

describe('baseline comparison', () => {
  const tmp = join(tmpdir(), 'eval-baseline-test.json')
  afterEach(() => { if (existsSync(tmp)) rmSync(tmp) })

  it('writes and loads baseline', () => {
    const metrics = [makeMetric({ id: 'a', score: 80 })]
    writeBaseline(metrics, tmp)
    expect(hasBaseline(tmp)).toBe(true)
    const loaded = loadBaseline(tmp)
    expect(loaded.scenarios).toHaveLength(1)
    expect(loaded.scenarios[0].score).toBe(80)
  })

  it('detects regression beyond tolerance', () => {
    const baseline = buildReport([makeMetric({ id: 'a', score: 100 })])
    const current = [makeMetric({ id: 'a', score: 80 })] // 20% drop
    const cmp = compareToBaseline(current, baseline, { tolerance: 0.05 })
    expect(cmp).toHaveLength(1)
    expect(cmp[0].regressed).toBe(true)
    expect(hasRegressions(cmp)).toBe(true)
  })

  it('does not flag small fluctuations within tolerance', () => {
    const baseline = buildReport([makeMetric({ id: 'a', score: 100 })])
    const current = [makeMetric({ id: 'a', score: 96 })] // 4% drop
    const cmp = compareToBaseline(current, baseline, { tolerance: 0.05 })
    expect(cmp[0].regressed).toBe(false)
  })

  it('does not flag improvements', () => {
    const baseline = buildReport([makeMetric({ id: 'a', score: 80 })])
    const current = [makeMetric({ id: 'a', score: 95 })]
    const cmp = compareToBaseline(current, baseline, { tolerance: 0.05 })
    expect(cmp[0].scoreDelta).toBe(15)
    expect(cmp[0].regressed).toBe(false)
  })

  it('renderComparison produces non-empty text', () => {
    const baseline = buildReport([makeMetric({ id: 'a', score: 100 })])
    const current = [makeMetric({ id: 'a', score: 80 })]
    const cmp = compareToBaseline(current, baseline)
    const text = renderComparison(cmp)
    expect(text).toContain('Baseline Comparison')
    expect(text).toContain('YES')
  })

  it('loadBaseline throws helpful error when file missing', () => {
    expect(() => loadBaseline(join(tmpdir(), 'definitely-not-there.json'))).toThrow(/Baseline not found/)
  })
})

// ============================================================
// 0.11.5 — latency regression guard
// ============================================================

describe('baseline latency regressions (0.11.5)', () => {
  const baselineMetric = makeMetric({
    id: 'a',
    score: 100,
    timeToFirstEventMs: 100,
    timeToFirstToolCallMs: 100,
    meanEventIntervalMs: 50,
  })

  it('flags regression when timeToFirstEvent slows by more than tolerance', () => {
    const baseline = buildReport([baselineMetric])
    const current = [makeMetric({
      id: 'a', score: 100,
      timeToFirstEventMs: 130,            // +30% — over the 10% default
      timeToFirstToolCallMs: 100,
      meanEventIntervalMs: 50,
    })]
    const cmp = compareToBaseline(current, baseline, { latencyTolerance: 0.10 })
    expect(cmp[0].regressed).toBe(true)
    expect(cmp[0].latency!.timeToFirstEvent.regressed).toBe(true)
    expect(cmp[0].latency!.timeToFirstEvent.pctDelta).toBeCloseTo(0.3, 2)
    expect(cmp[0].latency!.timeToFirstToolCall.regressed).toBe(false)
  })

  it('flags regression when timeToFirstToolCall slows', () => {
    const baseline = buildReport([baselineMetric])
    const current = [makeMetric({
      id: 'a', score: 100,
      timeToFirstEventMs: 100,
      timeToFirstToolCallMs: 200,         // +100% slower
      meanEventIntervalMs: 50,
    })]
    const cmp = compareToBaseline(current, baseline, { latencyTolerance: 0.10 })
    expect(cmp[0].regressed).toBe(true)
    expect(cmp[0].latency!.timeToFirstToolCall.regressed).toBe(true)
  })

  it('flags regression when meanEventInterval grows', () => {
    const baseline = buildReport([baselineMetric])
    const current = [makeMetric({
      id: 'a', score: 100,
      timeToFirstEventMs: 100,
      timeToFirstToolCallMs: 100,
      meanEventIntervalMs: 90,            // +80% bigger gap = stuck thinking
    })]
    const cmp = compareToBaseline(current, baseline, { latencyTolerance: 0.10 })
    expect(cmp[0].regressed).toBe(true)
    expect(cmp[0].latency!.meanEventInterval.regressed).toBe(true)
  })

  it('does not flag improvements (faster is fine)', () => {
    const baseline = buildReport([baselineMetric])
    const current = [makeMetric({
      id: 'a', score: 100,
      timeToFirstEventMs: 50,             // 2× faster
      timeToFirstToolCallMs: 50,
      meanEventIntervalMs: 25,
    })]
    const cmp = compareToBaseline(current, baseline, { latencyTolerance: 0.10 })
    expect(cmp[0].regressed).toBe(false)
    expect(cmp[0].latency!.timeToFirstEvent.regressed).toBe(false)
  })

  it('treats baseline=0 as "no measurement" — never flags regression', () => {
    const baseline = buildReport([makeMetric({
      id: 'a', score: 100,
      timeToFirstEventMs: 0,              // chat-only baseline
      timeToFirstToolCallMs: 0,
      meanEventIntervalMs: 0,
    })])
    const current = [makeMetric({
      id: 'a', score: 100,
      timeToFirstEventMs: 200,            // current run has measurements
      timeToFirstToolCallMs: 200,
      meanEventIntervalMs: 100,
    })]
    const cmp = compareToBaseline(current, baseline, { latencyTolerance: 0.10 })
    expect(cmp[0].regressed).toBe(false)
    expect(cmp[0].latency!.timeToFirstEvent.regressed).toBe(false)
  })

  it('renderComparison includes latency line when latency data present', () => {
    const baseline = buildReport([baselineMetric])
    const current = [makeMetric({
      id: 'a', score: 100,
      timeToFirstEventMs: 130,
      timeToFirstToolCallMs: 105,
      meanEventIntervalMs: 50,
    })]
    const cmp = compareToBaseline(current, baseline, { latencyTolerance: 0.10 })
    const text = renderComparison(cmp)
    expect(text).toContain('latency:')
    expect(text).toContain('firstEvent')
    expect(text).toContain('firstTool')
    expect(text).toContain('meanInterval')
  })
})
