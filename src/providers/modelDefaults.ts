/**
 * Model Defaults — 全局模型配置中心（单一维护点）
 *
 * 所有文件引用此模块的常量，避免默认模型名和参数硬编码散落多处。
 * 修改默认模型 / max_tokens / 参数只需改此文件一处。
 *
 * 模型 max_output_tokens 参考（2025-06）：
 *   GPT-4o           — 16 384
 *   GPT-4.1 / mini   — 32 768
 *   Gemini 2.5 Flash — 65 536
 *   Gemini 2.5 Pro   — 65 536
 *   Gemini 3 Flash   — 65 536
 *   Gemini 3.1 Pro   — 65 536
 */

// ── 默认模型 ID ──
export const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image-preview'
export const DEFAULT_VIDEO_MODEL = 'doubao-seedance-2-0'
export const DEFAULT_LLM_MODEL   = 'gemini-3.1-pro-preview'

// ── 默认视频参数 ──
export const DEFAULT_VIDEO_DURATION   = 5
export const DEFAULT_VIDEO_SIZE       = '16:9'
export const DEFAULT_VIDEO_RESOLUTION = '720p'

// ── 每个模型的最大输出 token 数（用于动态设置 max_tokens） ──
export const MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = {
  // OpenAI
  'gpt-4o':                        16_384,
  'gpt-4o-mini':                   16_384,
  'gpt-4.1':                       32_768,
  'gpt-4.1-mini':                  32_768,
  'gpt-4.1-nano':                  32_768,
  // Google Gemini
  'gemini-2.5-flash':              65_536,
  'gemini-2.5-pro':                65_536,
  'gemini-3-flash-preview':        65_536,
  'gemini-3.1-pro-preview':        65_536,
  'gemini-3.1-flash-image-preview': 8_192,
}

/** 查询模型最大输出 token 数，未知模型回退到 fallback（默认 16384） */
export function getModelMaxTokens(modelId: string, fallback = 16_384): number {
  return MODEL_MAX_OUTPUT_TOKENS[modelId] ?? fallback
}

// ── 任务级 token 预算（与模型无关，按输出预期确定） ──
export const TASK_TOKEN_BUDGETS = {
  /** Agent 聊天循环（含 tool_calls JSON） */
  AGENT_CHAT:        16_384,
  /** 分镜脚本生成（长 JSON，8-12 镜头） */
  STORYBOARD:        16_384,
  /** 通用 LLM 对话节点 */
  LLM_CHAT:           8_192,
  /** 连续性检查报告 */
  CONTINUITY_CHECK:   4_096,
  /** 提示词优化 */
  PROMPT_OPTIMIZE:    2_048,
  /** 风格提取（短文本） */
  STYLE_EXTRACT:        512,
  /** 图片分类（短 JSON） */
  IMAGE_CLASSIFY:       256,
} as const
