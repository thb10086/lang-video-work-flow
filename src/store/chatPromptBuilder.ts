/**
 * Chat Prompt Builder — Agent 系统提示词构建 + 辅助函数
 *
 * 从 chatStore.ts 拆分，负责：
 * - buildAgentSystemPrompt(): 组装完整系统提示词
 * - detectCurrentPhase(): 推断当前工作阶段
 * - getCanvasSnapshot(): 画布状态快照
 * - compactConversationHistory(): 上下文压缩
 * - buildMultimodalContent(): 多模态内容构建
 */

import { useSettingsStore } from '@/store/settingsStore'
import { DEFAULT_VIDEO_MODEL, CONTEXT_TOKEN_CEILING, AUTO_COMPACT_THRESHOLD, FULL_COMPACT_THRESHOLD } from '@/providers/modelDefaults'
import { getSystemPromptForRole } from '@/prompts/roles'
import { buildSkillsPromptByPhase } from '@/prompts/skills'
import { renderPromptEngineeringQuickRef } from '@/prompts/promptCraft'
import { useFlowStore } from '@/store/flowStore'
import { useAgentMemoryStore } from '@/store/agentMemoryStore'

import type { ChatMessage } from './chatStore'

// ============================================================
// Types
// ============================================================
export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: string } }
export type LLMMessage = { role: string; content: string | null | ContentPart[]; tool_calls?: unknown[]; tool_call_id?: string }

// ============================================================
// Token estimation (no tokenizer — use char/4 heuristic)
// Claude Code uses real token counting; we approximate.
// ============================================================
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0
  return Math.ceil(text.length / 3.5)
}

export function estimateMessageTokens(msg: LLMMessage): number {
  let tokens = 4 // message overhead
  if (typeof msg.content === 'string') {
    tokens += estimateTokens(msg.content)
  } else if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part.type === 'text') tokens += estimateTokens(part.text)
      else if (part.type === 'image_url') tokens += 1000 // image token estimate
    }
  }
  if (msg.tool_calls) tokens += estimateTokens(JSON.stringify(msg.tool_calls))
  return tokens
}

export function estimateTotalTokens(messages: LLMMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0)
}

// ============================================================
// Canvas state snapshot (compact)
// ============================================================
export function getCanvasSnapshot(): string {
  const { nodes, edges } = useFlowStore.getState()
  if (nodes.length === 0) return '画布为空。'
  const nodeList = nodes.map(n => {
    const label = String(n.data?.label || n.id)
    const type = String(n.type || 'unknown')
    const status = String(n.data?.status || '-')
    const extras: string[] = []
    if (n.data?.prompt) extras.push(`prompt="${String(n.data.prompt).slice(0, 60)}"`)
    if (n.data?.description) extras.push(`desc="${String(n.data.description).slice(0, 60)}"`)
    if (n.data?.content) extras.push(`content="${String(n.data.content).slice(0, 60)}"`)
    if (n.data?.name && n.type !== 'textNode') extras.push(`name="${String(n.data.name)}"`)
    const extraStr = extras.length > 0 ? ` {${extras.join(', ')}}` : ''
    return `- [${type}] "${label}" (${status})${extraStr}`
  }).join('\n')
  return `${nodes.length} 节点, ${edges.length} 连线:\n${nodeList}`
}

// ============================================================
// Detect current workflow phase from canvas state
// ============================================================
export function detectCurrentPhase(): string {
  const { nodes } = useFlowStore.getState()
  if (nodes.length === 0) return 'pre_production'

  const types = new Set(nodes.map(n => String(n.type || '')))
  const hasVideo = types.has('videoGen') || types.has('videoStitch')
  const hasAudio = types.has('audioNode')
  const hasImage = types.has('imageGen') || types.has('imageEdit')

  // Post-production: video/audio nodes exist and have outputs
  if (hasVideo || hasAudio) {
    const videoNodes = nodes.filter(n => n.type === 'videoGen' || n.type === 'videoStitch')
    const hasVideoOutput = videoNodes.some(n => n.data?.outputVideo || n.data?.status === 'success')
    if (hasVideoOutput) return 'post_production'
  }

  // Production: image/video nodes exist (generating content)
  if (hasImage || hasVideo) return 'production'

  // Pre-production: only planning nodes (characters, scenes, storyboard, text, style)
  return 'pre_production'
}

