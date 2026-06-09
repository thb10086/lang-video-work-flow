/**
 * reviewAdapter.ts — 图片/视频质量审查适配器
 *
 * 当前实现: **纯启发式 stub**（不调用任何 Vision API），仅根据
 * 节点元数据（status / outputImage / prompt 长度等）给出基础评分。
 *
 * 后续可替换为真正的 GPT-4V / Gemini 多模态审查，调用方签名不变。
 */

export interface ReviewResult {
  score: number          // 0..100
  pass: boolean          // score >= threshold
  issues: string[]       // 人类可读的问题列表
  suggestions: string[]  // 改进建议
}

export interface ReviewOptions {
  /** 审查通过阈值 (0-100)，默认 60。 */
  threshold?: number
  /** 审查维度：composition / consistency / prompt_adherence / all。 */
  aspects?: string[]
}

/**
 * Stub reviewer — no Vision API call.
 *
 * Heuristics:
 * - Node has outputImage → +40
 * - Node status is 'success' or 'done' → +20
 * - Prompt length > 30 chars → +15 (richer prompt → likely better result)
 * - Has referenceImage (character consistency) → +10
 * - Has extractedStyle (style lock applied) → +15
 */
export function reviewImageHeuristic(
  nodeData: Record<string, unknown>,
  _opts: ReviewOptions = {},
): ReviewResult {
  const threshold = _opts.threshold ?? 60
  let score = 0
  const issues: string[] = []
  const suggestions: string[] = []

  // Output existence
  const hasOutput = !!(nodeData.outputImage || nodeData.outputVideo)
  if (hasOutput) {
    score += 40
  } else {
    issues.push('节点尚无输出（outputImage / outputVideo 为空）')
    suggestions.push('先 execute_node 生成输出再审查')
  }

  // Status
  const status = String(nodeData.status || '')
  if (status === 'success' || status === 'done') {
    score += 20
  } else if (status === 'error') {
    issues.push(`节点状态异常: ${status}`)
    suggestions.push('retry_node 重试或检查 errorMsg 字段')
  }

  // Prompt richness
  const prompt = String(nodeData.prompt || '')
  if (prompt.length > 30) {
    score += 15
  } else if (prompt.length > 0) {
    score += 5
    suggestions.push('提示词较短，建议用 optimize_prompt 丰富细节')
  } else {
    issues.push('无提示词')
    suggestions.push('补充提示词后重新生成')
  }

  // Reference image (character consistency signal)
  if (nodeData.referenceImage || (Array.isArray(nodeData.referenceImages) && (nodeData.referenceImages as unknown[]).length > 0)) {
    score += 10
  }

  // Style lock applied
  if (nodeData.extractedStyle || nodeData.styleDescription) {
    score += 15
  }

  score = Math.min(100, score)

  return {
    score,
    pass: score >= threshold,
    issues,
    suggestions,
  }
}

/**
 * Pluggable adapter — swap in a real Vision model later.
 */
export const _reviewAdapter = {
  review: reviewImageHeuristic,
}
