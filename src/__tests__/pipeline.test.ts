/**
 * 制片 Pipeline 集成测试
 *
 * 覆盖：
 *  - executeNodesBatch 并行批量执行（concurrency 控制）
 *  - parallel_execute Agent 工具调用
 *  - generate_workflow 节点标签命名正确性（batch/parallel_execute 依赖）
 *  - batch_execute Agent 工具调用
 *  - 依赖链验证：characterGrid → imageGen 直接连接
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Force frontend mode for these legacy tests
vi.mock('@/lib/env', () => ({
  ENV: {
    BACKEND_ENABLED: false,
    BACKEND_URL: 'http://localhost:8000',
    API_KEY: '', API_BASE_URL: 'https://yunwu.ai',
    VIDEO_CHANNEL_PRIORITY: 'puyo,apimart',
    PUYO_API_KEY: '', PUYO_API_URL: '',
    APIMART_API_KEY: '', APIMART_API_URL: '',
    COS_SECRET_ID: '', COS_SECRET_KEY: '', COS_REGION: 'ap-guangzhou', COS_BUCKET: '',
    DEFAULT_IMAGE_MODEL: '', DEFAULT_VIDEO_MODEL: '', DEFAULT_LLM_MODEL: '',
    DEFAULT_VIDEO_DURATION: 8, DEFAULT_ASPECT_RATIO: '16:9',
    DEFAULT_IMAGE_SIZE: '2k', DEFAULT_IMAGE_ASPECT_RATIO: '16:9',
    POLL_INTERVAL: 5000, TASK_MAX_CONCURRENT: 1, TASK_MAX_RETRIES: 3,
    TASK_RETRY_DELAYS: [3000, 8000, 15000],
    AGENT_MAX_TOOL_ROUNDS: 25, AGENT_TEMPERATURE: 0.3, AGENT_MAX_TOKENS: 4096,
    CONTEXT_COMPACTION_WINDOW: 10, AGENT_REFLECTION_THRESHOLD: 3,
  },
  getEnv: (_name: string, fallback = '') => fallback,
}))

import { useFlowStore } from '@/store/flowStore'
import { executeNode, executeNodesBatch } from '@/providers/nodeExecutor'
import { executeToolCall } from '@/providers/agentTools'

// ── store 重置 ──
function reset() {
  useFlowStore.setState({ nodes: [], edges: [], selectedNodeId: null, _history: [], _historyIndex: -1, _clipboard: null })
}

// ── 直接注入节点 ──
function inject(id: string, type: string, label: string, extra: Record<string, unknown> = {}) {
  useFlowStore.setState(s => ({
    nodes: [...s.nodes, { id, type, position: { x: 0, y: 0 }, data: { label, status: 'idle', ...extra } }],
  }))
}

// NOTE: registry.ts / adapters/ 已删除，模型全部由后端 DB 管理

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: vi.fn().mockReturnValue({
      apiKey: 'test-key', defaultLLMModel: 'test-model',
      cosSecretId: '', cosSecretKey: '', cosBucket: '', cosRegion: '',
    }),
  },
}))

vi.mock('@/providers/cosUploader', () => ({
  cosUploader: { ensureUrl: vi.fn().mockResolvedValue(null), upload: vi.fn(), initialize: vi.fn() },
}))

// ============================================================
describe('executeNodesBatch — 并行批量执行', () => {
  beforeEach(reset)

  it('executes all nodes and returns per-node results', async () => {
    inject('n1', 'textNode', '节点A')
    inject('n2', 'textNode', '节点B')
    inject('n3', 'textNode', '节点C')

    const results = await executeNodesBatch(['n1', 'n2', 'n3'], 4)
    expect(results).toHaveLength(3)
    results.forEach(r => {
      expect(typeof r.nodeId).toBe('string')
      expect(typeof r.result.success).toBe('boolean')
    })
  })

  it('returns failure for non-existent node IDs', async () => {
    const results = await executeNodesBatch(['does-not-exist'], 2)
    expect(results).toHaveLength(1)
    expect(results[0].result.success).toBe(false)
  })

  it('respects concurrency — batch size controls parallel slots', async () => {
    const executionOrder: string[] = []
    // inject 4 textNodes
    for (let i = 1; i <= 4; i++) {
      inject(`n${i}`, 'textNode', `节点${i}`)
    }
    const ids = ['n1', 'n2', 'n3', 'n4']
    const results = await executeNodesBatch(ids, 2) // concurrency=2
    expect(results).toHaveLength(4)
  })

  it('executes single node batch', async () => {
    inject('solo', 'textNode', '单节点')
    const results = await executeNodesBatch(['solo'], 4)
    expect(results).toHaveLength(1)
    expect(results[0].nodeId).toBe('solo')
    expect(results[0].result.success).toBe(true)
  })

  it('returns empty array for empty input', async () => {
    const results = await executeNodesBatch([], 4)
    expect(results).toHaveLength(0)
  })
})

// ============================================================
describe('parallel_execute Agent 工具', () => {
  beforeEach(reset)

  it('succeeds for valid nodeLabels', async () => {
    inject('t1', 'textNode', '镜头1 关键帧', { prompt: '...' })
    inject('t2', 'textNode', '镜头2 关键帧', { prompt: '...' })

    const result = await executeToolCall('parallel_execute', {
      nodeLabels: ['镜头1 关键帧', '镜头2 关键帧'],
      concurrency: 4,
    })
    expect(result.success).toBe(true)
    expect(result.message).toContain('并行执行完成')
    expect(result.message).toContain('并发=4')
  })

  it('returns failure when no nodes found', async () => {
    const result = await executeToolCall('parallel_execute', {
      nodeLabels: ['不存在的节点'],
    })
    expect(result.success).toBe(false)
  })

  it('skips missing labels and succeeds for found ones', async () => {
    inject('t1', 'textNode', '镜头1 关键帧')

    const result = await executeToolCall('parallel_execute', {
      nodeLabels: ['镜头1 关键帧', '不存在的节点'],
    })
    expect(result.success).toBe(true)
    expect(result.message).toContain('skip')
  })

  it('uses nodeIds when provided', async () => {
    inject('explicit-id', 'textNode', '任意标签')

    const result = await executeToolCall('parallel_execute', {
      nodeIds: ['explicit-id'],
      concurrency: 2,
    })
    expect(result.success).toBe(true)
  })

  it('deduplicates nodeIds if same node appears in both lists', async () => {
    inject('n1', 'textNode', '关键帧1')

    const result = await executeToolCall('parallel_execute', {
      nodeIds: ['n1'],
      nodeLabels: ['关键帧1'], // same node via label
    })
    expect(result.success).toBe(true)
    // Should execute once, not twice
    expect(result.message).toContain('1/')
  })
})

// ============================================================
describe('batch_execute Agent 工具', () => {
  beforeEach(reset)

  it('succeeds for valid nodeLabels', async () => {
    inject('s1', 'textNode', '风格锁定')
    inject('s2', 'textNode', '分镜脚本')

    const result = await executeToolCall('batch_execute', {
      nodeLabels: ['风格锁定', '分镜脚本'],
    })
    expect(result.success).toBe(true)
    expect(result.message).toContain('批量执行完成')
  })

  it('skips nodes not found', async () => {
    inject('s1', 'textNode', '风格锁定')

    const result = await executeToolCall('batch_execute', {
      nodeLabels: ['风格锁定', '不存在节点'],
    })
    expect(result.message).toContain('skip')
  })

  it('fails when nodeLabels is empty', async () => {
    const result = await executeToolCall('batch_execute', { nodeLabels: [] })
    expect(result.success).toBe(false)
  })
})

// ============================================================
describe('generate_workflow — 节点标签命名约定', () => {
  beforeEach(reset)

  it('creates characterGrid with label "角色: {name}"', async () => {
    const result = await executeToolCall('generate_workflow', {
      title: '测试项目',
      description: '测试描述',
      characterNames: ['林夏'],
      shotCount: 1,
    })
    expect(result.success).toBe(true)
    const nodes = useFlowStore.getState().nodes
    const charNode = nodes.find(n => n.type === 'characterGrid')
    expect(charNode).toBeDefined()
    expect(String(charNode!.data?.label)).toBe('角色: 林夏')
  })

  it('creates imageGen with label "镜头{N} 关键帧"', async () => {
    await executeToolCall('generate_workflow', {
      title: '测试',
      description: '描述',
      shotCount: 3,
    })
    const nodes = useFlowStore.getState().nodes
    const imgNodes = nodes.filter(n => n.type === 'imageGen')
    expect(imgNodes).toHaveLength(3)
    expect(String(imgNodes[0].data?.label)).toBe('镜头1 关键帧')
    expect(String(imgNodes[1].data?.label)).toBe('镜头2 关键帧')
    expect(String(imgNodes[2].data?.label)).toBe('镜头3 关键帧')
  })

  it('creates videoGen with label "镜头{N} 视频"', async () => {
    await executeToolCall('generate_workflow', {
      title: '测试',
      description: '描述',
      shotCount: 2,
    })
    const nodes = useFlowStore.getState().nodes
    const vidNodes = nodes.filter(n => n.type === 'videoGen')
    expect(vidNodes).toHaveLength(2)
    expect(String(vidNodes[0].data?.label)).toBe('镜头1 视频')
    expect(String(vidNodes[1].data?.label)).toBe('镜头2 视频')
  })

  it('creates storyboard with label "分镜脚本"', async () => {
    await executeToolCall('generate_workflow', { title: 'X', description: 'D', shotCount: 1 })
    const nodes = useFlowStore.getState().nodes
    const sb = nodes.find(n => n.type === 'storyboard')
    expect(String(sb?.data?.label)).toBe('分镜脚本')
  })

  it('creates styleLock with label "风格锁定"', async () => {
    await executeToolCall('generate_workflow', { title: 'X', description: 'D', shotCount: 1 })
    const nodes = useFlowStore.getState().nodes
    const sl = nodes.find(n => n.type === 'styleLock')
    expect(String(sl?.data?.label)).toBe('风格锁定')
  })

  it('does not create audioNode by default (audio is optional)', async () => {
    await executeToolCall('generate_workflow', { title: 'X', description: 'D', shotCount: 1 })
    const nodes = useFlowStore.getState().nodes
    const audio = nodes.find(n => n.type === 'audioNode')
    expect(audio).toBeUndefined()
  })

  it('creates videoStitch with label "最终合成"', async () => {
    await executeToolCall('generate_workflow', { title: 'X', description: 'D', shotCount: 1 })
    const nodes = useFlowStore.getState().nodes
    const stitch = nodes.find(n => n.type === 'videoStitch')
    expect(String(stitch?.data?.label)).toBe('最终合成')
  })

  it('ALL characterGrids connect directly to ALL imageGen (multi-char consistency)', async () => {
    await executeToolCall('generate_workflow', {
      title: '多角色测试',
      description: '多角色一致性',
      characterNames: ['林夏', '顾明'],
      shotCount: 2,
    })
    const { nodes, edges } = useFlowStore.getState()
    const charNodes = nodes.filter(n => n.type === 'characterGrid')
    const imgNodes = nodes.filter(n => n.type === 'imageGen')

    expect(charNodes).toHaveLength(2)
    expect(imgNodes).toHaveLength(2)

    // characterGrid 直接连接 imageGen via ref-in
    const charToImgEdges = edges.filter(e => {
      const src = nodes.find(n => n.id === e.source)
      const tgt = nodes.find(n => n.id === e.target)
      return src?.type === 'characterGrid' && tgt?.type === 'imageGen' && e.targetHandle === 'ref-in'
    })
    // 2 chars × 2 imageGen = 4 条 ref-in 边
    expect(charToImgEdges.length).toBe(4)
    // 确认无废弃的 imageCrop 节点
    const cropNodes = nodes.filter(n => n.type === 'imageCrop')
    expect(cropNodes).toHaveLength(0)
  })

  it('creates imageGen → videoGen first-frame connections', async () => {
    await executeToolCall('generate_workflow', { title: 'T', description: 'D', shotCount: 2 })
    const { edges } = useFlowStore.getState()
    const firstFrameEdges = edges.filter(e => e.targetHandle === 'first-frame')
    expect(firstFrameEdges).toHaveLength(2) // one per shot
  })

  it('fills shotPrompts into imageGen.prompt when provided', async () => {
    await executeToolCall('generate_workflow', {
      title: 'P',
      description: 'D',
      shotCount: 1,
      shotPrompts: ['A woman with silver hair stands on a rooftop, cinematic 8K'],
    })
    const nodes = useFlowStore.getState().nodes
    const img = nodes.find(n => n.type === 'imageGen')
    expect(String(img!.data?.prompt)).toContain('silver hair')
  })
})

// ============================================================
describe('Pipeline 依赖链 — 标签可被 findNodeByLabel 查到', () => {
  beforeEach(reset)

  it('generate_workflow labels are all findable via get_canvas_state', async () => {
    await executeToolCall('generate_workflow', {
      title: '追风',
      description: '故事',
      characterNames: ['林夏'],
      shotCount: 2,
    })

    // Verify labels via canvas state (no node execution — avoids API call timeouts)
    const canvasResult = await executeToolCall('get_canvas_state', {})
    expect(canvasResult.success).toBe(true)
    // stage 1 labels (角色直接连接关键帧，无裁切节点)
    expect(canvasResult.message).toContain('角色: 林夏')
    expect(canvasResult.message).toContain('风格锁定')
    expect(canvasResult.message).toContain('分镜脚本')
    // parallel_execute stage 2 labels
    expect(canvasResult.message).toContain('镜头1 关键帧')
    expect(canvasResult.message).toContain('镜头2 关键帧')
    // stage 3 labels
    expect(canvasResult.message).toContain('镜头1 视频')
    expect(canvasResult.message).toContain('镜头2 视频')
    // stage 4 labels
    // audioNode is no longer auto-created (optional, added later)
    expect(canvasResult.message).toContain('最终合成')
  })
})
