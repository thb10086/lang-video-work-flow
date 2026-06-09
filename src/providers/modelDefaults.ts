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
// 注意：与后端 settings.DEFAULT_*_MODEL 保持同步（@server/app/config.py）
// 修改默认模型时务必同时：
//   1. 改 server/.env 的 DEFAULT_*_MODEL
//   2. 在 server/app/db/seed.py 添加对应模型 + channel mapping
//   3. 递增 settingsStore.version 让旧缓存失效
export const DEFAULT_IMAGE_MODEL = 'gpt-image-2'
export const DEFAULT_VIDEO_MODEL = 'sora-2-vvip'
export const DEFAULT_LLM_MODEL   = 'claude-opus-4-7'
export const DEFAULT_AUDIO_MODEL = 'elevenlabs'
export const DEFAULT_VISION_ADAPTER = 'gemini-vision'

// ── 已知模型枚举（静态回退，运行时优先从后端 DB 加载） ──
// ToApis 视频 SKU 对照（2026-05 价格）：
//   按次：sora-2-vvip 30 分/次  /  veo3.1-fast 16 分/次  /  veo3.1-lite 更便宜
//   按秒：wan2.6-flash 6 分/s  /  kling-v2-6 7.36 分/s  /  hailuo-2.3 9.76 分/s
//   按 token：doubao-seedance-2-0(-fast) 1057.14/1M
export const KNOWN_VIDEO_MODELS = [
  'sora-2-vvip', 'sora-2-official',
  'veo3.1-fast', 'veo3.1-lite',
  'kling-v2-6',
  'grok-video-3',
  'wan2.6-flash',
  'minimax-hailuo-2-3',
  'doubao-seedance-2-0', 'doubao-seedance-2-0-fast',
] as const

export const KNOWN_AUDIO_MODELS = [
  'elevenlabs', 'fish-speech', 'cosyvoice',
] as const

// ── 上下文窗口（用于压缩策略） ──
export const CONTEXT_TOKEN_CEILING = 120_000
export const AUTO_COMPACT_THRESHOLD = 0.75
export const FULL_COMPACT_THRESHOLD = 0.90

// ── 默认视频参数 ──
// duration=12 与默认模型 sora-2-vvip 的锁定值保持同步（实测 svip 分组下唯一可用价格档）。
// 切换到其他模型时，sanitizeOnModelSwitch 会按目标模型 schema 自动校正到合法值。
export const DEFAULT_VIDEO_DURATION   = 12
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
  // Anthropic
  'claude-opus-4-7':               32_768,
  'claude-sonnet-4-20250514':      16_384,
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
