/**
 * Tests for `migrateCharacterAssetNodes` (task 2.4.2).
 *
 * Pure-function migration: legacy `characterGrid` / `characterExtract`
 * / `characterManager` nodes collapse to the unified `characterAsset`
 * type with `data.mode` set; edges keep their handle ids unchanged
 * because the legacy port ids carry compatible semantics across the
 * rename (see the design comment in `workflowMigrations.ts`).
 *
 * Coverage targets:
 *   1. Each legacy type maps to the correct mode + retains data.
 *   2. Mixed canvases (legacy + already-unified + unrelated) only
 *      touch the legacy nodes.
 *   3. Idempotence: re-running on the migrated canvas yields count = 0.
 *   4. Edges are preserved (sourceHandle/targetHandle untouched).
 *   5. Healing: a `characterAsset` node missing `data.mode` is patched
 *      to `'design'` and counted as a mutation.
 *   6. Unrelated nodes are returned by reference (no spurious copies).
 */

import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'

import { migrateCharacterAssetNodes } from '@/store/workflowMigrations'


// ────────────────────────────────────────────────────────────────────
// Fixtures — minimal but realistic node/edge shapes.
// ────────────────────────────────────────────────────────────────────

const legacyGrid: Node = {
  id: 'cg-1',
  type: 'characterGrid',
  position: { x: 0, y: 0 },
  data: {
    label: '角色: 小明',
    name: '小明',
    description: 'a young swordsman',
    style: 'anime',
    outputImage: 'data:image/png;base64,xx',
  },
}

const legacyExtract: Node = {
  id: 'ce-1',
  type: 'characterExtract',
  position: { x: 100, y: 0 },
  data: {
    label: '角色提取',
    videoUrl: 'https://example/video.mp4',
    timestamps: [0.5, 1.5],
  },
}

const legacyManager: Node = {
  id: 'cm-1',
  type: 'characterManager',
  position: { x: 200, y: 0 },
  data: {
    label: '角色管理',
    characters: [
      { id: 'c1', name: '小明', description: 'swordsman' },
      { id: 'c2', name: '小红', description: 'archer' },
    ],
  },
}

const unrelated: Node = {
  id: 'img-1',
  type: 'imageGen',
  position: { x: 300, y: 0 },
  data: { prompt: 'a sunset' },
}

const edge: Edge = {
  id: 'e-1',
  source: 'cg-1',
  sourceHandle: 'grid-out',
  target: 'img-1',
  targetHandle: 'ref-in',
}


// ────────────────────────────────────────────────────────────────────
// Per-mode parametric tests
// ────────────────────────────────────────────────────────────────────

describe('migrateCharacterAssetNodes — legacy → unified type rename', () => {
  it.each([
    { legacy: legacyGrid,    expectedMode: 'design'   as const },
    { legacy: legacyExtract, expectedMode: 'extract'  as const },
    { legacy: legacyManager, expectedMode: 'registry' as const },
  ])('rewrites $legacy.type to characterAsset with mode=$expectedMode', ({ legacy, expectedMode }) => {
    const out = migrateCharacterAssetNodes([legacy], [])
    expect(out.migratedNodeCount).toBe(1)
    expect(out.nodes).toHaveLength(1)

    const migrated = out.nodes[0]
    expect(migrated.type).toBe('characterAsset')
    expect((migrated.data as { mode: string }).mode).toBe(expectedMode)
    // Identity-bearing fields must survive the rewrite.
    expect(migrated.id).toBe(legacy.id)
    expect(migrated.position).toEqual(legacy.position)
  })

  it('preserves every original data field besides `mode`', () => {
    const out = migrateCharacterAssetNodes([legacyGrid], [])
    const data = out.nodes[0].data as Record<string, unknown>
    expect(data.name).toBe('小明')
    expect(data.description).toBe('a young swordsman')
    expect(data.style).toBe('anime')
    expect(data.outputImage).toBe('data:image/png;base64,xx')
    expect(data.label).toBe('角色: 小明')
    expect(data.mode).toBe('design')
  })
})


// ────────────────────────────────────────────────────────────────────
// Mixed canvas + identity preservation
// ────────────────────────────────────────────────────────────────────

