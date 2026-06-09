/**
 * Regression tests for `update_node` tool — these guard the two root-cause
 * bugs that wiped video parameters on the canvas:
 *
 *  1. Sending the same `model` value (no actual change) used to trigger the
 *     model-switch sanitize path, which (when _modelCache was cold) used an
 *     empty schema and nulled out duration / aspect_ratio / resolution / etc.
 *  2. Even when model genuinely changes, a cache miss must not destroy
 *     existing fields — fall back to a no-op merge instead.
 *
 * Both behaviors are tested below so future refactors don't reintroduce them.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { executeToolCall } from '@/providers/agentTools'
import { primeModelCache } from '@/providers/toolHandlers'
import { useFlowStore } from '@/store/flowStore'
import { useAssetStore } from '@/store/assetStore'

function reset() {
  useFlowStore.setState({ nodes: [], edges: [], selectedNodeId: null, characterAppearances: {} })
  useAssetStore.setState({ characters: {}, scenes: {}, styles: {}, loading: false, error: null, lastFetchedAt: null })
}

async function createVideoNodeWithFullParams() {
  const res = await executeToolCall('create_video_node', {
    prompt: 'Test prompt',
    model: 'sora-2-vvip',
    aspect_ratio: '16:9',
    duration: 12,
    resolution: '720p',
  })
  expect(res.success).toBe(true)
  // create_video_node uses defaults; force-set the params we want to assert
  const node = useFlowStore.getState().nodes.slice(-1)[0]
  useFlowStore.getState().updateNodeData(node.id, {
    aspect_ratio: '16:9',
    duration: 12,
    resolution: '720p',
    size: '16:9',
    generate_audio: false,
  })
  return useFlowStore.getState().nodes.slice(-1)[0]
}

describe('update_node regression: sending same model must not wipe params', () => {
  beforeEach(reset)

  it('repeating the SAME model value preserves duration / aspect_ratio / resolution / size / generate_audio', async () => {
    const node = await createVideoNodeWithFullParams()
    expect(node.data.duration).toBe(12)
    expect(node.data.aspect_ratio).toBe('16:9')
    expect(node.data.resolution).toBe('720p')

    const res = await executeToolCall('update_node', {
      nodeId: node.id,
      // Same model as before — must NOT trigger sanitize
      updates: { model: 'sora-2-vvip', prompt: 'Refined prompt' },
    })
    expect(res.success).toBe(true)

    const updated = useFlowStore.getState().nodes.find(n => n.id === node.id)!
    expect(updated.data.prompt).toBe('Refined prompt')
    // All schema params must survive
    expect(updated.data.duration).toBe(12)
    expect(updated.data.aspect_ratio).toBe('16:9')
    expect(updated.data.resolution).toBe('720p')
    expect(updated.data.size).toBe('16:9')
    expect(updated.data.generate_audio).toBe(false)
  })

  it('omitting model entirely also preserves all params', async () => {
    const node = await createVideoNodeWithFullParams()

    await executeToolCall('update_node', {
      nodeId: node.id,
      updates: { prompt: 'Just prompt change' },
    })

    const updated = useFlowStore.getState().nodes.find(n => n.id === node.id)!
    expect(updated.data.prompt).toBe('Just prompt change')
    expect(updated.data.duration).toBe(12)
    expect(updated.data.aspect_ratio).toBe('16:9')
    expect(updated.data.resolution).toBe('720p')
  })

  it('changing model with cache miss preserves params (no destructive sanitize)', async () => {
    const node = await createVideoNodeWithFullParams()
    // 不预热 _modelCache → 切换到一个未知 model
    await executeToolCall('update_node', {
      nodeId: node.id,
      updates: { model: 'some-unknown-model' },
    })

    const updated = useFlowStore.getState().nodes.find(n => n.id === node.id)!
    expect(updated.data.model).toBe('some-unknown-model')
    // schema 缓存 miss 时，应跳过 sanitize（保留所有字段，等下次缓存命中再清洗）
    expect(updated.data.duration).toBe(12)
    expect(updated.data.aspect_ratio).toBe('16:9')
    expect(updated.data.resolution).toBe('720p')
  })

  it('switching from sora-2-vvip to grok-video-3 (cache hit): duration cleared, seconds appears, prompt preserved', async () => {
    const node = await createVideoNodeWithFullParams()
    // 预热 _modelCache.video，让 sora→grok 切换走真的 sanitize 路径
    primeModelCache('video', [
      {
        model_id: 'sora-2-vvip', name: 'Sora', provider: 'OpenAI',
        capability: 'video', sort_order: 5, is_active: true,
        param_schema: [
          { key: 'duration', label: '时长', type: 'select',
            options: [{ value: 12, label: '12s' }], default: 12 },
        ],
      } as any,
      {
        model_id: 'grok-video-3', name: 'Grok', provider: 'xAI',
        capability: 'video', sort_order: 50, is_active: true,
        param_schema: [
          { key: 'seconds', label: '时长', type: 'select',
            options: [{ value: '10', label: '10s' }], default: '10' },
          { key: 'aspect_ratio', label: '比例', type: 'select',
            options: [{ value: '16:9', label: '16:9' }], default: '16:9' },
        ],
      } as any,
    ])

    await executeToolCall('update_node', {
      nodeId: node.id,
      updates: { model: 'grok-video-3' },
    })

    const updated = useFlowStore.getState().nodes.find(n => n.id === node.id)!
    expect(updated.data.model).toBe('grok-video-3')
    // grok schema 没有 duration/resolution/generate_audio → 应被清除
    expect(updated.data.duration).toBeFalsy()
    expect(updated.data.resolution).toBeFalsy()
    expect(updated.data.generate_audio).toBeFalsy()
    // grok schema 有 seconds → 取默认值 "10"（字符串）
    expect(updated.data.seconds).toBe('10')
    // grok schema 也有 aspect_ratio → 保留之前的或取 default
    expect(updated.data.aspect_ratio).toBe('16:9')
    // reserved 字段（prompt 不在 schema 里但应保留）
    expect(updated.data.prompt).toBe('Test prompt')
  })
})