// ============================================================
// Multimodal content builder (OpenAI Vision format)
// ============================================================
export function buildMultimodalContent(text: string, images?: string[]): string | ContentPart[] {
  if (!images || images.length === 0) return text
  const parts: ContentPart[] = [{ type: 'text', text }]
  for (const img of images) {
    const url = img.startsWith('data:') ? img : `data:image/png;base64,${img}`
    parts.push({ type: 'image_url', image_url: { url, detail: 'high' } })
  }
  return parts
}

// ============================================================
// Three-Layer Context Compression (Claude Code pattern)
//
// Layer 1 — MicroCompact: trim tool outputs in-place, zero API cost
// Layer 2 — AutoCompact: triggered near context limit, structured summary
// Layer 3 — Full Compact: compress everything, re-inject only critical context
// ============================================================

// 上下文压缩阈值从 modelDefaults.ts 统一管理
// CONTEXT_TOKEN_CEILING / AUTO_COMPACT_THRESHOLD / FULL_COMPACT_THRESHOLD

/**
 * Layer 1 — MicroCompact
 * Trim old tool outputs in-place. Zero API calls.
 * Called every round inside the agent loop.
 */
export function microCompact(messages: LLMMessage[], preserveRecent = 20): void {
  const cutoff = messages.length - preserveRecent
  if (cutoff <= 0) return

  for (let i = 0; i < cutoff; i++) {
    const m = messages[i]
    // Trim verbose tool outputs
    if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 200) {
      try {
        const parsed = JSON.parse(m.content)
        m.content = JSON.stringify({
          success: parsed.success,
          message: String(parsed.message || '').slice(0, 80),
        })
      } catch { /* keep original */ }
    }
    // Trim long assistant reasoning
    if (m.role === 'assistant' && typeof m.content === 'string' && m.content.length > 500 && i < cutoff - 5) {
      m.content = m.content.slice(0, 200) + '...'
    }
  }
}

/**
 * Layer 2 — AutoCompact
 * Triggered when approaching context window limit.
 * Summarizes older messages, preserves recent window.
 */
export function autoCompact(messages: LLMMessage[], maxRecent = 20): LLMMessage[] {
  if (messages.length <= maxRecent) return messages

  const older = messages.slice(0, -maxRecent)
  const recent = messages.slice(-maxRecent)

  // Build structured summary by role
  const userActions: string[] = []
  const toolsExecuted: string[] = []
  const keyResults: string[] = []

  for (const m of older) {
    if (m.role === 'user' && typeof m.content === 'string') {
      userActions.push(m.content.slice(0, 80))
    } else if (m.role === 'tool' && typeof m.content === 'string') {
      try {
        const parsed = JSON.parse(m.content)
        if (parsed.success) keyResults.push(String(parsed.message || '').slice(0, 60))
        else keyResults.push(`[FAIL] ${String(parsed.message || '').slice(0, 60)}`)
      } catch {
        keyResults.push(m.content.slice(0, 60))
      }
    } else if (m.role === 'assistant' && m.tool_calls && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls as Array<{ function?: { name?: string } }>) {
        if (tc.function?.name) toolsExecuted.push(tc.function.name)
      }
    }
  }

  // Deduplicate tool names with counts
  const toolCounts = new Map<string, number>()
  for (const t of toolsExecuted) toolCounts.set(t, (toolCounts.get(t) || 0) + 1)
  const toolSummary = Array.from(toolCounts.entries()).map(([name, count]) =>
    count > 1 ? `${name}(x${count})` : name
  ).join(', ')

  const summaryLines = [
    userActions.length > 0 ? `用户请求: ${userActions.slice(-3).join('; ')}` : '',
    toolSummary ? `执行工具: ${toolSummary}` : '',
    keyResults.length > 0 ? `关键结果: ${keyResults.slice(-5).join('; ')}` : '',
  ].filter(Boolean)

  const compactedMsg: LLMMessage = {
    role: 'assistant',
    content: `[上下文摘要 — ${older.length} 条消息压缩]\n${summaryLines.join('\n')}\n[/摘要]`,
  }

  // Save to memory store
  useAgentMemoryStore.getState().addCompactedContext(
    summaryLines.join('\n'),
    Array.from(toolCounts.keys())
  )

  return [compactedMsg, ...recent]
}

