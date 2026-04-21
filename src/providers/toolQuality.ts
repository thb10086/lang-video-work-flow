/**
 * Tool Quality — 质量门控 & 提示词优化工具
 *
 * 从 toolHandlers.ts 拆分，包含：
 * - handleReviewContent: 审查画布节点内容质量
 * - handleOptimizePrompt: 使用 LLM 自动优化提示词
 *
 * 所有审查规则和优化公式引用 promptCraft.ts（单一知识源）
 */

import { useFlowStore } from '@/store/flowStore'
import { resolveNode, resolveNodeNotFound } from './toolHelpers'
import type { ToolCallResult } from './toolHelpers'
import {
  REVIEW_RULES,
  buildImageOptimizationSystemPrompt,
  buildVideoOptimizationSystemPrompt,
} from '@/prompts/promptCraft'

// ── Content Review ──

/** Review a single node's content quality */
function reviewSingleNode(node: { id: string; type: string; data: Record<string, unknown> }): string[] {
  const issues: string[] = []
  const d = node.data
  const type = node.type
  const label = String(d.label || node.id)

  // Completeness checks
  if (['imageGen', 'videoGen'].includes(type) && !String(d.prompt || '').trim()) {
    issues.push(`[空字段] 「${label}」缺少 prompt`)
  }
  if (type === 'characterGrid' && !String(d.description || '').trim()) {
    issues.push(`[空字段] 「${label}」缺少角色描述 description`)
  }
  if (type === 'sceneGrid' && !String(d.description || '').trim()) {
    issues.push(`[空字段] 「${label}」缺少场景描述 description`)
  }
  if (type === 'storyboard' && !String(d.script || '').trim()) {
    issues.push(`[空字段] 「${label}」缺少剧本 script`)
  }
  if (type === 'audioNode' && !String(d.text || '').trim()) {
    issues.push(`[空字段] 「${label}」缺少文本 text`)
  }

  // Prompt quality checks (for imageGen and videoGen)
  const prompt = String(d.prompt || '')
  if (prompt && ['imageGen', 'videoGen'].includes(type)) {
    if (prompt.length < REVIEW_RULES.minPromptLength) {
      issues.push(`[提示词过短] 「${label}」prompt 仅 ${prompt.length} 字符，建议至少 ${REVIEW_RULES.recommendedMinLength} 字符`)
    }
    const chineseChars = (prompt.match(/[\u4e00-\u9fff]/g) || []).length
    if (chineseChars > prompt.length * REVIEW_RULES.maxChineseRatio) {
      issues.push(`[语言] 「${label}」prompt 含大量中文(${chineseChars}字)，图片/视频提示词应使用英文`)
    }
    if (type === 'videoGen') {
      if (!REVIEW_RULES.cameraKeywords.test(prompt)) {
        issues.push(`[运镜缺失] 「${label}」视频 prompt 未包含运镜描述，建议添加 [Camera] 段`)
      }
      if (!REVIEW_RULES.negativeKeywords.test(prompt)) {
        issues.push(`[负面词缺失] 「${label}」视频 prompt 未包含 Negative 约束`)
      }
    }
    if (type === 'imageGen') {
      if (!REVIEW_RULES.lightingKeywords.test(prompt)) {
        issues.push(`[光照缺失] 「${label}」图片 prompt 未描述光照条件`)
      }
    }
  }

  // Technical param checks
  if (type === 'videoGen') {
    const { min, max } = REVIEW_RULES.videoDuration
    const duration = Number(d.duration || 0)
    if (duration > 0 && (duration < min || duration > max)) {
      issues.push(`[参数] 「${label}」时长 ${duration}s 超出推荐范围(${min}-${max}s)`)
    }
  }

  return issues
}

