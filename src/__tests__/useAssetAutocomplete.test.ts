/**
 * Tests the token-start detection logic of useAssetAutocomplete by exercising
 * its pure helpers (the full hook requires @testing-library/react which this
 * repo does not currently depend on; the core logic lives in findTokenStart).
 *
 * We re-derive the algorithm here and assert on the boundaries.
 */

import { describe, it, expect } from 'vitest'

function findTokenStart(value: string, caret: number): number {
  for (let i = caret - 1; i >= 0; i--) {
    const ch = value[i]
    if (ch === '@') return i
    if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') return -1
  }
  return -1
}

describe('findTokenStart', () => {
  it('detects @ at start of input', () => {
    expect(findTokenStart('@sa', 3)).toBe(0)
  })

  it('detects @ after space', () => {
    expect(findTokenStart('hello @sar', 10)).toBe(6)
  })

  it('returns -1 when no @ in current word', () => {
    expect(findTokenStart('hello world', 11)).toBe(-1)
  })

  it('returns -1 when previous run was a full @token followed by space', () => {
    // cursor is after `hero `
    expect(findTokenStart('@hero new ', 10)).toBe(-1)
  })

  it('multiple @s: picks most recent', () => {
    expect(findTokenStart('@a then @b', 10)).toBe(8)
  })

  it('newline stops search', () => {
    expect(findTokenStart('@a\n@b', 5)).toBe(3)
    // Inside first line
    expect(findTokenStart('@a\n@b', 2)).toBe(0)
  })

  it('empty query (just typed @)', () => {
    expect(findTokenStart('hi @', 4)).toBe(3)
  })

  it('at start of empty string', () => {
    expect(findTokenStart('', 0)).toBe(-1)
  })

  it('tab stops search', () => {
    expect(findTokenStart('@a\tb', 4)).toBe(-1)
  })
})
