/**
 * Console reporter — renders a human-readable summary table after an eval run.
 * Uses plain ASCII (no unicode box chars) so Windows cmd.exe renders cleanly.
 */

import type { EvalReport, ScenarioMetrics } from '../types'

export function renderConsoleReport(report: EvalReport): string {
  const lines: string[] = []
  lines.push('')
  lines.push('Eval Report')
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push('')
  lines.push(formatRow('ID', 'Passed', 'Score', 'Tools', 'Tokens', 'ToolTok', 'Time(ms)', 'Issues'))
  lines.push('-'.repeat(100))
  for (const s of report.scenarios) {
    lines.push(formatRow(
      s.id.padEnd(20).slice(0, 20),
      s.passed ? 'YES' : 'NO ',
      String(s.score),
      String(s.toolCallCount),
      String(s.tokensUsed),
      String(s.toolResponseTokens),
      String(s.elapsedMs),
      s.issues.length === 0 ? '-' : `${s.issues.length} issues`,
    ))
  }
  lines.push('-'.repeat(92))
  lines.push(formatSummaryLine(report))
  // Detail: first-N issues per failed scenario
  const failed = report.scenarios.filter(s => !s.passed)
  if (failed.length > 0) {
    lines.push('')
    lines.push('Failures')
    for (const s of failed) {
      lines.push(`  [${s.id}] ${s.name}`)
      for (const issue of s.issues.slice(0, 5)) {
        lines.push(`    - ${issue}`)
      }
      if (s.overBudget.toolCalls) lines.push(`    - over tool-call budget (${s.toolCallCount})`)
      if (s.overBudget.tokens) lines.push(`    - over token budget (${s.tokensUsed})`)
      if (s.overBudget.elapsed) lines.push(`    - over time budget (${s.elapsedMs}ms)`)
    }
  }
  return lines.join('\n')
}

function formatRow(
  id: string,
  passed: string,
  score: string,
  tools: string,
  tokens: string,
  toolTokens: string,
  time: string,
  issues: string,
): string {
  return [
    id.padEnd(20),
    passed.padEnd(6),
    score.padEnd(5),
    tools.padEnd(5),
    tokens.padEnd(8),
    toolTokens.padEnd(8),
    time.padEnd(8),
    issues.padEnd(20),
  ].join(' ')
}

function formatSummaryLine(report: EvalReport): string {
  const { total, passed, failed, averageScore, totalTokens, totalElapsedMs } = report.summary
  return (
    `Total: ${total}  Passed: ${passed}  Failed: ${failed}  ` +
    `AvgScore: ${averageScore}  Tokens: ${totalTokens}  Time: ${totalElapsedMs}ms`
  )
}

/** Pretty-print a ScenarioMetrics for debugging a single run */
export function renderScenarioDetail(s: ScenarioMetrics): string {
  const lines: string[] = []
  lines.push(`Scenario: ${s.id} (${s.name})`)
  lines.push(`  Passed: ${s.passed} | Score: ${s.score} | Tools: ${s.toolCallCount} | Tokens: ${s.tokensUsed} | Time: ${s.elapsedMs}ms`)
  if (s.issues.length > 0) {
    lines.push('  Issues:')
    for (const i of s.issues) lines.push(`    - ${i}`)
  }
  if (s.toolLog.length > 0) {
    lines.push('  Tool log:')
    for (const t of s.toolLog) {
      lines.push(`    [${t.roundIndex}] ${t.tool}(${Object.keys(t.args).join(',')}) -> ${t.success ? 'ok' : 'fail'} (${t.elapsedMs}ms)`)
    }
  }
  return lines.join('\n')
}
