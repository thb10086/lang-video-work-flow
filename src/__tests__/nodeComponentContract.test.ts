/**
 * nodeComponentContract — guards against regressions in node component
 * contracts. Specifically:
 *   1. No node component may contain a placeholder "wired via runtime engine"
 *      comment paired with an empty onClick — that pattern produced the dead
 *      AudioNode SubmitButton bug.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const NODE_DIR = join(process.cwd(), 'src', 'components', 'nodes')

function listNodeFiles(): string[] {
  return readdirSync(NODE_DIR)
    .filter(f => f.endsWith('Node.tsx'))
    .map(f => join(NODE_DIR, f))
}

describe('node component contract', () => {
  it('no node file contains the "wired via runtime engine" placeholder marker', () => {
    const offenders: string[] = []
    for (const file of listNodeFiles()) {
      const src = readFileSync(file, 'utf-8')
      if (src.includes('wired via runtime engine')) {
        offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })

  it('no node file has `onClick={() => {}}` with no other body', () => {
    // Narrow regex — only flags the exact no-op we care about, not legitimate
    // empty handlers that appear mid-block in complex trees.
    const offenders: string[] = []
    for (const file of listNodeFiles()) {
      const src = readFileSync(file, 'utf-8')
      if (/onClick=\{\(\)\s*=>\s*\{\s*\/\*[^}]*\*\/\s*\}\}/.test(src)) {
        offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })
})
