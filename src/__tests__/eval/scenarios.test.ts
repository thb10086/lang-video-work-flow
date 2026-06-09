/**
 * End-to-end smoke test: auto-discover and run every scenario under scenarios/.
 *
 * This doubles as the "scenarios all pass baseline" check called out in
 * Task 1.10 of the tasks.md. It is what `npm run eval` executes internally.
 */

import { describe, it, expect } from 'vitest'
import { loadAllScenarios, runScenario } from './runEval'
import { buildReport } from './reporters/jsonReporter'

describe('Eval scenarios (baseline)', () => {
  it('auto-discovers all scenarios in scenarios/', async () => {
    const all = await loadAllScenarios()
    expect(all.length).toBeGreaterThanOrEqual(3)
    const ids = all.map(s => s.id).sort()
    expect(ids).toContain('01-product-ad')
    expect(ids).toContain('02-short-story')
    expect(ids).toContain('03-character-fix')
  })

  it('each scenario runs and produces a valid ScenarioMetrics', async () => {
    const all = await loadAllScenarios()
    for (const scn of all) {
      const result = await runScenario(scn)
      // Structural invariants, not pass/fail assertions — the baseline captures
      // the actual scores. Here we just validate the runner contract.
      expect(result.id).toBe(scn.id)
      expect(typeof result.score).toBe('number')
      expect(result.score).toBeGreaterThanOrEqual(0)
      expect(result.score).toBeLessThanOrEqual(100)
      expect(result.toolCallCount).toBeGreaterThanOrEqual(0)
      expect(result.toolLog.length).toBe(result.toolCallCount)
    }
  }, 30_000) // generous timeout for 3 scenarios

  it('all baseline scenarios pass', async () => {
    const all = await loadAllScenarios()
    const results = []
    for (const scn of all) {
      results.push(await runScenario(scn))
    }
    const report = buildReport(results)
    const failedScenarios = results.filter(r => !r.passed)
    if (failedScenarios.length > 0) {
      // Surface all failure details in one shot so CI diagnostics are helpful
      const detail = failedScenarios
        .map(s => `[${s.id}] score=${s.score}\n  - ${s.issues.join('\n  - ')}`)
        .join('\n')
      throw new Error(`${failedScenarios.length} scenario(s) failed:\n${detail}`)
    }
    expect(report.summary.passed).toBe(report.summary.total)
  }, 30_000)
})
