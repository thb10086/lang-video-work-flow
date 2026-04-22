/**
 * toolSchemaGenerator.test.ts — verify per-capability tool schemas are
 * generated as union + model-discriminator, with correct enums + annotations.
 */

import { describe, it, expect } from 'vitest'
import {
  buildCreateVideoNodeTool,
  buildCreateImageNodeTool,
  buildCreateAudioNodeTool,
  GET_MODEL_PARAMS_TOOL,
  __testing__,
} from '@/providers/toolSchemaGenerator'
import type { AiModelResponse, ParamFieldDTO } from '@/api/backend'

// ── Fixtures ──

const SEEDANCE: AiModelResponse = {
  id: 1,
  model_id: 'doubao-seedance-2-0',
  name: 'Seedance 2.0',
  provider: 'ByteDance',
  capability: 'video',
  description: 'default video model',
  schema_version: 1,
  is_enabled: 1,
  sort_order: 10,
  created_at: '',
  updated_at: '',
  param_schema: [
    { key: 'duration', label: '时长', type: 'select',
      options: [{ label: '5秒', value: 5 }, { label: '10秒', value: 10 }], default: 5 },
    { key: 'size', label: '比例', type: 'select',
      options: [{ label: '16:9', value: '16:9' }, { label: '9:16', value: '9:16' }], default: '16:9' },
    { key: 'generate_audio', label: '有声', type: 'boolean', default: false },
    { key: 'seed', label: '种子', type: 'number', min: 0, max: 2147483647 },
  ] as ParamFieldDTO[],
}

const VEO: AiModelResponse = {
  ...SEEDANCE,
  id: 2,
  model_id: 'veo3.1-fast',
  name: 'VEO 3.1 Fast',
  provider: 'Google',
  param_schema: [
    { key: 'duration', label: '时长', type: 'select',
      options: [{ label: '8秒', value: 8 }], default: 8 },
    { key: 'aspect_ratio', label: '比例', type: 'select',
      options: [{ label: '16:9', value: '16:9' }, { label: '9:16', value: '9:16' }], default: '16:9' },
    { key: 'resolution', label: '分辨率', type: 'select',
      options: [{ label: '720p', value: '720p' }, { label: '1080p', value: '1080p' }], default: '1080p' },
  ] as ParamFieldDTO[],
}

// ──────────────────────────────────────────────────────────────
// buildCreateVideoNodeTool
// ──────────────────────────────────────────────────────────────

describe('buildCreateVideoNodeTool', () => {
  it('produces a valid OpenAI function tool shape', () => {
    const tool = buildCreateVideoNodeTool([SEEDANCE, VEO])
    expect(tool.type).toBe('function')
    expect(tool.function.name).toBe('create_video_node')
    expect(tool.function.parameters.type).toBe('object')
    expect(Array.isArray(tool.function.parameters.required)).toBe(true)
  })

  it('model field enum lists all registered video models', () => {
    const tool = buildCreateVideoNodeTool([SEEDANCE, VEO])
    const modelField = tool.function.parameters.properties.model as { enum: string[] }
    expect(modelField.enum).toEqual(['doubao-seedance-2-0', 'veo3.1-fast'])
  })

  it('unions shared fields across models (duration appears once)', () => {
    const tool = buildCreateVideoNodeTool([SEEDANCE, VEO])
    const props = tool.function.parameters.properties as Record<string, { enum?: unknown[] }>
    expect(props.duration).toBeDefined()
    // Union: [5, 10] ∪ [8] = [5, 10, 8]
    const durEnum = props.duration.enum as number[]
    expect(durEnum).toContain(5)
    expect(durEnum).toContain(8)
    expect(durEnum).toContain(10)
  })

  it('seedance-only fields get [仅适用于 ...] annotation', () => {
    const tool = buildCreateVideoNodeTool([SEEDANCE, VEO])
    const props = tool.function.parameters.properties as Record<string, { description?: string }>
    expect(props.generate_audio).toBeDefined()
    expect(props.generate_audio.description).toContain('[仅适用于')
    expect(props.generate_audio.description).toContain('doubao-seedance-2-0')
    expect(props.generate_audio.description).not.toContain('veo3.1-fast')

    // size is seedance-only in this fixture too
    expect(props.size.description).toContain('[仅适用于 doubao-seedance-2-0]')
    // aspect_ratio is VEO-only
    expect(props.aspect_ratio.description).toContain('[仅适用于 veo3.1-fast]')
  })

  it('does NOT annotate universal fields (prompt / duration)', () => {
    const tool = buildCreateVideoNodeTool([SEEDANCE, VEO])
    const props = tool.function.parameters.properties as Record<string, { description?: string }>
    expect(props.prompt.description).not.toContain('[仅适用于')
    expect(props.duration.description).not.toContain('[仅适用于')
  })

  it('numeric range widens across models', () => {
    const M1: AiModelResponse = { ...SEEDANCE, param_schema: [
      { key: 'steps', label: 'steps', type: 'number', min: 10, max: 20 } as ParamFieldDTO,
    ] }
    const M2: AiModelResponse = { ...SEEDANCE, model_id: 'm2', param_schema: [
      { key: 'steps', label: 'steps', type: 'number', min: 5, max: 30 } as ParamFieldDTO,
    ] }
    const tool = buildCreateVideoNodeTool([M1, M2])
    const steps = (tool.function.parameters.properties as Record<string, { minimum: number; maximum: number }>).steps
    expect(steps.minimum).toBe(5)
    expect(steps.maximum).toBe(30)
  })

  it('empty model list still produces a valid tool with prompt-only body', () => {
    const tool = buildCreateVideoNodeTool([])
    const props = tool.function.parameters.properties
    expect(props.prompt).toBeDefined()
    expect(props.model).toBeUndefined()
  })
})

