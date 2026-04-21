/**
 * Task Verification — 画布质量评分引擎
 *
 * 6 维度评分（满分 100）：
 *   1. 节点数量 (10 pts)
 *   2. 孤立节点 (15 pts)
 *   3. 提示词语言 (20 pts) — imageGen/videoGen 应为英文
 *   4. 角色外貌一致性 (20 pts)
 *   5. 字段完整性 (20 pts)
 *   6. 视频时长合理性 (15 pts)
 */

import { useFlowStore } from '@/store/flowStore'
import type { ToolCallResult } from './toolHelpers'

export function handleVerifyTask(args: Record<string, unknown>): ToolCallResult {
  const store = useFlowStore.getState()
  const nodes = store.nodes
  const edges = store.edges
  const expectedNodes = args.expectedNodes ? Number(args.expectedNodes) : null
  const checkConnections = args.checkConnections !== false
  const verbose = Boolean(args.verbose)

  const issues: string[] = []
  const passed: string[] = []
  let totalPoints = 0
  let maxPoints = 0

  // ── 1. Node count (10 pts) ──
  maxPoints += 10
  if (nodes.length === 0) {
    issues.push('画布为空，无节点')
  } else if (expectedNodes !== null && nodes.length < expectedNodes) {
    issues.push(`节点不足: ${nodes.length}/${expectedNodes}`)
    totalPoints += 5
  } else {
    passed.push(`节点数: ${nodes.length}${expectedNodes !== null ? `/${expectedNodes}` : ''}`)
    totalPoints += 10
  }

  // ── 2. Isolated nodes (15 pts) ──
  maxPoints += 15
  if (checkConnections && nodes.length > 1) {
    const connected = new Set<string>()
    for (const e of edges) { connected.add(e.source); connected.add(e.target) }
    const isolated = nodes.filter(n => !connected.has(n.id))
    if (isolated.length > 0) {
      issues.push(`孤立节点 (${isolated.length}): ${isolated.map(n => String(n.data?.label || n.id)).join(', ')}`)
    } else {
      passed.push('无孤立节点')
      totalPoints += 15
    }
  } else {
    totalPoints += 15
  }

  // ── 3. Prompt language — imageGen/videoGen prompts should be English (20 pts) ──
  maxPoints += 20
  const promptNodes = nodes.filter(n => n.type === 'imageGen' || n.type === 'videoGen')
  const cnCharRe = /[\u4e00-\u9fff]/
  let promptLangIssues = 0
  const promptDetails: string[] = []
  for (const n of promptNodes) {
    const prompt = String(n.data?.prompt || '')
    if (prompt && cnCharRe.test(prompt)) {
      promptLangIssues++
      if (verbose) promptDetails.push(`  「${String(n.data?.label || n.id)}」prompt 含中文`)
    }
  }
  if (promptNodes.length === 0) {
    totalPoints += 20
  } else if (promptLangIssues === 0) {
    passed.push(`提示词语言: 全部英文 (${promptNodes.length} 节点)`)
    totalPoints += 20
  } else {
    const ratio = 1 - promptLangIssues / promptNodes.length
    totalPoints += Math.round(20 * ratio)
    issues.push(`提示词含中文: ${promptLangIssues}/${promptNodes.length} 个节点`)
    if (verbose) issues.push(...promptDetails)
  }

  // ── 4. Character appearance consistency (20 pts) ──
  maxPoints += 20
  const charAppearances = store.getCharacterAppearances()
  const charNames = Object.keys(charAppearances)
  if (charNames.length === 0) {
    totalPoints += 20
  } else {
    let charMissing = 0
    const charDetails: string[] = []
    for (const n of promptNodes) {
      const prompt = String(n.data?.prompt || '').toLowerCase()
      if (!prompt) continue
      for (const name of charNames) {
        if (prompt.includes(name.toLowerCase())) {
          const desc = charAppearances[name].toLowerCase()
          const keyWords = desc.split(/[\s,]+/).filter(w => w.length > 3).slice(0, 3)
          const missing = keyWords.filter(kw => !prompt.includes(kw))
          if (missing.length > 0) {
            charMissing++
            if (verbose) charDetails.push(`  「${String(n.data?.label)}」含角色「${name}」但缺外貌词: ${missing.join(', ')}`)
          }
        }
      }
    }
    if (charMissing === 0) {
      passed.push(`角色外貌一致性: ${charNames.length} 角色, 提示词均含外貌关键词`)
      totalPoints += 20
    } else {
      totalPoints += Math.max(0, 20 - charMissing * 4)
      issues.push(`角色外貌缺失: ${charMissing} 处提示词缺少角色外貌关键词`)
      if (verbose) issues.push(...charDetails)
    }
  }

  // ── 5. Field completeness — key fields not empty (20 pts) ──
  maxPoints += 20
  let emptyFields = 0
  const fieldDetails: string[] = []
  const fieldChecks: Record<string, string[]> = {
    imageGen: ['prompt'], videoGen: ['prompt'],
    characterGrid: ['name', 'description'], sceneGrid: ['name', 'description'],
    storyboard: ['script'], textNode: ['content'], llmChat: ['userInput'],
  }
  for (const n of nodes) {
    const checks = fieldChecks[String(n.type)] || []
    for (const f of checks) {
      const val = String(n.data?.[f] || '').trim()
      if (!val) {
        emptyFields++
        if (verbose) fieldDetails.push(`  「${String(n.data?.label || n.id)}」.${f} 为空`)
      }
    }
  }
  if (emptyFields === 0) {
    passed.push('字段完整性: 所有关键字段已填充')
    totalPoints += 20
  } else {
    totalPoints += Math.max(0, 20 - emptyFields * 3)
    issues.push(`空字段: ${emptyFields} 个关键字段未填充`)
    if (verbose) issues.push(...fieldDetails)
  }

  // ── 6. Video duration reasonableness (15 pts) ──
  maxPoints += 15
  const videoNodes = nodes.filter(n => n.type === 'videoGen')
  let durationIssues = 0
  for (const n of videoNodes) {
    const dur = Number(n.data?.duration || 0)
    if (dur > 0 && (dur < 2 || dur > 20)) {
      durationIssues++
      if (verbose) issues.push(`  「${String(n.data?.label)}」时长 ${dur}s 超出合理范围(2-20s)`)
    }
  }
  if (videoNodes.length === 0 || durationIssues === 0) {
    if (videoNodes.length > 0) passed.push(`视频时长: ${videoNodes.length} 节点均在合理范围`)
    totalPoints += 15
  } else {
    totalPoints += Math.max(0, 15 - durationIssues * 5)
    issues.push(`视频时长异常: ${durationIssues}/${videoNodes.length} 个`)
  }

  // ── Score & summary ──
  const score = maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 100) : 100
  const statuses = new Map<string, number>()
  for (const n of nodes) {
    const s = String(n.data?.status || 'idle')
    statuses.set(s, (statuses.get(s) || 0) + 1)
  }

  const lines: string[] = [
    `画布质量评分: ${score}/100`,
    `节点 ${nodes.length} | 连线 ${edges.length} | 状态: ${[...statuses.entries()].map(([k, v]) => `${k}=${v}`).join(', ')}`,
  ]
  if (passed.length > 0) lines.push(`通过 (${passed.length}): ${passed.join(' | ')}`)
  if (issues.length > 0) lines.push(`问题 (${issues.length}):\n${issues.map(i => `  - ${i}`).join('\n')}`)
  if (issues.length === 0) lines.push('所有检查项通过。')

  return { success: true, message: lines.join('\n') }
}
