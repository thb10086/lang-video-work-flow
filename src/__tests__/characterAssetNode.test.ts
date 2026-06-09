/**
 * Tests for `CharacterAssetNode` (task 2.4.1).
 *
 * Scope: pure-logic coverage of the mode→component dispatcher and its
 * supporting type guards. Component rendering is intentionally NOT
 * exercised here — see the file header of `CharacterAssetNode.tsx` for
 * the full rationale, but in short: this repo's vitest config doesn't
 * load `*.test.tsx`, doesn't depend on `@testing-library/react`, and
 * currently has no precedent for React rendering tests.
 *
 * What we DO assert:
 *   - `selectCharacterAssetVariant` returns the *exact* legacy
 *     component for each known mode (not a wrapper).
 *   - Unknown / corrupted / undefined / null / typo modes fall back to
 *     the design variant (so a half-migrated canvas doesn't blank out).
 *   - `CHARACTER_ASSET_MODES` is exhaustive and ordered with `design`
 *     first (the default-mode contract).
 *   - `isCharacterAssetMode` is a strict positive type guard with no
 *     false positives on look-alike strings.
 */

import { describe, expect, it } from 'vitest'

import CharacterGridNode from '@/components/nodes/CharacterGridNode'
import CharacterExtractNode from '@/components/nodes/CharacterExtractNode'
import CharacterManagerNode from '@/components/nodes/CharacterManagerNode'
import {
  CHARACTER_ASSET_MODES,
  DEFAULT_CHARACTER_ASSET_MODE,
  isCharacterAssetMode,
  selectCharacterAssetVariant,
} from '@/components/nodes/CharacterAssetNode'


describe('CHARACTER_ASSET_MODES', () => {
  it('is exhaustive and lists every supported mode', () => {
    expect(CHARACTER_ASSET_MODES).toEqual(['design', 'extract', 'registry'])
  })

  it('places `design` first so it acts as the default mode for new nodes', () => {
    expect(CHARACTER_ASSET_MODES[0]).toBe('design')
    expect(DEFAULT_CHARACTER_ASSET_MODE).toBe('design')
  })

  it('is frozen at the type level via `as const` (literal, not string[])', () => {
    // Compile-time check: the readonly tuple type is preserved.
    // Runtime check: `length` matches the literal arity.
    expect(CHARACTER_ASSET_MODES.length).toBe(3)
  })
})


describe('selectCharacterAssetVariant', () => {
  it('maps `design` to CharacterGridNode', () => {
    expect(selectCharacterAssetVariant('design')).toBe(CharacterGridNode)
  })

  it('maps `extract` to CharacterExtractNode', () => {
    expect(selectCharacterAssetVariant('extract')).toBe(CharacterExtractNode)
  })

  it('maps `registry` to CharacterManagerNode', () => {
    expect(selectCharacterAssetVariant('registry')).toBe(CharacterManagerNode)
  })

  it.each([
    undefined,
    null,
    '',
    'unknown',
    'design ',          // trailing whitespace
    'Design',           // wrong case — legacy migrations may produce this
    42,
    true,
    {},
    [],
  ])('falls back to CharacterGridNode for unknown / corrupted mode %p', (badMode) => {
    expect(selectCharacterAssetVariant(badMode)).toBe(CharacterGridNode)
  })

  it('does not return a wrapper — components are referenced directly', () => {
    // Sanity: the dispatcher should never insert an HOC. The returned
    // component identity must equal the imported legacy component
    // identity so React can preserve render state across mode changes
    // *within the same variant* (no remount).
    const a = selectCharacterAssetVariant('design')
    const b = selectCharacterAssetVariant('design')
    expect(a).toBe(b)
    expect(a).toBe(CharacterGridNode)
  })
})


describe('isCharacterAssetMode', () => {
  it('returns true for every entry of CHARACTER_ASSET_MODES', () => {
    for (const m of CHARACTER_ASSET_MODES) {
      expect(isCharacterAssetMode(m)).toBe(true)
    }
  })

  it.each([
    undefined,
    null,
    '',
    'Design',           // case mismatch
    'designs',
    ' design',
    'extract\n',
    'registry-mode',
    0,
    false,
    {},
    ['design'],
  ])('returns false for non-canonical value %p', (bad) => {
    expect(isCharacterAssetMode(bad)).toBe(false)
  })
})
