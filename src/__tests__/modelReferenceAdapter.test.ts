/**
 * Unit tests for the model reference adapter strategies.
 *
 * Each strategy has 2+ cases:
 *   - happy path with refs
 *   - schema missing the expected target field
 *   - overflow / truncation
 */

import { describe, it, expect } from 'vitest'
import {
  injectVideoReferences,
  injectImageReferences,
  seedanceStrategy,
  veoStrategy,
  soraStrategy,
  klingStrategy,
  fallbackStrategy,
} from '@/providers/modelReferenceAdapter'
import type { ParamField } from '@/providers/types'

/** Minimal-boilerplate ParamField factory for fixtures. */
function f(key: string, type: ParamField['type'] = 'number'): ParamField {
  return { key, label: key, type, required: false }
}

const SEEDANCE_SCHEMA: ParamField[] = [f('duration'), f('size', 'select')]

const VEO_SCHEMA: ParamField[] = [
  f('duration'),
  f('aspect_ratio', 'select'),
  f('image_mode', 'select'),
]

const VEO_SCHEMA_NO_IMAGE_MODE: ParamField[] = [
  f('duration'),
  f('aspect_ratio', 'select'),
]

const SORA_SCHEMA: ParamField[] = [
  f('duration'),
  f('aspect_ratio', 'select'),
  f('style', 'select'),
]

const KLING_SCHEMA: ParamField[] = [
  f('duration'),
  f('aspect_ratio', 'select'),
  f('mode', 'select'),
]

describe('seedanceStrategy', () => {
  it('merges existing + reference images natively', () => {
    const r = seedanceStrategy(
      { existingImages: ['frame.png'], referenceImages: ['ref1.png', 'ref2.png'], characterUrls: [], timestamps: null },
      SEEDANCE_SCHEMA,
    )
    expect(r.images).toEqual(['frame.png', 'ref1.png', 'ref2.png'])
    expect(r.params).toEqual({})
    expect(r.notes).toEqual([])
  })

  it('de-duplicates repeated images', () => {
    const r = seedanceStrategy(
      { existingImages: ['a.png'], referenceImages: ['a.png', 'b.png'], characterUrls: [], timestamps: null },
      SEEDANCE_SCHEMA,
    )
    expect(r.images).toEqual(['a.png', 'b.png'])
  })

  it('warns about Sora character URL being ignored', () => {
    const r = seedanceStrategy(
      { existingImages: [], referenceImages: [], characterUrls: ['https://sora/c1'], timestamps: null },
      SEEDANCE_SCHEMA,
    )
    expect(r.notes.length).toBe(1)
    expect(r.notes[0]).toContain('Sora')
  })
})

describe('veoStrategy', () => {
  it('uses reference mode when refs provided and schema supports image_mode', () => {
    const r = veoStrategy(
      { existingImages: [], referenceImages: ['ref.png'], characterUrls: [], timestamps: null },
      VEO_SCHEMA,
    )
    expect(r.images).toEqual(['ref.png'])
    expect(r.params.image_mode).toBe('reference')
  })

  it('uses frame mode when only existing frames, schema has image_mode', () => {
    const r = veoStrategy(
      { existingImages: ['first.png', 'last.png'], referenceImages: [], characterUrls: [], timestamps: null },
      VEO_SCHEMA,
    )
    expect(r.images).toEqual(['first.png', 'last.png'])
    expect(r.params.image_mode).toBe('frame')
  })

  it('does not set image_mode when schema lacks it', () => {
    const r = veoStrategy(
      { existingImages: [], referenceImages: ['r.png'], characterUrls: [], timestamps: null },
      VEO_SCHEMA_NO_IMAGE_MODE,
    )
    expect(r.images).toEqual(['r.png'])
    expect(r.params.image_mode).toBeUndefined()
  })

  it('truncates to 2 images and emits a note', () => {
    const r = veoStrategy(
      { existingImages: [], referenceImages: ['a.png', 'b.png', 'c.png'], characterUrls: [], timestamps: null },
      VEO_SCHEMA,
    )
    expect(r.images.length).toBe(2)
    expect(r.notes.join(' ')).toContain('VEO 仅接受 2 帧')
  })

  it('warns on unused Sora URL', () => {
    const r = veoStrategy(
      { existingImages: [], referenceImages: [], characterUrls: ['x'], timestamps: null },
      VEO_SCHEMA,
    )
    expect(r.notes.join(' ')).toContain('Sora Character URL')
  })

  it('no image_mode when images empty', () => {
    const r = veoStrategy(
      { existingImages: [], referenceImages: [], characterUrls: [], timestamps: null },
      VEO_SCHEMA,
    )
    expect(r.params.image_mode).toBeUndefined()
    expect(r.images).toEqual([])
  })
})

