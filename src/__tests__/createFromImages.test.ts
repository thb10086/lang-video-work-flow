/**
 * createFromImages.test.ts — create_from_images 工具 + imageClassifier 测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useFlowStore } from '@/store/flowStore'
import { useChatStore } from '@/store/chatStore'
import { executeToolCall } from '@/providers/agentTools'
import { classifyImageHeuristic, _classifierAdapter } from '@/providers/imageClassifier'
import { isLegacyCharacterNode } from './_helpers/characterAssetTestHelpers'

function reset() {
  useFlowStore.setState({ nodes: [], edges: [], selectedNodeId: null, _history: [], _historyIndex: -1, _clipboard: null })
}

// ────────────────────────────────────────────────────────────
describe('classifyImageHeuristic', () => {
  it('style_lock intent → style kind', () => {
    const result = classifyImageHeuristic('data:image/png;base64,abc', { intent: 'style_lock' })
    expect(result.kind).toBe('style')
    expect(result.confidence).toBeGreaterThanOrEqual(0.8)
  })

  it('character_refs intent → character kind', () => {
    const result = classifyImageHeuristic('data:image/png;base64,abc', { intent: 'character_refs' })
    expect(result.kind).toBe('character')
    expect(result.confidence).toBeGreaterThanOrEqual(0.8)
  })

  it('scene_refs intent → scene kind', () => {
    const result = classifyImageHeuristic('data:image/png;base64,abc', { intent: 'scene_refs' })
    expect(result.kind).toBe('scene')
    expect(result.confidence).toBeGreaterThanOrEqual(0.8)
  })

  it('edit intent → edit_input kind', () => {
    const result = classifyImageHeuristic('data:image/png;base64,abc', { intent: 'edit' })
    expect(result.kind).toBe('edit_input')
    expect(result.confidence).toBeGreaterThanOrEqual(0.8)
  })

  it('no intent + large image → scene', () => {
    // Need payload whose estimated bytes > 1.5MB: len * 0.75 > 1.5M → len > 2M
    const bigPayload = 'x'.repeat(2_100_000)
    const result = classifyImageHeuristic(`data:image/png;base64,${bigPayload}`)
    expect(result.kind).toBe('scene')
  })

  it('no intent + mid-size image → character (default)', () => {
    // Need payload whose estimated bytes in 0.3–1.5MB range: len * 0.75 >= 0.3M → len >= 400K
    const midPayload = 'x'.repeat(500_000)
    const result = classifyImageHeuristic(`data:image/png;base64,${midPayload}`)
    expect(result.kind).toBe('character')
    expect(result.confidence).toBeLessThan(0.8)
  })

  it('no intent + tiny image → edit_input fallback', () => {
    const result = classifyImageHeuristic('data:image/png;base64,small')
    expect(result.kind).toBe('edit_input')
    expect(result.confidence).toBeLessThan(0.5)
  })

  it('hintText with "角色" → character', () => {
    const result = classifyImageHeuristic('data:image/png;base64,abc', { hintText: '这是主角的角色设定图' })
    expect(result.kind).toBe('character')
  })

  it('hintText with "风格" → style', () => {
    const result = classifyImageHeuristic('data:image/png;base64,abc', { hintText: '参考风格' })
    expect(result.kind).toBe('style')
  })
})

// ────────────────────────────────────────────────────────────
describe('create_from_images tool dispatch', () => {
  beforeEach(reset)

  it('creates character nodes from explicit images with character intent', async () => {
    const res = await executeToolCall('create_from_images', {
      images: ['data:image/png;base64,img1', 'data:image/png;base64,img2'],
      intent: 'character_refs',
      names: ['英雄', '反派'],
    })
    expect(res.success).toBe(true)
    const nodes = useFlowStore.getState().nodes
    expect(nodes).toHaveLength(2)
    expect(isLegacyCharacterNode(nodes[0], 'characterGrid')).toBe(true)
    expect(isLegacyCharacterNode(nodes[1], 'characterGrid')).toBe(true)
    expect(nodes[0].data.label).toContain('英雄')
    expect(nodes[1].data.label).toContain('反派')
  })

  it('creates style lock node with style_lock intent', async () => {
    const res = await executeToolCall('create_from_images', {
      images: ['data:image/png;base64,styleimg'],
      intent: 'style_lock',
    })
    expect(res.success).toBe(true)
    const nodes = useFlowStore.getState().nodes
    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe('styleLock')
  })

  it('creates scene node with scene_refs intent', async () => {
    const res = await executeToolCall('create_from_images', {
      images: ['data:image/png;base64,sceneimg'],
      intent: 'scene_refs',
      names: ['城市夜景'],
    })
    expect(res.success).toBe(true)
    const nodes = useFlowStore.getState().nodes
    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe('sceneGrid')
    expect(nodes[0].data.label).toContain('城市夜景')
  })

  it('rejects when no images available', async () => {
    const res = await executeToolCall('create_from_images', { images: [] })
    expect(res.success).toBe(false)
    expect(res.message).toContain('没有可用图片')
  })

  it('rejects when exceeding MAX_IMAGES_PER_CALL (10)', async () => {
    const imgs = Array.from({ length: 11 }, (_, i) => `data:image/png;base64,img${i}`)
    const res = await executeToolCall('create_from_images', { images: imgs })
    expect(res.success).toBe(false)
    expect(res.message).toContain('最多')
  })

  it('mixed intent falls back to per-image heuristic classification', async () => {
    const res = await executeToolCall('create_from_images', {
      images: ['data:image/png;base64,small1', 'data:image/png;base64,small2'],
      intent: 'mixed',
    })
    expect(res.success).toBe(true)
    expect(useFlowStore.getState().nodes.length).toBe(2)
  })
})

// ────────────────────────────────────────────────────────────
describe('_classifierAdapter: pluggable', () => {
  it('default adapter uses heuristic', () => {
    expect(_classifierAdapter.classify).toBe(classifyImageHeuristic)
  })
})
