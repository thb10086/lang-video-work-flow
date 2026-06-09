/**
 * characterNameResolver — unit tests
 *
 * Covers: `@角色名` token parsing, character URL aggregation, description
 * substitution, unresolved token reporting, and coexistence with the
 * ASCII-format tokens owned by `assetReferenceResolver`.
 */

import { describe, it, expect } from 'vitest'
import type { Node } from '@xyflow/react'
import { resolveCharacterNames } from '@/providers/characterNameResolver'

function charMgr(id: string, characters: Array<Record<string, unknown>>): Node {
  return {
    id,
    type: 'characterManager',
    position: { x: 0, y: 0 },
    data: { label: '角色库', characters },
  } as Node
}

describe('resolveCharacterNames', () => {
  it('returns empty resolver output when no CharacterManager on canvas', () => {
    const r = resolveCharacterNames('一个女孩在雨中奔跑 @小红', [])
    expect(r.matched).toHaveLength(0)
    expect(r.unresolved).toEqual(['小红'])
    expect(r.referenceImages).toEqual([])
  })

  it('resolves a Chinese @name token and injects description into prompt', () => {
    const nodes: Node[] = [
      charMgr('mgr1', [
        { id: 'c1', name: '小红', description: '红色连衣裙', characterUrl: 'https://cos/r.png' },
      ]),
    ]

    const r = resolveCharacterNames('镇头特写 @小红', nodes)
    expect(r.matched).toHaveLength(1)
    expect(r.matched[0].name).toBe('小红')
    expect(r.referenceImages).toContain('https://cos/r.png')
    expect(r.characterUrls).toContain('https://cos/r.png')
    expect(r.expandedPrompt).toBe('镇头特写 小红 (红色连衣裙)')
    expect(r.unresolved).toEqual([])
  })

  it('handles multiple tokens in the same prompt', () => {
    const nodes: Node[] = [
      charMgr('mgr1', [
        { id: 'c1', name: '小红', characterUrl: 'https://cos/r.png' },
        { id: 'c2', name: '小明', characterUrl: 'https://cos/m.png' },
      ]),
    ]

    const r = resolveCharacterNames('@小红 和 @小明 在公园', nodes)
    expect(r.matched).toHaveLength(2)
    expect(r.referenceImages).toEqual(['https://cos/r.png', 'https://cos/m.png'])
  })

  it('falls through ASCII asset_id tokens (@char_abc) to assetReferenceResolver', () => {
    const nodes: Node[] = [
      charMgr('mgr1', [
        { id: 'c1', name: 'char_abc', characterUrl: 'https://should-not-match/' },
      ]),
    ]

    // `@char_abc` matches the asset_id pattern → skipped by name resolver
    const r = resolveCharacterNames('镇头 @char_abc', nodes)
    expect(r.matched).toHaveLength(0)
    expect(r.referenceImages).toEqual([])
    expect(r.expandedPrompt).toBe('镇头 @char_abc')   // token left intact
  })

  it('reports unresolved names without throwing', () => {
    const nodes: Node[] = [
      charMgr('mgr1', [
        { id: 'c1', name: '小红', characterUrl: 'https://cos/r.png' },
      ]),
    ]

    const r = resolveCharacterNames('@小红 和 @未知角色 登场', nodes)
    expect(r.matched.map(m => m.name)).toEqual(['小红'])
    expect(r.unresolved).toEqual(['未知角色'])
    // expanded prompt only touches resolved names; unresolved stays intact
    expect(r.expandedPrompt).toContain('小红')
    expect(r.expandedPrompt).toContain('@未知角色')
  })

  it('falls back to thumbnail URL when characterUrl is absent', () => {
    const nodes: Node[] = [
      charMgr('mgr1', [
        { id: 'c1', name: '小红', thumbnailUrl: 'https://thumb/r.png' },
      ]),
    ]

    const r = resolveCharacterNames('@小红', nodes)
    expect(r.referenceImages).toEqual(['https://thumb/r.png'])
    expect(r.characterUrls).toEqual([])   // thumbnail alone is not a Sora-grade URL
  })

  it('first CharacterManager wins when the same name appears in multiple nodes', () => {
    const nodes: Node[] = [
      charMgr('mgr1', [
        { id: 'c1', name: '小红', characterUrl: 'https://first/r.png' },
      ]),
      charMgr('mgr2', [
        { id: 'c1', name: '小红', characterUrl: 'https://second/r.png' },
      ]),
    ]

    const r = resolveCharacterNames('@小红', nodes)
    expect(r.matched).toHaveLength(1)
    expect(r.referenceImages).toEqual(['https://first/r.png'])
  })

  it('ignores CharacterManager entries without a name', () => {
    const nodes: Node[] = [
      charMgr('mgr1', [
        { id: 'c1', name: '', characterUrl: 'https://cos/r.png' },
      ]),
    ]
    const r = resolveCharacterNames('@小红', nodes)
    expect(r.matched).toHaveLength(0)
    expect(r.unresolved).toEqual(['小红'])
  })

  it('keeps trailing punctuation out of the match', () => {
    const nodes: Node[] = [
      charMgr('mgr1', [
        { id: 'c1', name: '小红', characterUrl: 'https://cos/r.png' },
      ]),
    ]
    const r = resolveCharacterNames('@小红, 在公园.', nodes)
    expect(r.matched.map(m => m.name)).toEqual(['小红'])
    expect(r.expandedPrompt).toBe('小红, 在公园.')
  })
})
