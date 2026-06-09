/**
 * Workflow Quality — TDD 风格的工作流生成质量审查
 *
 * 本套件模拟 Agent 的 generate_workflow 调用，对生成的 JSON 做 7 项
 * 一致性/连贯性/可执行性断言。这些是实现一部"有剧情、角色一致、场景连贯
 * 的短片/动漫"的必要条件 —— 但不是充分条件，充分条件需要真实 LLM 产出的
 * prompt 质量。
 *
 * 质量维度：
 *  A. 节点结构完整：角色 + 场景 + 风格 + 分镜 + 关键帧 + 视频 + 合成
 *  B. 端口契约完整：边的 (sourceHandle, targetHandle) 必须存在于 portRegistry
 *  C. 角色一致性路径：每个 imageGen 有 ≥1 条 characterGrid→ref-in 的入边
 *  D. 风格一致性路径：每个 imageGen 接 styleLock.style-out
 *  E. 关键帧→视频锁定：每个 videoGen 有 imageGen→first-frame 的入边
 *  F. 资产库整合：generate_workflow 是否让新创建的角色进入 assetStore
 *  G. 提示词语言：shot/video prompts 应为英文
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { executeToolCall } from '@/providers/agentTools'
import { useFlowStore } from '@/store/flowStore'
import { useAssetStore } from '@/store/assetStore'
import { NODE_PORT_REGISTRY } from '@/types/portRegistry'
import { isLegacyCharacterNode, nodesOfType } from './_helpers/characterAssetTestHelpers'

function reset() {
  useFlowStore.setState({ nodes: [], edges: [], selectedNodeId: null, characterAppearances: {} })
  useAssetStore.setState({
    characters: {}, scenes: {}, styles: {},
    loading: false, error: null, lastFetchedAt: null,
  })
}

const SARAH_DESC = 'young woman with silver hair, black leather jacket, confident posture'
const KAI_DESC = 'tall man with short black hair, navy trench coat, stoic expression'
const NEWSROOM_DESC = 'neon-lit cyberpunk newsroom at night, volumetric fog, cool blue lighting'

async function runScenario(overrides: Record<string, unknown> = {}) {
  const args = {
    title: '追风',
    description: 'Sarah, a rogue journalist, and Kai, a silent hacker, infiltrate a neon-lit newsroom to expose a conspiracy.',
    scenario: 'short_drama',
    characterNames: ['Sarah', 'Kai'],
    characterDescriptions: [SARAH_DESC, KAI_DESC],
    sceneNames: ['Newsroom'],
    sceneDescriptions: [NEWSROOM_DESC],
    shotCount: 3,
    shotPrompts: [
      'Wide shot: Sarah with silver hair steps into the neon-lit cyberpunk newsroom, trench coat swirling, 8K cinematic',
      'Medium two-shot: Sarah with silver hair and Kai with black hair hover over a glowing terminal, volumetric fog, rim lighting',
      'Close-up: Kai with black hair cracks a cryptic grin, dramatic side light, shallow depth of field',
    ],
    videoPrompts: [
      '[Camera]: Slow dolly forward. [Subject]: Sarah with silver hair walking into newsroom. [Atmosphere]: cyberpunk, neon reflections. [Quality]: 4K 24fps. [Negative]: no morphing, no identity drift.',
      '[Camera]: Orbit around terminal. [Subject]: Sarah (silver hair) + Kai (black hair) studying screen. [Atmosphere]: volumetric fog. [Quality]: 4K. [Negative]: no flicker.',
      '[Camera]: Push in close. [Subject]: Kai with black hair grins. [Atmosphere]: dramatic shadows. [Quality]: 4K film grain. [Negative]: no morphing.',
    ],
    styleDescription: 'cyberpunk noir, neon pink + cool blue, rain-soaked, volumetric fog, shallow depth of field, cinematic 4K',
    ...overrides,
  }
  const res = await executeToolCall('generate_workflow', args)
  expect(res.success).toBe(true)
  return useFlowStore.getState()
}

describe('[A] 节点结构完整性', () => {
  beforeEach(reset)

  it('short_drama: 生成 script + storyboard + style + 2 chars + manager + 1 scene + 3 kf + 3 video + stitch = 14 节点', async () => {
    const { nodes } = await runScenario()
    // byType is migration-aware: legacy character types resolve via
    // `nodesOfType` so the assertions still describe the *role* of the
    // node regardless of whether the canvas uses legacy 3-type schema
    // or the unified `characterAsset` type with `data.mode`.
    const byType = (t: string) => nodesOfType(nodes, t).length
    expect(byType('textNode')).toBe(1)           // 剧本
    expect(byType('storyboard')).toBe(1)
    expect(byType('styleLock')).toBe(1)
    expect(byType('characterGrid')).toBe(2)
    expect(byType('characterManager')).toBe(1)   // LibTV 角色库 registry (added in node-functional-parity-cleanup)
    expect(byType('sceneGrid')).toBe(1)
    expect(byType('imageGen')).toBe(3)
    expect(byType('videoGen')).toBe(3)
    expect(byType('videoStitch')).toBe(1)
    expect(nodes).toHaveLength(14)
  })
})

// ────────────────────────────────────────────────────────────
describe('[B] 端口契约：边上的 handle 必须真实存在', () => {
  beforeEach(reset)

  it('所有边的 (sourceHandle, targetHandle) 都能在 NODE_PORT_REGISTRY 找到', async () => {
    const { nodes, edges } = await runScenario()
    const handleExists = (nodeType: string, handleId: string, direction: 'input' | 'output') => {
      const ports = NODE_PORT_REGISTRY[nodeType]
      if (!ports) return false
      return ports.some(p => p.id === handleId && p.direction === direction)
    }

    const violations: string[] = []
    for (const e of edges) {
      const src = nodes.find(n => n.id === e.source)
      const tgt = nodes.find(n => n.id === e.target)
      if (!src || !tgt) { violations.push(`missing endpoint on edge ${e.id}`); continue }
      const sh = e.sourceHandle || ''
      const th = e.targetHandle || ''
      if (!handleExists(src.type!, sh, 'output')) {
        violations.push(`${src.type}.${sh} (source) 未在 portRegistry 声明`)
      }
      if (!handleExists(tgt.type!, th, 'input')) {
        violations.push(`${tgt.type}.${th} (target) 未在 portRegistry 声明`)
      }
    }
    expect({ violations }).toEqual({ violations: [] })
  })
})

// ────────────────────────────────────────────────────────────
describe('[C] 角色一致性：每个 imageGen 都被所有 characterGrid 连接', () => {
  beforeEach(reset)

  it('每个 imageGen 节点 ref-in 上有 N 条来自 characterGrid 的边（N = 角色数）', async () => {
    const { nodes, edges } = await runScenario()
    const imgNodes = nodes.filter(n => n.type === 'imageGen')
    const charNodes = nodes.filter(n => isLegacyCharacterNode(n, 'characterGrid'))
    for (const img of imgNodes) {
      const charRefEdges = edges.filter(e =>
        e.target === img.id &&
        e.targetHandle === 'ref-in' &&
        isLegacyCharacterNode(nodes.find(n => n.id === e.source), 'characterGrid')
      )
      expect(charRefEdges.length).toBe(charNodes.length)
    }
  })
})

// ────────────────────────────────────────────────────────────
describe('[D] 风格一致性：每个 imageGen 接 styleLock.style-out', () => {
  beforeEach(reset)

  it('每个 imageGen 都有一条 styleLock → style-in 的入边', async () => {
    const { nodes, edges } = await runScenario()
    const imgNodes = nodes.filter(n => n.type === 'imageGen')
    const styleNode = nodes.find(n => n.type === 'styleLock')
    expect(styleNode).toBeDefined()
    for (const img of imgNodes) {
      const styleEdges = edges.filter(e =>
        e.source === styleNode!.id &&
        e.target === img.id &&
        e.sourceHandle === 'style-out' &&
        e.targetHandle === 'style-in'
      )
      expect(styleEdges.length).toBe(1)
    }
  })
})

// ────────────────────────────────────────────────────────────
describe('[E] 关键帧→视频锁定：每个 videoGen 有 imageGen.first-frame 入边', () => {
  beforeEach(reset)

  it('每个 videoGen 正好 1 条 imageGen → first-frame 的入边', async () => {
    const { nodes, edges } = await runScenario()
    for (const v of nodes.filter(n => n.type === 'videoGen')) {
      const firstFrame = edges.filter(e =>
        e.target === v.id && e.targetHandle === 'first-frame'
      )
      expect(firstFrame.length).toBe(1)
      const src = nodes.find(n => n.id === firstFrame[0].source)
      expect(src?.type).toBe('imageGen')
    }
  })
})

// ────────────────────────────────────────────────────────────
describe('[F] 资产库整合：generate_workflow 与 Asset Library 的关系', () => {
  beforeEach(reset)

  it('generate_workflow 后 assetStore 中应有对应角色（Sarah + Kai）', async () => {
    await runScenario()
    const assetChars = Object.values(useAssetStore.getState().characters)
    // post-fix: generate_workflow seeds every character into the Asset Library
    // via assetStore.seedLocal so @token references, modelReferenceAdapter
    // routing, and drag-from-panel all work out of the box.
    expect(assetChars.length).toBe(2)
    const names = assetChars.map(a => a.name).sort()
    expect(names).toEqual(['Kai', 'Sarah'])
    // appearance should have been persisted too (used by @token resolver)
    expect(assetChars.find(a => a.name === 'Sarah')?.appearance).toContain('silver hair')
  })

  it('generate_workflow 后 assetStore 中应有对应场景（Newsroom）', async () => {
    await runScenario()
    const assetScenes = Object.values(useAssetStore.getState().scenes)
    expect(assetScenes.length).toBe(1)
    expect(assetScenes[0].name).toBe('Newsroom')
    expect(assetScenes[0].environment).toContain('cyberpunk')
  })

  it('每个 imageGen/videoGen 节点 data.assetRefs 应包含所有角色+场景 asset_id', async () => {
    const { nodes } = await runScenario()
    const assetChars = Object.values(useAssetStore.getState().characters).map(a => a.asset_id)
    const assetScenes = Object.values(useAssetStore.getState().scenes).map(a => a.asset_id)
    const expected = [...assetChars, ...assetScenes].sort()
    const offenders: string[] = []
    for (const n of nodes.filter(x => x.type === 'imageGen' || x.type === 'videoGen')) {
      const refs = (n.data?.assetRefs as string[] | undefined)?.slice().sort() || []
      if (JSON.stringify(refs) !== JSON.stringify(expected)) {
        offenders.push(`${n.type}#${n.id}: got ${JSON.stringify(refs)} != expected ${JSON.stringify(expected)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('characterGrid / sceneGrid 节点 data.assetId 应指向 assetStore 中的条目', async () => {
    const { nodes } = await runScenario()
    const store = useAssetStore.getState()
    for (const n of nodes.filter(x => isLegacyCharacterNode(x, 'characterGrid') || x.type === 'sceneGrid')) {
      const assetId = n.data?.assetId as string | undefined
      expect(assetId, `${n.type}#${n.id} missing assetId`).toBeTruthy()
      expect(store.get(assetId!), `assetStore.get(${assetId}) should resolve`).toBeTruthy()
    }
  })
})

// ────────────────────────────────────────────────────────────
describe('[G] 提示词语言：imageGen/videoGen 都应为英文', () => {
  beforeEach(reset)

  it('shot prompts 不含中文', async () => {
    const { nodes } = await runScenario()
    const zh = /[\u4e00-\u9fff]/
    const offenders = nodes
      .filter(n => n.type === 'imageGen' || n.type === 'videoGen')
      .filter(n => zh.test(String(n.data?.prompt || '')))
      .map(n => String(n.data?.label))
    expect(offenders).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────
describe('[H] Agent 自检 verify_task 应给高分', () => {
  beforeEach(reset)

  it('verify_task 对上面合规工作流给出 ≥85 分', async () => {
    await runScenario()
    const res = await executeToolCall('verify_task', { verbose: true })
    expect(res.success).toBe(true)
    const m = res.message.match(/画布质量评分: (\d+)\/100/)
    expect(m).toBeTruthy()
    const score = Number(m![1])
    expect(score).toBeGreaterThanOrEqual(85)
  })
})
