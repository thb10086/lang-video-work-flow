/**
 * Agent Generation Evaluation — 以 TDD 方式评估 Agent (generate_workflow) 的
 * 生成效果。
 *
 * 与 workflowQuality.test.ts 的区别：
 *  - workflowQuality 只测 short_drama 一个场景，断言单点事实。
 *  - 这个套件跑完整 6 个场景，用 10 维 rubric 打分，输出可读的成绩单；
 *    并以"总分 ≥ 80 = B"作为硬门槛 TDD。
 *
 * Rubric (每维 0-10，不适用则 N/A 不计入分母)：
 *   D1. 画布自洽：生成的节点数与 builder 预期一致
 *   D2. 端口契约：所有边 (sourceHandle, targetHandle) 都在 NODE_PORT_REGISTRY
 *   D3. 孤立检测：除 characterManager / stitch 等终端节点外，没有孤立节点
 *   D4. 风格一致性：有 styleLock 且每个 imageGen 都接它的 style-out
 *   D5. 关键帧→视频：每个 videoGen 都有 imageGen → first-frame 入边
 *   D6. 角色一致性：有角色时，characterManager 存在且每个 grid → character-in
 *   D7. 资产库整合：assetStore 有对应角色/场景条目（有 characters/scenes 时）
 *   D8. verify_task 自检：内建的 verify_task 工具返回 ≥ 80
 *   D9. 提示词语言：shot/video prompts 无中文
 *   D10. 成片路径：videoStitch 存在且有入边
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { executeToolCall } from '@/providers/agentTools'
import { useFlowStore } from '@/store/flowStore'
import { useAssetStore } from '@/store/assetStore'
import { NODE_PORT_REGISTRY } from '@/types/portRegistry'
import { isLegacyCharacterNode, nodesOfType } from './_helpers/characterAssetTestHelpers'

// ═══════════════════════════════════════════════════════════════════
// Reset helpers
// ═══════════════════════════════════════════════════════════════════
function reset() {
  useFlowStore.setState({
    nodes: [], edges: [], selectedNodeId: null, characterAppearances: {},
  })
  useAssetStore.setState({
    characters: {}, scenes: {}, styles: {},
    loading: false, error: null, lastFetchedAt: null,
  })
}

// ═══════════════════════════════════════════════════════════════════
// Fixtures — 6 scenarios worth of realistic Agent args
// ═══════════════════════════════════════════════════════════════════
interface ScenarioFixture {
  id: 'short_drama' | 'comic_drama' | 'product_ad' | 'store_tour' | 'tutorial' | 'music_video'
  label: string
  args: Record<string, unknown>
}

const FIXTURES: ScenarioFixture[] = [
  {
    id: 'short_drama',
    label: '短剧：赛博朋克新闻社',
    args: {
      title: '追风',
      description: 'Sarah, a rogue journalist, and Kai, a silent hacker, expose a conspiracy.',
      scenario: 'short_drama',
      characterNames: ['Sarah', 'Kai'],
      characterDescriptions: [
        'young woman with silver hair, black leather jacket',
        'tall man with short black hair, navy trench coat',
      ],
      sceneNames: ['Newsroom'],
      sceneDescriptions: ['neon-lit cyberpunk newsroom, volumetric fog'],
      shotCount: 3,
      shotPrompts: [
        'Wide: Sarah (silver hair) enters neon-lit newsroom, 8K cinematic',
        'Medium: Sarah and Kai at glowing terminal, volumetric fog',
        'Close-up: Kai (black hair) cracks a grin, dramatic side light',
      ],
      videoPrompts: [
        '[Camera]: Dolly forward. [Subject]: Sarah (silver hair) walking. [Quality]: 4K 24fps. [Negative]: no morphing.',
        '[Camera]: Orbit. [Subject]: Sarah + Kai studying screen. [Quality]: 4K. [Negative]: no flicker.',
        '[Camera]: Push in. [Subject]: Kai (black hair) grins. [Quality]: 4K film grain. [Negative]: no morphing.',
      ],
      styleDescription: 'cyberpunk noir, neon pink + cool blue, volumetric fog',
    },
  },
  {
    id: 'comic_drama',
    label: '漫剧：校园热血',
    args: {
      title: '风起',
      description: 'Hero Ryu and his rival Ken clash in a school tournament.',
      scenario: 'comic_drama',
      characterNames: ['Ryu', 'Ken'],
      characterDescriptions: [
        'spiky red hair boy, blue school uniform, fierce expression',
        'dark-haired rival, black jacket, cold stare',
      ],
      shotCount: 4,
      shotPrompts: [
        'Ryu (red hair) charges forward, dynamic pose, anime style',
        'Ken (black hair) dodges sideways, motion lines',
        'Wide: both clash in gym, speed lines, anime',
        'Close: Ryu grins, sweat drop, anime close-up',
      ],
      videoPrompts: [
        '[Camera]: Handheld tracking. [Subject]: Ryu (red hair) charging. [Quality]: anime 4K.',
        '[Camera]: Whip pan. [Subject]: Ken (black hair) dodging. [Quality]: anime 4K.',
        '[Camera]: Wide static. [Subject]: both clashing. [Quality]: anime 4K.',
        '[Camera]: Push in. [Subject]: Ryu (red hair) grinning. [Quality]: anime 4K.',
      ],
      styleDescription: 'anime style, vibrant colors, clean line art, dynamic composition',
    },
  },
  {
    id: 'product_ad',
    label: '产品广告：智能手表',
    args: {
      title: 'Aqua Smart Watch',
      description: '15s commercial for a sleek titanium smartwatch.',
      scenario: 'product_ad',
      characterNames: [],
      sceneNames: [],
      shotCount: 3,
      shotPrompts: [
        'Hero shot of titanium smartwatch, studio lighting, 8K',
        'Watch on wrist hiking mountain trail, golden hour',
        'Logo reveal, minimal typography',
      ],
      videoPrompts: [
        '[Camera]: Slow 360 orbit. [Subject]: watch on pedestal. [Quality]: Commercial 4K.',
        '[Camera]: Tracking. [Subject]: watch on wrist hiking. [Quality]: Cinematic 4K.',
        '[Camera]: Static. [Subject]: logo reveal. [Quality]: 4K clean.',
      ],
      styleDescription: 'commercial, clean, professional, titanium tones',
    },
  },
  {
    id: 'store_tour',
    label: '探店：咖啡馆 vlog',
    args: {
      title: '午后咖啡馆',
      description: 'Vlog exploring a cozy Kyoto-style coffee shop.',
      scenario: 'store_tour',
      characterNames: [],
      sceneNames: ['Coffee Shop Interior', 'Barista Counter'],
      sceneDescriptions: [
        'cozy wooden interior, warm pendant lights',
        'copper espresso machine gleaming under spotlights',
      ],
      shotCount: 4,
      shotPrompts: [
        'Entrance: warm wooden door, vlog angle',
        'Interior wide: cozy seats, pendant lights',
        'Barista closeup: pouring latte art',
        'Details: coffee cup steam, books on shelf',
      ],
      videoPrompts: [],
      styleDescription: 'vlog style, warm tones, natural lighting',
    },
  },
  {
    id: 'tutorial',
    label: '教程：React Hooks 入门',
    args: {
      title: 'React Hooks 速成',
      description: 'Beginner tutorial explaining useState and useEffect with code examples.',
      scenario: 'tutorial',
      characterNames: [],
      sceneNames: [],
      shotCount: 3,
      shotPrompts: [
        'Step 1: useState diagram, clean infographic, educational',
        'Step 2: useEffect lifecycle flow, minimal style',
        'Step 3: combined example, clear text labels',
      ],
      videoPrompts: [],
      styleDescription: '',
    },
  },
  {
    id: 'music_video',
    label: 'MV：霓虹都市',
    args: {
      title: 'Neon Pulse',
      description: 'Upbeat synthwave MV through neon streets with one lead dancer.',
      scenario: 'music_video',
      characterNames: ['Dancer'],
      characterDescriptions: ['woman with purple bob haircut, chrome jacket, neon eyeshadow'],
      shotCount: 6,
      shotPrompts: [
        'Dancer (purple bob) spinning, neon reflections',
        'Wide neon street, slow motion rain',
        'Dancer close-up, chrome jacket glint',
        'Overhead: dancer in intersection, cars blurring',
        'Dancer silhouette against billboard, backlit',
        'Fast cut: dancer lip-sync, neon pink flash',
      ],
      videoPrompts: [],
      styleDescription: 'synthwave, neon pink + cyan, high contrast, cinematic grain',
    },
  },
]

// ═══════════════════════════════════════════════════════════════════
// Scoring dimensions
// ═══════════════════════════════════════════════════════════════════
interface DimensionScore {
  name: string
  score: number | null  // null = N/A (not applicable for this scenario)
  max: number
  notes: string
}

interface ScenarioReport {
  id: string
  label: string
  dimensions: DimensionScore[]
  totalScore: number        // 0-100 normalized
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
}

function scoreWorkflow(args: Record<string, unknown>): DimensionScore[] {
  const { nodes, edges } = useFlowStore.getState()
  // Migration-aware: legacy character types resolve to the unified
  // `characterAsset` schema via `nodesOfType` so all D-dimension scoring
  // works regardless of whether `flowStore.addNode` has translated
  // the picker types.
  const byType = (t: string) => nodesOfType(nodes, t)
  const isCharacterTerminal = (n: { type?: string; data?: unknown }) =>
    isLegacyCharacterNode(n, 'characterManager')
  const isCharacterSource = (n: { type?: string; data?: unknown }) =>
    isLegacyCharacterNode(n, 'characterGrid')
  const hasCharacters = ((args.characterNames as string[]) || []).length > 0
  const hasScenes = ((args.sceneNames as string[]) || []).length > 0

  // D1. 画布自洽：至少产出 ≥ 5 个节点，且一定有 videoGen + videoStitch
  const d1: DimensionScore = (() => {
    const hasVideo = byType('videoGen').length > 0
    const hasStitch = byType('videoStitch').length > 0
    const enoughNodes = nodes.length >= 5
    const score = (hasVideo ? 4 : 0) + (hasStitch ? 3 : 0) + (enoughNodes ? 3 : 0)
    return {
      name: '画布自洽',
      score,
      max: 10,
      notes: `nodes=${nodes.length} videoGen=${byType('videoGen').length} stitch=${byType('videoStitch').length}`,
    }
  })()

  // D2. 端口契约：每条边都在 portRegistry 中合法
  const d2: DimensionScore = (() => {
    const violations: string[] = []
    for (const e of edges) {
      const src = nodes.find(n => n.id === e.source)
      const tgt = nodes.find(n => n.id === e.target)
      if (!src || !tgt) { violations.push(`missing endpoint ${e.id}`); continue }
      const srcPorts = NODE_PORT_REGISTRY[src.type!]
      const tgtPorts = NODE_PORT_REGISTRY[tgt.type!]
      const sh = e.sourceHandle || ''
      const th = e.targetHandle || ''
      if (!srcPorts?.some(p => p.id === sh && p.direction === 'output')) {
        violations.push(`${src.type}.${sh}(out) illegal`)
      }
      if (!tgtPorts?.some(p => p.id === th && p.direction === 'input')) {
        violations.push(`${tgt.type}.${th}(in) illegal`)
      }
    }
    const total = edges.length
    const ratio = total === 0 ? 1 : (total - violations.length) / total
    return {
      name: '端口契约',
      score: Math.round(ratio * 10),
      max: 10,
      notes: violations.length === 0 ? `${total} edges OK` : `${violations.length}/${total} violations: ${violations.slice(0, 2).join('; ')}`,
    }
  })()

  // D3. 孤立节点检测：除终端类型外，每个节点应有边。
  //     characterManager 和 videoStitch 允许只有入边（本来就是终端汇总）。
  //     带 `downstreamTextNodeId` 标签的 llmChat 通过 executor 写回下游文本节点，
  //     不依赖 edge，视作已连接。
  const d3: DimensionScore = (() => {
    const isolated: string[] = []
    // `videoStitch` is the only non-character terminal kind; character
    // managers (registry mode) are checked via `isCharacterTerminal`.
    const TERMINAL_OK = new Set(['videoStitch'])
    // Non-character source kinds. Character design / extract / registry
    // are matched separately via the helpers above so legacy + unified
    // schemas both pass.
    const SOURCE_OK = new Set(['textNode', 'styleLock', 'sceneGrid', 'llmChat'])
    for (const n of nodes) {
      const incoming = edges.filter(e => e.target === n.id).length
      const outgoing = edges.filter(e => e.source === n.id).length
      // llmChat with builder-set downstream tag is NOT isolated (runtime-wired via executor).
      if (n.type === 'llmChat' && n.data?.downstreamTextNodeId) continue
      if (incoming === 0 && outgoing === 0) {
        isolated.push(`${n.data?.label}(${n.type})`)
        continue
      }
      // Terminal nodes: must have ≥1 incoming.
      if ((TERMINAL_OK.has(n.type!) || isCharacterTerminal(n)) && incoming === 0) {
        isolated.push(`${n.data?.label}(${n.type}) terminal with no inputs`)
      }
      // Source nodes: can be standalone generators, no check.
      if (SOURCE_OK.has(n.type!) || isCharacterSource(n)) { continue }
    }
    const total = nodes.length
    const ratio = total === 0 ? 0 : (total - isolated.length) / total
    return {
      name: '孤立检测',
      score: Math.round(ratio * 10),
      max: 10,
      notes: isolated.length === 0 ? 'none' : `${isolated.length} isolated: ${isolated.slice(0, 2).join(', ')}`,
    }
  })()

  // D4. 风格一致性：有 styleLock 且每个 imageGen 都接它
  const d4: DimensionScore = (() => {
    const styleNode = byType('styleLock')[0]
    const imgs = byType('imageGen')
    if (!styleNode) {
      return { name: '风格一致性', score: 0, max: 10, notes: 'no styleLock node' }
    }
    if (imgs.length === 0) {
      return { name: '风格一致性', score: null, max: 10, notes: 'no imageGen (N/A)' }
    }
    const linked = imgs.filter(img =>
      edges.some(e => e.source === styleNode.id && e.target === img.id && e.sourceHandle === 'style-out'),
    )
    const ratio = linked.length / imgs.length
    return {
      name: '风格一致性',
      score: Math.round(ratio * 10),
      max: 10,
      notes: `${linked.length}/${imgs.length} imageGen nodes linked to styleLock`,
    }
  })()

  // D5. 关键帧 → 视频：每个 videoGen 都要有一条 imageGen.first-frame 入边
  const d5: DimensionScore = (() => {
    const videos = byType('videoGen')
    if (videos.length === 0) {
      return { name: '关键帧→视频', score: null, max: 10, notes: 'no videoGen (N/A)' }
    }
    const locked = videos.filter(v =>
      edges.some(e => e.target === v.id && e.targetHandle === 'first-frame'),
    )
    const ratio = locked.length / videos.length
    return {
      name: '关键帧→视频',
      score: Math.round(ratio * 10),
      max: 10,
      notes: `${locked.length}/${videos.length} videoGen nodes have first-frame input`,
    }
  })()

  // D6. 角色一致性：有 characters 时必须有 characterManager + 每个 grid 连接
  const d6: DimensionScore = (() => {
    if (!hasCharacters) {
      return { name: '角色一致性', score: null, max: 10, notes: 'no characters (N/A)' }
    }
    const managers = byType('characterManager')
    const grids = byType('characterGrid')
    if (managers.length !== 1 || grids.length === 0) {
      return {
        name: '角色一致性',
        score: 0,
        max: 10,
        notes: `manager=${managers.length} grid=${grids.length}`,
      }
    }
    const connected = grids.filter(g =>
      edges.some(e =>
        e.source === g.id && e.target === managers[0].id &&
        e.sourceHandle === 'grid-out' && e.targetHandle === 'character-in'
      ),
    )
    const ratio = connected.length / grids.length
    return {
      name: '角色一致性',
      score: Math.round(ratio * 10),
      max: 10,
      notes: `${connected.length}/${grids.length} grids connected to manager`,
    }
  })()

  // D7. 资产库整合：assetStore 应填入每个角色+场景
  const d7: DimensionScore = (() => {
    if (!hasCharacters && !hasScenes) {
      return { name: '资产库整合', score: null, max: 10, notes: 'no chars/scenes (N/A)' }
    }
    const charAssets = Object.values(useAssetStore.getState().characters)
    const sceneAssets = Object.values(useAssetStore.getState().scenes)
    const expectedChars = ((args.characterNames as string[]) || []).length
    const expectedScenes = ((args.sceneNames as string[]) || []).length
    const charsOk = charAssets.length >= expectedChars
    const scenesOk = sceneAssets.length >= expectedScenes
    const score = (charsOk ? 5 : Math.round((charAssets.length / Math.max(expectedChars, 1)) * 5)) +
                  (scenesOk ? 5 : Math.round((sceneAssets.length / Math.max(expectedScenes, 1)) * 5))
    return {
      name: '资产库整合',
      score: Math.min(score, 10),
      max: 10,
      notes: `chars=${charAssets.length}/${expectedChars} scenes=${sceneAssets.length}/${expectedScenes}`,
    }
  })()

  // D9. 提示词语言：shot/video prompts 不含中文
  const d9: DimensionScore = (() => {
    const zh = /[\u4e00-\u9fff]/
    const offenders: string[] = []
    for (const n of nodes.filter(x => x.type === 'imageGen' || x.type === 'videoGen')) {
      const p = String(n.data?.prompt || '')
      if (p && zh.test(p)) offenders.push(String(n.data?.label))
    }
    const generative = nodes.filter(x => x.type === 'imageGen' || x.type === 'videoGen')
    if (generative.length === 0) {
      return { name: '提示词语言', score: null, max: 10, notes: 'no generative nodes (N/A)' }
    }
    const ratio = (generative.length - offenders.length) / generative.length
    return {
      name: '提示词语言',
      score: Math.round(ratio * 10),
      max: 10,
      notes: offenders.length === 0 ? 'all English' : `${offenders.length} contain CJK`,
    }
  })()

  // D10. 成片路径：videoStitch 存在且有入边
  const d10: DimensionScore = (() => {
    const stitch = byType('videoStitch')[0]
    if (!stitch) {
      return { name: '成片路径', score: 0, max: 10, notes: 'no videoStitch' }
    }
    const incoming = edges.filter(e => e.target === stitch.id).length
    const score = incoming === 0 ? 0 : Math.min(10, 4 + incoming * 2)
    return {
      name: '成片路径',
      score,
      max: 10,
      notes: `stitch has ${incoming} input clips`,
    }
  })()

  return [d1, d2, d3, d4, d5, d6, d7, d9, d10]
}

async function scoreVerifyTask(): Promise<DimensionScore> {
  try {
    const res = await executeToolCall('verify_task', { verbose: false })
    // Extract score from message (format: "画布质量评分: 85/100 ...")
    const match = /(\d{1,3})\/100/.exec(String(res.message || ''))
    const verifyScore = match ? Math.min(100, Math.max(0, parseInt(match[1], 10))) : 0
    return {
      name: 'verify_task 自检',
      score: Math.round(verifyScore / 10),  // normalize 0-100 → 0-10
      max: 10,
      notes: `${verifyScore}/100`,
    }
  } catch (err) {
    return {
      name: 'verify_task 自检',
      score: 0,
      max: 10,
      notes: `error: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

function computeTotal(dims: DimensionScore[]): { total: number; grade: ScenarioReport['grade'] } {
  const applicable = dims.filter(d => d.score !== null)
  const sum = applicable.reduce((acc, d) => acc + (d.score ?? 0), 0)
  const max = applicable.length * 10
  const total = max === 0 ? 0 : Math.round((sum / max) * 100)
  const grade: ScenarioReport['grade'] =
    total >= 90 ? 'A' : total >= 80 ? 'B' : total >= 70 ? 'C' : total >= 60 ? 'D' : 'F'
  return { total, grade }
}

function formatReport(report: ScenarioReport): string {
  const lines: string[] = []
  lines.push(`\n[${report.id}] ${report.label}  Score=${report.totalScore}/100  Grade=${report.grade}`)
  for (const d of report.dimensions) {
    const label = d.score === null ? 'N/A ' : `${d.score}/${d.max}`
    lines.push(`  ${label.padEnd(6)} ${d.name.padEnd(14)} ${d.notes}`)
  }
  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════════════
// Test suite — runs 6 scenarios, produces rubric + TDD thresholds
// ═══════════════════════════════════════════════════════════════════
describe('Agent Generation Evaluation (6-scenario rubric)', () => {
  const reports: ScenarioReport[] = []

  for (const fixture of FIXTURES) {
    it(`${fixture.id}: scores ≥ 90 (A grade) across 10 dimensions`, async () => {
      reset()
      const res = await executeToolCall('generate_workflow', fixture.args)
      expect(res.success).toBe(true)

      const dims = scoreWorkflow(fixture.args)
      const verify = await scoreVerifyTask()
      dims.push(verify)
      const { total, grade } = computeTotal(dims)

      const report: ScenarioReport = {
        id: fixture.id,
        label: fixture.label,
        dimensions: dims,
        totalScore: total,
        grade,
      }
      reports.push(report)

      // Print report (visible via vitest --reporter=verbose)
      console.log(formatReport(report))

      // TDD threshold per spec workflow-builder-wiring-fixes — Grade A for every scenario
      expect(total).toBeGreaterThanOrEqual(90)
    })
  }

  it('overall Agent generation quality: average score ≥ 96', () => {
    expect(reports).toHaveLength(FIXTURES.length)
    const avg = Math.round(
      reports.reduce((acc, r) => acc + r.totalScore, 0) / reports.length,
    )
    const gradeDistribution = reports.reduce<Record<string, number>>((acc, r) => {
      acc[r.grade] = (acc[r.grade] || 0) + 1
      return acc
    }, {})
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`Agent Generation Evaluation — Overall Summary`)
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`Scenarios tested : ${reports.length}`)
    console.log(`Average score    : ${avg}/100`)
    console.log(`Grade breakdown  : ${JSON.stringify(gradeDistribution)}`)
    console.log(`Per-scenario     : ${reports.map(r => `${r.id}=${r.totalScore}`).join(', ')}`)
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    expect(avg).toBeGreaterThanOrEqual(96)
  })
})
