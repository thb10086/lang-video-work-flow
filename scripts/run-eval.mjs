#!/usr/bin/env node
/**
 * Eval CLI — thin wrapper around `vitest run` that maps friendly CLI flags
 * to EVAL_* environment variables consumed by baselineGuard.test.ts.
 *
 * We spawn vitest because:
 *   1. runEval.ts relies on import.meta.glob (Vite-only) to auto-discover
 *      scenarios, so we need Vite's module graph.
 *   2. Vitest gives us TypeScript handling, assertion plumbing, and a
 *      well-understood exit-code contract (0 = pass, 1 = fail).
 *
 * Usage:
 *   npm run eval                              # run all, compare to baseline
 *   npm run eval -- --only '01-*'             # filter by id glob
 *   npm run eval -- --update-baseline         # refresh the baseline
 *   npm run eval -- --tolerance 0.02          # stricter regression guard
 *   npm run eval:update                       # shortcut for --update-baseline
 */

import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
const env = { ...process.env, EVAL_HARNESS: '1' }

function printHelp() {
  console.log(`
Eval Harness — Agent E2E scenario runner

Usage:
  npm run eval [-- flags]

Flags:
  --only <glob>         Run only scenarios whose id matches (supports *)
  --update-baseline     Overwrite eval-baseline.json with this run
  --output <path>       Report output path (default: eval-report.json)
  --baseline <path>     Baseline path (default: eval-baseline.json)
  --tolerance <0-1>     Score regression tolerance (default: 0.05 = 5%)
  --latency-tolerance <0-1>
                        Latency regression tolerance for time_to_first_event /
                        time_to_first_tool_call / mean_event_interval
                        (default: 0.10 = 10%)
  --help                Show this help

Examples:
  npm run eval
  npm run eval -- --only 01-product-ad
  npm run eval -- --update-baseline
  npm run eval -- --tolerance 0.02
`)
}

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]
  switch (arg) {
    case '--only':
      env.EVAL_ONLY = argv[++i]
      break
    case '--update-baseline':
      env.EVAL_UPDATE_BASELINE = '1'
      break
    case '--output':
      env.EVAL_OUTPUT = argv[++i]
      break
    case '--baseline':
      env.EVAL_BASELINE = argv[++i]
      break
    case '--tolerance':
      env.EVAL_TOLERANCE = argv[++i]
      break
    case '--latency-tolerance':
      env.EVAL_LATENCY_TOLERANCE = argv[++i]
      break
    case '--help':
    case '-h':
      printHelp()
      process.exit(0)
      break
    default:
      console.error(`Unknown flag: ${arg}`)
      printHelp()
      process.exit(2)
  }
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const testFile = 'src/__tests__/eval/baselineGuard.test.ts'
const args = ['vitest', 'run', testFile, '--reporter=verbose']

const child = spawn('npx', args, {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: true,
  env,
})
child.on('exit', code => process.exit(code ?? 0))
child.on('error', err => {
  console.error('Failed to launch vitest:', err)
  process.exit(99)
})
