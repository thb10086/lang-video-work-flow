/**
 * Agent Tool Schema Generator — build model-aware OpenAI function-calling schemas
 *
 * 策略：union + discriminator
 * - `model` 字段是枚举，列出当前 capability 下所有注册的模型 ID
 * - 其他字段取所有模型的并集；每个字段描述中标注 "[仅适用于 <ids>]"（若非通用）
 * - 前端 sanitizer + 后端 param_validator 是最终兜底，LLM 传错字段不会伤到后端
 *
 * 保留字段 (prompt / userInput / systemPrompt / label / script / editInstruction / text
 *   / voice / styleDescription) 会从 schema 中 key 分组里剔除，它们通过专门的参数传入。
 */

import type { AiModelResponse, ParamFieldDTO } from '@/api/backend'
import { DEFAULT_VIDEO_MODEL } from '@/providers/modelDefaults'

// ── Types ──

export interface AgentFunctionTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required: string[]
    }
  }
}

interface PropEntry {
  key: string
  jsonSchema: Record<string, unknown>
  supportedBy: string[] // model_ids that declare this field
}

// 跨工具的 "非参数" 字段（属于 tool-level top-level 而非 model param）
const NON_PARAM_KEYS: ReadonlySet<string> = new Set([
  'prompt', 'userInput', 'systemPrompt', 'label', 'script',
  'editInstruction', 'text', 'voice', 'styleDescription', 'model',
])

// ── Internal helpers ──

function paramFieldToJsonSchema(field: ParamFieldDTO): Record<string, unknown> {
  const ftype = String(field.type || 'string').toLowerCase()

  if (ftype === 'select') {
    const enumValues = (field.options || []).map(o => o.value)
    // Heuristic: detect numeric-only enums
    const allNumber = enumValues.every(v => typeof v === 'number')
    return {
      type: allNumber ? 'number' : 'string',
      enum: enumValues,
    }
  }
  if (ftype === 'number' || ftype === 'slider') {
    const base: Record<string, unknown> = { type: 'number' }
    if (typeof field.min === 'number') base.minimum = field.min
    if (typeof field.max === 'number') base.maximum = field.max
    return base
  }
  if (ftype === 'boolean') return { type: 'boolean' }
  return { type: 'string' }
}

/** Merge param schemas across multiple models into a shared property map. */
function aggregateProperties(models: AiModelResponse[]): Map<string, PropEntry> {
  const byKey = new Map<string, PropEntry>()

  for (const m of models) {
    const schema = Array.isArray(m.param_schema) ? m.param_schema : []
    for (const field of schema) {
      if (!field || typeof field.key !== 'string') continue
      if (NON_PARAM_KEYS.has(field.key)) continue

      const existing = byKey.get(field.key)
      if (!existing) {
        byKey.set(field.key, {
          key: field.key,
          jsonSchema: {
            ...paramFieldToJsonSchema(field),
            description: field.label || field.key,
          },
          supportedBy: [m.model_id],
        })
      } else {
        // Union enum values if both are enum/select
        const prev = existing.jsonSchema
        const next = paramFieldToJsonSchema(field)
        if (Array.isArray(prev.enum) && Array.isArray(next.enum)) {
          const merged = Array.from(new Set([...prev.enum as unknown[], ...next.enum as unknown[]]))
          prev.enum = merged
        }
        // Relax numeric bounds to the widest across models
        if (typeof next.minimum === 'number') {
          const cur = typeof prev.minimum === 'number' ? prev.minimum : Number.POSITIVE_INFINITY
          prev.minimum = Math.min(cur, next.minimum as number)
        }
        if (typeof next.maximum === 'number') {
          const cur = typeof prev.maximum === 'number' ? prev.maximum : Number.NEGATIVE_INFINITY
          prev.maximum = Math.max(cur, next.maximum as number)
        }
        if (!existing.supportedBy.includes(m.model_id)) {
          existing.supportedBy.push(m.model_id)
        }
      }
    }
  }
  return byKey
}

/** Decorate each property's description with "[仅适用于 ...]" when not universal. */
function annotateSupport(props: Map<string, PropEntry>, allModelIds: string[]): void {
  const total = allModelIds.length
  for (const entry of props.values()) {
    if (entry.supportedBy.length < total) {
      const baseDesc = String(entry.jsonSchema.description || entry.key)
      const list = entry.supportedBy.join(', ')
      entry.jsonSchema.description = `${baseDesc} [仅适用于 ${list}]`
    }
  }
}