/**
 * Layer 3 — Full Compact
 * Nuclear option: compress everything to a minimal summary.
 * Re-inject: active plan + last user request + canvas state.
 */
export function fullCompact(messages: LLMMessage[]): LLMMessage[] {
  // Extract the last user message (we always need it)
  const lastUser = [...messages].reverse().find(m => m.role === 'user')

  // Count all tool calls across the conversation
  const allTools: string[] = []
  const allResults: string[] = []
  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls as Array<{ function?: { name?: string } }>) {
        if (tc.function?.name) allTools.push(tc.function.name)
      }
    }
    if (m.role === 'tool' && typeof m.content === 'string') {
      try {
        const parsed = JSON.parse(m.content)
        if (parsed.success === false) allResults.push(`[FAIL] ${String(parsed.message || '').slice(0, 50)}`)
      } catch { /* skip */ }
    }
  }

  const toolCounts = new Map<string, number>()
  for (const t of allTools) toolCounts.set(t, (toolCounts.get(t) || 0) + 1)

  const canvasState = getCanvasSnapshot()
  const plan = useAgentMemoryStore.getState().currentPlan
  const planStr = plan && !plan.completedAt
    ? `\n当前计划: ${plan.goal} (${plan.steps.filter(s => s.status === 'done').length}/${plan.steps.length} 完成)`
    : ''

  const fullSummary: LLMMessage = {
    role: 'assistant',
    content: [
      `[全量上下文压缩 — ${messages.length} 条消息重置]`,
      `工具调用总计: ${Array.from(toolCounts.entries()).map(([n, c]) => c > 1 ? `${n}(x${c})` : n).join(', ')}`,
      allResults.length > 0 ? `失败记录: ${allResults.slice(-3).join('; ')}` : '',
      `画布状态: ${canvasState.slice(0, 300)}`,
      planStr,
      `[/压缩]`,
    ].filter(Boolean).join('\n'),
  }

  const result: LLMMessage[] = [fullSummary]
  if (lastUser) result.push(lastUser)
  return result
}

/**
 * Smart compression dispatcher — picks the right layer based on token usage.
 * Called before each LLM call in the agent loop.
 */
export function smartCompress(messages: LLMMessage[]): { messages: LLMMessage[]; compressed: boolean; layer: 0 | 1 | 2 | 3 } {
  const tokens = estimateTotalTokens(messages)
  const usage = tokens / CONTEXT_TOKEN_CEILING

  // Layer 3: emergency full compact
  if (usage >= FULL_COMPACT_THRESHOLD) {
    return { messages: fullCompact(messages), compressed: true, layer: 3 }
  }

  // Layer 2: auto compact
  if (usage >= AUTO_COMPACT_THRESHOLD) {
    const settings = useSettingsStore.getState()
    const maxRecent = settings.contextCompactionWindow || 10
    return { messages: autoCompact(messages, maxRecent), compressed: true, layer: 2 }
  }

  // Layer 1: micro compact (in-place, always safe)
  if (messages.length > 30) {
    microCompact(messages)
    return { messages, compressed: false, layer: 1 }
  }

  return { messages, compressed: false, layer: 0 }
}

