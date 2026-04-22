/**
 * Param Sanitizer — pure helpers for schema-aware node data cleanup.
 *
 * 职责：把节点 data 中的"模型参数"字段跟 ParamField[] 对齐，
 * 在"切换模型"和"执行生成"两个时机分别做不同策略的清洗。
 *
 * 两个 public 函数均为纯函数（不读任何 store），便于单测与服务端复用。
 */

import type { ParamField } from './types'

// 保留字段 — 即使不在 schema 里也要保留在节点数据中的 key，避免误杀。
// 这些是节点 UI 层 / 执行流所需，不参与后端 params 体。
const NODE_RESERVED_KEYS: ReadonlySet<string> = new Set([
  // Identity & status
  'label', 'status', 'errorMsg', 'progress', 'retryCount', 'taskId',
  // Port inputs / outputs
  'prompt', 'referenceImages', 'referenceImage', 'referenceImageUrl',
  'firstFrameImage', 'firstFrameImageUrl',
  'lastFrameImage', 'lastFrameImageUrl',
  'characterImage', 'characterUrl', 'characterTimestamps',
  'outputImage', 'outputImageUrl', 'outputVideo', 'outputVideoUrl', 'outputAudio',
  'croppedImage', 'extractedStyle',
  // Type-specific helpers
  'model',           // handled separately
  'name',            // characterGrid
  'description',     // several node types
  'content',         // textNode
  'response',        // llmChat
  'script',          // characterExtract / storyboard
  'shots', 'clips', 'results',   // structured outputs
  'styleDescription',            // styleLock
])

// 模型参数字段 (会进入后端 params 体) 的识别方式：
// 1. 出现在 schema 里 → 是参数
// 2. 不在 NODE_RESERVED_KEYS 里 且 在 oldData 里 → 可能是陈旧参数
// 3. 以 `__` 开头的内部标记字段 → 跳过清洗（保留）

function isReserved(key: string): boolean {
  return NODE_RESERVED_KEYS.has(key) || key.startsWith('__')
}

function schemaKeys(schema: ParamField[] | undefined | null): Set<string> {
  const keys = new Set<string>()
  for (const f of schema || []) {
    if (f && typeof f.key === 'string') keys.add(f.key)
  }
  return keys
}

// ──────────────────────────────────────────────────────────────
// sanitizeForExecute — 构造发给后端的 params 体
//
// 规则：
// - 只取 schema 中声明的 key
// - 值存在 (非 null/undefined/空串) 则用 node.data 的值
// - 否则若 schema 有 default 就填 default
// - 其他 reserved / 未知 key 一律不进入 params
// ──────────────────────────────────────────────────────────────

export function sanitizeForExecute(
  nodeData: Record<string, unknown>,
  schema: ParamField[] | undefined | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of schema || []) {
    if (!field || typeof field.key !== 'string') continue
    const v = nodeData[field.key]
    if (v !== undefined && v !== null && v !== '') {
      out[field.key] = v
    } else if (field.default !== undefined) {
      out[field.key] = field.default
    }
  }
  return out
}

// ──────────────────────────────────────────────────────────────
// sanitizeOnModelSwitch — 切换模型时清理老字段 + 注入新 schema 的默认值
//
// 规则：
// - 保留 reserved keys（label/status/prompt/referenceImages 等）
// - 保留新 schema 中声明的字段；若 oldData 中的值仍合法（在 options 或区间内）沿用，否则用新 default
// - 删除老 schema 特有、新 schema 没有的字段（stale）
// - 返回 { clean, removed }，其中 removed 是被剔除的 key 列表
// ──────────────────────────────────────────────────────────────

export interface ModelSwitchResult {
  clean: Record<string, unknown>
  removed: string[]
}

function isValueCompatible(field: ParamField, value: unknown): boolean {
  const ftype = field.type
  if (value === undefined || value === null || value === '') return false

  if (ftype === 'select') {
    const options = field.options || []
    return options.some(o => o.value === value)
  }
  if (ftype === 'slider' || ftype === 'number') {
    const num = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(num)) return false
    if (field.min !== undefined && num < field.min) return false
    if (field.max !== undefined && num > field.max) return false
    return true
  }
  if (ftype === 'boolean') {
    return typeof value === 'boolean'
  }
  // text/textarea/image — almost any non-empty string is fine
  return typeof value === 'string'
}

export function sanitizeOnModelSwitch(
  oldData: Record<string, unknown>,
  newSchema: ParamField[] | undefined | null,
): ModelSwitchResult {
  const newKeys = schemaKeys(newSchema)
  const clean: Record<string, unknown> = {}
  const removed: string[] = []

  // Pass 1: keep reserved keys as-is
  for (const [key, value] of Object.entries(oldData)) {
    if (isReserved(key)) {
      clean[key] = value
      continue
    }
    // Pass 2: non-reserved key
    if (newKeys.has(key)) {
      // still in new schema — decide if value remains compatible
      const field = (newSchema || []).find(f => f.key === key)
      if (field && isValueCompatible(field, value)) {
        clean[key] = value
      }
      // else fall through — will be filled with default below
    } else {
      // key disappeared from new schema → stale
      removed.push(key)
    }
  }

  // Pass 3: fill defaults for new-schema fields that are missing or incompatible
  for (const field of newSchema || []) {
    if (!field || typeof field.key !== 'string') continue
    if (clean[field.key] === undefined && field.default !== undefined) {
      clean[field.key] = field.default
    }
  }

  return { clean, removed }
}

// ──────────────────────────────────────────────────────────────
// Helpers exposed for tests
// ──────────────────────────────────────────────────────────────

export const __testing__ = {
  isReserved,
  isValueCompatible,
  NODE_RESERVED_KEYS,
}
