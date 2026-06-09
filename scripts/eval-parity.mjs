#!/usr/bin/env node
/**
 * Eval Parity — runs each scenario twice and asserts the two pathways
 * agree on the externally observable outcomes.
 *
 *   Pass 1 (legacy):  EVAL_PATHWAY=legacy  → drives chatStore's
 *                     existing for-loop (mocked LLM via mockBackend).
 *   Pass 2 (backend): EVAL_PATHWAY=backend → in the future, drives the
 *                     SSE-driven backend runtime via the mock client
 *                     bridge. Today (Phase 1, while runScenario is still
 *                     pathway-agnostic) this exercises the same code path
 *                     and acts as a self-check that the harness machinery
 *                     itself is deterministic.
 *
 * Each pass writes its own JSON report; this driver then diffs the two
 * and exits non-zero on any meaningful divergence:
 *
 *   - passed flag mismatch                                        (FATAL)
 *   - score delta beyond `--score-tolerance`  (default 0)         (FATAL)
 *   - toolCallCount mismatch                                      (FATAL)
 *   - tool sequence (names only) divergence                       (FATAL)
 *   - elapsed delta beyond `--elapsed-tolerance` (default 50%)    (warn)
 *
 * Usage:
 *   node scripts/eval-parity.mjs
 *   node scripts/eval-parity.mjs -- --only 01-product-ad
 *   node scripts/eval-parity.mjs -- --score-tolerance 0
 *
 * The script intentionally lives at scripts/ (not src/__tests__/eval/)
 * so CI can wire it as a top-level npm script:
 *
 *     "scripts": { "eval:parity": "node scripts/eval-parity.mjs" }
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================
// CLI parsing
// ============================================================

const argv = process.argv.slice(2)
const opts = {
  only: undefined,
  scoreTolerance: 0,        // bit-for-bit identical scores by default
  elapsedTolerance: 0.5,    // 50% wall-clock fluctuation is tolerated
  legacyReport: 'eval-report-legacy.json',
  backendReport: 'eval-report-backend.json',
  keepReports: false,       // delete after diff unless --keep-reports
  forceBaseline: false,     // pass --update-baseline through
}

function printHelp() {
  console.log(`
Eval Parity — double-run scenario harness (legacy vs backend pathway)

Usage:
  node scripts/eval-parity.mjs [-- flags]

Flags:
  --only <glob>             Filter scenarios (forwarded to vitest)
  --score-tolerance <0-1>   Allowed score delta between paths (default 0)
  --elapsed-tolerance <0-1> Allowed wall-clock delta (default 0.5 = 50%)
  --legacy-report <path>    Output path for legacy run (default eval-report-legacy.json)
  --backend-report <path>   Output path for backend run (default eval-report-backend.json)
  --keep-reports            Don't delete reports after the run
  --update-baseline         Forwarded as EVAL_UPDATE_BASELINE=1 to both runs
  --help                    Show this help
`)
}

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]
  switch (arg) {
    case '--only': opts.only = argv[++i]; break
    case '--score-tolerance': opts.scoreTolerance = Number(argv[++i]); break
    case '--elapsed-tolerance': opts.elapsedTolerance = Number(argv[++i]); break
    case '--legacy-report': opts.legacyReport = argv[++i]; break
    case '--backend-report': opts.backendReport = argv[++i]; break
    case '--keep-reports': opts.keepReports = true; break
    case '--update-baseline': opts.forceBaseline = true; break
    case '--help':
    case '-h': printHelp(); process.exit(0)
    default:
      console.error(`Unknown flag: ${arg}`)
      printHelp()
      process.exit(2)
  }
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ============================================================
// Pass runner — spawn vitest with the appropriate env vars
// ============================================================

function runPass(pathway, outputPath) {
  return new Promise((res, rej) => {
    const env = {
      ...process.env,
      EVAL_HARNESS: '1',
      EVAL_PATHWAY: pathway,
      EVAL_OUTPUT: outputPath,
    }
    if (opts.only) env.EVAL_ONLY = opts.only
    if (opts.forceBaseline) env.EVAL_UPDATE_BASELINE = '1'

    console.log(`\n=== Pass ${pathway === 'legacy' ? '1' : '2'} (${pathway}) ===`)
    const child = spawn(
      'npx',
      ['vitest', 'run', 'src/__tests__/eval/baselineGuard.test.ts', '--reporter=verbose'],
      { cwd: repoRoot, stdio: 'inherit', shell: true, env },
    )
    child.on('exit', code => (code === 0 ? res() : rej(new Error(`vitest exited ${code}`))))
    child.on('error', rej)
  })
}

// ============================================================
// Diff — load both reports and compare per-scenario
// ============================================================

function loadReport(path) {
  if (!existsSync(path)) {
    throw new Error(`Report not found at ${path}. Vitest must have crashed.`)
  }
  return JSON.parse(readFileSync(path, 'utf-8'))
}

/**
 * Returns an array of human-readable divergence strings. Empty array
 * means parity. Fatal divergences include `[FATAL]` prefix; warnings
 * use `[warn]`.
 */