// ============================================================
// Legacy compaction entry point (for initial history build)
// ============================================================
export function compactConversationHistory(messages: ChatMessage[]): LLMMessage[] {
  const settings = useSettingsStore.getState()
  const MAX_RECENT = settings.contextCompactionWindow || 10
  const filtered = messages.filter(m => m.content)

  if (filtered.length <= MAX_RECENT) {
    return filtered.map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: buildMultimodalContent(m.content, m.images),
    }))
  }

  // Keep last MAX_RECENT messages raw, summarize older ones
  const older = filtered.slice(0, -MAX_RECENT)
  const recent = filtered.slice(-MAX_RECENT)

  // Build compact summary of older messages
  const summaryParts: string[] = []
  for (const m of older) {
    if (m.role === 'user') {
      const imgNote = m.images?.length ? ` [附${m.images.length}张图片]` : ''
      summaryParts.push(`用户: ${m.content.slice(0, 100)}${imgNote}`)
    } else if (m.toolCalls && m.toolCalls.length > 0) {
      const tools = m.toolCalls.map(t => t.name).join(', ')
      summaryParts.push(`助手执行了: ${tools}`)
    } else {
      summaryParts.push(`助手: ${m.content.slice(0, 80)}`)
    }
  }

  const compactedMsg: LLMMessage = {
    role: 'assistant',
    content: `[对话历史摘要]\n${summaryParts.join('\n')}\n[/摘要]`,
  }

  // Save compacted context to memory store
  useAgentMemoryStore.getState().addCompactedContext(
    summaryParts.join('\n'),
    older.filter(m => m.toolCalls).flatMap(m => m.toolCalls?.map(t => t.name) || [])
  )

  return [
    compactedMsg,
    ...recent.map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: buildMultimodalContent(m.content, m.images),
    })),
  ]
}

// ============================================================
// Layered prompt architecture (Anthropic cache_control alignment)
// ============================================================
//
// The system prompt is now produced as an ordered array of PromptSegments.
// Callers may:
//   • flatten them into a single string (legacy `buildAgentSystemPrompt`)
//   • feed them to the backend as `{role:'system', content:[Block...]}` so
//     stable/semi-stable blocks can be tagged with `cache_control` by
//     Anthropic-compatible providers
//
// Stability tiers:
//   • 'stable'      — mission / loop / error-handling / output-spec; same
//                     across every turn of every session → top cache-priority.
//   • 'semi-stable' — role prompt, phase-scoped SKILLS section; same within
//                     a given phase+role → mid cache-priority.
//   • 'dynamic'     — canvas state, memory, per-turn image hint → never cache.
//
// Adding a new layer is a single push into the segments array + a test.
// DO NOT inline prompt text into chatStore.ts — all prompt copy lives here
// or in src/prompts/.

export interface PromptSegment {
  /** Unique id across a single build call. Used for test introspection and cache-key prefixes. */
  id: string
  /** Rendered text. Empty string means the segment is elided for this build. */
  text: string
  /** Stability tier — governs whether the backend may attach cache_control. */
  stability: 'stable' | 'semi-stable' | 'dynamic'
}

// ============================================================
// Build professional agentic system prompt
// ============================================================
export interface BuildAgentPromptOpts {
  /** Number of images attached to the current user message (for hint injection). */
  imageCount?: number
  /** Current user message — enables relevance-ranked memory injection. */
  userMessage?: string
}

/**
 * Return the layered prompt as an ordered array of PromptSegments.
 * Preferred entry point for new code — keeps structural information the
 * backend needs for cache-control decisions.
 */
