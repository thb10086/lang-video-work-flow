/**
 * Unit tests for src/providers/toolBudget.ts
 *
 * Covers:
 *   - withResponseBudget passthrough when disabled
 *   - concise/detailed routing, default format
 *   - hard truncation + hint suffix
 *   - __isBudgeted / __budgetOpts metadata
 *   - applyBudgetToSchema idempotency + registry gating
 *   - concise formatters produce smaller output for real-shaped payloads
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  withResponseBudget,
  applyBudgetToSchema,
  BUDGETED_TOOL_NAMES,
  BUDGETED_TOOLS_REGISTRY,
  DEFAULT_TOOL_RESPONSE_MAX_TOKENS,
  formatCanvasStateConcise,
  formatDiscoverToolsConcise,
  formatListAssetsConcise,
  formatListModelsConcise,
  formatModelParamsConcise,
  formatNodeOutputConcise,
  formatRecallMemoryConcise,
  getBudgetOpts,
} from '@/providers/toolBudget'
import { useSettingsStore } from '@/store/settingsStore'
import type { ToolCallResult } from '@/providers/toolHelpers'

const baseSettings = () => useSettingsStore.getState().enableResponseBudget

describe('toolBudget — withResponseBudget', () => {
  let originalFlag: boolean
  beforeEach(() => {
    originalFlag = baseSettings()
    useSettingsStore.setState({ enableResponseBudget: true })
  })
  afterEach(() => {
    useSettingsStore.setState({ enableResponseBudget: originalFlag })
  })

  it('marks the wrapped handler with metadata', () => {
    const wrapped = withResponseBudget(
      async (_args: Record<string, unknown>) => ({ success: true, message: 'hi' }),
      { toolName: 'test_tool' },
    )
    expect((wrapped as unknown as { __isBudgeted: boolean }).__isBudgeted).toBe(true)
    expect((wrapped as unknown as { __budgetOpts: { toolName: string } }).__budgetOpts.toolName).toBe(
      'test_tool',
    )
  })

  it('passes through untouched when enableResponseBudget=false', async () => {
    useSettingsStore.setState({ enableResponseBudget: false })
    const big = 'x'.repeat(200_000)
    const wrapped = withResponseBudget(
      async (_args: Record<string, unknown>) => ({ success: true, message: big }),
      {
        toolName: 'test_tool',
        conciseFormatter: () => ({ success: true, message: 'short' }),
      },
    )
    const r = await wrapped({})
    expect(r.message).toBe(big)
  })

  it('uses concise formatter by default', async () => {
    const wrapped = withResponseBudget(
      async (_args: Record<string, unknown>) => ({ success: true, message: 'DETAILED_BODY' }),
      {
        toolName: 'test_tool',
        conciseFormatter: r => ({ ...r, message: r.message.slice(0, 3) }),
      },
    )
    const r = await wrapped({})
    expect(r.message).toBe('DET')
  })

  it('uses detailed formatter when response_format="detailed"', async () => {
    const wrapped = withResponseBudget(
      async (_args: Record<string, unknown>) => ({ success: true, message: 'ABC' }),
      {
        toolName: 'test_tool',
        conciseFormatter: r => ({ ...r, message: '(concise)' + r.message }),
        detailedFormatter: r => ({ ...r, message: '(detailed)' + r.message }),
      },
    )
    const rC = await wrapped({})
    const rD = await wrapped({ response_format: 'detailed' })
    expect(rC.message).toBe('(concise)ABC')
    expect(rD.message).toBe('(detailed)ABC')
  })

  it('honors explicit response_format="concise" override even if defaultFormat is detailed', async () => {
    const wrapped = withResponseBudget(
      async (_args: Record<string, unknown>) => ({ success: true, message: 'X' }),
      {
        toolName: 'test_tool',
        defaultFormat: 'detailed',
        conciseFormatter: r => ({ ...r, message: 'C' + r.message }),
        detailedFormatter: r => ({ ...r, message: 'D' + r.message }),
      },
    )
    expect((await wrapped({})).message).toBe('DX')
    expect((await wrapped({ response_format: 'concise' })).message).toBe('CX')
  })

  it('falls back to raw result when formatter throws', async () => {
    const wrapped = withResponseBudget(
      async (_args: Record<string, unknown>) => ({ success: true, message: 'RAW' }),
      {
        toolName: 'test_tool',
        conciseFormatter: () => {
          throw new Error('boom')
        },
      },
    )
    const r = await wrapped({})
    expect(r.message).toBe('RAW')
  })

  it('hard-truncates responses exceeding maxTokens', async () => {
    const maxTokens = 50
    const charOver = Math.floor(maxTokens * 3.5) * 4 // well over budget
    const big = 'Y'.repeat(charOver)
    const wrapped = withResponseBudget(
      async (_args: Record<string, unknown>) => ({ success: true, message: big }),
      {
        toolName: 'test_tool',
        maxTokens,
      },
    )
    const r = await wrapped({})
    expect(r.message.length).toBeLessThan(big.length)
    expect(r.message).toContain('[truncated:')
    expect(r.message).toContain("response_format='detailed'")
  })

  it('leaves tiny responses alone below the floor', async () => {
    const wrapped = withResponseBudget(
      async (_args: Record<string, unknown>) => ({ success: true, message: 'hi' }),
      {
        toolName: 'test_tool',
        maxTokens: 1,
      },
    )
    const r = await wrapped({})
    expect(r.message).toBe('hi')
  })

  it('DEFAULT_TOOL_RESPONSE_MAX_TOKENS equals Anthropic default', () => {
    expect(DEFAULT_TOOL_RESPONSE_MAX_TOKENS).toBe(25_000)
  })
})

describe('toolBudget — applyBudgetToSchema', () => {
  const budgetedTool = () => ({
    type: 'function' as const,
    function: {
      name: 'get_canvas_state',
      description: 'canvas',
      parameters: {
        type: 'object',
        properties: { foo: { type: 'string' } },
        required: [],
      },
    },
  })

  const nonBudgetedTool = () => ({
    type: 'function' as const,
    function: {
      name: 'create_text_node',
      description: 'text',
      parameters: { type: 'object', properties: { label: { type: 'string' } }, required: [] },
    },
  })

  it('adds response_format enum param for budgeted tools', () => {
    const out = applyBudgetToSchema(budgetedTool())
    const props = out.function.parameters.properties as Record<string, unknown>
    const rf = props.response_format as Record<string, unknown>
    expect(rf).toBeDefined()
    expect(rf.enum).toEqual(['concise', 'detailed'])
    expect(rf.type).toBe('string')
    // Original properties preserved
    expect(props.foo).toBeDefined()
  })

  it('leaves non-budgeted tools untouched', () => {
    const orig = nonBudgetedTool()
    const out = applyBudgetToSchema(orig)
    const props = out.function.parameters.properties as Record<string, unknown>
    expect(props.response_format).toBeUndefined()
  })

  it('is idempotent', () => {
    const once = applyBudgetToSchema(budgetedTool())
    const twice = applyBudgetToSchema(once)
    expect(Object.keys(twice.function.parameters.properties).sort()).toEqual(
      Object.keys(once.function.parameters.properties).sort(),
    )
  })

  it('registry covers exactly 7 query tools', () => {
    expect(BUDGETED_TOOL_NAMES.size).toBe(7)
    expect(BUDGETED_TOOL_NAMES.has('get_canvas_state')).toBe(true)
    expect(BUDGETED_TOOL_NAMES.has('get_node_output')).toBe(true)
    expect(BUDGETED_TOOL_NAMES.has('list_models')).toBe(true)
    expect(BUDGETED_TOOL_NAMES.has('get_model_params')).toBe(true)
    expect(BUDGETED_TOOL_NAMES.has('list_assets')).toBe(true)
    expect(BUDGETED_TOOL_NAMES.has('recall_memory')).toBe(true)
    expect(BUDGETED_TOOL_NAMES.has('discover_tools')).toBe(true)
  })

  it('every registry entry has a concise formatter', () => {
    for (const name of BUDGETED_TOOL_NAMES) {
      expect(BUDGETED_TOOLS_REGISTRY[name].conciseFormatter).toBeDefined()
    }
  })

  it('getBudgetOpts returns null for unknown tools', () => {
    expect(getBudgetOpts('no_such_tool')).toBeNull()
    const opts = getBudgetOpts('get_canvas_state')
    expect(opts?.toolName).toBe('get_canvas_state')
    expect(opts?.conciseFormatter).toBeDefined()
  })
})

describe('toolBudget — concise formatters', () => {
  const shrinks = (formatter: (r: ToolCallResult, args: Record<string, unknown>) => ToolCallResult, raw: ToolCallResult) => {
    const out = formatter(raw, {})
    expect(out.message.length).toBeLessThanOrEqual(raw.message.length)
    return out
  }

  it('formatCanvasStateConcise strips prompt/desc/content fields from nodes', () => {
    const raw: ToolCallResult = {
      success: true,
      message: JSON.stringify({
        nodeCount: 2,
        edgeCount: 1,
        nodes: [
          {
            id: 'n1',
            type: 'characterGrid',
            label: 'C',
            status: 'idle',
            name: 'A',
            prompt: 'x'.repeat(200),
            description: 'y'.repeat(200),
            model: 'm',
          },
          { id: 'n2', type: 'imageGen', label: 'I', status: 'done', prompt: 'z'.repeat(200) },
        ],
        edges: [{ source: { id: 'n1', label: 'C' }, target: { id: 'n2', label: 'I' } }],
      }),
    }
    const out = shrinks(formatCanvasStateConcise, raw)
    const parsed = JSON.parse(out.message)
    expect(parsed.nodes[0]).toEqual({ id: 'n1', type: 'characterGrid', status: 'idle', label: 'C' })
    expect(parsed.edges[0]).toEqual({ source: 'n1', target: 'n2' })
  })

  it('formatCanvasStateConcise passes through failed results', () => {
    const raw: ToolCallResult = { success: false, message: 'err' }
    expect(formatCanvasStateConcise(raw)).toEqual(raw)
  })

  it('formatNodeOutputConcise head-trims shots and clips arrays', () => {
    const raw: ToolCallResult = {
      success: true,
      message: JSON.stringify({
        nodeId: 'n',
        type: 'storyboard',
        status: 'done',
        label: 'L',
        shotCount: 10,
        shots: Array.from({ length: 10 }, (_, i) => ({
          index: i,
          prompt: 'x'.repeat(200),
          characters: ['A'],
        })),
        clips: Array.from({ length: 10 }, (_, i) => ({ index: i, hasUrl: true, label: 'l' })),
      }),
    }
    const out = shrinks(formatNodeOutputConcise, raw)
    const parsed = JSON.parse(out.message)
    expect(parsed.shots).toHaveLength(3)
    expect(parsed.clips).toHaveLength(3)
    expect(parsed.shots[0].prompt.length).toBeLessThanOrEqual(60)
  })

  it('formatListModelsConcise drops descriptions', () => {
    const raw: ToolCallResult = {
      success: true,
      message:
        '已注册模型 (2):\n' +
        '- [video] veo3 (google): High quality long description here with many words that take tokens\n' +
        '- [image] gemini (google): another long description that we want to drop',
    }
    const out = shrinks(formatListModelsConcise, raw)
    expect(out.message).not.toContain('long description')
    expect(out.message).toContain('veo3')
    expect(out.message).toContain('gemini')
  })

  it('formatModelParamsConcise strips label field from schema entries', () => {
    const raw: ToolCallResult = {
      success: true,
      message: JSON.stringify({
        model_id: 'm',
        schema_version: 1,
        schema: [
          { key: 'duration', type: 'number', min: 4, max: 15, label: 'Long label removed', default: 8 },
          { key: 'style', type: 'select', options: [{ value: 'a' }], label: 'Style!', required: true },
        ],
      }),
    }
    const out = shrinks(formatModelParamsConcise, raw)
    expect(out.message).not.toContain('Long label removed')
    const parsed = JSON.parse(out.message)
    expect(parsed.schema[0].min).toBe(4)
    expect(parsed.schema[1].options).toEqual([{ value: 'a' }])
  })

  it('formatListAssetsConcise drops reference_images and truncates appearance', () => {
    const raw: ToolCallResult = {
      success: true,
      message:
        '找到 1 个素材:\n' +
        JSON.stringify([
          {
            asset_id: '@hero',
            kind: 'character',
            name: 'Hero',
            appearance: 'x'.repeat(300),
            reference_images: ['url1', 'url2', 'url3'],
            variation_count: 0,
            local_only: false,
          },
        ]),
    }
    const out = shrinks(formatListAssetsConcise, raw)
    expect(out.message).not.toContain('reference_images')
    expect(out.message).not.toContain('url1')
  })

  it('formatRecallMemoryConcise tightens content previews', () => {
    const raw: ToolCallResult = {
      success: true,
      message:
        '找到 1 条相关记忆:\n- [project_preference] Title: ' + 'Z'.repeat(300),
    }
    const out = shrinks(formatRecallMemoryConcise, raw)
    expect(out.message.length).toBeLessThan(raw.message.length)
  })

  it('formatDiscoverToolsConcise drops parameters schema', () => {
    const raw: ToolCallResult = {
      success: true,
      message:
        '发现 2 个工具\n\n' +
        JSON.stringify([
          {
            name: 'create_text_node',
            tier: 'tier2',
            description: 'Create a text node with script content',
            parameters: { type: 'object', properties: { label: {}, content: {} }, required: [] },
          },
          {
            name: 'recall_memory',
            tier: 'tier3',
            description: 'Recall memory by query',
            parameters: { type: 'object', properties: { query: {} }, required: ['query'] },
          },
        ]),
    }
    const out = shrinks(formatDiscoverToolsConcise, raw)
    expect(out.message).not.toContain('parameters')
    expect(out.message).toContain('create_text_node')
  })
})
