/**
 * assetStore unit tests — search ranking, resolve with/without variation,
 * CRUD flow with mocked backend.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/env', () => ({
  ENV: {
    BACKEND_URL: 'http://localhost:8000',
    AGENT_MAX_TOOL_ROUNDS: 25,
    AGENT_TEMPERATURE: 0.3,
    AGENT_MAX_TOKENS: 4096,
    CONTEXT_COMPACTION_WINDOW: 10,
    AGENT_REFLECTION_THRESHOLD: 3,
    POLL_INTERVAL: 5000,
  },
}))

// Mock api client so we can control what "backend" returns
const mockList = vi.fn()
const mockCreate = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()

vi.mock('@/api/backend', async () => {
  // Keep real type exports; mock only the `backendApi` functions we use.
  return {
    backendApi: {
      listAssets: (...args: unknown[]) => mockList(...args),
      createAsset: (...args: unknown[]) => mockCreate(...args),
      updateAsset: (...args: unknown[]) => mockUpdate(...args),
      deleteAsset: (...args: unknown[]) => mockDelete(...args),
      restoreAsset: vi.fn(),
      createVariation: vi.fn(),
      updateVariation: vi.fn(),
      deleteVariation: vi.fn(),
      resolveAsset: vi.fn(),
      getAsset: vi.fn(),
      listTrash: vi.fn(),
    },
  }
})

import { useAssetStore } from '@/store/assetStore'
import type { AssetDTO } from '@/api/backend'

function makeCharacter(partial: Partial<AssetDTO>): AssetDTO {
  return {
    id: 1,
    asset_id: partial.asset_id || 'char_test',
    kind: 'character',
    user_id: 1,
    project_id: null,
    name: partial.name || 'Test',
    name_en: partial.name_en || null,
    appearance: partial.appearance || 'default',
    reference_images: partial.reference_images || [],
    variations: partial.variations || [],
    appearance_version: 1,
    metadata: {},
    ...partial,
  }
}

describe('assetStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAssetStore.setState({
      characters: {},
      scenes: {},
      styles: {},
      loading: false,
      error: null,
      lastFetchedAt: null,
    })
  })

  it('fetchAll populates all three buckets', async () => {
    mockList.mockImplementation(({ kind }) => {
      if (kind === 'character') {
        return Promise.resolve({ items: [makeCharacter({ asset_id: 'char_a', name: 'A' })], total: 1 })
      }
      if (kind === 'scene') {
        return Promise.resolve({ items: [{ ...makeCharacter({ asset_id: 'scene_a' }), kind: 'scene', environment: 'env' }], total: 1 })
      }
      return Promise.resolve({ items: [{ ...makeCharacter({ asset_id: 'style_a' }), kind: 'style', guide: 'grd' }], total: 1 })
    })
    await useAssetStore.getState().fetchAll()
    const s = useAssetStore.getState()
    expect(Object.keys(s.characters)).toEqual(['char_a'])
    expect(Object.keys(s.scenes)).toEqual(['scene_a'])
    expect(Object.keys(s.styles)).toEqual(['style_a'])
    expect(s.lastFetchedAt).toBeGreaterThan(0)
  })

  it('fetchAll surfaces error on backend failure', async () => {
    mockList.mockRejectedValue(new Error('backend down'))
    await useAssetStore.getState().fetchAll()
    const s = useAssetStore.getState()
    expect(s.error).toContain('backend down')
    expect(s.loading).toBe(false)
  })

  it('create inserts into the right bucket', async () => {
    const created = makeCharacter({ asset_id: 'char_new', name: 'New' })
    mockCreate.mockResolvedValue(created)
    const asset = await useAssetStore.getState().create({
      kind: 'character',
      name: 'New',
      appearance: 'bold',
    })
    expect(asset.asset_id).toBe('char_new')
    expect(useAssetStore.getState().characters['char_new']).toEqual(created)
    expect(useAssetStore.getState().scenes['char_new']).toBeUndefined()
  })

  it('remove drops from the correct bucket', async () => {
    useAssetStore.setState({
      characters: { char_a: makeCharacter({ asset_id: 'char_a' }) },
    })
    mockDelete.mockResolvedValue({})
    await useAssetStore.getState().remove('char_a')
    expect(useAssetStore.getState().characters['char_a']).toBeUndefined()
  })

  it('search ranks prefix matches above mid-string matches', () => {
    useAssetStore.setState({
      characters: {
        char_sarah: makeCharacter({ asset_id: 'char_sarah', name: 'Sarah', name_en: 'Sarah' }),
        char_other: makeCharacter({ asset_id: 'char_other', name: 'Other Sarah Character' }),
      },
    })
    const results = useAssetStore.getState().search('sarah', 'character')
    expect(results[0].asset_id).toBe('char_sarah')
    expect(results.length).toBe(2)
  })

  it('search with empty text returns recent assets', () => {
    useAssetStore.setState({
      characters: {
        char_new: makeCharacter({ asset_id: 'char_new', updated_at: '2026-01-02' }),
        char_old: makeCharacter({ asset_id: 'char_old', updated_at: '2026-01-01' }),
      },
    })
    const results = useAssetStore.getState().search('')
    expect(results[0].asset_id).toBe('char_new')
  })

  it('resolve without variation returns base appearance + images', () => {
    useAssetStore.setState({
      characters: {
        char_s: makeCharacter({
          asset_id: 'char_s',
          appearance: 'base',
          reference_images: ['a.png'],
        }),
      },
    })
    const r = useAssetStore.getState().resolve('char_s')
    expect(r).not.toBeNull()
    expect(r!.appearance).toBe('base')
    expect(r!.reference_images).toEqual(['a.png'])
    expect(r!.variation).toBeNull()
  })

  it('resolve with variation merges text and prioritizes variation images', () => {
    useAssetStore.setState({
      characters: {
        char_s: makeCharacter({
          asset_id: 'char_s',
          appearance: 'base',
          reference_images: ['base.png'],
          variations: [
            { id: 'var_1', label: 'formal', appearance_delta: 'in suit', reference_images: ['suit.png'] },
          ],
        }),
      },
    })
    const r = useAssetStore.getState().resolve('char_s:var_1')
    expect(r).not.toBeNull()
    expect(r!.appearance).toBe('base, in suit')
    expect(r!.reference_images).toEqual(['suit.png', 'base.png'])
    expect(r!.variation?.id).toBe('var_1')
  })

  it('resolve with @prefix works', () => {
    useAssetStore.setState({
      characters: { char_s: makeCharacter({ asset_id: 'char_s' }) },
    })
    const r = useAssetStore.getState().resolve('@char_s')
    expect(r?.asset.asset_id).toBe('char_s')
  })

  it('resolve returns null for unknown asset', () => {
    expect(useAssetStore.getState().resolve('char_unknown')).toBeNull()
  })

  it('resolve with unknown variation falls back to base', () => {
    useAssetStore.setState({
      characters: {
        char_s: makeCharacter({
          asset_id: 'char_s',
          appearance: 'base',
          variations: [],
        }),
      },
    })
    const r = useAssetStore.getState().resolve('char_s:var_missing')
    expect(r?.appearance).toBe('base')
    expect(r?.variation).toBeNull()
  })

  it('all() returns flat list across kinds', () => {
    useAssetStore.setState({
      characters: { char_a: makeCharacter({ asset_id: 'char_a' }) },
      scenes: { scene_a: { ...makeCharacter({ asset_id: 'scene_a' }), kind: 'scene' as const } },
      styles: {},
    })
    const all = useAssetStore.getState().all()
    expect(all.length).toBe(2)
    expect(all.map(a => a.asset_id).sort()).toEqual(['char_a', 'scene_a'])
  })
})
