/**
 * reviewGeneratedImage.test.ts — review_generated_image 工具 + reviewAdapter 测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { reviewImageHeuristic, _reviewAdapter, type ReviewResult } from '@/providers/reviewAdapter'
import { useFlowStore } from '@/store/flowStore'
import { executeToolCall } from '@/providers/agentTools'

function reset() {
  useFlowStore.setState({ nodes: [], edges: [], selectedNodeId: null, _history: [], _historyIndex: -1, _clipboard: null })
}

function injectNode(id: string, type: string, label: string, extra: Record<string, unknown> = {}) {
  useFlowStore.setState(s => ({
    nodes: [...s.nodes, { id, type, position: { x: 0, y: 0 }, data: { label, ...extra } }],
  }))
}

// ────────────────────────────────────────────────────────────
describe('reviewImageHeuristic: scoring logic', () => {
  it('node with output + success + rich prompt + ref + style → score ~100', () => {
    const data: Record<string, unknown> = {
      outputImage: 'data:image/png;base64,abc',
      status: 'success',
      prompt: 'A beautiful landscape with mountains and rivers in sunset',
      referenceImage: 'data:image/png;base64,ref',
      extractedStyle: 'warm tones, cinematic',
    }
    const result = reviewImageHeuristic(data)
    expect(result.score).toBe(100)
    expect(result.pass).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('empty node → low score + issues + suggestions', () => {
    const result = reviewImageHeuristic({})
    expect(result.score).toBeLessThan(60)
    expect(result.pass).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.suggestions.length).toBeGreaterThan(0)
  })

  it('node with output but short prompt → partial score', () => {
    const data: Record<string, unknown> = {
      outputImage: 'data:image/png;base64,abc',
      status: 'success',
      prompt: 'cat',
    }
    const result = reviewImageHeuristic(data)
    expect(result.score).toBeGreaterThanOrEqual(60)
    expect(result.score).toBeLessThan(100)
    expect(result.suggestions.some(s => s.includes('optimize_prompt'))).toBe(true)
  })

  it('error status node → includes status issue', () => {
    const data: Record<string, unknown> = {
      outputImage: 'data:image/png;base64,abc',
      status: 'error',
      prompt: 'A wide landscape shot',
    }
    const result = reviewImageHeuristic(data)
    expect(result.issues.some(i => i.includes('异常'))).toBe(true)
  })

  it('custom threshold changes pass/fail boundary', () => {
    const data: Record<string, unknown> = { outputImage: 'x', status: 'success' }
    const strict = reviewImageHeuristic(data, { threshold: 90 })
    const lenient = reviewImageHeuristic(data, { threshold: 30 })
    expect(strict.pass).toBe(false)
    expect(lenient.pass).toBe(true)
    expect(strict.score).toBe(lenient.score) // same data → same score
  })
})

// ────────────────────────────────────────────────────────────
describe('_reviewAdapter: pluggable adapter', () => {
  it('default adapter equals heuristic function', () => {
    expect(_reviewAdapter.review).toBe(reviewImageHeuristic)
  })

  it('can be swapped out for a custom implementation', () => {
    const original = _reviewAdapter.review
    const custom = (): ReviewResult => ({
      score: 99, pass: true, issues: [], suggestions: [],
    })
    _reviewAdapter.review = custom
    expect(_reviewAdapter.review({})).toEqual({ score: 99, pass: true, issues: [], suggestions: [] })
    _reviewAdapter.review = original // restore
  })
})

// ────────────────────────────────────────────────────────────
describe('review_generated_image tool dispatch', () => {
  beforeEach(reset)

  it('reviews a node by nodeId', async () => {
    injectNode('img-1', 'imageGen', '风景图', {
      outputImage: 'data:image/png;base64,abc',
      status: 'success',
      prompt: 'A panoramic mountain view with snow-capped peaks at dawn',
      referenceImage: 'data:image/png;base64,ref',
    })
    const res = await executeToolCall('review_generated_image', { nodeId: 'img-1' })
    expect(res.success).toBe(true)
    expect(res.message).toContain('风景图')
    expect(res.message).toMatch(/\d+\/100/)
  })

  it('reviews a node by nodeLabel', async () => {
    injectNode('v-1', 'videoGen', '片头视频', {
      outputVideo: 'blob:http://xxx',
      status: 'done',
      prompt: 'Cinematic opening shot with studio logo reveal',
    })
    const res = await executeToolCall('review_generated_image', { nodeLabel: '片头视频' })
    expect(res.success).toBe(true)
    expect(res.message).toContain('片头视频')
  })

  it('returns not-found for missing node', async () => {
    const res = await executeToolCall('review_generated_image', { nodeId: 'nonexistent' })
    expect(res.success).toBe(false)
    expect(res.message).toMatch(/未找到/)
  })

  it('custom threshold is forwarded to adapter', async () => {
    injectNode('img-2', 'imageGen', '测试图', { outputImage: 'x', status: 'success' })
    const strict = await executeToolCall('review_generated_image', { nodeId: 'img-2', threshold: 95 })
    expect(strict.message).toContain('未通过')
    const lenient = await executeToolCall('review_generated_image', { nodeId: 'img-2', threshold: 10 })
    expect(lenient.message).toContain('通过')
  })
})
