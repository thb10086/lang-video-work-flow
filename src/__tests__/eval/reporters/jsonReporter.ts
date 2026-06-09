/**
 * JSON reporter — persists the full ScenarioMetrics[] to disk.
 * Node-only (uses fs). Safe to import from the CLI entry point; must NOT be
 * imported from browser/test runtime paths.
 */

import { writeFileSync } from 'node:fs'
import type { EvalReport, ScenarioMetrics } from '../types'

export interface JsonReporterOptions {
  /** Absolute or cwd-relative path. Defaults to `eval-report.json` in cwd. */
  outputPath?: string
  /** Pretty-print indent (default 2) */
  indent?: number
  /** Pathway tag (eval-parity.mjs sets this). */
  pathway?: 'legacy' | 'backend'
}

export function writeJsonReport(
  scenarios: ScenarioMetrics[],
  opts: JsonReporterOptions = {},
): { path: string; report: EvalReport } {
  const outputPath = opts.outputPath ?? 'eval-report.json'
  const report = buildReport(scenarios, opts.pathway)
  writeFileSync(outputPath, JSON.stringify(report, null, opts.indent ?? 2), 'utf-8')
  return { path: outputPath, report }
}

export function buildReport(scenarios: ScenarioMetrics[], pathway?: 'legacy' | 'backend'): EvalReport {
  const passed = scenarios.filter(s => s.passed).length
  const averageScore =
    scenarios.length > 0
      ? scenarios.reduce((acc, s) => acc + s.score, 0) / scenarios.length
      : 0
  return {
    generatedAt: new Date().toISOString(),
    scenarios,
    pathway,
    summary: {
      total: scenarios.length,
      passed,
      failed: scenarios.length - passed,
      averageScore: Math.round(averageScore * 100) / 100,
      totalTokens: scenarios.reduce((acc, s) => acc + s.tokensUsed, 0),
      totalElapsedMs: scenarios.reduce((acc, s) => acc + s.elapsedMs, 0),
    },
  }
}