export function handleReviewContent(args: Record<string, unknown>): ToolCallResult {
  const store = useFlowStore.getState()
  const reviewAll = Boolean(args.reviewAll)

  let targetNodes: Array<{ id: string; type: string; data: Record<string, unknown> }>

  if (reviewAll) {
    targetNodes = store.nodes.map(n => ({
      id: n.id,
      type: String(n.type || 'unknown'),
      data: (n.data || {}) as Record<string, unknown>,
    }))
  } else {
    const found = resolveNode(args)
    if (!found) return resolveNodeNotFound(args)
    const node = store.nodes.find(n => n.id === found.id)
    if (!node) return { success: false, message: '节点已不存在' }
    targetNodes = [{
      id: node.id,
      type: String(node.type || 'unknown'),
      data: (node.data || {}) as Record<string, unknown>,
    }]
  }

  if (targetNodes.length === 0) {
    return { success: true, message: '画布为空，没有节点可审查。' }
  }

  const allIssues: string[] = []
  for (const node of targetNodes) {
    allIssues.push(...reviewSingleNode(node))
  }

  // Character consistency check: find all characterGrid descriptions and check imageGen prompts
  const aspects = (args.aspects as string[]) || ['prompt_quality', 'character_consistency', 'style_consistency', 'completeness', 'technical_params']

  if (aspects.includes('character_consistency')) {
    const charNodes = store.nodes.filter(n => n.type === 'characterGrid')
    const imageNodes = store.nodes.filter(n => n.type === 'imageGen')
    for (const charNode of charNodes) {
      const charName = String(charNode.data?.name || '')
      if (!charName) continue
      for (const imgNode of imageNodes) {
        const prompt = String(imgNode.data?.prompt || '')
        const label = String(imgNode.data?.label || imgNode.id)
        const connected = store.edges.some(e => e.source === charNode.id && e.target === imgNode.id)
        if (connected && prompt && !prompt.toLowerCase().includes(charName.toLowerCase())) {
          allIssues.push(`[角色一致性] 「${label}」prompt 未提及角色「${charName}」的名称/外貌关键词`)
        }
      }
    }
  }

  if (aspects.includes('style_consistency')) {
    const styleLocks = store.nodes.filter(n => n.type === 'styleLock')
    if (styleLocks.length === 0 && store.nodes.filter(n => n.type === 'imageGen').length > 1) {
      allIssues.push(`[风格统一] 画布有多个图片节点但未设置风格锁定节点，建议添加 styleLock`)
    }
  }

  // Score calculation
  const totalNodes = targetNodes.length
  const issueCount = allIssues.length
  const score = Math.max(0, Math.round(100 - (issueCount / Math.max(totalNodes, 1)) * 15))

  const lines: string[] = [
    `质量审查报告 (${totalNodes} 个节点, 评分: ${score}/100)`,
  ]

  if (issueCount === 0) {
    lines.push('✓ 未发现问题，所有节点内容质量良好。')
  } else {
    lines.push(`发现 ${issueCount} 个问题:`)
    allIssues.forEach(issue => lines.push(`  ${issue}`))
    lines.push('')
    lines.push('建议: 使用 update_node 修正上述问题，或调用 optimize_prompt 自动优化提示词。')
  }

  return { success: true, message: lines.join('\n') }
}

// ── Prompt Optimization ──

export async function handleOptimizePrompt(args: Record<string, unknown>): Promise<ToolCallResult> {
  const store = useFlowStore.getState()
  const found = resolveNode(args)
  if (!found) return resolveNodeNotFound(args)

  const node = store.nodes.find(n => n.id === found.id)
  if (!node) return { success: false, message: '节点已不存在' }

  const nodeType = String(node.type || '')
  const currentPrompt = String(node.data?.prompt || node.data?.description || '')
  if (!currentPrompt.trim()) {
    return { success: false, message: `节点「${found.label}」没有可优化的提示词（prompt/description 为空）` }
  }

  const style = String(args.style || 'cinematic')
  const characterAnchors = (args.characterAnchors as string[]) || []
  const keepIntent = args.keepOriginalIntent !== false

  // Build optimization system prompt based on node type
  let systemPrompt: string
  let userPrompt: string

  const buildOpts = { style, keepOriginalIntent: keepIntent }
  const anchorsStr = characterAnchors.length > 0
    ? `\n\nCharacter anchors to include:\n${characterAnchors.map(a => `- ${a}`).join('\n')}`
    : ''

  if (nodeType === 'videoGen') {
    systemPrompt = buildVideoOptimizationSystemPrompt(buildOpts)
    userPrompt = `Optimize this video prompt:\n"${currentPrompt}"${anchorsStr}`
  } else {
    systemPrompt = buildImageOptimizationSystemPrompt(buildOpts)
    userPrompt = `Optimize this image prompt:\n"${currentPrompt}"${anchorsStr}`
  }

  try {
    const { useSettingsStore } = await import('@/store/settingsStore')
    const { backendApi } = await import('@/api/backend')
    const settings = useSettingsStore.getState()
    const modelId = settings.defaultLLMModel

    const { TASK_TOKEN_BUDGETS } = await import('@/providers/modelDefaults')
    const result = await backendApi.chat({
      model_id: modelId,
      prompt: userPrompt,
      system_prompt: systemPrompt,
      temperature: 0.4,
      max_tokens: TASK_TOKEN_BUDGETS.PROMPT_OPTIMIZE,
    })

    const optimized = (result.text || '').trim()
    if (!optimized) {
      return { success: false, message: 'LLM 未返回优化后的提示词' }
    }

    // Write back to node
    const field = node.data?.prompt !== undefined ? 'prompt' : 'description'
    store.updateNodeData(found.id, { [field]: optimized })

    return {
      success: true,
      message: `已优化节点「${found.label}」的 ${field}:\n\n原始 (${currentPrompt.length}字): ${currentPrompt.slice(0, 100)}...\n\n优化后 (${optimized.length}字): ${optimized.slice(0, 200)}...`,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '优化失败'
    return { success: false, message: `提示词优化失败：${msg}` }
  }
}
