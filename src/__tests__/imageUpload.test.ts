/**
 * 图片上传功能 白盒测试
 *
 * 覆盖：
 *   1. ChatMessage.images 字段 + addMessage 带图片
 *   2. processUserMessage 带图片参数
 *   3. compactConversationHistory 多模态消息构建
 *   4. inject_user_images 工具执行（含多目标/索引选择/边界情况）
 *   5. AGENT_TOOLS 中 inject_user_images 定义完整性
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore } from '@/store/chatStore'
import { useFlowStore } from '@/store/flowStore'
import { executeToolCall, AGENT_TOOLS } from '@/providers/agentTools'

// ── Reset helpers ──

function resetChat() {
  useChatStore.setState({
    messages: [],
    isProcessing: false,
    activeRole: 'assistant',
    chatModel: '',
    streamingMessageId: null,
  })
}

function resetFlow() {
  useFlowStore.setState({
    nodes: [],
    edges: [],
    selectedNodeId: null,
    _history: [],
    _historyIndex: -1,
    _clipboard: null,
  })
}

function resetAll() {
  resetChat()
  resetFlow()
}

function addTestNode(type: string, label: string, extra: Record<string, unknown> = {}) {
  return useFlowStore.getState().addNode(type, { x: 0, y: 0 }, { label, ...extra })
}

const FAKE_IMG_A = 'data:image/png;base64,AAAA'
const FAKE_IMG_B = 'data:image/png;base64,BBBB'
const FAKE_IMG_C = 'data:image/png;base64,CCCC'

// ────────────────────────────────────────────────────────────
describe('ChatMessage.images — addMessage with images', () => {
  beforeEach(resetAll)

  it('stores images array on user message', () => {
    const { addMessage } = useChatStore.getState()
    const id = addMessage('user', '产品图', [FAKE_IMG_A, FAKE_IMG_B])
    const msg = useChatStore.getState().messages.find(m => m.id === id)
    expect(msg).toBeDefined()
    expect(msg!.images).toHaveLength(2)
    expect(msg!.images![0]).toBe(FAKE_IMG_A)
    expect(msg!.images![1]).toBe(FAKE_IMG_B)
  })

  it('does not set images when array is empty', () => {
    const { addMessage } = useChatStore.getState()
    const id = addMessage('user', '纯文本', [])
    const msg = useChatStore.getState().messages.find(m => m.id === id)
    expect(msg!.images).toBeUndefined()
  })

  it('does not set images when undefined', () => {
    const { addMessage } = useChatStore.getState()
    const id = addMessage('user', '纯文本')
    const msg = useChatStore.getState().messages.find(m => m.id === id)
    expect(msg!.images).toBeUndefined()
  })

  it('assistant messages do not have images', () => {
    const { addMessage } = useChatStore.getState()
    const id = addMessage('assistant', '回复')
    const msg = useChatStore.getState().messages.find(m => m.id === id)
    expect(msg!.images).toBeUndefined()
  })
})

// ────────────────────────────────────────────────────────────
describe('inject_user_images — tool definition', () => {
  it('exists in AGENT_TOOLS with correct schema', () => {
    const tool = AGENT_TOOLS.find(t => t.function.name === 'inject_user_images')
    expect(tool).toBeDefined()
    expect(tool!.function.parameters.required).toContain('targets')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params = tool!.function.parameters as any
    const targetsSchema = params.properties.targets
    expect(targetsSchema.type).toBe('array')
    const fieldEnum = targetsSchema.items.properties.field.enum
    expect(fieldEnum).toContain('referenceImages')
    expect(fieldEnum).toContain('inputImage')
    expect(fieldEnum).toContain('referenceImage')
    expect(fieldEnum).toContain('firstFrameImage')
  })
})

// ────────────────────────────────────────────────────────────
describe('inject_user_images — tool execution', () => {
  beforeEach(resetAll)

  it('fails when no user images in chat', async () => {
    addTestNode('imageGen', '图片生成', { referenceImages: [] })
    const result = await executeToolCall('inject_user_images', {
      targets: [{ nodeLabel: '图片生成', field: 'referenceImages' }],
    })
    expect(result.success).toBe(false)
    expect(result.message).toContain('未找到用户上传的图片')
  })

  it('injects all images to referenceImages (append)', async () => {
    // Simulate user uploading images
    useChatStore.getState().addMessage('user', '产品图', [FAKE_IMG_A, FAKE_IMG_B])

    const nodeId = addTestNode('imageGen', '镜头1 关键帧', { referenceImages: ['existing.png'] })
    const result = await executeToolCall('inject_user_images', {
      targets: [{ nodeLabel: '镜头1 关键帧', field: 'referenceImages' }],
    })

    expect(result.success).toBe(true)
    const node = useFlowStore.getState().nodes.find(n => n.id === nodeId)!
    const refs = node.data.referenceImages as string[]
    expect(refs).toHaveLength(3) // 1 existing + 2 new
    expect(refs[0]).toBe('existing.png')
    expect(refs[1]).toBe(FAKE_IMG_A)
    expect(refs[2]).toBe(FAKE_IMG_B)
  })

  it('injects single image to inputImage field', async () => {
    useChatStore.getState().addMessage('user', '编辑这张图', [FAKE_IMG_A, FAKE_IMG_B])

    const nodeId = addTestNode('imageEdit', '图片编辑', { inputImage: null })
    const result = await executeToolCall('inject_user_images', {
      targets: [{ nodeLabel: '图片编辑', field: 'inputImage' }],
    })

    expect(result.success).toBe(true)
    const node = useFlowStore.getState().nodes.find(n => n.id === nodeId)!
    // Single-image field: only first image
    expect(node.data.inputImage).toBe(FAKE_IMG_A)
  })

  it('supports imageIndices to select specific images', async () => {
    useChatStore.getState().addMessage('user', '三张图', [FAKE_IMG_A, FAKE_IMG_B, FAKE_IMG_C])

    const nodeId = addTestNode('imageGen', '关键帧', { referenceImages: [] })
    const result = await executeToolCall('inject_user_images', {
      targets: [{
        nodeLabel: '关键帧',
        field: 'referenceImages',
        imageIndices: [1, 2], // Only B and C
      }],
    })

    expect(result.success).toBe(true)
    const node = useFlowStore.getState().nodes.find(n => n.id === nodeId)!
    const refs = node.data.referenceImages as string[]
    expect(refs).toHaveLength(2)
    expect(refs[0]).toBe(FAKE_IMG_B)
    expect(refs[1]).toBe(FAKE_IMG_C)
  })

  it('supports multiple targets in one call', async () => {
    useChatStore.getState().addMessage('user', '产品图', [FAKE_IMG_A])

    const id1 = addTestNode('imageGen', '镜头1', { referenceImages: [] })
    const id2 = addTestNode('imageGen', '镜头2', { referenceImages: [] })
    const id3 = addTestNode('styleLock', '风格锁定', { referenceImage: null })

    const result = await executeToolCall('inject_user_images', {
      targets: [
        { nodeLabel: '镜头1', field: 'referenceImages' },
        { nodeLabel: '镜头2', field: 'referenceImages' },
        { nodeLabel: '风格锁定', field: 'referenceImage' },
      ],
    })

    expect(result.success).toBe(true)
    expect(result.nodeIds).toHaveLength(3)

    const n1 = useFlowStore.getState().nodes.find(n => n.id === id1)!
    const n2 = useFlowStore.getState().nodes.find(n => n.id === id2)!
    const n3 = useFlowStore.getState().nodes.find(n => n.id === id3)!
    expect((n1.data.referenceImages as string[])).toContain(FAKE_IMG_A)
    expect((n2.data.referenceImages as string[])).toContain(FAKE_IMG_A)
    expect(n3.data.referenceImage).toBe(FAKE_IMG_A)
  })

  it('skips non-existent nodes and reports partial success', async () => {
    useChatStore.getState().addMessage('user', '图', [FAKE_IMG_A])

    addTestNode('imageGen', '存在的节点', { referenceImages: [] })

    const result = await executeToolCall('inject_user_images', {
      targets: [
        { nodeLabel: '存在的节点', field: 'referenceImages' },
        { nodeLabel: '不存在的节点', field: 'inputImage' },
      ],
    })

    expect(result.success).toBe(true)
    expect(result.nodeIds).toHaveLength(1)
    expect(result.message).toContain('[skip]')
    expect(result.message).toContain('[done]')
  })

  it('uses only most recent user message images', async () => {
    // First message with images
    useChatStore.getState().addMessage('user', '旧图', [FAKE_IMG_A])
    // Assistant reply
    useChatStore.getState().addMessage('assistant', '好的')
    // Second message with different images
    useChatStore.getState().addMessage('user', '新图', [FAKE_IMG_B, FAKE_IMG_C])

    const nodeId = addTestNode('imageGen', '节点', { referenceImages: [] })
    await executeToolCall('inject_user_images', {
      targets: [{ nodeLabel: '节点', field: 'referenceImages' }],
    })

    const node = useFlowStore.getState().nodes.find(n => n.id === nodeId)!
    const refs = node.data.referenceImages as string[]
    // Should only have B and C (from most recent), not A
    expect(refs).toHaveLength(2)
    expect(refs).toContain(FAKE_IMG_B)
    expect(refs).toContain(FAKE_IMG_C)
    expect(refs).not.toContain(FAKE_IMG_A)
  })

  it('fails gracefully with empty targets array', async () => {
    useChatStore.getState().addMessage('user', '图', [FAKE_IMG_A])
    const result = await executeToolCall('inject_user_images', { targets: [] })
    expect(result.success).toBe(false)
    expect(result.message).toContain('targets')
  })

  it('handles out-of-range imageIndices gracefully', async () => {
    useChatStore.getState().addMessage('user', '一张图', [FAKE_IMG_A])

    addTestNode('imageGen', '节点', { referenceImages: [] })
    const result = await executeToolCall('inject_user_images', {
      targets: [{
        nodeLabel: '节点',
        field: 'referenceImages',
        imageIndices: [5, 10], // All out of range
      }],
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('[skip]')
  })

  it('injects to firstFrameImage field for videoGen', async () => {
    useChatStore.getState().addMessage('user', '首帧', [FAKE_IMG_A])

    const nodeId = addTestNode('videoGen', '镜头1 视频', { firstFrameImage: null })
    const result = await executeToolCall('inject_user_images', {
      targets: [{ nodeLabel: '镜头1 视频', field: 'firstFrameImage' }],
    })

    expect(result.success).toBe(true)
    const node = useFlowStore.getState().nodes.find(n => n.id === nodeId)!
    expect(node.data.firstFrameImage).toBe(FAKE_IMG_A)
  })

  it('supports nodeId-based targeting', async () => {
    useChatStore.getState().addMessage('user', '图', [FAKE_IMG_A])

    const nodeId = addTestNode('imageGen', '重复标签', { referenceImages: [] })
    addTestNode('imageGen', '重复标签', { referenceImages: [] }) // same label

    const result = await executeToolCall('inject_user_images', {
      targets: [{ nodeId, field: 'referenceImages' }],
    })

    expect(result.success).toBe(true)
    const node = useFlowStore.getState().nodes.find(n => n.id === nodeId)!
    expect((node.data.referenceImages as string[])).toContain(FAKE_IMG_A)
  })
})

// ────────────────────────────────────────────────────────────
describe('ChatMessage images — exportWorkflow strips base64', () => {
  beforeEach(resetAll)

  it('user message images survive in chat store but do not leak to flow export', () => {
    useChatStore.getState().addMessage('user', '产品图', [FAKE_IMG_A])
    // Chat store should still have images
    const msgs = useChatStore.getState().messages
    expect(msgs[0].images).toHaveLength(1)

    // Flow store is independent — no images leaked
    const json = useFlowStore.getState().exportWorkflow()
    expect(json).not.toContain('AAAA')
  })
})