// ──────────────────────────────────────────────────────────────
// buildCreateImageNodeTool & buildCreateAudioNodeTool
// ──────────────────────────────────────────────────────────────

describe('buildCreateImageNodeTool / buildCreateAudioNodeTool', () => {
  it('image tool has prompt + model + aggregated params', () => {
    const m: AiModelResponse = {
      ...SEEDANCE, capability: 'image', model_id: 'gemini-image',
      param_schema: [
        { key: 'aspectRatio', label: '比例', type: 'select',
          options: [{ label: '1:1', value: '1:1' }], default: '1:1' } as ParamFieldDTO,
      ],
    }
    const tool = buildCreateImageNodeTool([m])
    const props = tool.function.parameters.properties as Record<string, unknown>
    expect(props.prompt).toBeDefined()
    expect(props.model).toBeDefined()
    expect(props.aspectRatio).toBeDefined()
  })

  it('audio tool includes text + voice + any schema fields', () => {
    const m: AiModelResponse = {
      ...SEEDANCE, capability: 'audio', model_id: 'elevenlabs', param_schema: [],
    }
    const tool = buildCreateAudioNodeTool([m])
    const props = tool.function.parameters.properties as Record<string, unknown>
    expect(props.text).toBeDefined()
    expect(props.voice).toBeDefined()
    expect(props.model).toBeDefined()
  })
})

// ──────────────────────────────────────────────────────────────
// GET_MODEL_PARAMS_TOOL (static)
// ──────────────────────────────────────────────────────────────

describe('GET_MODEL_PARAMS_TOOL', () => {
  it('requires model_id', () => {
    expect(GET_MODEL_PARAMS_TOOL.function.name).toBe('get_model_params')
    expect(GET_MODEL_PARAMS_TOOL.function.parameters.required).toContain('model_id')
  })
})

// ──────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────

describe('aggregateProperties (internal)', () => {
  it('skips reserved non-param keys', () => {
    const m: AiModelResponse = {
      ...SEEDANCE, param_schema: [
        { key: 'prompt', label: 'p', type: 'string' } as ParamFieldDTO,
        { key: 'label', label: 'l', type: 'string' } as ParamFieldDTO,
        { key: 'duration', label: 'd', type: 'number', min: 1, max: 10 } as ParamFieldDTO,
      ],
    }
    const agg = __testing__.aggregateProperties([m])
    expect(agg.has('duration')).toBe(true)
    expect(agg.has('prompt')).toBe(false)
    expect(agg.has('label')).toBe(false)
  })
})
