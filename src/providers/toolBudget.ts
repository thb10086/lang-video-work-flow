/**
 * Agent Tool Response Budget
 *
 * Higher-order wrapper that:
 *   1. Routes tool output through a `concise` or `detailed` formatter
 *      according to the caller-supplied `response_format` arg.
 *   2. Hard-truncates the final message to a configurable token ceiling
 *      (default 25k, Anthropic's default for tool_result blocks).
 *   3. Tags the wrapped handler with `__isBudgeted = true` metadata so the
 *      rest of the codebase (and tests) can introspect what's wrapped.
 *
 * Rationale: query tools (`get_canvas_state` / `get_node_output` / …) can
 * return huge JSON payloads that inflate context across every agent round.
 * By asking the LLM to opt into `detailed` only when needed, we cut average
 * round token usage without losing expressivity.
 *
 * The registry + `applyBudgetToSchema()` helper lets `getAgentTools()`
 * inject a uniform `response_format` enum parameter without touching each
 * individual schema literal in `toolDefinitions.ts`.
 */

import { estimateTokens } from '@/store/chatPromptBuilder'
import { useSettingsStore } from '@/store/settingsStore'
import type { ToolCallResult } from './toolHelpers'

// ============================================================
// Constants & types
// ============================================================

/** Anthropic's default tool-result size budget (tokens). */
export const DEFAULT_TOOL_RESPONSE_MAX_TOKENS = 25_000

/** Threshold below which a response is never touched even in concise mode. */
const PASSTHROUGH_TOKEN_FLOOR = 80

export type ResponseFormat = 'concise' | 'detailed'

/**
 * A formatter takes a raw ToolCallResult and returns a reshaped result.
 * It MUST preserve `success` and never throw on malformed input — it should
 * return the input unchanged if reshaping fails.
 */
export type ToolFormatter = (
  result: ToolCallResult,
  args: Record<string, unknown>,
) => ToolCallResult

export interface ResponseBudgetOptions {
  toolName: string
  /** Hard truncation ceiling (default {@link DEFAULT_TOOL_RESPONSE_MAX_TOKENS}). */
  maxTokens?: number
  /** Format used when the caller did not pass `response_format`. Default `'concise'`. */
  defaultFormat?: ResponseFormat
  /** Formatter for `'concise'` mode (default mode). */
  conciseFormatter?: ToolFormatter
  /** Formatter for `'detailed'` mode. Rarely needed — passthrough is usually fine. */
  detailedFormatter?: ToolFormatter
}

// ============================================================
// Wrapper
// ============================================================

type Awaitable<T> = T | Promise<T>
type ToolHandler = (args: Record<string, unknown>) => Awaitable<ToolCallResult>

/**
 * Type-safe metadata attached to a budgeted handler. Tests inspect these
 * fields instead of the handler body.
 */
export interface BudgetedHandlerMeta {
  __isBudgeted: true
  __budgetOpts: ResponseBudgetOptions
}