export function buildAgentSystemPromptSegments(
  roleId: string,
  opts?: BuildAgentPromptOpts,
): PromptSegment[] {
  const rolePrompt = getSystemPromptForRole(roleId)

  // ── Dynamic context sources (read once, captured as segments below) ──
  const canvasState = getCanvasSnapshot()
  const memoryStore = useAgentMemoryStore.getState()
  const currentProjectId = useFlowStore.getState().projectId
  const memoryContext = memoryStore.getRelevantContext({
    message: opts?.userMessage,
    projectId: currentProjectId,
  })
  const agentPhase = memoryStore.currentPhase
  const phase = (agentPhase && agentPhase !== 'idle') ? agentPhase : detectCurrentPhase()
  const imageCount = opts?.imageCount ?? 0
  const skillsPrompt = buildSkillsPromptByPhase(phase, { hasImages: imageCount > 0 })

  const imageHint = imageCount > 0
    ? `### 本轮输入\n\n用户上传了 ${imageCount} 张图像。可用 \`create_from_images\` 基于它们创建新节点（角色/场景/风格参考/编辑输入），或用 \`inject_user_images\` 绑定到已有节点。先用 \`classify_image\` 逐张分类再决定路由。`
    : ''

  const segments: PromptSegment[] = []

  // ── Segment 1: core (stable) — mission, execution loop, HALT, error, output, constraints ──
  // Pipeline recipe and multimodal protocol extracted to SKILL modules
  // (videoWorkflowRecipe / multimodalInput) and loaded conditionally via
  // buildSkillsPromptByPhase(). What remains here is the phase-invariant
  // shared contract every session needs — target ≤ 800 tokens.
  segments.push({
    id: 'core',
    stability: 'stable',
    text: `## 使命

通过工具调用完整驱动 AI 视频制片流程——从世界观搭建、角色设计、分镜拆解，到关键帧生成、视频合成、音频配音。**交付可用的视频素材，而非仅提供方案建议。**

## 执行循环

每次响应遵循 **分析 → 规划 → 行动 → 验证**：

1. **分析**：读取画布状态，理解任务的依赖链和潜在风险点
2. **规划**：复杂任务先 \`plan_task\` 制定步骤；意图明确时直接跳至行动
3. **行动**：最小工具集完成当前步骤，无依赖节点优先 \`parallel_execute\` 并发执行
4. **验证**：\`get_node_output\` 确认输出存在后方可推进下一步；失败参考错误处理协议

**HALT 条件（停止执行，向用户报告）**：
- API Key 或 COS 凭证未配置
- 同一步骤连续失败 ≥3 次
- 任务需要用户决策（如创意方向、角色选型）

## 模型参数

每个视频/图片/音频模型有自己的参数 schema（来自后端 DB）。\`create_video_node\`/\`create_image_node\`/\`create_audio_node\` 的 schema 会随模型切换自动切换，字段描述中 \`[仅适用于 <ids>]\` 标注非通用字段。

需要精确参数时：
- \`list_models\` — 查看当前所有已注册模型（含 capability）
- \`get_model_params(model_id)\` — 获取某个模型的完整 ParamField schema
- 默认视频模型见 \`DEFAULT_VIDEO_MODEL\`（当前为 ${DEFAULT_VIDEO_MODEL}）
- 不支持的字段在提交时会被自动过滤（前端 sanitizer + 后端 422 双保险）

## 错误处理协议

| 错误类型 | 识别特征 | 应对策略 |
|---------|---------|---------|
| 暂时性错误 | API 负载、网络超时、未返回图片 | 先执行其他无依赖步骤，稍后重试 |
| 逻辑错误 | 参数无效、节点不存在、模型未注册 | 修改参数或更换方案 |
| 连续失败 | 同一操作失败 ≥3 次 | \`update_plan_step\` 标记 failed，跳过并告知用户 |
| API 过载 | 上游服务 429/503 | 逐个重试，不批量，调用间留间隔 |

## 输出规范

工具调用完成后，按以下格式回复（3-5 句，不做冗余解释）：

- **全部成功**：「已完成 [操作描述] → 产出 [内容列表] → 下一步：[具体建议]」
- **部分失败**：「[成功项] 完成；[失败项] 因 [原因] 失败 → 建议：[处置方案]」
- **HALT/阻塞**：「遇到阻塞：[原因] → 需要您：[操作指引]」

不在执行前输出计划列表，不做冗长分析，先执行后报告。

## 约束

1. **内容质量**：节点内容必须专业充实——角色有完整外貌 | 场景有空间层次 | 镜头有运镜方案
2. **验证驱动**：每个图片/视频节点执行后必须 \`get_node_output\` 确认输出，据此决策下一步
3. **提示词语言**：角色/场景/镜头描述使用英文；解释、对话、报告使用中文
4. **信息隔离**：禁止暴露节点 ID、内部坐标、技术实现细节
5. **无 emoji**：全程禁止使用 emoji 表情符号

${renderPromptEngineeringQuickRef()}`,
  })

  // ── Segment 2: role (semi-stable) — role-specific preamble ──
  segments.push({
    id: 'role',
    stability: 'semi-stable',
    text: rolePrompt,
  })

  // ── Segment 3: skills (semi-stable per phase+hasImages) ──
  // Pipeline recipe + multimodal protocol (if hasImages) live in here.
  if (skillsPrompt) {
    segments.push({
      id: `skills:${phase}${imageCount > 0 ? ':withImages' : ''}`,
      stability: 'semi-stable',
      text: `### 可用技能 (${phase})\n\n${skillsPrompt}`,
    })
  }

  // ── Segment 4: image hint (dynamic) — only present when images attached ──
  if (imageHint) {
    segments.push({
      id: 'image_hint',
      stability: 'dynamic',
      text: imageHint,
    })
  }

  // ── Segment 5: memory (dynamic) — relevance-ranked project memories ──
  if (memoryContext) {
    segments.push({
      id: 'memory',
      stability: 'dynamic',
      text: `### 项目记忆\n\n${memoryContext}`,
    })
  }

  // ── Segment 6: canvas state (dynamic) — always present, always last ──
  segments.push({
    id: 'canvas_state',
    stability: 'dynamic',
    text: `---\n\n## 当前上下文\n\n### 画布状态\n\n${canvasState}`,
  })

  return segments
}

