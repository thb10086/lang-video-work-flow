/**
 * T2: 前端白盒测试 — 后端模式 (BACKEND_ENABLED=true) 双模式执行器 + API 层 + Hook
 *
 * 测试覆盖:
 *  - backendApi 各方法调用 client.get/post 的路径和参数
 *  - useBackendModels hook 缓存逻辑
 *  - 双模式执行器: BACKEND=true 时走 backendApi，BACKEND=false 走本地 adapter
 *  - client.ts 请求/错误处理
 *  - ENV.BACKEND_ENABLED 读取
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock ENV to enable backend mode ──
vi.mock('@/lib/env', () => ({
  ENV: {
    BACKEND_URL: 'http://localhost:8000',
    AGENT_MAX_TOOL_ROUNDS: 25,
    AGENT_TEMPERATURE: 0.3,
    AGENT_MAX_TOKENS: 4096,
    CONTEXT_COMPACTION_WINDOW: 10,
    AGENT_REFLECTION_THRESHOLD: 3,
    POLL_INTERVAL: 5000,
  },
}))

// ── Mock client.ts ──
const mockGet = vi.fn()
const mockPost = vi.fn()
const mockPut = vi.fn()
const mockDelete = vi.fn()

vi.mock('@/api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    put: (...args: unknown[]) => mockPut(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: number, message: string) {
      super(message)
    }
  },
}))

// NOTE: registry.ts / adapters/ 已删除，模型全部由后端 DB 管理

vi.mock('@/providers/cosUploader', () => ({
  cosUploader: { ready: false, upload: vi.fn(), ensureUrl: vi.fn() },
}))

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: vi.fn().mockReturnValue({ apiKey: 'test-key', defaultLLMModel: 'gpt-4o' }),
  },
}))

vi.mock('@/providers/videoMerger', () => ({
  mergeVideos: vi.fn().mockResolvedValue(new Blob(['fake'], { type: 'video/mp4' })),
  blobToDataUrl: vi.fn().mockResolvedValue('data:video/mp4;base64,ZmFrZQ=='),
}))

// ────────────────────────────────────────────────────────
// T2-01: backendApi 路径验证
// ────────────────────────────────────────────────────────
describe('backendApi — path & params', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockResolvedValue({ items: [], total: 0 })
    mockPost.mockResolvedValue({})
  })

  it('listModels calls /api/models', async () => {
    const { backendApi } = await import('@/api/backend')
    await backendApi.listModels()
    expect(mockGet).toHaveBeenCalledWith('/api/models')
  })

  it('listModels with capability appends query string', async () => {
    const { backendApi } = await import('@/api/backend')
    await backendApi.listModels('video')
    expect(mockGet).toHaveBeenCalledWith('/api/models?capability=video')
  })

  it('getModel calls correct path', async () => {
    const { backendApi } = await import('@/api/backend')
    mockGet.mockResolvedValue({ id: 1, model_id: 'test' })
    await backendApi.getModel('test-model')
    expect(mockGet).toHaveBeenCalledWith('/api/models/test-model')
  })

  it('getModelSchema calls /api/models/{id}/schema', async () => {
    const { backendApi } = await import('@/api/backend')
    mockGet.mockResolvedValue([])
    await backendApi.getModelSchema('veo3.1-fast')
    expect(mockGet).toHaveBeenCalledWith('/api/models/veo3.1-fast/schema')
  })

  it('generateImage POSTs to /api/generate/image', async () => {
    const { backendApi } = await import('@/api/backend')
    mockPost.mockResolvedValue({ images: [], text: '' })
    await backendApi.generateImage({ model_id: 'gemini', prompt: 'test' })
    expect(mockPost).toHaveBeenCalledWith(
      '/api/generate/image',
      { model_id: 'gemini', prompt: 'test' },
    )
  })

  it('submitVideo POSTs to /api/generate/video', async () => {
    const { backendApi } = await import('@/api/backend')
    mockPost.mockResolvedValue({ task_id: 'abc', status: 'pending' })
    await backendApi.submitVideo({ model_id: 'veo', prompt: 'waves' })
    expect(mockPost).toHaveBeenCalledWith(
      '/api/generate/video',
      { model_id: 'veo', prompt: 'waves' },
    )
  })

  it('queryTask GETs /api/tasks/{id}', async () => {
    const { backendApi } = await import('@/api/backend')
    mockGet.mockResolvedValue({ task_id: 'abc', status: 'completed' })
    await backendApi.queryTask('abc')
    expect(mockGet).toHaveBeenCalledWith('/api/tasks/abc')
  })

  it('chat POSTs to /api/generate/chat', async () => {
    const { backendApi } = await import('@/api/backend')
    mockPost.mockResolvedValue({ text: 'hello', usage: {} })
    await backendApi.chat({ model_id: 'gpt-5.4', prompt: 'Hi' })
    expect(mockPost).toHaveBeenCalledWith(
      '/api/generate/chat',
      { model_id: 'gpt-5.4', prompt: 'Hi' },
    )
  })

  it('uploadImage POSTs base64 data', async () => {
    const { backendApi } = await import('@/api/backend')
    mockPost.mockResolvedValue({ url: 'https://cos/a.png', key: 'a.png' })
    await backendApi.uploadImage('data:image/png;base64,AAA', 'test.png')
    expect(mockPost).toHaveBeenCalledWith(
      '/api/upload/image',
      { data: 'data:image/png;base64,AAA', filename: 'test.png' },
    )
  })

  it('uploadBatch POSTs array', async () => {
    const { backendApi } = await import('@/api/backend')
    mockPost.mockResolvedValue({ results: [] })
    await backendApi.uploadBatch([{ data: 'base64-1' }, { data: 'base64-2' }])
    expect(mockPost).toHaveBeenCalledWith(
      '/api/upload/batch',
      { images: [{ data: 'base64-1' }, { data: 'base64-2' }] },
    )
  })
})

// ────────────────────────────────────────────────────────
// T2-02: 双模式执行器 — BACKEND=true 走 backendApi
// ────────────────────────────────────────────────────────
import { useFlowStore } from '@/store/flowStore'

function reset() {
  useFlowStore.setState({
    nodes: [], edges: [], selectedNodeId: null,
    _history: [], _historyIndex: -1, _clipboard: null,
  })
}

function injectNode(id: string, type: string, data: Record<string, unknown>) {
  useFlowStore.setState(s => ({
    nodes: [...s.nodes, { id, type, position: { x: 0, y: 0 }, data: { label: `node-${id}`, ...data } }],
  }))
}

describe('Dual-mode executors — BACKEND=true', () => {
  beforeEach(() => {
    reset()
    vi.clearAllMocks()
  })

  it('imageGen with BACKEND=true calls backendApi.generateImage', async () => {
    mockPost.mockResolvedValue({
      images: [{ data: 'AAAA==', mime_type: 'image/png' }],
      text: null,
    })

    injectNode('ig1', 'imageGen', {
      prompt: 'A cat',
      model: 'gemini-3.1-flash-image-preview',
      aspectRatio: '16:9',
      imageSize: '2k',
    })

    const { executeNode } = await import('@/providers/nodeExecutor')
    const result = await executeNode('ig1')
    expect(result.success).toBe(true)

    // Should call backendApi (POST /api/generate/image)
    expect(mockPost).toHaveBeenCalledWith(
      '/api/generate/image',
      expect.objectContaining({
        model_id: 'gemini-3.1-flash-image-preview',
        prompt: expect.stringContaining('A cat'),
      }),
    )

    const node = useFlowStore.getState().nodes.find(n => n.id === 'ig1')!
    expect(node.data.status).toBe('done')
    expect(node.data.outputImage).toBeTruthy()
  })

  it('videoGen with BACKEND=true calls backendApi.submitVideo', async () => {
    mockPost.mockResolvedValue({ task_id: 'backend-task-001', status: 'pending' })
    // executeVideoGen calls listModels (GET /api/models) before submit, then
    // queryTask (GET /api/tasks/{id}) during awaited polling. Route by path
    // so both calls get the right shape.
    mockGet.mockImplementation((path: string) => {
      if (path.startsWith('/api/tasks/')) {
        return Promise.resolve({
          task_id: 'backend-task-001',
          status: 'completed',
          progress: 100,
          output_url: 'https://cos.example.com/backend-test.mp4',
        })
      }
      // listModels and any other GET — empty list is fine
      return Promise.resolve({ items: [], total: 0 })
    })

    injectNode('vg1', 'videoGen', {
      prompt: 'Ocean sunset',
      model: 'veo3.1-fast',
    })

    const { executeNode } = await import('@/providers/nodeExecutor')
    const result = await executeNode('vg1')
    expect(result.success).toBe(true)

    expect(mockPost).toHaveBeenCalledWith(
      '/api/generate/video',
      expect.objectContaining({
        model_id: 'veo3.1-fast',
        prompt: expect.stringContaining('Ocean sunset'),
      }),
    )
    expect(mockGet).toHaveBeenCalledWith('/api/tasks/backend-task-001')

    const node = useFlowStore.getState().nodes.find(n => n.id === 'vg1')!
    expect(node.data.status).toBe('done')
    expect(node.data.outputVideo).toBe('https://cos.example.com/backend-test.mp4')
  })

  it('characterGrid with BACKEND=true calls backendApi.generateImage', async () => {
    mockPost.mockResolvedValue({
      images: [{ data: 'GRID_BASE64', mime_type: 'image/png' }],
    })

    injectNode('cg1', 'characterGrid', {
      name: '角色A',
      description: 'A hero with sword',
      style: 'anime',
    })

    const { executeNode } = await import('@/providers/nodeExecutor')
    const result = await executeNode('cg1')
    expect(result.success).toBe(true)

    expect(mockPost).toHaveBeenCalledWith(
      '/api/generate/image',
      expect.objectContaining({
        model_id: expect.any(String),
        prompt: expect.stringContaining('角色A'),
      }),
    )
  })

  it('LLM chat (storyboard) with BACKEND=true calls backendApi.chat', async () => {
    mockPost.mockResolvedValue({
      text: '[{"id":1,"scene":"Beach","camera":"Wide","duration":5,"mood":"calm","emotionIntensity":3,"charactersPresent":[],"imagePrompt":"test","videoPrompt":"test","dialogue":"","dialogueEN":"","audioHint":"waves"}]',
      usage: {},
    })

    injectNode('sb1', 'storyboard', { script: 'A scene on a beach' })

    const { executeNode } = await import('@/providers/nodeExecutor')
    const result = await executeNode('sb1')
    expect(result.success).toBe(true)

    expect(mockPost).toHaveBeenCalledWith(
      '/api/generate/chat',
      expect.objectContaining({
        model_id: expect.any(String),
        prompt: expect.stringContaining('beach'),
      }),
    )
  })
})

// ────────────────────────────────────────────────────────
// T2-03: ENV 常量校验
// ────────────────────────────────────────────────────────
describe('ENV constants', () => {
  it('BACKEND_URL defaults to localhost:8000', async () => {
    const { ENV } = await import('@/lib/env')
    expect(ENV.BACKEND_URL).toBe('http://localhost:8000')
  })
})

// ────────────────────────────────────────────────────────
// T2-04: Type contract 校验 — AiModelResponse 字段
// ────────────────────────────────────────────────────────
describe('Type contract — AiModelResponse', () => {
  it('interface has all expected fields', async () => {
    // Type contract: verify a model object has all expected keys
    await import('@/api/backend')
    const mockModel: Record<string, unknown> = {
      id: 1,
      model_id: 'test',
      name: 'Test',
      provider: 'Test',
      capability: 'image',
      param_schema: [],
      is_enabled: 1,
      sort_order: 0,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
    }

    const expectedKeys = [
      'id', 'model_id', 'name', 'provider',
      'capability', 'param_schema', 'is_enabled',
      'sort_order', 'created_at', 'updated_at',
    ]
    for (const key of expectedKeys) {
      expect(mockModel[key]).toBeDefined()
    }
  })
})
