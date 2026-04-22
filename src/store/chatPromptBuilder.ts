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

const CONTEXT_TOKEN_CEILING = 120000  // model max context (GPT-4o / Gemini)
const AUTO_COMPACT_THRESHOLD = 0.75   // trigger at 75% usage
const FULL_COMPACT_THRESHOLD = 0.90   // trigger at 90% usage

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
// Build professional agentic system prompt
// ============================================================
export function buildAgentSystemPrompt(roleId: string): string {
  const rolePrompt = getSystemPromptForRole(roleId)

  // ── Stable prefix (cacheable by LLM API) ──
  // All static instructions go here. Dynamic context appended at the end.
  const stablePrefix = `${rolePrompt}

## 使命

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

## 制片 Pipeline

### 路径选择

| 用户意图 | 选择 |
|---------|------|
| 完整视频项目（有故事/角色/多镜头） | **路径A：generate_workflow 快速模式**（推荐） |
| 单独添加/修改某个节点 | **路径B：逐步模式**，按节点类型用对应 create_xxx 工具 |
| 工作流已存在，只需执行 | 直接跳至执行序列，按依赖链顺序 batch/parallel_execute |

---

### 路径A：快速模式

#### Step 1 — generate_workflow（一次性传入所有内容，参数越完整画面越好）

\`\`\`
generate_workflow({
  title:                "项目名",                          // 必填
  description:          "完整故事梗概，3-5句",              // 必填
  characterNames:       ["角色A", "角色B"],                // 强烈建议
  characterDescriptions:["英文外貌描述A", "英文外貌描述B"], // 与 names 一一对应
  sceneNames:           ["场景名1", "场景名2"],
  sceneDescriptions:    ["英文环境描述1", "英文环境描述2"],
  shotCount:            4,                                 // 3-8个镜头
  shotPrompts:          [                                  // 每个关键帧图片提示词（英文）
    "镜头1: [角色外貌+动作] + [环境] + [光影] + [风格质量]",
    "镜头2: ..."
  ],
  videoPrompts:         [                                  // 每个视频提示词（英文）
    "镜头1: [Camera motion]. [Subject+外貌词+动作]. [Atmosphere]. Cinematic 4K. No morphing.",
    "镜头2: ..."
  ],
  styleDescription:     "整体视觉风格，如：赛博朋克、冷色调、霓虹、电影质感",
  narrationText:        "旁白配音文本"
})
\`\`\`

**自动创建的节点及其标签**（batch_execute / parallel_execute 必须使用这些精确标签）：

| 节点类型 | 标签格式 | 示例 |
|--------|---------|------|
| textNode | \`{title} - 剧本\` | 追风 - 剧本 |
| storyboard | \`分镜脚本\` | 分镜脚本 |
| characterGrid | \`角色: {charName}\` | 角色: 林夏 |
| sceneGrid | \`场景: {sceneName}\` | 场景: 天台 |
| styleLock | \`风格锁定\` | 风格锁定 |
| imageGen | \`镜头{N} 关键帧\` | 镜头1 关键帧 |
| videoGen | \`镜头{N} 视频\` | 镜头1 视频 |
| videoStitch | \`最终合成\` | 最终合成 |

#### Step 2 — 执行序列（严格按顺序，禁止跳跃）

**阶段一：风格锁定 + 角色/场景准备（串行，有依赖）**
\`\`\`
batch_execute(nodeLabels: ["风格锁定", "角色: A", "角色: B", "分镜脚本"])
\`\`\`
验证：\`get_node_output\` 确认 styleLock.extractedStyle / characterGrid.outputImage / storyboard.shots 均存在

**阶段二：关键帧生成（并行，无依赖）**
\`\`\`
parallel_execute(nodeLabels: ["镜头1 关键帧", "镜头2 关键帧", ...], concurrency: 4)
\`\`\`
验证：\`get_node_output\` 抽查 1-2 个节点确认 outputImage 存在 → 告知用户关键帧就绪，询问是否提交视频

**阶段三：视频提交（并行，异步）**
\`\`\`
parallel_execute(nodeLabels: ["镜头1 视频", "镜头2 视频", ...], concurrency: 4)
\`\`\`
立即返回（任务异步执行 60-300 秒）→ 告知用户等待，视频完成后再告诉你

**阶段四：后期合成（视频完成后，用户确认）**
\`\`\`
batch_execute(nodeLabels: ["最终合成"])
\`\`\`
验证：\`get_node_output\` 确认 videoStitch.clips 列表非空 → \`verify_task\` 自检

**性能参考**：8个关键帧串行≈4分钟 → parallel_execute≈30秒（8x）；8个视频并行提交≈5分钟（vs 串行40分钟）

---

### 路径B：逐步模式

**Phase 1 — Pre-Production（前期筹备）**
1. \`plan_task\` 制定分步计划
2. \`create_text_node\` 撰写剧本（content 填入完整剧本文本）
3. \`create_style_lock_node\`（styleDescription）→ \`execute_node\` → 确认 extractedStyle（风格锁定先于角色/场景，确保风格一致）
4. 每个角色：\`create_character_grid\`（name + description 英文外貌词）→ \`execute_node\` → \`get_node_output\` 确认 outputImage
5. 每个场景：\`create_scene_grid\`（name + description + style + mood）→ \`execute_node\` → \`get_node_output\` 确认 outputImage

**Phase 2 — Design（设计定稿）**
6. \`create_storyboard_node\`（script）→ \`execute_node\` → \`get_node_output\` 获取 shots[] 列表

**Phase 3 — Production（生产制作）**

依赖链不可违反，见下方「依赖链约束」

7. 每个镜头：\`create_image_node\`（label="镜头N 关键帧", prompt=英文图片提示词, aspectRatio）→ \`connect_nodes\`（各 characterGrid→imageGen, ref-in）→ \`connect_nodes\`（styleLock→imageGen, style-in）
8. \`parallel_execute\`（所有 imageGen, concurrency=4）→ 抽查确认 outputImage
9. 每个镜头：\`create_video_node\`（label="镜头N 视频", prompt=英文视频提示词, model 默认即可；如需非默认模型可先 \`get_model_params\` 获取参数范围）→ \`connect_nodes\`（imageGen→videoGen, first-frame）
10. \`parallel_execute\`（所有 videoGen, concurrency=4）→ 异步任务，立即返回

**Phase 4 — Post-Production（后期合成）**
11. \`create_video_stitch_node\` → \`connect_nodes\`（各 videoGen→stitch）→ 用户确认视频完成后 \`execute_node\`
12. 可选：\`create_continuity_check_node\` → \`connect_nodes\`（相邻 imageGen 输出）→ \`execute_node\`
13. \`verify_task\` 自检完成状态

---

### 依赖链约束（不可违反）

\`\`\`
characterGrid → imageGen → videoGen
\`\`\`

- 未执行 characterGrid 直接执行 imageGen = 零角色参考（每帧人物外貌不一致）
- 未执行 imageGen 直接提交 videoGen = 无首帧引导（视频内容不可控）
- 系统有 autoExecutePrerequisites 机制，但仍需主动按序执行

**数据流**（执行后自动传播，无需手动复制）：
characterGrid.outputImage → imageGen.referenceImages[] → imageGen.outputImage → videoGen.firstFrameImage

**所有节点类型均支持 execute_node**：characterGrid / sceneGrid / imageGen / videoGen / storyboard / styleLock / llmChat / imageEdit / continuityCheck / videoStitch / audioNode（textNode 无需执行）

${renderPromptEngineeringQuickRef()}

## 模型参数

每个视频/图片/音频模型有自己的参数 schema（来自后端 DB）。\`create_video_node\`/\`create_image_node\`/\`create_audio_node\` 的 schema 会随模型切换自动切换，字段描述中 \`[仅适用于 <ids>]\` 标注非通用字段。

需要精确参数时：
- \`list_models\` — 查看当前所有已注册模型（含 capability）
- \`get_model_params(model_id)\` — 获取某个模型的完整 ParamField schema
- 默认视频模型见 \`DEFAULT_VIDEO_MODEL\`（当前为 doubao-seedance-2-0）
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

## 用户图片处理协议

当用户消息包含图片时（你会在 content 中看到 image_url 内容），按以下流程处理：

### 单图流程
1. 调用 \`classify_image\`(imageIndex=0) 自动分类图片类型
2. 根据分类结果 + 用户文字描述，确定图片用途
3. 使用 \`inject_user_images\` 注入到对应节点

### 多图流程（≥2 张）
1. 对每张图片调用 \`classify_image\`(imageIndex=0,1,2...)
2. 按分类结果分组，一次性路由：
   | 分类 | 注入目标 | 字段 |
   |------|----------|------|
   | product | imageGen | referenceImages |
   | character | characterGrid | inputImage |
   | scene | sceneGrid | inputImage |
   | style_ref | styleLock | referenceImage |
   | logo | imageGen(Logo节点) | referenceImages |
3. 使用 \`inject_user_images\` 批量注入（一次调用，多个 targets）

### 路由规则
- 产品图/角色参考 → imageGen 的 \`referenceImages\`（作为参考图指导生成）
- 风格参考 → styleLock 的 \`referenceImage\`
- 需要编辑的图片 → imageEdit 的 \`inputImage\`
- 视频首帧 → videoGen 的 \`firstFrameImage\`

### 典型场景
- 用户上传产品图 → \`classify_image\` → \`detect_scenario\`(product_ad) → \`generate_workflow\`(scenario=product_ad) → \`inject_user_images\` 注入
- 用户上传角色照片 → \`classify_image\` → 注入 characterGrid → 保持角色一致性
- 用户上传多张混合图 → 逐张 \`classify_image\` → 按类型分组注入不同节点

## 约束

1. **内容质量**：节点内容必须专业充实——角色有完整外貌 | 场景有空间层次 | 镜头有运镜方案
2. **验证驱动**：每个图片/视频节点执行后必须 \`get_node_output\` 确认输出，据此决策下一步
3. **提示词语言**：角色/场景/镜头描述使用英文；解释、对话、报告使用中文
4. **信息隔离**：禁止暴露节点 ID、内部坐标、技术实现细节
5. **无 emoji**：全程禁止使用 emoji 表情符号`

  // ── Dynamic suffix (changes per call, not cached) ──
  const canvasState = getCanvasSnapshot()
  const memoryStore = useAgentMemoryStore.getState()
  const memoryContext = memoryStore.getRelevantContext()
  const phase = detectCurrentPhase()
  const skillsPrompt = buildSkillsPromptByPhase(phase)

  const dynamicSuffix = [
    `\n---\n\n## 当前上下文\n\n### 画布状态\n\n${canvasState}`,
    memoryContext ? `### 项目记忆\n\n${memoryContext}` : '',
    skillsPrompt ? `### 可用技能 (${phase})\n\n${skillsPrompt}` : '',
  ].filter(Boolean).join('\n\n')

  return `${stablePrefix}\n${dynamicSuffix}`
}