/** Wrap a tool handler so its response is budget-limited and formattable. */
export function withResponseBudget<H extends ToolHandler>(
  handler: H,
  opts: ResponseBudgetOptions,
): H & BudgetedHandlerMeta {
  const maxTokens = opts.maxTokens ?? DEFAULT_TOOL_RESPONSE_MAX_TOKENS
  const defaultFormat: ResponseFormat = opts.defaultFormat ?? 'concise'

  const wrapped = (async (args: Record<string, unknown>): Promise<ToolCallResult> => {
    // Feature flag — default on, but explicit false disables everything.
    const enabled = readEnableFlag()
    const raw = await handler(args)
    if (!enabled) return raw

    // Resolve format (explicit arg > default).
    const requested = typeof args.response_format === 'string' ? args.response_format : undefined
    const format: ResponseFormat =
      requested === 'detailed' ? 'detailed' : requested === 'concise' ? 'concise' : defaultFormat

    // Apply the relevant formatter. Formatters must be defensive — if they
    // throw, we fall back to the raw result rather than failing the call.
    let formatted: ToolCallResult = raw
    if (format === 'concise' && opts.conciseFormatter) {
      formatted = safeFormat(opts.toolName, 'concise', opts.conciseFormatter, raw, args)
    } else if (format === 'detailed' && opts.detailedFormatter) {
      formatted = safeFormat(opts.toolName, 'detailed', opts.detailedFormatter, raw, args)
    }

    // Hard truncation at token ceiling. We leave a generous hint suffix so
    // the LLM knows why content is cut off and how to opt into full detail.
    const tokens = estimateTokens(formatted.message)
    if (tokens <= Math.max(maxTokens, PASSTHROUGH_TOKEN_FLOOR)) {
      return formatted
    }
    const charBudget = Math.floor(maxTokens * 3.5)
    const hint =
      `\n\n[truncated: response exceeded ${maxTokens} tokens; pass response_format='detailed' only if you need full fields.]`
    const head = formatted.message.slice(0, Math.max(0, charBudget - hint.length))
    return { ...formatted, message: head + hint }
  }) as H & BudgetedHandlerMeta

  wrapped.__isBudgeted = true
  wrapped.__budgetOpts = opts
  return wrapped
}

/** Read the feature flag from settings store; defensive about uninitialised stores. */
function readEnableFlag(): boolean {
  try {
    return useSettingsStore.getState().enableResponseBudget !== false
  } catch {
    return true
  }
}

function safeFormat(
  toolName: string,
  mode: ResponseFormat,
  fmt: ToolFormatter,
  raw: ToolCallResult,
  args: Record<string, unknown>,
): ToolCallResult {
  try {
    return fmt(raw, args)
  } catch (err) {
    console.warn(`[toolBudget] ${mode} formatter for ${toolName} threw; using raw result`, err)
    return raw
  }
}

// ============================================================
// Concise formatters (per-tool)
// ============================================================
//
// Each formatter is a pure function that reshapes the handler's output
// into the smallest form still useful for decision-making. They all parse
// the JSON or text shape the handler produces — if the shape changes, the
// formatter no-ops and returns the raw result unchanged.

/** `get_canvas_state` — keep {id, type, status, label} per node; edges collapse to id-pair. */
export function formatCanvasStateConcise(raw: ToolCallResult): ToolCallResult {
  if (!raw.success) return raw
  const parsed = tryParseJson(raw.message)
  if (!parsed || typeof parsed !== 'object') return raw
  const obj = parsed as Record<string, unknown>
  const nodes = Array.isArray(obj.nodes) ? (obj.nodes as Array<Record<string, unknown>>) : []
  const edges = Array.isArray(obj.edges) ? (obj.edges as Array<Record<string, unknown>>) : []
  const compactNodes = nodes.map(n => ({
    id: n.id,
    type: n.type,
    status: n.status,
    label: n.label,
  }))
  const compactEdges = edges.map(e => ({
    source: readEdgeEndpoint(e.source),
    target: readEdgeEndpoint(e.target),
  }))
  return {
    ...raw,
    message: JSON.stringify({
      nodeCount: obj.nodeCount ?? nodes.length,
      edgeCount: obj.edgeCount ?? edges.length,
      nodes: compactNodes,
      edges: compactEdges,
    }),
  }
}