/**
 * Legacy string-returning builder. Flattens the segment array with a
 * standard "\n\n" joiner. Keep in sync with {@link buildAgentSystemPromptSegments}
 * — prefer that API for any new code path that wants cache_control.
 */
export function buildAgentSystemPrompt(roleId: string, opts?: BuildAgentPromptOpts): string {
  const segments = buildAgentSystemPromptSegments(roleId, opts)
  return segments.map(s => s.text).filter(Boolean).join('\n\n')
}

// ============================================================
// Cache-controlled system content block builder
// ============================================================

export interface SystemContentBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}

/**
 * Build an Anthropic-style structured system-message `content` array from
 * layered PromptSegments. Stable + semi-stable segments get a
 * `cache_control: {type: 'ephemeral'}` marker so supporting providers can
 * cache them across turns. Dynamic segments are sent as plain text blocks.
 *
 * Anthropic allows up to 4 cache breakpoints per request; we emit at most
 * 3 (core, role, skills) — well within the limit.
 *
 * When the downstream provider does not support cache_control (OpenAI),
 * the backend is responsible for flattening this array back to a single
 * string before forwarding.
 */
export function buildSystemContentBlocks(segments: PromptSegment[]): SystemContentBlock[] {
  const blocks: SystemContentBlock[] = []
  const cacheableIds = new Set<string>()
  // Collect the ids that should carry a cache breakpoint.
  for (const s of segments) {
    if ((s.stability === 'stable' || s.stability === 'semi-stable') && s.text) {
      cacheableIds.add(s.id)
    }
  }
  // Emit one block per segment. Attach cache_control only to the last
  // cacheable segment within each contiguous run — Anthropic's docs say
  // breakpoints count cumulatively from the start, so trailing markers
  // implicitly cache everything before them.
  const lastCacheableId = [...cacheableIds].pop()
  for (const s of segments) {
    if (!s.text) continue
    const block: SystemContentBlock = { type: 'text', text: s.text }
    if (s.id === lastCacheableId) {
      block.cache_control = { type: 'ephemeral' }
    }
    blocks.push(block)
  }
  return blocks
}