function diffReports(legacy, backend) {
  const out = []
  const byId = new Map(backend.scenarios.map(s => [s.id, s]))

  for (const a of legacy.scenarios) {
    const b = byId.get(a.id)
    if (!b) {
      out.push(`[FATAL] [${a.id}] missing in backend report`)
      continue
    }

    if (a.passed !== b.passed) {
      out.push(`[FATAL] [${a.id}] passed mismatch: legacy=${a.passed} backend=${b.passed}`)
    }

    const scoreDelta = Math.abs(a.score - b.score)
    if (scoreDelta > a.score * opts.scoreTolerance + 0.001) {
      out.push(`[FATAL] [${a.id}] score divergence: legacy=${a.score} backend=${b.score} (Δ=${scoreDelta.toFixed(2)})`)
    }

    if (a.toolCallCount !== b.toolCallCount) {
      out.push(`[FATAL] [${a.id}] toolCallCount mismatch: legacy=${a.toolCallCount} backend=${b.toolCallCount}`)
    }

    // Tool sequence parity — same tools called in the same order.
    const aTools = (a.toolLog ?? []).map(t => t.tool)
    const bTools = (b.toolLog ?? []).map(t => t.tool)
    if (aTools.length !== bTools.length || aTools.some((n, i) => n !== bTools[i])) {
      out.push(`[FATAL] [${a.id}] tool sequence divergence:\n        legacy : ${JSON.stringify(aTools)}\n        backend: ${JSON.stringify(bTools)}`)
    }

    // Elapsed time — best-effort warning only (CI environment is noisy).
    if (a.elapsedMs > 0 && b.elapsedMs > 0) {
      const elapsedDelta = Math.abs(a.elapsedMs - b.elapsedMs) / a.elapsedMs
      if (elapsedDelta > opts.elapsedTolerance) {
        out.push(`[warn] [${a.id}] elapsed Δ=${(elapsedDelta * 100).toFixed(0)}% (legacy=${a.elapsedMs}ms backend=${b.elapsedMs}ms)`)
      }
    }
  }

  // Scenarios that exist in backend but not legacy.
  const legacyIds = new Set(legacy.scenarios.map(s => s.id))
  for (const b of backend.scenarios) {
    if (!legacyIds.has(b.id)) {
      out.push(`[FATAL] [${b.id}] missing in legacy report`)
    }
  }

  return out
}

// ============================================================
// Main
// ============================================================

async function main() {
  try {
    await runPass('legacy', opts.legacyReport)
    await runPass('backend', opts.backendReport)
  } catch (err) {
    console.error('\nA pass failed:', err.message)
    process.exit(1)
  }

  console.log('\n=== Diffing the two reports ===')
  const legacy = loadReport(opts.legacyReport)
  const backend = loadReport(opts.backendReport)

  console.log(`legacy:  ${legacy.scenarios.length} scenarios, ${legacy.summary.passed} passed`)
  console.log(`backend: ${backend.scenarios.length} scenarios, ${backend.summary.passed} passed`)
  console.log(`legacy.pathway = ${legacy.pathway ?? '(unset)'}`)
  console.log(`backend.pathway = ${backend.pathway ?? '(unset)'}`)

  const divergences = diffReports(legacy, backend)

  if (!opts.keepReports) {
    try { unlinkSync(opts.legacyReport) } catch {}
    try { unlinkSync(opts.backendReport) } catch {}
  }

  if (divergences.length === 0) {
    console.log('\n✓ Parity check passed — both pathways produced identical outcomes.')
    process.exit(0)
  }

  const fatal = divergences.filter(d => d.startsWith('[FATAL]'))
  const warn = divergences.filter(d => d.startsWith('[warn]'))

  if (warn.length > 0) {
    console.log('\nWarnings:')
    for (const w of warn) console.log('  ' + w)
  }
  if (fatal.length > 0) {
    console.error('\n✗ Parity FAILED — divergences:')
    for (const f of fatal) console.error('  ' + f)
    process.exit(1)
  }

  // Warnings only — non-fatal.
  console.log('\n✓ Parity check passed (warnings above are informational).')
  process.exit(0)
}

main()