/** `get_node_output` — preserve status + key outputs; truncate shots/clips to head 3. */
export function formatNodeOutputConcise(raw: ToolCallResult): ToolCallResult {
  if (!raw.success) return raw
  const parsed = tryParseJson(raw.message)
  if (!parsed || typeof parsed !== 'object') return raw
  const o = parsed as Record<string, unknown>
  const slim: Record<string, unknown> = {
    nodeId: o.nodeId,
    label: o.label,
    type: o.type,
    status: o.status,
  }
  // Preserve booleans / compact URL markers — these are already tiny.
  for (const k of ['error', 'hasOutputImage', 'hasCroppedImage', 'hasOutputAudio', 'outputVideoUrl', 'progress']) {
    if (k in o) slim[k] = o[k]
  }
  // Heavy arrays — head trim.
  if (Array.isArray(o.shots)) {
    const shots = o.shots as Array<Record<string, unknown>>
    slim.shotCount = o.shotCount ?? shots.length
    slim.shots = shots.slice(0, 3).map(s => ({
      index: s.index,
      prompt: typeof s.prompt === 'string' ? s.prompt.slice(0, 60) : s.prompt,
    }))
  }
  if (Array.isArray(o.clips)) {
    const clips = o.clips as Array<Record<string, unknown>>
    slim.clipCount = o.clipCount ?? clips.length
    slim.clips = clips.slice(0, 3).map(c => ({ index: c.index, hasUrl: c.hasUrl }))
  }
  if (o.checkResults && typeof o.checkResults === 'object') {
    const cr = o.checkResults as Record<string, unknown>
    slim.checkResults = { total: cr.total, passed: cr.passed }
  }
  return { ...raw, message: JSON.stringify(slim) }
}

/** `list_models` — drop description text; keep 1 line per model. */
export function formatListModelsConcise(raw: ToolCallResult): ToolCallResult {
  if (!raw.success) return raw
  const lines = raw.message.split('\n')
  const header = lines[0]
  const slim = lines.slice(1).map(line => {
    // Input shape: "- [capability] model_id (provider): description"
    const match = line.match(/^-\s+\[(\w+)\]\s+([^\s]+)\s+\(([^)]+)\)/)
    return match ? `- [${match[1]}] ${match[2]} (${match[3]})` : line
  })
  return { ...raw, message: [header, ...slim].join('\n') }
}

/** `get_model_params` — drop `label`/description fields from each param. */
export function formatModelParamsConcise(raw: ToolCallResult): ToolCallResult {
  if (!raw.success) return raw
  const parsed = tryParseJson(raw.message)
  if (!parsed || typeof parsed !== 'object') return raw
  const o = parsed as Record<string, unknown>
  const schema = Array.isArray(o.schema) ? (o.schema as Array<Record<string, unknown>>) : []
  const compactSchema = schema.map(f => {
    const slim: Record<string, unknown> = { key: f.key, type: f.type }
    for (const k of ['enum', 'options', 'min', 'max', 'default', 'required']) {
      if (k in f && f[k] !== undefined && f[k] !== null) slim[k] = f[k]
    }
    return slim
  })
  return {
    ...raw,
    message: JSON.stringify({
      model_id: o.model_id,
      schema_version: o.schema_version,
      schema: compactSchema,
    }),
  }
}

/** `list_assets` — trim reference_images array; truncate appearance text. */
export function formatListAssetsConcise(raw: ToolCallResult): ToolCallResult {
  if (!raw.success) return raw
  // Handler output: header line(s), then JSON.stringify(items, null, 2).
  // We only reshape the JSON block; leave human-readable prefix lines alone.
  const jsonStart = raw.message.indexOf('[')
  if (jsonStart < 0) return raw
  const prefix = raw.message.slice(0, jsonStart)
  const jsonBlock = raw.message.slice(jsonStart)
  const parsed = tryParseJson(jsonBlock)
  if (!Array.isArray(parsed)) return raw
  const compact = (parsed as Array<Record<string, unknown>>).map(a => ({
    asset_id: a.asset_id,
    kind: a.kind,
    name: a.name,
    appearance: typeof a.appearance === 'string' ? a.appearance.slice(0, 60) : a.appearance,
    variation_count: a.variation_count ?? 0,
    local_only: a.local_only ?? false,
  }))
  return { ...raw, message: prefix + JSON.stringify(compact) }
}

/** `recall_memory` — tighter content truncation + flattened bullet list. */
export function formatRecallMemoryConcise(raw: ToolCallResult): ToolCallResult {
  if (!raw.success) return raw
  // Handler output: "找到 N 条相关记忆:\n- [type] title: content preview\n..."
  const lines = raw.message.split('\n')
  const compressed = lines.map(line => {
    if (!line.startsWith('- [')) return line
    // Shorten "content preview" to 60 chars. Split carefully so title colons
    // inside content aren't mistaken for the delimiter.
    const splitIdx = line.indexOf(': ', line.indexOf(']'))
    if (splitIdx < 0) return line
    const head = line.slice(0, splitIdx + 2)
    const body = line.slice(splitIdx + 2).slice(0, 60)
    return head + body
  })
  return { ...raw, message: compressed.join('\n') }
}

