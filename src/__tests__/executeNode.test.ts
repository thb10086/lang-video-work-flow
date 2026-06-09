/**
 * executeNode dispatch 集成测试
 *
 * 覆盖：
 *  - 未知节点类型返回 failure
 *  - textNode 无需执行直接返回 success
 *  - 节点 ID 不存在返回 failure
 *  - characterGrid / imageGen / videoGen 等执行时调用正确 adapter（mock）
 *  - 前置 prompt 缺失时返回 failure（不调用 API）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Simplified ENV mock — backend always enabled
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

// ── mock backendApi (executors now use this) ──
const mockGenerateImage = vi.fn().mockResolvedValue({
  images: [{ data: 'AAAA==', mime_type: 'image/png' }],
})
const mockSubmitVideo = vi.fn().mockResolvedValue({ task_id: 'mock-task-123', status: 'pending' })
const mockChat = vi.fn().mockResolvedValue({ text: '{}' })
const mockUploadImage = vi.fn().mockResolvedValue({ url: 'https://cdn.test/img.png', key: 'img.png' })
// Default to "completed" so executeVideoGen tests do not hang on the new
// awaited-polling behavior. Tests that want to exercise pending/failed/timeout
// override per-call via mockResolvedValueOnce.
const mockQueryTask = vi.fn().mockResolvedValue({
  task_id: 'mock-task-123',
  status: 'completed',
  progress: 100,
  output_url: 'https://cos.example.com/mock-video.mp4',
})

vi.mock('@/api/backend', () => ({
  backendApi: {
    generateImage: (...args: unknown[]) => mockGenerateImage(...args),
    submitVideo: (...args: unknown[]) => mockSubmitVideo(...args),
    chat: (...args: unknown[]) => mockChat(...args),
    uploadImage: (...args: unknown[]) => mockUploadImage(...args),
    queryTask: (...args: unknown[]) => mockQueryTask(...args),
  },
}))

import { useFlowStore } from '@/store/flowStore'
import { useSettingsStore } from '@/store/settingsStore'
import { executeNode } from '@/providers/nodeExecutor'

// ── store 重置 ──
function reset() {
  useFlowStore.setState({ nodes: [], edges: [], selectedNodeId: null, _history: [], _historyIndex: -1, _clipboard: null })
}

// ── 直接注入节点 ──
function injectNode(id: string, type: string, data: Record<string, unknown>) {
  useFlowStore.setState(s => ({
    nodes: [...s.nodes, { id, type, position: { x: 0, y: 0 }, data: { label: `node-${id}`, ...data } }],
  }))
}

// NOTE: registry.ts / adapters/ 已删除，模型全部由后端 DB 管理

// ── mock cosUploader ──
vi.mock('@/providers/cosUploader', () => ({
  cosUploader: {
    ready: false,
    upload: vi.fn(),
    ensureUrl: vi.fn(),
  },
}))

// ── mock settingsStore ──
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: vi.fn().mockReturnValue({ apiKey: 'test-key', defaultLLMModel: 'gpt-4o' }),
  },
}))

// ── mock videoMerger (dynamic import) ──
vi.mock('@/providers/videoMerger', () => ({
  mergeVideos: vi.fn().mockResolvedValue(new Blob(['fake-video'], { type: 'video/mp4' })),
  blobToDataUrl: vi.fn().mockResolvedValue('data:video/mp4;base64,ZmFrZQ=='),
}))

// ────────────────────────────────────────────────────────────
describe('executeNode — 基础路由', () => {
  beforeEach(reset)

  it('returns failure for unknown node ID', async () => {
    const result = await executeNode('nonexistent-id')
    expect(result.success).toBe(false)
    expect(result.message).toContain('nonexistent-id')
  })

  it('returns success for textNode without calling any API', async () => {
    injectNode('t1', 'textNode', { content: 'hello' })
    const result = await executeNode('t1')
    expect(result.success).toBe(true)
    expect(result.message).toContain('文本节点')
  })

  it('returns failure for unsupported node type', async () => {
    injectNode('x1', 'unknownType', {})
    const result = await executeNode('x1')
    expect(result.success).toBe(false)
    expect(result.message).toContain('unknownType')
  })
})

// ────────────────────────────────────────────────────────────
describe('executeNode — imageGen', () => {
  beforeEach(reset)

  it('returns failure when prompt is empty', async () => {
    injectNode('g1', 'imageGen', { prompt: '' })
    const result = await executeNode('g1')
    expect(result.success).toBe(false)
    expect(result.message).toContain('prompt')
  })

  it('calls adapter.generate and sets status=done on success', async () => {
    injectNode('g1', 'imageGen', {
      prompt: 'A beautiful sunset',
      model: 'gemini-3.1-flash-image-preview',
      aspectRatio: '16:9',
      imageSize: '2k',
    })
    const result = await executeNode('g1')
    expect(result.success).toBe(true)
    const node = useFlowStore.getState().nodes.find(n => n.id === 'g1')!
    expect(node.data.status).toBe('done')
    expect(typeof node.data.outputImage).toBe('string')
  })

  it('sets status=done after successful generation', async () => {
    injectNode('g2', 'imageGen', { prompt: 'test', model: 'gemini-3.1-flash-image-preview' })
    await executeNode('g2')
    const node = useFlowStore.getState().nodes.find(n => n.id === 'g2')!
    expect(node.data.status).toBe('done')
    expect(typeof node.data.outputImage).toBe('string')
  })
})

// ────────────────────────────────────────────────────────────
describe('executeNode — videoGen', () => {
  beforeEach(reset)

  it('returns failure when prompt is empty', async () => {
    injectNode('v1', 'videoGen', { prompt: '' })
    const result = await executeNode('v1')
    expect(result.success).toBe(false)
    expect(result.message).toContain('prompt')
  })

  it('submits task and AWAITS polling completion (no fire-and-forget)', async () => {
    // Default mock returns 'completed' → polling should resolve fast
    injectNode('v1', 'videoGen', {
      prompt: 'Ocean waves at sunset',
      model: 'veo3.1-fast',
    })
    const result = await executeNode('v1')
    expect(result.success).toBe(true)

    // CRITICAL: when executeNode returns, node MUST already be `done` with
    // the actual video URL — proves we awaited the polling result instead
    // of returning success immediately after submission.
    const node = useFlowStore.getState().nodes.find(n => n.id === 'v1')!
    expect(node.data.status).toBe('done')
    expect(node.data.outputVideo).toBe('https://cos.example.com/mock-video.mp4')
  })

  // ── P0-1 RED: fire-and-forget regression ──
  it('GAP-VIDEO-1: does NOT return success until backend task completes', async () => {
    // Sequence: 2× processing, then completed. executeNode must poll until completion.
    mockQueryTask.mockReset()
    mockQueryTask
      .mockResolvedValueOnce({ task_id: 't1', status: 'processing', progress: 20 })
      .mockResolvedValueOnce({ task_id: 't1', status: 'processing', progress: 60 })
      .mockResolvedValueOnce({ task_id: 't1', status: 'completed', progress: 100, output_url: 'https://cos/v1.mp4' })

    mockSubmitVideo.mockResolvedValueOnce({ task_id: 't1', status: 'pending' })

    injectNode('v1', 'videoGen', { prompt: 'shot 1', model: 'veo3.1-fast' })
    const result = await executeNode('v1')
    expect(result.success).toBe(true)
    expect(mockQueryTask).toHaveBeenCalledTimes(3)

    const node = useFlowStore.getState().nodes.find(n => n.id === 'v1')!
    expect(node.data.status).toBe('done')
    expect(node.data.outputVideo).toBe('https://cos/v1.mp4')
  })

  // ── P0-1 RED: each videoGen submits EXACTLY ONCE (no duplicate paid calls) ──
  it('GAP-VIDEO-2: parallel videoGens submit exactly once each — NO duplicate API calls', async () => {
    mockSubmitVideo.mockReset()
    mockQueryTask.mockReset()

    let submitCount = 0
    mockSubmitVideo.mockImplementation(() => {
      submitCount += 1
      return Promise.resolve({ task_id: `task-par-${submitCount}`, status: 'pending' })
    })
    mockQueryTask.mockImplementation((taskId: string) =>
      Promise.resolve({
        task_id: taskId, status: 'completed', progress: 100,
        output_url: `https://cos/${taskId}.mp4`,
      }),
    )

    injectNode('v1', 'videoGen', { prompt: 'shot 1', model: 'veo3.1-fast' })
    injectNode('v2', 'videoGen', { prompt: 'shot 2', model: 'veo3.1-fast' })
    injectNode('v3', 'videoGen', { prompt: 'shot 3', model: 'veo3.1-fast' })

    const results = await Promise.all([executeNode('v1'), executeNode('v2'), executeNode('v3')])
    expect(results.every(r => r.success)).toBe(true)
    expect(submitCount, 'each videoGen must submit exactly once').toBe(3)

    const v1 = useFlowStore.getState().nodes.find(n => n.id === 'v1')!
    expect(v1.data.outputVideo).toBe('https://cos/task-par-1.mp4')
  })

  // ── P0-2 RED: polling timeout must mark node as `error`, not stuck `generating` ──
  it('GAP-VIDEO-3: polling timeout marks node as error (NOT stuck generating)', async () => {
    mockSubmitVideo.mockResolvedValueOnce({ task_id: 'task-stuck', status: 'pending' })
    // queryTask always returns 'processing' — never completes
    mockQueryTask.mockReset()
    mockQueryTask.mockResolvedValue({ task_id: 'task-stuck', status: 'processing', progress: 50 })

    injectNode('vstuck', 'videoGen', { prompt: 'never completes', model: 'veo3.1-fast' })
    const result = await executeNode('vstuck')

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/超时|timeout/i)

    const node = useFlowStore.getState().nodes.find(n => n.id === 'vstuck')!
    expect(node.data.status, 'on timeout, status must transition to error, not remain generating').toBe('error')
    expect(node.data.errorMsg).toMatch(/超时|timeout/i)
  })

  // ── P0-1 RED: failed task surfaces failure to caller ──
  it('GAP-VIDEO-4: failed task returns success=false and surfaces error', async () => {
    mockSubmitVideo.mockResolvedValueOnce({ task_id: 'task-fail', status: 'pending' })
    mockQueryTask.mockReset()
    mockQueryTask.mockResolvedValueOnce({ task_id: 'task-fail', status: 'failed', error: 'GPU OOM' })

    injectNode('vfail', 'videoGen', { prompt: 'will fail', model: 'veo3.1-fast' })
    const result = await executeNode('vfail')

    expect(result.success).toBe(false)
    expect(result.message).toContain('GPU OOM')

    const node = useFlowStore.getState().nodes.find(n => n.id === 'vfail')!
    expect(node.data.status).toBe('error')
  })
})

// ────────────────────────────────────────────────────────────
describe('executeNode — storyboard', () => {
  beforeEach(reset)

  it('returns failure when script is empty', async () => {
    injectNode('sb1', 'storyboard', { script: '' })
    const result = await executeNode('sb1')
    expect(result.success).toBe(false)
    expect(result.message).toContain('剧本')
  })

  it('parses JSON shots from LLM response', async () => {
    mockChat.mockResolvedValueOnce({
      text: 'Here are the shots: [{"id":1,"scene":"EXT Ocean Beach - Sunset","camera":"Wide shot, slow dolly forward","duration":5,"mood":"peaceful","emotionIntensity":3,"charactersPresent":["Man"],"imagePrompt":"A man walking barefoot on golden sand beach at sunset, warm amber light, gentle waves, cinematic 8K, wide shot","videoPrompt":"[Camera]: Slow dolly forward. [Subject]: A man walking barefoot along shoreline. [Environment]: Golden sunset beach, warm light. [Quality]: Cinematic 4K. [Negative]: No morphing.","dialogue":"","dialogueEN":"","audioHint":"ocean waves, soft ambient music"}]',
    })

    injectNode('sb1', 'storyboard', { script: 'A man walks on a beach' })
    const result = await executeNode('sb1')
    expect(result.success).toBe(true)
    expect(result.message).toContain('1 个镜头')
    const node = useFlowStore.getState().nodes.find(n => n.id === 'sb1')!
    expect(Array.isArray(node.data.shots)).toBe(true)
    expect((node.data.shots as unknown[]).length).toBe(1)
  })
})

// ────────────────────────────────────────────────────────────
describe('executeNode — styleLock', () => {
  beforeEach(reset)

  it('returns failure when no style description and no reference image', async () => {
    injectNode('sl1', 'styleLock', { styleDescription: '' })
    const result = await executeNode('sl1')
    expect(result.success).toBe(false)
  })

  it('uses styleDescription directly when no reference image', async () => {
    injectNode('sl1', 'styleLock', { styleDescription: 'cinematic, moody' })
    const result = await executeNode('sl1')
    expect(result.success).toBe(true)
    const node = useFlowStore.getState().nodes.find(n => n.id === 'sl1')!
    expect(node.data.extractedStyle).toBe('cinematic, moody')
    expect(node.data.status).toBe('done')
  })
})

// ────────────────────────────────────────────────────────────
describe('executeNode — characterGrid', () => {
  beforeEach(reset)

  it('calls adapter and sets outputImage on success', async () => {
    injectNode('cg1', 'characterGrid', {
      name: '张三',
      description: 'A hero',
      style: 'anime',
    })
    const result = await executeNode('cg1')
    expect(result.success).toBe(true)
    const node = useFlowStore.getState().nodes.find(n => n.id === 'cg1')!
    expect(node.data.status).toBe('done')
    expect(String(node.data.outputImage)).toContain('data:image/png')
  })
})

// ────────────────────────────────────────────────────────────
describe('executeNode — continuityCheck', () => {
  beforeEach(reset)

  it('returns failure when no images provided', async () => {
    injectNode('cc1', 'continuityCheck', {})
    const result = await executeNode('cc1')
    expect(result.success).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
describe('executeNode — audioNode', () => {
  beforeEach(reset)

  it('returns failure when text is empty', async () => {
    injectNode('a1', 'audioNode', { text: '' })
    const result = await executeNode('a1')
    expect(result.success).toBe(false)
    expect(result.message).toContain('文本')
  })

  it('returns success (pending) when text provided (TTS not yet implemented)', async () => {
    injectNode('a1', 'audioNode', { text: '配音内容' })
    const result = await executeNode('a1')
    expect(result.success).toBe(true)
    const node = useFlowStore.getState().nodes.find(n => n.id === 'a1')!
    expect(node.data.status).toBe('pending')
  })
})

// ────────────────────────────────────────────────────────────
describe('executeNode — characterExtract', () => {
  beforeEach(reset)

  it('returns failure when no video URL and no task id', async () => {
    injectNode('ext1', 'characterExtract', {})
    const result = await executeNode('ext1')
    expect(result.success).toBe(false)
    expect(result.message).toContain('视频输入')
  })

  it('calls /api/character/extract and surfaces URL + id on success', async () => {
    // Mock the raw api client's post method
    const apiModule = await import('@/api/client')
    const postSpy = vi
      .spyOn(apiModule.api, 'post')
      .mockResolvedValueOnce({ id: 'char_abc', url: 'https://cos/char.png' })

    injectNode('ext1', 'characterExtract', {
      videoUrl: 'https://cos/video.mp4',
      timestamps: '1,3',
    })
    const result = await executeNode('ext1')
    expect(result.success).toBe(true)
    expect(postSpy).toHaveBeenCalledWith('/api/character/extract', expect.objectContaining({
      video_url: 'https://cos/video.mp4',
      timestamps: '1,3',
    }))

    const node = useFlowStore.getState().nodes.find(n => n.id === 'ext1')!
    expect(node.data.status).toBe('done')
    expect(node.data.characterId).toBe('char_abc')
    expect(node.data.characterUrl).toBe('https://cos/char.png')

    postSpy.mockRestore()
  })
})

// ────────────────────────────────────────────────────────────
describe('executeNode — characterManager (passive registry)', () => {
  beforeEach(reset)

  it('returns success without calling any API', async () => {
    injectNode('mgr1', 'characterManager', { characters: [] })
    const result = await executeNode('mgr1')
    expect(result.success).toBe(true)
    expect(result.message).toContain('注册节点')
  })
})
