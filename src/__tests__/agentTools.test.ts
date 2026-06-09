/**
 * agentTools / nodeExecutor 查找函数 单元测试
 *
 * 覆盖：findNodeByLabel / findNodesByLabel / findNodeById
 *       resolveNode (nodeId 优先 / 歧义消除)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useFlowStore } from '@/store/flowStore'
import { findNodeByLabel, findNodesByLabel, findNodeById } from '@/providers/nodeExecutor'
import { isLegacyCharacterNode } from './_helpers/characterAssetTestHelpers'

function reset() {
  useFlowStore.setState({ nodes: [], edges: [], selectedNodeId: null, _history: [], _historyIndex: -1, _clipboard: null })
}

function injectNode(id: string, type: string, label: string, extra: Record<string, unknown> = {}) {
  useFlowStore.setState(s => ({
    nodes: [...s.nodes, { id, type, position: { x: 0, y: 0 }, data: { label, ...extra } }],
  }))
}

// ────────────────────────────────────────────────────────────
describe('findNodeById', () => {
  beforeEach(reset)

  it('returns node info for existing ID', () => {
    injectNode('abc-123', 'imageGen', '图片生成 1')
    const result = findNodeById('abc-123')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('abc-123')
    expect(result!.type).toBe('imageGen')
    expect(result!.label).toBe('图片生成 1')
  })

  it('returns null for unknown ID', () => {
    expect(findNodeById('does-not-exist')).toBeNull()
  })

  it('returns null on empty canvas', () => {
    expect(findNodeById('any-id')).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────
describe('findNodeByLabel', () => {
  beforeEach(reset)

  it('returns node for exact label match', () => {
    injectNode('n1', 'imageGen', '人物图片生成')
    const result = findNodeByLabel('人物图片生成')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('n1')
  })

  it('returns node for partial/fuzzy match', () => {
    injectNode('n1', 'imageGen', '人物图片生成')
    const result = findNodeByLabel('图片生成')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('n1')
  })

  it('returns null when no match', () => {
    injectNode('n1', 'imageGen', '图片生成')
    expect(findNodeByLabel('视频生成')).toBeNull()
  })

  it('returns first match when multiple candidates exist', () => {
    injectNode('n1', 'imageGen', '图片生成 A')
    injectNode('n2', 'imageGen', '图片生成 B')
    const result = findNodeByLabel('图片生成')
    expect(result).not.toBeNull()
    // 应返回其中一个
    expect(['n1', 'n2']).toContain(result!.id)
  })

  it('prefers exact match over partial match', () => {
    injectNode('n1', 'imageGen', '图片生成')
    injectNode('n2', 'imageGen', '图片生成 Pro')
    const result = findNodeByLabel('图片生成')
    // 精确匹配优先
    expect(result!.id).toBe('n1')
  })
})

// ────────────────────────────────────────────────────────────
describe('findNodesByLabel', () => {
  beforeEach(reset)

  it('returns all nodes matching label (exact or partial)', () => {
    injectNode('n1', 'imageGen', '图片生成 A')
    injectNode('n2', 'imageGen', '图片生成 B')
    injectNode('n3', 'videoGen', '视频生成')
    const results = findNodesByLabel('图片生成')
    expect(results).toHaveLength(2)
    const ids = results.map(r => r.id)
    expect(ids).toContain('n1')
    expect(ids).toContain('n2')
  })

  it('returns empty array when no matches', () => {
    injectNode('n1', 'videoGen', '视频生成')
    expect(findNodesByLabel('不存在的标签')).toHaveLength(0)
  })

  it('returns single node when only one matches', () => {
    injectNode('n1', 'imageGen', '特定图片')
    injectNode('n2', 'videoGen', '视频')
    const results = findNodesByLabel('特定图片')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('n1')
  })
})

// ────────────────────────────────────────────────────────────
describe('findNodeByLabel — 精确匹配优先级', () => {
  beforeEach(reset)

  it('returns exact match first when ambiguous', () => {
    injectNode('n1', 'imageGen', '角色图片生成')
    injectNode('n2', 'imageGen', '图片生成')  // exact match
    injectNode('n3', 'imageGen', '场景图片生成')
    const result = findNodeByLabel('图片生成')
    expect(result!.id).toBe('n2')
  })

  it('can find storyboard by label', () => {
    injectNode('sb', 'storyboard', '分镜脚本')
    expect(findNodeByLabel('分镜脚本')).not.toBeNull()
    expect(findNodeByLabel('分镜')).not.toBeNull()
  })

  it('can find styleLock by label', () => {
    injectNode('sl', 'styleLock', '风格锁定')
    expect(findNodeByLabel('风格锁定')?.id).toBe('sl')
  })

  it('can find characterGrid by label', () => {
    injectNode('cg', 'characterGrid', '主角九宫图')
    expect(findNodeByLabel('主角九宫图')?.id).toBe('cg')
    expect(findNodeByLabel('九宫图')?.id).toBe('cg')
  })
})

// ────────────────────────────────────────────────────────────
describe('findNodeById vs findNodeByLabel 优先级', () => {
  beforeEach(reset)

  it('findNodeById is precise — label query does not interfere', () => {
    injectNode('id-001', 'videoGen', '视频生成 A')
    injectNode('id-002', 'videoGen', '视频生成 B')

    // 通过 ID 能精确找到对应节点
    expect(findNodeById('id-001')?.label).toBe('视频生成 A')
    expect(findNodeById('id-002')?.label).toBe('视频生成 B')

    // 通过 label 模糊查找，只返回第一个匹配
    const byLabel = findNodeByLabel('视频生成')
    expect(['id-001', 'id-002']).toContain(byLabel?.id)
  })

  it('findNodesByLabel lists all candidates for disambiguation', () => {
    injectNode('id-001', 'videoGen', '视频生成 A')
    injectNode('id-002', 'videoGen', '视频生成 B')
    injectNode('id-003', 'videoGen', '视频生成 C')

    const all = findNodesByLabel('视频生成')
    expect(all).toHaveLength(3)
    // disambiguation list should give user enough info to use nodeId
    all.forEach(n => {
      expect(typeof n.id).toBe('string')
      expect(typeof n.label).toBe('string')
      expect(typeof n.type).toBe('string')
    })
  })
})

// ────────────────────────────────────────────────────────────
describe('边缘情况', () => {
  beforeEach(reset)

  it('handles nodes with no label (falls back to id)', () => {
    useFlowStore.setState(s => ({
      nodes: [...s.nodes, { id: 'no-label', type: 'imageGen', position: { x: 0, y: 0 }, data: {} }],
    }))
    const result = findNodeById('no-label')
    expect(result).not.toBeNull()
    // label should fallback to id
    expect(result!.label).toBe('no-label')
  })

  it('findNodeByLabel with single-char query', () => {
    injectNode('n1', 'imageGen', 'A')
    expect(findNodeByLabel('A')?.id).toBe('n1')
  })

  it('is case-sensitive for Chinese labels', () => {
    injectNode('n1', 'imageGen', '图片生成')
    expect(findNodeByLabel('图片生成')).not.toBeNull()
    expect(findNodeByLabel('IMAGEGEN')).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────
describe('create_character_extract_node / create_character_manager_node (agentTools)', () => {
  beforeEach(reset)

  it('creates a characterExtract node with defaults', async () => {
    const { executeToolCall } = await import('@/providers/agentTools')
    const res = await executeToolCall('create_character_extract_node', {})
    expect(res.success).toBe(true)
    expect(res.nodeIds).toHaveLength(1)

    const node = useFlowStore.getState().nodes.find(n => n.id === res.nodeIds![0])!
    expect(isLegacyCharacterNode(node, 'characterExtract')).toBe(true)
    expect(node.data.label).toBe('角色提取')
    expect(node.data.timestamps).toBe('1,3')
    expect(node.data.status).toBe('idle')
    expect(node.data.videoUrl).toBeNull()
  })

  it('characterExtract honors Agent-provided videoUrl and timestamps', async () => {
    const { executeToolCall } = await import('@/providers/agentTools')
    const res = await executeToolCall('create_character_extract_node', {
      videoUrl: 'https://cos.example.com/v.mp4',
      timestamps: '2,5',
      label: '提取主角',
    })
    const node = useFlowStore.getState().nodes.find(n => n.id === res.nodeIds![0])!
    expect(node.data.videoUrl).toBe('https://cos.example.com/v.mp4')
    expect(node.data.timestamps).toBe('2,5')
    expect(node.data.label).toBe('提取主角')
  })

  it('creates a characterManager with empty characters list', async () => {
    const { executeToolCall } = await import('@/providers/agentTools')
    const res = await executeToolCall('create_character_manager_node', {})
    expect(res.success).toBe(true)
    expect(res.nodeIds).toHaveLength(1)

    const node = useFlowStore.getState().nodes.find(n => n.id === res.nodeIds![0])!
    expect(isLegacyCharacterNode(node, 'characterManager')).toBe(true)
    expect(node.data.label).toBe('角色管理器')
    expect(node.data.characters).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────
describe('generate_workflow emits characterManager for drama scenarios', () => {
  beforeEach(reset)

  it('short_drama builder wires a single characterManager with character-in edges', async () => {
    const { executeToolCall } = await import('@/providers/agentTools')
    await executeToolCall('generate_workflow', {
      title: 'T',
      description: 'D',
      scenario: 'short_drama',
      characterNames: ['Alice', 'Bob'],
      characterDescriptions: ['blonde woman', 'dark-haired man'],
      sceneNames: ['Park'],
      sceneDescriptions: ['sunny park'],
      shotCount: 2,
      shotPrompts: ['Alice walks', 'Bob runs'],
      videoPrompts: ['Alice walks', 'Bob runs'],
    })
    const { nodes, edges } = useFlowStore.getState()
    const managers = nodes.filter(n => isLegacyCharacterNode(n, 'characterManager'))
    expect(managers).toHaveLength(1)

    const charInEdges = edges.filter(e =>
      e.target === managers[0].id && e.targetHandle === 'character-in',
    )
    expect(charInEdges).toHaveLength(2)  // one per character
  })

  it('comic_drama builder wires a single characterManager with character-in edges', async () => {
    const { executeToolCall } = await import('@/providers/agentTools')
    await executeToolCall('generate_workflow', {
      title: 'T',
      description: 'D',
      scenario: 'comic_drama',
      characterNames: ['Hero'],
      characterDescriptions: ['red-haired anime hero'],
      shotCount: 3,
    })
    const { nodes, edges } = useFlowStore.getState()
    const managers = nodes.filter(n => isLegacyCharacterNode(n, 'characterManager'))
    expect(managers).toHaveLength(1)

    const charInEdges = edges.filter(e =>
      e.target === managers[0].id && e.targetHandle === 'character-in',
    )
    expect(charInEdges).toHaveLength(1)
  })
})