describe('migrateCharacterAssetNodes — mixed canvases', () => {
  it('only touches legacy character nodes; leaves others by reference', () => {
    const out = migrateCharacterAssetNodes([legacyGrid, unrelated, legacyExtract], [])
    expect(out.migratedNodeCount).toBe(2)
    expect(out.nodes).toHaveLength(3)

    // Unrelated node returned by reference (no spurious copy).
    const passthrough = out.nodes.find(n => n.id === 'img-1')
    expect(passthrough).toBe(unrelated)

    // Legacy ones are new objects with the new type.
    const newGrid = out.nodes.find(n => n.id === 'cg-1')!
    const newExtract = out.nodes.find(n => n.id === 'ce-1')!
    expect(newGrid).not.toBe(legacyGrid)
    expect(newGrid.type).toBe('characterAsset')
    expect((newGrid.data as { mode: string }).mode).toBe('design')
    expect(newExtract.type).toBe('characterAsset')
    expect((newExtract.data as { mode: string }).mode).toBe('extract')
  })

  it('returns input nodes unchanged when there is nothing to migrate', () => {
    const out = migrateCharacterAssetNodes([unrelated], [])
    expect(out.migratedNodeCount).toBe(0)
    expect(out.nodes[0]).toBe(unrelated)
  })

  it('handles an empty canvas without throwing', () => {
    const out = migrateCharacterAssetNodes([], [])
    expect(out.migratedNodeCount).toBe(0)
    expect(out.nodes).toEqual([])
    expect(out.edges).toEqual([])
  })
})


// ────────────────────────────────────────────────────────────────────
// Edges preserved
// ────────────────────────────────────────────────────────────────────

describe('migrateCharacterAssetNodes — edges', () => {
  it('keeps source/target/handles unchanged across the type rename', () => {
    const out = migrateCharacterAssetNodes([legacyGrid, unrelated], [edge])
    expect(out.edges).toHaveLength(1)
    const e = out.edges[0]
    expect(e.id).toBe('e-1')
    expect(e.source).toBe('cg-1')
    expect(e.target).toBe('img-1')
    expect(e.sourceHandle).toBe('grid-out')
    expect(e.targetHandle).toBe('ref-in')
  })

  it('returns a fresh edges array (no aliasing back to caller input)', () => {
    const inputEdges: Edge[] = [edge]
    const out = migrateCharacterAssetNodes([legacyGrid], inputEdges)
    expect(out.edges).not.toBe(inputEdges)
    // …but the edge objects themselves are intentionally NOT cloned.
    expect(out.edges[0]).toBe(edge)
  })
})


// ────────────────────────────────────────────────────────────────────
// Idempotence + healing
// ────────────────────────────────────────────────────────────────────

describe('migrateCharacterAssetNodes — idempotence + healing', () => {
  it('is a no-op on an already-migrated canvas', () => {
    const first = migrateCharacterAssetNodes(
      [legacyGrid, legacyExtract, legacyManager],
      [edge],
    )
    expect(first.migratedNodeCount).toBe(3)

    const second = migrateCharacterAssetNodes(first.nodes, first.edges)
    expect(second.migratedNodeCount).toBe(0)
    // Same node identities passed straight through.
    for (const n of second.nodes) {
      expect(first.nodes.find(p => p.id === n.id)).toBe(n)
    }
  })

  it('heals a characterAsset node missing data.mode by defaulting to "design"', () => {
    const broken: Node = {
      id: 'broken-1',
      type: 'characterAsset',
      position: { x: 0, y: 0 },
      data: { label: '损坏数据' }, // no `mode`
    }
    const out = migrateCharacterAssetNodes([broken], [])
    expect(out.migratedNodeCount).toBe(1)
    expect((out.nodes[0].data as { mode: string }).mode).toBe('design')
    expect((out.nodes[0].data as { label: string }).label).toBe('损坏数据')
  })

  it('does NOT count an already-correctly-migrated characterAsset node', () => {
    const ok: Node = {
      id: 'ok-1',
      type: 'characterAsset',
      position: { x: 0, y: 0 },
      data: { mode: 'extract', videoUrl: 'x' },
    }
    const out = migrateCharacterAssetNodes([ok], [])
    expect(out.migratedNodeCount).toBe(0)
    expect(out.nodes[0]).toBe(ok)
  })

  it.each([
    'design'   as const,
    'extract'  as const,
    'registry' as const,
  ])('treats valid mode "%s" as already-correct (no heal)', (mode) => {
    const ok: Node = {
      id: `ok-${mode}`,
      type: 'characterAsset',
      position: { x: 0, y: 0 },
      data: { mode, foo: 'bar' },
    }
    const out = migrateCharacterAssetNodes([ok], [])
    expect(out.migratedNodeCount).toBe(0)
    expect(out.nodes[0]).toBe(ok)
  })

  it('heals when data.mode is a typo / unknown string', () => {
    const broken: Node = {
      id: 'typo-1',
      type: 'characterAsset',
      position: { x: 0, y: 0 },
      data: { mode: 'Design' }, // wrong case → counts as missing
    }
    const out = migrateCharacterAssetNodes([broken], [])
    expect(out.migratedNodeCount).toBe(1)
    expect((out.nodes[0].data as { mode: string }).mode).toBe('design')
  })
})