describe('soraStrategy', () => {
  it('routes character URL + timestamps into params', () => {
    const r = soraStrategy(
      { existingImages: [], referenceImages: [], characterUrls: ['https://sora/c1'], timestamps: '2,5' },
      SORA_SCHEMA,
    )
    expect(r.params.characterUrl).toBe('https://sora/c1')
    expect(r.params.characterTimestamps).toBe('2,5')
    expect(r.images).toEqual([])
  })

  it('keeps first-frame in images for Sora', () => {
    const r = soraStrategy(
      { existingImages: ['first.png', 'extra.png'], referenceImages: [], characterUrls: ['x'], timestamps: null },
      SORA_SCHEMA,
    )
    expect(r.images).toEqual(['first.png']) // truncate to 1
  })

  it('warns when multiple character URLs', () => {
    const r = soraStrategy(
      { existingImages: [], referenceImages: [], characterUrls: ['a', 'b', 'c'], timestamps: null },
      SORA_SCHEMA,
    )
    expect(r.params.characterUrl).toBe('a')
    expect(r.notes.join(' ')).toContain('仅接受 1')
  })

  it('warns when refs given but no character URL', () => {
    const r = soraStrategy(
      { existingImages: [], referenceImages: ['r.png'], characterUrls: [], timestamps: null },
      SORA_SCHEMA,
    )
    expect(r.notes.join(' ')).toContain('characterExtract')
    expect(r.params.characterUrl).toBeUndefined()
  })
})

describe('klingStrategy', () => {
  it('accepts 2 frames: first + last', () => {
    const r = klingStrategy(
      { existingImages: ['first.png'], referenceImages: ['last.png'], characterUrls: [], timestamps: null },
      KLING_SCHEMA,
    )
    expect(r.images).toEqual(['first.png', 'last.png'])
    expect(r.params).toEqual({})
  })

  it('drops extras beyond 2', () => {
    const r = klingStrategy(
      { existingImages: ['a.png'], referenceImages: ['b.png', 'c.png', 'd.png'], characterUrls: [], timestamps: null },
      KLING_SCHEMA,
    )
    expect(r.images).toEqual(['a.png', 'b.png'])
    expect(r.notes.join(' ')).toContain('丢弃 2 张图')
  })

  it('warns on unused Character URL', () => {
    const r = klingStrategy(
      { existingImages: [], referenceImages: [], characterUrls: ['x'], timestamps: null },
      KLING_SCHEMA,
    )
    expect(r.notes.join(' ')).toContain('Character URL')
  })
})

describe('fallbackStrategy', () => {
  it('passes through existing frames untouched', () => {
    const r = fallbackStrategy(
      { existingImages: ['f1.png', 'f2.png'], referenceImages: ['r.png'], characterUrls: [], timestamps: null },
      [],
    )
    // existing fills both slots → no room for ref
    expect(r.images).toEqual(['f1.png', 'f2.png'])
  })

  it('fills empty slots with first ref image', () => {
    const r = fallbackStrategy(
      { existingImages: [], referenceImages: ['r1.png', 'r2.png', 'r3.png'], characterUrls: [], timestamps: null },
      [],
    )
    expect(r.images.length).toBe(2)
  })
})

describe('injectVideoReferences (dispatch)', () => {
  it('dispatches Seedance by prefix', () => {
    const r = injectVideoReferences(
      'doubao-seedance-2-0',
      SEEDANCE_SCHEMA,
      { existingImages: [], referenceImages: ['r.png'], characterUrls: [], timestamps: null },
    )
    expect(r.images).toEqual(['r.png'])
    expect(r.params).toEqual({})  // seedance has no extra params
  })

  it('dispatches VEO by prefix', () => {
    const r = injectVideoReferences(
      'veo3.1-fast',
      VEO_SCHEMA,
      { existingImages: [], referenceImages: ['r.png'], characterUrls: [], timestamps: null },
    )
    expect(r.params.image_mode).toBe('reference')
  })

  it('dispatches Sora by prefix', () => {
    const r = injectVideoReferences(
      'sora-2-vip',
      SORA_SCHEMA,
      { existingImages: [], referenceImages: [], characterUrls: ['c'], timestamps: null },
    )
    expect(r.params.characterUrl).toBe('c')
  })

  it('dispatches Kling by prefix', () => {
    const r = injectVideoReferences(
      'kling-v3',
      KLING_SCHEMA,
      { existingImages: [], referenceImages: ['a.png', 'b.png', 'c.png'], characterUrls: [], timestamps: null },
    )
    expect(r.images.length).toBe(2)
  })

  it('uses fallback for unknown model', () => {
    const r = injectVideoReferences(
      'some-new-future-model',
      [],
      { existingImages: [], referenceImages: ['r.png'], characterUrls: [], timestamps: null },
    )
    expect(r.notes.some(n => n.includes('未知模型'))).toBe(true)
  })
})

describe('injectImageReferences', () => {
  it('merges existing + refs for image models', () => {
    const r = injectImageReferences(
      'gemini-3.1-flash-image-preview',
      [],
      { existingImages: ['a.png'], referenceImages: ['b.png', 'c.png'], characterUrls: [], timestamps: null },
    )
    expect(r.images).toEqual(['a.png', 'b.png', 'c.png'])
    expect(r.params).toEqual({})
  })

  it('warns about Character URL being ignored', () => {
    const r = injectImageReferences(
      'gemini-3.1-flash-image-preview',
      [],
      { existingImages: [], referenceImages: [], characterUrls: ['c'], timestamps: null },
    )
    expect(r.notes.join(' ')).toContain('图片')
  })
})