/** `discover_tools` — drop full `parameters` schema; keep name/tier/description. */
export function formatDiscoverToolsConcise(raw: ToolCallResult): ToolCallResult {
  if (!raw.success) return raw
  // Handler output: header line, blank line, JSON.stringify(rows, null, 2)
  const jsonStart = raw.message.indexOf('[')
  if (jsonStart < 0) return raw
  const prefix = raw.message.slice(0, jsonStart)
  const parsed = tryParseJson(raw.message.slice(jsonStart))
  if (!Array.isArray(parsed)) return raw
  const compact = (parsed as Array<Record<string, unknown>>).map(t => ({
    name: t.name,
    tier: t.tier,
    description: typeof t.description === 'string' ? t.description.slice(0, 120) : t.description,
  }))
  return { ...raw, message: prefix + JSON.stringify(compact) }
}

// ============================================================
// Registry — which tools are budgeted + which formatter to use
// ============================================================

export const BUDGETED_TOOLS_REGISTRY: Readonly<
  Record<string, Omit<ResponseBudgetOptions, 'toolName'>>
> = Object.freeze({
  get_canvas_state: { conciseFormatter: formatCanvasStateConcise, defaultFormat: 'concise' },
  get_node_output: { conciseFormatter: formatNodeOutputConcise, defaultFormat: 'concise' },
  list_models: { conciseFormatter: formatListModelsConcise, defaultFormat: 'concise' },
  get_model_params: { conciseFormatter: formatModelParamsConcise, defaultFormat: 'concise' },
  list_assets: { conciseFormatter: formatListAssetsConcise, defaultFormat: 'concise' },
  recall_memory: { conciseFormatter: formatRecallMemoryConcise, defaultFormat: 'concise' },
  discover_tools: { conciseFormatter: formatDiscoverToolsConcise, defaultFormat: 'concise' },
})

export const BUDGETED_TOOL_NAMES: ReadonlySet<string> = new Set(Object.keys(BUDGETED_TOOLS_REGISTRY))

/** Convenience: build the option bag with the tool name filled in. */
export function getBudgetOpts(toolName: string): ResponseBudgetOptions | null {
  const entry = BUDGETED_TOOLS_REGISTRY[toolName]
  if (!entry) return null
  return { toolName, ...entry }
}

// ============================================================
// Schema decoration
// ============================================================

/**
 * If `tool` is one of the budgeted tools, add an optional
 * `response_format: 'concise' | 'detailed'` parameter to its schema.
 * Idempotent — adding twice is a no-op.
 */
export function applyBudgetToSchema<
  T extends {
    function?: {
      name?: string
      description?: string
      parameters?: {
        type?: string
        properties?: Record<string, unknown>
        required?: string[]
      }
    }
  },
>(tool: T): T {
  const name = tool.function?.name
  if (!name || !BUDGETED_TOOL_NAMES.has(name)) return tool
  const params = tool.function?.parameters
  if (!params || typeof params !== 'object') return tool
  const props = params.properties ?? {}
  if ('response_format' in props) return tool
  const nextProps: Record<string, unknown> = {
    ...props,
    response_format: {
      type: 'string',
      enum: ['concise', 'detailed'],
      description:
        "响应粒度。默认 'concise'（省 token）。需要完整字段时再用 'detailed'。大多数场景 concise 已足够。",
    },
  }
  return {
    ...tool,
    function: {
      ...tool.function,
      parameters: { ...params, properties: nextProps },
    },
  } as T
}

// ============================================================
// Helpers
// ============================================================

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function readEdgeEndpoint(ep: unknown): unknown {
  if (ep && typeof ep === 'object' && 'id' in (ep as Record<string, unknown>)) {
    return (ep as Record<string, unknown>).id
  }
  return ep
}
