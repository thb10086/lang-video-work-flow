/**
 * Tests for `nodeExecutor.ts` propagation/pull dispatching when
 * character nodes use the unified `characterAsset` type with
 * `data.mode` (task 2.4.4).
 *
 * What this exercises:
 *   - `propagateNodeOutput`: when a `characterExtract`-equivalent
 *     node finishes, edges with `targetHandle === 'character-in'`
 *     pointing at a `characterAsset:registry` (legacy:
 *     `characterManager`) target append a character entry.
 *   - `pullFromUpstream`: a downstream consumer (videoGen) pulling
 *     from a `characterAsset:registry` upstream gets its
 *     `characters[]` populated.
 *   - `characterKind` agrees on legacy + unified for both source and
 *     target sides.
 *
 * Why this is its own test file:
 *   The pre-existing `propagation.test.ts` covers the legacy-type
 *   path. This file is the parallel coverage for the unified path
 *   so a regression in `characterKind` shows up here without
 *   churning the legacy test fixtures.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useFlowStore } from '@/store/flowStore'
import {
  _testPropagateNodeOutput as propagateNodeOutput,
  _testPullFromUpstream as pullFromUpstream,
  characterKind,
} from '@/providers/nodeExecutor'


function reset() {
  useFlowStore.setState({
    nodes: [], edges: [], selectedNodeId: null,
    _history: [], _historyIndex: -1, _clipboard: null,
    characterAppearances: {},
  })
}


// ════════════════════════════════════════════════════════════════════
// characterKind helper — exhaustive coverage on both schemas
// ════════════════════════════════════════════════════════════════════

describe('characterKind', () => {
  it.each([
    { type: 'characterGrid',    expected: 'design'   as const },
    { type: 'characterExtract', expected: 'extract'  as const },
    { type: 'characterManager', expected: 'registry' as const },
  ])('legacy type $type → $expected', ({ type, expected }) => {
    expect(characterKind({ type })).toBe(expected)
  })

  it.each([
    { mode: 'design',   expected: 'design'   as const },
    { mode: 'extract',  expected: 'extract'  as const },
    { mode: 'registry', expected: 'registry' as const },
  ])('unified characterAsset with mode=$mode → $expected', ({ mode, expected }) => {
    expect(characterKind({ type: 'characterAsset', data: { mode } })).toBe(expected)
  })

  it('characterAsset with missing/unknown mode falls back to design', () => {
    expect(characterKind({ type: 'characterAsset', data: {} })).toBe('design')
    expect(characterKind({ type: 'characterAsset', data: { mode: 'typo' } })).toBe('design')
    expect(characterKind({ type: 'characterAsset' })).toBe('design')
  })

  it.each([
    { input: null,             label: 'null' },
    { input: undefined,        label: 'undefined' },
    { input: { type: '' },     label: 'empty type' },
    { input: { type: 'imageGen' },    label: 'imageGen' },
    { input: { type: 'styleLock' },   label: 'styleLock' },
  ])('non-character input $label → null', ({ input }) => {
    expect(characterKind(input)).toBeNull()
  })
})


// ════════════════════════════════════════════════════════════════════
// propagateNodeOutput — character-in routing for unified registry
// ════════════════════════════════════════════════════════════════════

describe('propagateNodeOutput → characterAsset:registry target', () => {
  beforeEach(reset)

  it('appends entry to registry node when extract node finishes (unified target)', () => {
    // Source: legacy `characterExtract` carrying a fresh URL/id.
    // Target: unified `characterAsset` with mode='registry'.
    useFlowStore.setState({
      nodes: [
        {
          id: 'extract-1',
          type: 'characterExtract',
          position: { x: 0, y: 0 },
          data: {
            label: 'Extract',
            characterUrl: 'https://example/c1.png',
            characterId: 'sora-c1',
            name: 'Hero',
            description: 'red-haired warrior',
          },
        },
        {
          id: 'reg-1',
          type: 'characterAsset',
          position: { x: 200, y: 0 },
          data: { mode: 'registry', label: '角色管理器', characters: [] },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'extract-1',
          sourceHandle: 'character-out',
          target: 'reg-1',
          targetHandle: 'character-in',
        },
      ],
    })

    propagateNodeOutput('extract-1')

    const reg = useFlowStore.getState().nodes.find(n => n.id === 'reg-1')!
    const chars = reg.data.characters as Array<Record<string, unknown>>
    expect(chars).toHaveLength(1)
    expect(chars[0].name).toBe('Hero')
    expect(chars[0].characterUrl).toBe('https://example/c1.png')
    expect(chars[0].characterId).toBe('sora-c1')
  })

  it('also works when both source and target are unified characterAsset', () => {
    useFlowStore.setState({
      nodes: [
        {
          id: 'extract-1',
          type: 'characterAsset',
          position: { x: 0, y: 0 },
          data: {
            mode: 'extract',
            label: 'Extract',
            characterUrl: 'https://example/c2.png',
            characterId: 'sora-c2',
            name: 'Villain',
          },
        },
        {
          id: 'reg-1',
          type: 'characterAsset',
          position: { x: 200, y: 0 },
          data: { mode: 'registry', label: 'Registry', characters: [] },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'extract-1',
          sourceHandle: 'character-out',
          target: 'reg-1',
          targetHandle: 'character-in',
        },
      ],
    })

    propagateNodeOutput('extract-1')

    const reg = useFlowStore.getState().nodes.find(n => n.id === 'reg-1')!
    const chars = reg.data.characters as Array<Record<string, unknown>>
    expect(chars).toHaveLength(1)
    expect(chars[0].name).toBe('Villain')
  })

  it('de-dupes by characterId across re-propagations', () => {
    useFlowStore.setState({
      nodes: [
        {
          id: 'extract-1',
          type: 'characterExtract',
          position: { x: 0, y: 0 },
          data: { label: 'X', characterId: 'cid-1', characterUrl: 'u' },
        },
        {
          id: 'reg-1',
          type: 'characterAsset',
          position: { x: 200, y: 0 },
          data: { mode: 'registry', label: 'R', characters: [] },
        },
      ],
      edges: [
        { id: 'e1', source: 'extract-1', sourceHandle: 'character-out', target: 'reg-1', targetHandle: 'character-in' },
      ],
    })

    propagateNodeOutput('extract-1')
    propagateNodeOutput('extract-1')

    const reg = useFlowStore.getState().nodes.find(n => n.id === 'reg-1')!
    expect((reg.data.characters as unknown[]).length).toBe(1)
  })

  it('routes to videoGen.characterUrl when target is NOT a registry', () => {
    // Sanity: the kind check should also let non-registry targets fall
    // through to the URL-write branch — i.e. not accidentally mis-route
    // legitimate consumers.
    useFlowStore.setState({
      nodes: [
        {
          id: 'extract-1',
          type: 'characterAsset',
          position: { x: 0, y: 0 },
          data: { mode: 'extract', characterUrl: 'https://x/c.png', characterId: 'cid-x' },
        },
        {
          id: 'video-1',
          type: 'videoGen',
          position: { x: 300, y: 0 },
          data: { label: 'V', model: 'sora' },
        },
      ],
      edges: [
        { id: 'e1', source: 'extract-1', sourceHandle: 'character-out', target: 'video-1', targetHandle: 'character-in' },
      ],
    })

    propagateNodeOutput('extract-1')

    const video = useFlowStore.getState().nodes.find(n => n.id === 'video-1')!
    expect(video.data.characterUrl).toBe('https://x/c.png')
    expect(video.data.characterImage).toBe('https://x/c.png')
    expect(video.data.characterId).toBe('cid-x')
    // Critically: registry-only field MUST NOT have been written.
    expect(video.data.characters).toBeUndefined()
  })
})


// ════════════════════════════════════════════════════════════════════
// pullFromUpstream — characters[] hydration from unified registry source
// ════════════════════════════════════════════════════════════════════

describe('pullFromUpstream ← characterAsset:registry source', () => {
  beforeEach(reset)

  it('hydrates downstream characters[] when source is unified registry', () => {
    useFlowStore.setState({
      nodes: [
        {
          id: 'reg-1',
          type: 'characterAsset',
          position: { x: 0, y: 0 },
          data: {
            mode: 'registry',
            label: 'R',
            characters: [
              { id: 'a', name: 'Alice', characterUrl: 'https://x/a.png', characterId: 'cid-a' },
              { id: 'b', name: 'Bob',   characterUrl: 'https://x/b.png', characterId: 'cid-b' },
            ],
          },
        },
        {
          id: 'video-1',
          type: 'videoGen',
          position: { x: 300, y: 0 },
          data: { label: 'V', model: 'sora' },
        },
      ],
      edges: [
        { id: 'e1', source: 'reg-1', sourceHandle: 'character-out', target: 'video-1', targetHandle: 'character-in' },
      ],
    })

    pullFromUpstream('video-1')

    const video = useFlowStore.getState().nodes.find(n => n.id === 'video-1')!
    const chars = video.data.characters as Array<Record<string, unknown>>
    expect(chars).toHaveLength(2)
    expect(chars[0].name).toBe('Alice')
    expect(chars[1].name).toBe('Bob')
  })

  it('still pulls characters[] when registry is legacy characterManager type', () => {
    // Regression guard: the pre-2.4.x behaviour must keep working
    // because old persisted canvases are migrated lazily.
    useFlowStore.setState({
      nodes: [
        {
          id: 'reg-1',
          type: 'characterManager',
          position: { x: 0, y: 0 },
          data: {
            label: 'R',
            characters: [{ id: 'a', name: 'Legacy', characterUrl: 'u' }],
          },
        },
        {
          id: 'video-1',
          type: 'videoGen',
          position: { x: 300, y: 0 },
          data: { label: 'V', model: 'sora' },
        },
      ],
      edges: [
        { id: 'e1', source: 'reg-1', sourceHandle: 'character-out', target: 'video-1', targetHandle: 'character-in' },
      ],
    })

    pullFromUpstream('video-1')

    const video = useFlowStore.getState().nodes.find(n => n.id === 'video-1')!
    const chars = video.data.characters as Array<Record<string, unknown>>
    expect(chars).toHaveLength(1)
    expect(chars[0].name).toBe('Legacy')
  })
})
