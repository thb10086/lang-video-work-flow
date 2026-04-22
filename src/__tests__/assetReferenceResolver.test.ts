/**
 * Unit tests for resolvePromptRefs — @ token expansion + reference image
 * aggregation + Sora character URL handling + unresolved warnings.
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

// Mock the backend module used transitively
vi.mock('@/api/backend', () => ({
  backendApi: {},
}))

import { useAssetStore } from '@/store/assetStore'
import { resolvePromptRefs } from '@/providers/assetReferenceResolver'
import type { AssetDTO } from '@/api/backend'

function makeChar(id: string, partial: Partial<AssetDTO> = {}): AssetDTO {
  return {
    id: 1,
    asset_id: id,
    kind: 'character',
    user_id: 1,
    project_id: null,
    name: partial.name || id,
    name_en: partial.name_en || null,
    appearance: partial.appearance || `default ${id}`,
    reference_images: partial.reference_images || [],
    variations: partial.variations || [],
    appearance_version: 1,
    metadata: partial.metadata || {},
  }
}

function makeScene(id: string, partial: Partial<AssetDTO> = {}): AssetDTO {
  return {
    id: 2,
    asset_id: id,
    kind: 'scene',
    user_id: 1,
    project_id: null,
    name: partial.name || id,
    name_en: null,
    environment: partial.environment || 'a place',
    reference_images: partial.reference_images || [],
    variations: [],
    appearance_version: 1,
    metadata: partial.metadata || {},
  }
}

describe('resolvePromptRefs', () => {
  beforeEach(() => {
    useAssetStore.setState({
      characters: {},
      scenes: {},
      styles: {},
      loading: false,
      error: null,
      lastFetchedAt: null,
    })
  })

  it('expands a single @character token', () => {
    useAssetStore.setState({
      characters: {
        char_sarah: makeChar('char_sarah', { appearance: 'red hair, trench coat' }),
      },
    })
    const r = resolvePromptRefs('wide shot of @char_sarah at dusk', useAssetStore.getState())
    expect(r.expandedPrompt).toBe('wide shot of red hair, trench coat at dusk')
    expect(r.refs).toEqual(['char_sarah'])
    expect(r.unresolved).toEqual([])
  })

  it('expands two tokens and merges reference_images uniquely', () => {
    useAssetStore.setState({
      characters: {
        char_a: makeChar('char_a', { appearance: 'A appears', reference_images: ['a1.png', 'shared.png'] }),
        char_b: makeChar('char_b', { appearance: 'B appears', reference_images: ['shared.png', 'b1.png'] }),
      },
    })
    const r = resolvePromptRefs(
      'meeting between @char_a and @char_b',
      useAssetStore.getState(),
    )
    expect(r.expandedPrompt).toBe('meeting between A appears and B appears')
    expect(r.referenceImages).toEqual(['a1.png', 'shared.png', 'b1.png'])
    expect(r.refs).toEqual(['char_a', 'char_b'])
  })

  it('expands a variation token', () => {
    useAssetStore.setState({
      characters: {
        char_s: makeChar('char_s', {
          appearance: 'base',
          reference_images: ['base.png'],
          variations: [
            { id: 'var_formal', label: 'formal', appearance_delta: 'in suit', reference_images: ['suit.png'] },
          ],
        }),
      },
    })
    const r = resolvePromptRefs('@char_s:var_formal walks in', useAssetStore.getState())
    expect(r.expandedPrompt).toBe('base, in suit walks in')
    expect(r.referenceImages).toEqual(['suit.png', 'base.png'])
    expect(r.refs).toEqual(['char_s'])
  })

  it('leaves unresolved tokens in place and logs warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    useAssetStore.setState({
      characters: { char_known: makeChar('char_known', { appearance: 'known' }) },
    })
    const r = resolvePromptRefs(
      '@char_known meets @char_missing',
      useAssetStore.getState(),
    )
    expect(r.expandedPrompt).toBe('known meets @char_missing')
    expect(r.refs).toEqual(['char_known'])
    expect(r.unresolved).toEqual(['char_missing'])
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('merges extraAssetRefs even when absent from prompt', () => {
    useAssetStore.setState({
      characters: {
        char_x: makeChar('char_x', { appearance: 'X', reference_images: ['x.png'] }),
      },
      scenes: {
        scene_y: makeScene('scene_y', { environment: 'Y', reference_images: ['y.png'] }),
      },
    })
    const r = resolvePromptRefs(
      'a plain prompt',
      useAssetStore.getState(),
      ['char_x', 'scene_y'],
    )
    expect(r.expandedPrompt).toBe('a plain prompt')
    expect(r.refs.sort()).toEqual(['char_x', 'scene_y'])
    expect(r.referenceImages.sort()).toEqual(['x.png', 'y.png'])
  })

  it('picks up Sora character_url from asset metadata', () => {
    useAssetStore.setState({
      characters: {
        char_sora: makeChar('char_sora', {
          appearance: 'the sora char',
          metadata: { sora_character_url: 'https://sora/characters/c123' },
        }),
      },
    })
    const r = resolvePromptRefs('@char_sora on camera', useAssetStore.getState())
    expect(r.characterUrls).toEqual(['https://sora/characters/c123'])
    expect(r.timestamps).toBe('1,3')
  })

  it('respects explicit timestamps in metadata', () => {
    useAssetStore.setState({
      characters: {
        char_sora: makeChar('char_sora', {
          appearance: 'the sora char',
          metadata: {
            sora_character_url: 'https://sora/c',
            sora_timestamps: '2,5',
          },
        }),
      },
    })
    const r = resolvePromptRefs('@char_sora', useAssetStore.getState())
    expect(r.timestamps).toBe('2,5')
  })

  it('handles empty prompt', () => {
    const r = resolvePromptRefs('', useAssetStore.getState())
    expect(r.expandedPrompt).toBe('')
    expect(r.refs).toEqual([])
    expect(r.referenceImages).toEqual([])
  })

  it('does not match non-asset text starting with @', () => {
    const r = resolvePromptRefs('email me @someone else', useAssetStore.getState())
    // `@someone` does not match `@prefix_something` pattern
    expect(r.expandedPrompt).toBe('email me @someone else')
    expect(r.refs).toEqual([])
    expect(r.unresolved).toEqual([])
  })
})
