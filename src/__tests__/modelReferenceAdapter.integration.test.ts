/**
 * End-to-end adapter integration: asset library → resolver → adapter →
 * final submit payload, for each of the four registered video model families.
 *
 * Uses fixture asset data + real `resolvePromptRefs` + real `injectVideoReferences`,
 * asserts the shape a backend would see.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { resolvePromptRefs } from '@/providers/assetReferenceResolver'
import { injectVideoReferences } from '@/providers/modelReferenceAdapter'
import { useAssetStore } from '@/store/assetStore'
import type { AssetDTO } from '@/api/backend'
import type { ParamField } from '@/providers/types'

function f(key: string, type: ParamField['type'] = 'select'): ParamField {
  return { key, label: key, type, required: false }
}

const SEEDANCE_SCHEMA: ParamField[] = [f('duration'), f('size'), f('resolution')]
const VEO_SCHEMA: ParamField[] = [f('duration'), f('aspect_ratio'), f('image_mode')]
const SORA_SCHEMA: ParamField[] = [f('duration'), f('aspect_ratio'), f('style')]
const KLING_SCHEMA: ParamField[] = [f('duration'), f('aspect_ratio'), f('mode')]

function makeChar(partial: Partial<AssetDTO>): AssetDTO {
  return {
    id: 1,
    asset_id: partial.asset_id || 'char_test',
    kind: 'character',
    user_id: 1,
    project_id: null,
    name: partial.name || 'Test',
    name_en: null,
    appearance: partial.appearance || 'default',
    reference_images: partial.reference_images || [],
    variations: partial.variations || [],
    appearance_version: 1,
    metadata: partial.metadata || {},
    ...partial,
  }
}

describe('adapter integration: resolver + per-model routing', () => {
  beforeEach(() => {
    useAssetStore.setState({
      characters: {
        char_sarah: makeChar({
          asset_id: 'char_sarah',
          name: 'Sarah',
          appearance: 'red hair, trench coat',
          reference_images: ['https://cdn/sarah-1.png', 'https://cdn/sarah-2.png'],
        }),
        char_sora: makeChar({
          asset_id: 'char_sora',
          name: 'SoraSubject',
          appearance: 'the sora-managed subject',
          reference_images: ['https://cdn/backup.png'],
          metadata: {
            sora_character_url: 'https://sora/characters/abc',
            sora_timestamps: '1,4',
          },
        }),
      },
      scenes: {},
      styles: {},
      loading: false,
      error: null,
      lastFetchedAt: null,
    })
  })

  it('Seedance receives all reference images natively', () => {
    const resolved = resolvePromptRefs(
      '@char_sarah walks into view',
      useAssetStore.getState(),
    )
    const r = injectVideoReferences('doubao-seedance-2-0', SEEDANCE_SCHEMA, {
      referenceImages: resolved.referenceImages,
      characterUrls: resolved.characterUrls,
      timestamps: resolved.timestamps,
      existingImages: ['https://cdn/first-frame.png'],
    })
    expect(r.images).toEqual([
      'https://cdn/first-frame.png',
      'https://cdn/sarah-1.png',
      'https://cdn/sarah-2.png',
    ])
    expect(r.params).toEqual({})
    expect(resolved.expandedPrompt).toBe('red hair, trench coat walks into view')
  })

  it('VEO uses reference mode with 2 ref images, truncating extras', () => {
    const resolved = resolvePromptRefs(
      '@char_sarah stares',
      useAssetStore.getState(),
    )
    const r = injectVideoReferences('veo3.1-fast', VEO_SCHEMA, {
      referenceImages: resolved.referenceImages,
      characterUrls: resolved.characterUrls,
      timestamps: resolved.timestamps,
      existingImages: [],
    })
    expect(r.images.length).toBeLessThanOrEqual(2)
    expect(r.params.image_mode).toBe('reference')
    expect(r.images).toEqual(['https://cdn/sarah-1.png', 'https://cdn/sarah-2.png'])
  })

  it('Sora routes character URL + timestamps into params, not images', () => {
    const resolved = resolvePromptRefs(
      '@char_sora on stage',
      useAssetStore.getState(),
    )
    const r = injectVideoReferences('sora-2-vip', SORA_SCHEMA, {
      referenceImages: resolved.referenceImages,
      characterUrls: resolved.characterUrls,
      timestamps: resolved.timestamps,
      existingImages: ['https://cdn/first-frame.png'],
    })
    expect(r.params.characterUrl).toBe('https://sora/characters/abc')
    expect(r.params.characterTimestamps).toBe('1,4')
    // Only the explicit first frame, NOT reference images
    expect(r.images).toEqual(['https://cdn/first-frame.png'])
  })

  it('Kling keeps only first/last frame, drops extras', () => {
    const resolved = resolvePromptRefs(
      '@char_sarah action',
      useAssetStore.getState(),
    )
    const r = injectVideoReferences('kling-v3', KLING_SCHEMA, {
      referenceImages: resolved.referenceImages,
      characterUrls: resolved.characterUrls,
      timestamps: resolved.timestamps,
      existingImages: ['https://cdn/first-frame.png', 'https://cdn/last-frame.png'],
    })
    expect(r.images).toEqual(['https://cdn/first-frame.png', 'https://cdn/last-frame.png'])
    expect(r.notes.join(' ')).toContain('Kling 仅支持')
  })

  it('final backend payload shape is correct for Seedance', () => {
    const resolved = resolvePromptRefs(
      'shot of @char_sarah',
      useAssetStore.getState(),
    )
    const adaptation = injectVideoReferences('doubao-seedance-2-0', SEEDANCE_SCHEMA, {
      referenceImages: resolved.referenceImages,
      characterUrls: resolved.characterUrls,
      timestamps: resolved.timestamps,
      existingImages: [],
    })

    // What the node would submit:
    const payload = {
      model_id: 'doubao-seedance-2-0',
      prompt: resolved.expandedPrompt,
      images: adaptation.images.length > 0 ? adaptation.images : undefined,
      params: adaptation.params,
    }

    expect(payload).toEqual({
      model_id: 'doubao-seedance-2-0',
      prompt: 'shot of red hair, trench coat',
      images: ['https://cdn/sarah-1.png', 'https://cdn/sarah-2.png'],
      params: {},
    })
  })
})
