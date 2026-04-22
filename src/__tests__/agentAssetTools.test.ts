/**
 * Agent tool surface for the Asset Library.
 *
 *  - Verifies the 5 new tool schemas are present with clean shape
 *  - Verifies `create_video_node` / `create_image_node` expose `assetRefs`
 *  - Verifies handler dispatch contract for the asset handlers
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { AGENT_TOOLS, getAgentTools } from '@/providers/toolDefinitions'
import { executeToolCall } from '@/providers/agentTools'
import { useAssetStore } from '@/store/assetStore'
import { useFlowStore } from '@/store/flowStore'
import type { AssetDTO } from '@/api/backend'

function findTool(name: string) {
  return AGENT_TOOLS.find(t => t.function?.name === name)
}

describe('Asset Library — tool schema surface', () => {
  it('registers list_assets with kind enum', () => {
    const t = findTool('list_assets')
    expect(t).toBeTruthy()
    const props = t!.function.parameters?.properties as Record<string, { enum?: string[] }>
    expect(props.kind?.enum).toEqual(['character', 'scene', 'style'])
    expect(t!.function.description).toMatch(/素材库/)
  })

  it('registers create_asset with kind + name required', () => {
    const t = findTool('create_asset')
    expect(t).toBeTruthy()
    const params = t!.function.parameters as { required?: string[] }
    expect(params.required).toEqual(['kind', 'name'])
  })

  it('registers update_asset / link_asset_to_node / resolve_prompt_refs', () => {
    expect(findTool('update_asset')).toBeTruthy()
    expect(findTool('link_asset_to_node')).toBeTruthy()
    expect(findTool('resolve_prompt_refs')).toBeTruthy()
  })
})

describe('Asset Library — assetRefs on node creation tools', () => {
  it('create_video_node schema declares assetRefs (array of strings)', () => {
    const schemaAware = getAgentTools(
      [
        {
          model_id: 'doubao-seedance-2-0', name: 'Seedance', provider: 'Doubao', capability: 'video',
          description: '', param_schema: [], default_params: {}, enabled: true, schema_version: 1,
        } as never,
      ],
      [],
      [],
    )
    const tool = schemaAware.find(t => t.function?.name === 'create_video_node')
    expect(tool).toBeTruthy()
    const props = tool!.function.parameters?.properties as Record<string, { type?: string; items?: unknown }>
    expect(props.assetRefs).toBeTruthy()
    expect(props.assetRefs.type).toBe('array')
  })

  it('create_image_node schema declares assetRefs', () => {
    const schemaAware = getAgentTools(
      [],
      [
        {
          model_id: 'gemini-3.1-flash-image-preview', name: 'Gemini', provider: 'Google', capability: 'image',
          description: '', param_schema: [], default_params: {}, enabled: true, schema_version: 1,
        } as never,
      ],
      [],
    )
    const tool = schemaAware.find(t => t.function?.name === 'create_image_node')
    expect(tool).toBeTruthy()
    const props = tool!.function.parameters?.properties as Record<string, { type?: string }>
    expect(props.assetRefs?.type).toBe('array')
  })
})

function makeChar(partial: Partial<AssetDTO>): AssetDTO {
  return {
    id: 1,
    asset_id: partial.asset_id || 'char_test',
    kind: 'character',
    user_id: 1,
    project_id: null,
    name: partial.name || 'Test',
    name_en: null,
    appearance: partial.appearance || 'a',
    reference_images: partial.reference_images || [],
    variations: partial.variations || [],
    appearance_version: 1,
    metadata: {},
    ...partial,
  }
}

describe('Asset Library — handler dispatch', () => {
  beforeEach(() => {
    useAssetStore.setState({
      characters: {
        char_sarah: makeChar({
          asset_id: 'char_sarah',
          name: 'Sarah',
          appearance: 'red hair, trench coat',
          reference_images: ['https://cdn/s.png'],
        }),
      },
      scenes: {},
      styles: {},
      loading: false,
      error: null,
      lastFetchedAt: Date.now(),
    })
    // Reset flow store to a clean slate
    useFlowStore.setState({
      nodes: [],
      edges: [],
      selectedNodeId: null,
    } as never, false)
  })

  it('list_assets returns the stored character', async () => {
    const res = await executeToolCall('list_assets', { kind: 'character' })
    expect(res.success).toBe(true)
    expect(res.message).toContain('Sarah')
    expect(res.message).toContain('char_sarah')
  })

  it('resolve_prompt_refs expands @char_sarah', async () => {
    const res = await executeToolCall('resolve_prompt_refs', { prompt: '@char_sarah walks' })
    expect(res.success).toBe(true)
    expect(res.message).toContain('red hair, trench coat walks')
    expect(res.message).toContain('https://cdn/s.png')
  })

  it('link_asset_to_node writes assetRefs onto node.data', async () => {
    const store = useFlowStore.getState()
    store.addNode('videoGen', { x: 0, y: 0 }, { label: 'vg', prompt: 'test', status: 'idle' })
    const node = useFlowStore.getState().nodes[0]
    const res = await executeToolCall('link_asset_to_node', {
      node_id: node.id,
      asset_id: 'char_sarah',
    })
    expect(res.success).toBe(true)
    const updated = useFlowStore.getState().nodes.find(n => n.id === node.id)
    expect(updated?.data.assetRefs).toEqual(['char_sarah'])
  })

  it('link_asset_to_node fails gracefully for missing node', async () => {
    const res = await executeToolCall('link_asset_to_node', {
      node_id: 'nope',
      asset_id: 'char_sarah',
    })
    expect(res.success).toBe(false)
    expect(res.message).toMatch(/未找到节点/)
  })

  it('update_node merges assetRefs union-style', async () => {
    const store = useFlowStore.getState()
    store.addNode('videoGen', { x: 0, y: 0 }, {
      label: 'vg', prompt: 'test', status: 'idle', assetRefs: ['char_sarah'],
    })
    const node = useFlowStore.getState().nodes[0]
    // Agent adds a new ref
    const res = await executeToolCall('update_node', {
      nodeId: node.id,
      updates: { assetRefs: ['char_sarah', 'scene_newsroom'] },
    })
    expect(res.success).toBe(true)
    const updated = useFlowStore.getState().nodes.find(n => n.id === node.id)
    expect(updated?.data.assetRefs).toEqual(['char_sarah', 'scene_newsroom'])
  })
})