/** Build `model` enum field from registered model list. */
function buildModelField(models: AiModelResponse[], capabilityLabel: string): Record<string, unknown> {
  const ids = models.map(m => m.model_id)
  return {
    type: 'string',
    enum: ids,
    description: `${capabilityLabel}模型（默认由 modelDefaults 决定；不同模型支持不同参数）`,
  }
}

function assembleProperties(
  models: AiModelResponse[],
  headerProps: Record<string, unknown>,
  capabilityLabel: string,
): Record<string, unknown> {
  const agg = aggregateProperties(models)
  annotateSupport(agg, models.map(m => m.model_id))

  const properties: Record<string, unknown> = { ...headerProps }
  if (models.length > 0) {
    properties.model = buildModelField(models, capabilityLabel)
  }
  for (const entry of agg.values()) {
    properties[entry.key] = entry.jsonSchema
  }
  return properties
}

// ── Public: per-capability tool builders ──

export function buildCreateVideoNodeTool(models: AiModelResponse[]): AgentFunctionTool {
  const properties = assembleProperties(models, {
    prompt: { type: 'string', description: '视频描述提示词 (英文, 含 [Camera]/[Subject]/[Atmosphere]/[Quality]/[Negative])。可用 @assetId 引用素材库资产。' },
    assetRefs: {
      type: 'array',
      items: { type: 'string' },
      description: '额外链接的素材 ID（不在 prompt 文本中出现）。resolvePromptRefs 会合并它们与 @token 来注入外貌与参考图。',
    },
  }, '视频')

  const modelSummary = models.length > 0
    ? models.slice(0, 6).map(m => m.model_id).join(' / ') + (models.length > 6 ? ' ...' : '')
    : DEFAULT_VIDEO_MODEL

  return {
    type: 'function',
    function: {
      name: 'create_video_node',
      description: `在画布上创建视频生成节点。可选模型: ${modelSummary}。不同模型支持的参数不同，请只传入目标模型声明的字段；未声明的字段会被忽略或报 422。创建后用 connect_nodes 连接首帧图片，再 execute_node 执行。多节点建议 parallel_execute。`,
      parameters: {
        type: 'object',
        properties,
        required: [],
      },
    },
  }
}

export function buildCreateImageNodeTool(models: AiModelResponse[]): AgentFunctionTool {
  const properties = assembleProperties(models, {
    prompt: { type: 'string', description: '图片生成提示词 (英文)。可用 @assetId 引用素材库资产。' },
    assetRefs: {
      type: 'array',
      items: { type: 'string' },
      description: '额外链接的素材 ID（不在 prompt 文本中出现）。用于绑定角色/场景/风格，便于后续复用。',
    },
  }, '图片')

  return {
    type: 'function',
    function: {
      name: 'create_image_node',
      description: '在画布上创建图片生成节点。不同图片模型（Gemini / Seedream 等）参数不同，请使用目标模型声明的字段。创建后用 connect_nodes 接入参考图，再 execute_node 执行。',
      parameters: {
        type: 'object',
        properties,
        required: [],
      },
    },
  }
}

export function buildCreateAudioNodeTool(models: AiModelResponse[]): AgentFunctionTool {
  const properties = assembleProperties(models, {
    text: { type: 'string', description: '要转为语音的文本' },
    voice: { type: 'string', description: '声音名称（留空使用默认）' },
  }, '音频')

  return {
    type: 'function',
    function: {
      name: 'create_audio_node',
      description: '在画布上创建音频/配音节点（ElevenLabs / FishSpeech / CosyVoice）。当前音频模型参数 schema 多为空，主要通过 text + voice 驱动。',
      parameters: {
        type: 'object',
        properties,
        required: [],
      },
    },
  }
}

// ── Static: get_model_params tool (model-introspection helper) ──

export const GET_MODEL_PARAMS_TOOL: AgentFunctionTool = {
  type: 'function',
  function: {
    name: 'get_model_params',
    description: '获取指定模型的参数 schema（含字段类型/默认值/区间）。当需要为某一特定模型构造 create_video_node/create_image_node 参数、或者校验字段合法性时调用。',
    parameters: {
      type: 'object',
      properties: {
        model_id: {
          type: 'string',
          description: '模型标识符，例如 doubao-seedance-2-0 / veo3.1-fast / kling-v3',
        },
      },
      required: ['model_id'],
    },
  },
}

// ── Test helpers ──

export const __testing__ = {
  aggregateProperties,
  annotateSupport,
  NON_PARAM_KEYS,
}
