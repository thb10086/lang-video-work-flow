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
import {
  getActiveVerifier,
  DEFAULT_VISION_THRESHOLD,
  VISION_SCORE_REWARD_CEILING,
  VISION_PASS_AVG,
  type VerifyResult,
} from './visionVerifyAdapter'
// Ensure the default vision adapter is registered even if this module is the
// first to touch the registry. Idempotent — registerVerifier is keyed by id.
import './geminiVisionAdapter'

// 外貌描述里的"低信息量"通用词 — 挑 keywords 时需跳过，避免把 "young/with/and"
// 这种无区分度词当作角色指纹。优先保留颜色/部位/服装等具视觉锚定力的词。
const APPEARANCE_STOPWORDS = new Set([
  'young', 'old', 'tall', 'short', 'thin', 'slim', 'tiny', 'huge', 'large', 'small',
  'with', 'and', 'the', 'her', 'his', 'they', 'them', 'him', 'she', 'has', 'have',
  'having', 'wearing', 'dressed', 'feature', 'features', 'distinctive', 'recognizable',
  'consistent', 'clothing', 'appearance', 'character', 'posture', 'look', 'looking',
  'style', 'style.', 'person', 'people', 'human',
])

/** 从外貌描述中抽取最具视觉锚定力的 keywords — 保留颜色/服装/发型等关键词 */
function pickAnchorKeywords(appearance: string, limit = 4): string[] {
  const words = appearance
    .toLowerCase()
    .replace(/[,.;()[\]{}"']/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !APPEARANCE_STOPWORDS.has(w))
  // 去重保持顺序
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of words) {
    if (!seen.has(w)) { seen.add(w); out.push(w) }
    if (out.length >= limit) break
  }
  return out
}

/** Sliding-window average of Vision scores. Returns a per-node contribution
 *  point value within the 20-point dimension 4 budget. */
function computeVisionDimensionPoints(results: VerifyResult[]): number {
  if (results.length === 0) return 20 // No images to verify — full credit
  const avg = results.reduce((s, r) => s + r.matchScore, 0) / results.length
  // matchScore 0-100 → 0-20 pts, rewarded at VISION_SCORE_REWARD_CEILING so
  // minor imperfections don't collapse the grade. See constant docs.
  return Math.max(0, Math.min(20, Math.round((avg / VISION_SCORE_REWARD_CEILING) * 20)))
}

export async function handleVerifyTask(args: Record<string, unknown>): Promise<ToolCallResult> {
  const store = useFlowStore.getState()
  const nodes = store.nodes
  const edges = store.edges
  const expectedNodes = args.expectedNodes ? Number(args.expectedNodes) : null
  const checkConnections = args.checkConnections !== false
  const verbose = Boolean(args.verbose)
  const useVisionVerify = Boolean(args.useVisionVerify)

  const issues: string[] = []
  const passed: string[] = []
  let totalPoints = 0
  let maxPoints = 0
  // Tracks whether dimension 4 used heuristic (true) vs vision (false).
  // When vision was requested but any call failed, we flip this back to true
  // and append a [vision fallback] marker to the message.
  let visionFallback = false
  let visionSummary: string | null = null

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
  // Default path: heuristic keyword anchoring on prompt text.
  // Opt-in path (useVisionVerify=true): hit every imageGen with outputImage
  // through the active VisionVerifier and score by matchScore average.
  // Any vision failure falls back to heuristic + sets visionFallback=true.
  maxPoints += 20

  // Collect the vision targets up front so we can decide path before scoring.
  const visionTargets = useVisionVerify
    ? nodes.filter(n => n.type === 'imageGen' && typeof n.data?.outputImage === 'string' && (n.data.outputImage as string).length > 0)
    : []

  const runHeuristic = (): void => {
    const charAppearances = store.getCharacterAppearances()
    const charNames = Object.keys(charAppearances)
    if (charNames.length === 0) {
      totalPoints += 20
      return
    }
    let charMissing = 0
    const charDetails: string[] = []
    // 预计算每个角色的 anchor keywords，避免重复拆词
    const charAnchors: Record<string, string[]> = {}
    for (const name of charNames) {
      charAnchors[name] = pickAnchorKeywords(charAppearances[name])
    }
    for (const n of promptNodes) {
      const prompt = String(n.data?.prompt || '').toLowerCase()
      if (!prompt) continue
      // Agent 也可能用 @assetId 引用 —— resolver 会在执行时展开外貌文本。
      // 检查 prompt 里是否有任意 @token，如有则视为"延迟展开"，跳过关键词检查。
      const hasAtRef = /@[a-zA-Z]+_[A-Za-z0-9]+/.test(prompt)
      if (hasAtRef) continue
      for (const name of charNames) {
        if (!prompt.includes(name.toLowerCase())) continue
        const anchors = charAnchors[name]
        if (anchors.length === 0) continue
        // 只要命中 ≥1 个视觉锚定词就算通过 — 容忍同义词/表达差异，
        // 避免过度机械匹配"young/with"等通用词。
        const hit = anchors.some(kw => prompt.includes(kw))
        if (!hit) {
          charMissing++
          if (verbose) charDetails.push(`  「${String(n.data?.label)}」含角色「${name}」但未出现任一外貌锚点词: ${anchors.join(' / ')}`)
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

  if (useVisionVerify && visionTargets.length === 0) {
    // Flag requested but no imageGen outputs yet — skip vision, no penalty.
    totalPoints += 20
    visionSummary = '无 outputImage 可校验，跳过 Vision QC'
  } else if (useVisionVerify) {
    const verifier = (() => {
      try { return getActiveVerifier() } catch { return null }
    })()
    if (!verifier) {
      visionFallback = true
      runHeuristic()
    } else {
      const appearances = store.getCharacterAppearances()
      const charNames = Object.keys(appearances)
      // Fire all vision calls in parallel. Each verify() is already wrapped
      // in try/catch by the adapter, so promises always resolve — but we
      // still use Promise.allSettled() as a safety net in case a future
      // adapter forgets to wrap its errors. Preserving input order matters
      // for the verbose branch below that maps result[i] → visionTargets[i].
      const settled = await Promise.allSettled(
        visionTargets.map(n => {
          const imageUrl = String(n.data?.outputImage || '')
          const prompt = String(n.data?.prompt || '').toLowerCase()
          const expectedSubjects = charNames.filter(name => prompt.includes(name.toLowerCase()))
          return verifier.verify(imageUrl, {
            subjects: expectedSubjects.length > 0 ? expectedSubjects : undefined,
            threshold: DEFAULT_VISION_THRESHOLD,
          })
        }),
      )
      // We track per-target results + failures in parallel arrays keyed by
      // `visionTargets` index so we can emit label-accurate verbose output
      // without relying on the fragile `results[idx] → visionTargets[idx]`
      // alignment the serial version had.
      const results: VerifyResult[] = []
      const okIndices: number[] = []
      const failedNodes: string[] = []
      for (let i = 0; i < settled.length; i++) {
        const s = settled[i]
        const n = visionTargets[i]
        const label = String(n.data?.label || n.id)
        if (s.status !== 'fulfilled') {
          failedNodes.push(label)
          continue
        }
        const r = s.value
        // Degraded reply (score=0 + "Vision 验证调用失败") counts as a failure
        if (r.matchScore === 0 && r.reasoning.startsWith('Vision')) {
          failedNodes.push(label)
        } else {
          results.push(r)
          okIndices.push(i)
        }
      }
      if (failedNodes.length > 0 || results.length === 0) {
        // Any failure → fallback. Keep partial results in summary.
        visionFallback = true
        runHeuristic()
      } else {
        const pts = computeVisionDimensionPoints(results)
        totalPoints += pts
        const avg = Math.round(results.reduce((s, r) => s + r.matchScore, 0) / results.length)
        visionSummary = `Vision QC: ${results.length} 张图平均 matchScore=${avg}/100 → ${pts}/20 pts`
        if (avg >= VISION_PASS_AVG) passed.push(visionSummary)
        else issues.push(visionSummary)
        if (verbose) {
          for (let j = 0; j < results.length; j++) {
            const r = results[j]
            const originalIdx = okIndices[j]
            const label = visionTargets[originalIdx]?.data?.label ?? `#${originalIdx}`
            issues.push(`  「${String(label)}」matchScore=${r.matchScore} → ${r.recommendation}${r.missingElements.length > 0 ? ` (missing: ${r.missingElements.slice(0, 3).join(', ')})` : ''}`)
          }
        }
      }
    }
  } else {
    runHeuristic()
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
    `画布质量评分: ${score}/100${visionFallback ? ' [vision fallback]' : ''}`,
    `节点 ${nodes.length} | 连线 ${edges.length} | 状态: ${[...statuses.entries()].map(([k, v]) => `${k}=${v}`).join(', ')}`,
  ]
  if (visionFallback) {
    lines.push('Vision 校验失败，第 4 维已回退到启发式打分')
  } else if (visionSummary && useVisionVerify) {
    lines.push(visionSummary)
  }
  if (passed.length > 0) lines.push(`通过 (${passed.length}): ${passed.join(' | ')}`)
  if (issues.length > 0) lines.push(`问题 (${issues.length}):\n${issues.map(i => `  - ${i}`).join('\n')}`)
  if (issues.length === 0) lines.push('所有检查项通过。')

  return { success: true, message: lines.join('\n') }
}
