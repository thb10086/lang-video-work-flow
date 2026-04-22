/**
 * paramSanitizer.test.ts — pure-function tests for schema-aware cleanup.
 */

import { describe, it, expect } from 'vitest'
import { sanitizeForExecute, sanitizeOnModelSwitch } from '@/providers/paramSanitizer'
import type { ParamField } from '@/providers/types'

// ── Fixtures ──

const SEEDANCE_SCHEMA: ParamField[] = [
  { key: 'duration', label: '时长', type: 'select', required: false, default: 5,
    options: [{ label: '5秒', value: 5 }, { label: '10秒', value: 10 }] },
  { key: 'size', label: '比例', type: 'select', required: false, default: '16:9',
    options: [{ label: '16:9', value: '16:9' }, { label: '9:16', value: '9:16' }] },
  { key: 'generate_audio', label: '有声', type: 'boolean', required: false, default: false },
  { key: 'seed', label: '种子', type: 'number', required: false, min: 0, max: 2147483647 },
]

const VEO_SCHEMA: ParamField[] = [
  { key: 'duration', label: '时长', type: 'select', required: false, default: 8,
    options: [{ label: '8秒', value: 8 }] },
  { key: 'aspect_ratio', label: '比例', type: 'select', required: false, default: '16:9',
    options: [{ label: '16:9', value: '16:9' }, { label: '9:16', value: '9:16' }] },
  { key: 'resolution', label: '分辨率', type: 'select', required: false, default: '1080p',
    options: [{ label: '720p', value: '720p' }, { label: '1080p', value: '1080p' }] },
]

// ──────────────────────────────────────────────────────────────
// sanitizeForExecute
// ──────────────────────────────────────────────────────────────

describe('sanitizeForExecute', () => {
  it('keeps only schema keys, drops reserved fields and unknown keys', () => {
    const result = sanitizeForExecute(
      {
        label: '视频1',
        status: 'idle',
        prompt: 'A cat',
        duration: 5,
        size: '16:9',
        generate_audio: true,
        __internal_flag: true,
        bogus: 'xyz',
      },
      SEEDANCE_SCHEMA,
    )
    expect(result).toEqual({
      duration: 5,
      size: '16:9',
      generate_audio: true,
    })
    expect(result).not.toHaveProperty('prompt')
    expect(result).not.toHaveProperty('label')
    expect(result).not.toHaveProperty('bogus')
  })

  it('fills defaults for missing schema keys', () => {
    const result = sanitizeForExecute(
      { duration: 10 },
      SEEDANCE_SCHEMA,
    )
    expect(result.duration).toBe(10)
    expect(result.size).toBe('16:9')
    expect(result.generate_audio).toBe(false)
  })

  it('empty schema returns empty object', () => {
    const result = sanitizeForExecute({ foo: 1, bar: 2 }, [])
    expect(result).toEqual({})
  })

  it('treats empty string / null as missing and uses default', () => {
    const result = sanitizeForExecute(
      { duration: '', size: null, generate_audio: false },
      SEEDANCE_SCHEMA,
    )
    expect(result.duration).toBe(5)
    expect(result.size).toBe('16:9')
    expect(result.generate_audio).toBe(false)
  })
})

// ──────────────────────────────────────────────────────────────
// sanitizeOnModelSwitch
// ──────────────────────────────────────────────────────────────

describe('sanitizeOnModelSwitch', () => {
  it('Seedance → VEO: removes generate_audio / size / seed, retains prompt+label', () => {
    const { clean, removed } = sanitizeOnModelSwitch(
      {
        label: 'Video 1',
        status: 'idle',
        prompt: 'A knight',
        duration: 5,                 // present in both, but "5" not in VEO's options (only 8)
        size: '16:9',                // VEO uses aspect_ratio
        generate_audio: true,        // Seedance-only
        seed: 42,                    // Seedance-only
      },
      VEO_SCHEMA,
    )
    expect(clean.label).toBe('Video 1')
    expect(clean.status).toBe('idle')
    expect(clean.prompt).toBe('A knight')
    // duration exists in both schemas but value 5 is invalid for VEO → falls back to VEO default 8
    expect(clean.duration).toBe(8)
    expect(clean.aspect_ratio).toBe('16:9')
    expect(clean.resolution).toBe('1080p')
    expect(clean).not.toHaveProperty('size')
    expect(clean).not.toHaveProperty('generate_audio')
    expect(clean).not.toHaveProperty('seed')
    expect(removed).toContain('generate_audio')
    expect(removed).toContain('seed')
    expect(removed).toContain('size')
  })

  it('preserves valid values that exist in the new schema', () => {
    const { clean, removed } = sanitizeOnModelSwitch(
      {
        label: 'V1',
        prompt: 'X',
        duration: 5,
        size: '16:9',
      },
      SEEDANCE_SCHEMA,  // same schema → values stay
    )
    expect(clean.duration).toBe(5)
    expect(clean.size).toBe('16:9')
    expect(removed).toHaveLength(0)
  })

  it('reserved node fields always pass through', () => {
    const { clean } = sanitizeOnModelSwitch(
      {
        label: 'Test',
        status: 'generating',
        errorMsg: 'prev error',
        retryCount: 2,
        taskId: 'abc',
        firstFrameImage: 'data:image/png;base64,xxx',
        outputVideo: 'http://cdn/v.mp4',
      },
      VEO_SCHEMA,
    )
    expect(clean.label).toBe('Test')
    expect(clean.status).toBe('generating')
    expect(clean.errorMsg).toBe('prev error')
    expect(clean.retryCount).toBe(2)
    expect(clean.taskId).toBe('abc')
    expect(clean.firstFrameImage).toBe('data:image/png;base64,xxx')
    expect(clean.outputVideo).toBe('http://cdn/v.mp4')
  })

  it('empty new schema only keeps reserved fields', () => {
    const { clean, removed } = sanitizeOnModelSwitch(
      { label: 'X', prompt: 'P', duration: 5, size: '16:9' },
      [],
    )
    expect(clean).toEqual({ label: 'X', prompt: 'P' })
    expect(removed).toContain('duration')
    expect(removed).toContain('size')
  })

  it('underscored internal keys are preserved (not treated as stale)', () => {
    const { clean, removed } = sanitizeOnModelSwitch(
      { __debug: true, __schema_version: 3, duration: 5 },
      VEO_SCHEMA,
    )
    expect(clean.__debug).toBe(true)
    expect(clean.__schema_version).toBe(3)
    expect(removed).not.toContain('__debug')
  })
})
