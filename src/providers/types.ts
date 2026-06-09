/**
 * AI Model Provider Abstraction Layer
 * 
 * 策略模式 + 适配器模式：
 * - IModelAdapter 统一接口，所有模型 Adapter 必须实现
 * - ModelRegistry 注册中心（工厂模式），新增模型只需注册一个 Adapter
 * - 更换渠道/添加模型零业务代码修改
 */

// ============================================================
// 模型能力枚举
// ============================================================

export type ModelCapability = 'text' | 'image' | 'video' | 'audio' | 'character'

// ============================================================
// 模型信息
// ============================================================

export interface ModelInfo {
  id: string
  name: string
  provider: string
  capabilities: ModelCapability[]
  description?: string
}

// ============================================================
// 参数 Schema（用于动态渲染节点 UI）
// ============================================================

export interface ParamField {
  key: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'select' | 'textarea' | 'image' | 'slider'
  required: boolean
  default?: unknown
  options?: { label: string; value: string | number }[]
  min?: number
  max?: number
  step?: number
  placeholder?: string
  description?: string
}

// ============================================================
// 生成请求/响应类型（同步：LLM、图片）
// ============================================================

export interface GenerateInput {
  prompt: string
  systemPrompt?: string
  referenceImages?: string[]  // base64 或 URL
  params?: Record<string, unknown>
}

export interface GenerateOutput {
  text?: string
  images?: GeneratedImage[]
  usage?: TokenUsage
  raw?: unknown
}

export interface GeneratedImage {
  data: string       // base64 编码
  mimeType: string   // image/png, image/jpeg
  url?: string       // 如果有 CDN URL
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

// ============================================================
// 流式生成类型（LLM 流式输出）
// ============================================================

export interface StreamChunk {
  text?: string
  done: boolean
  usage?: TokenUsage
}

// ============================================================
// 异步任务类型（视频等耗时操作）
// ============================================================

export interface TaskInput {
  prompt: string
  images?: string[]           // 首帧/尾帧图片 URL
  characterUrl?: string       // Sora Character URL
  characterTimestamps?: string // e.g. "1,3"
  params?: Record<string, unknown>
}

export interface TaskSubmitResult {
  taskId: string
  status: TaskStatus
  raw?: unknown
}

export type TaskStatus = 'pending' | 'processing' | 'completed' | 'error'

export interface TaskQueryResult {
  taskId: string
  status: TaskStatus
  progress?: number           // 0-100
  outputUrl?: string          // 生成完成后的资源 URL
  outputUrls?: string[]       // 多个输出
  error?: string
  raw?: unknown
}

// ============================================================
// Character 类型（Sora Character 功能）
// ============================================================

export interface CharacterCreateInput {
  fromTaskId?: string         // 从已有视频任务提取
  videoUrl?: string           // 或直接提供视频 URL
  timestamps?: string         // e.g. "1,3"
}

export interface CharacterInfo {
  id: string
  url?: string
  profilePictureUrl?: string
}

// ============================================================
// 核心接口：IModelAdapter（策略模式）
// ============================================================

export interface IModelAdapter {
  readonly modelId: string
  readonly modelInfo: ModelInfo
  readonly capabilities: ModelCapability[]

  /** 同步生成（LLM 文本、图片） */
  generate(input: GenerateInput): Promise<GenerateOutput>

  /** 流式生成（LLM 流式输出） */
  generateStream?(input: GenerateInput): AsyncGenerator<StreamChunk>

  /** 提交异步任务（视频生成等） */
  submitTask?(input: TaskInput): Promise<TaskSubmitResult>

  /** 查询异步任务状态 */
  queryTask?(taskId: string): Promise<TaskQueryResult>

  /** 创建 Character（Sora 专属） */
  createCharacter?(input: CharacterCreateInput): Promise<CharacterInfo>

  /** 获取模型支持的参数 schema */
  getParamSchema(): ParamField[]
}

// ============================================================
// API 配置
// ============================================================

export interface APIConfig {
  baseUrl: string
  apiKey: string
  timeout?: number
}

// ============================================================
// 端口数据类型（节点连接系统）
// ============================================================

export enum PortDataType {
  TEXT = 'text',
  IMAGE = 'image',
  IMAGE_SET = 'imageSet',
  VIDEO = 'video',
  AUDIO = 'audio',
  CHARACTER = 'character',
  PROMPT = 'prompt',
  STORYBOARD = 'storyboard',
}

export interface NodePort {
  id: string
  label: string
  dataType: PortDataType
  direction: 'input' | 'output'
  required: boolean
  multi: boolean
}

// ============================================================
// Structured ToolResult contract (D-6) — mirrors backend `app/agents/types.py`
// ============================================================

export interface ToolError {
  code: string
  message: string
  recoverable: boolean
}

export interface ToolMeta {
  elapsed_ms: number
  cost_tokens?: number
}

export interface ToolResult<T = unknown> {
  ok: boolean
  data?: T
  hints?: string[]
  next_step?: string
  error?: ToolError
  meta?: ToolMeta
}

/** Legacy `ToolCallResult` shape used by all current `agentTools.executeToolCall` callers. */
export interface LegacyToolCallResult {
  success: boolean
  message: string
  nodeIds?: string[] | null
}

/**
 * Adapter: project a structured `ToolResult` to the legacy `{success, message, nodeIds?}`
 * shape so existing call sites don't need to be changed yet. The new SSE-driven
 * runtime consumes `ToolResult` directly; this is only for back-compat with the
 * frontend `chatStore` legacy path during the migration window.
 */
export function toLegacyResult<T = unknown>(result: ToolResult<T>): LegacyToolCallResult {
  const parts: string[] = []
  if (result.hints && result.hints.length > 0) parts.push(...result.hints)
  if (result.data !== undefined && result.data !== null) {
    try {
      parts.push(JSON.stringify(result.data))
    } catch {
      parts.push(String(result.data))
    }
  } else if (result.error) {
    parts.push(`[${result.error.code}] ${result.error.message}`)
  }
  const message = parts.join(' | ').slice(0, 200)

  let nodeIds: string[] | null = null
  if (result.data && typeof result.data === 'object') {
    const obj = result.data as { affected_node_ids?: unknown; nodeIds?: unknown }
    const ids = obj.affected_node_ids ?? obj.nodeIds
    if (Array.isArray(ids)) {
      nodeIds = ids.map((x) => String(x))
    }
  }
  return { success: result.ok, message, nodeIds }
}
