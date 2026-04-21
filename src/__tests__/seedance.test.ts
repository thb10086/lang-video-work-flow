/**
 * seedance 模型 — Agent 工具集成测试
 *
 * 覆盖：
 *   1. Agent create_video_node 工具支持 seedance 模型
 *   2. AGENT_TOOLS schema 包含 seedance 模型
 *
 * NOTE: 模型定义 / param_schema / 路由全部由后端 DB 管理，
 *       前端已删除 channelRouter / APIMartVideoAdapter 等静态模块。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useFlowStore } from '@/store/flowStore'
import { executeToolCall, AGENT_TOOLS } from '@/providers/agentTools'

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: vi.fn().mockReturnValue({
      apiKey: 'test-key', defaultLLMModel: 'test-model',
      cosSecretId: '', cosSecretKey: '', cosBucket: '', cosRegion: '',
    }),
  },
}))

function reset() {
  useFlowStore.setState({ nodes: [], edges: [], selectedNodeId: null, _history: [], _historyIndex: -1, _clipboard: null })
}

// ════════════════════════════════════════════════════════════
// 1. Agent create_video_node 支持 seedance
// ════════════════════════════════════════════════════════════
describe('Agent create_video_node — seedance support', () => {
  beforeEach(reset)

  it('creates video node with seedance model and params', async () => {
    const result = await executeToolCall('create_video_node', {
      model: 'doubao-seedance-2-0',
      prompt: 'A kitten yawning',
      duration: 8,
      size: '16:9',
      resolution: '720p',
      generate_audio: true,
      camera_fixed: false,
    })
    expect(result.success).toBe(true)
    expect(result.nodeIds).toHaveLength(1)

    const node = useFlowStore.getState().nodes.find(n => n.id === result.nodeIds![0])!
    expect(node.data.model).toBe('doubao-seedance-2-0')
    expect(node.data.size).toBe('16:9')
    expect(node.data.resolution).toBe('720p')
    expect(node.data.generate_audio).toBe(true)
    expect(node.data.duration).toBe(8)
  })

  it('creates fast version node', async () => {
    const result = await executeToolCall('create_video_node', {
      model: 'doubao-seedance-2-0-fast',
      prompt: 'City timelapse',
    })
    expect(result.success).toBe(true)
    const node = useFlowStore.getState().nodes.find(n => n.id === result.nodeIds![0])!
    expect(node.data.model).toBe('doubao-seedance-2-0-fast')
  })
})

// ════════════════════════════════════════════════════════════
// 2. AGENT_TOOLS schema includes seedance models
// ════════════════════════════════════════════════════════════
describe('AGENT_TOOLS — create_video_node model enum', () => {
  it('model enum includes seedance models', () => {
    const tool = AGENT_TOOLS.find(t => t.function.name === 'create_video_node')
    expect(tool).toBeDefined()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params = tool!.function.parameters as any
    const modelEnum = params.properties.model.enum as string[]
    expect(modelEnum).toContain('doubao-seedance-2-0')
    expect(modelEnum).toContain('doubao-seedance-2-0-fast')
  })
})
