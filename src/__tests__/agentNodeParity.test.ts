/**
 * agentNodeParity — spec: every NODE_REGISTRY entry has a matching
 * Agent `create_*` tool.
 *
 * Intent: the canvas must not expose a node type that Agent cannot create.
 * If this test fails, either add the missing tool or remove the node type.
 *
 * The tool-naming convention varies by node type (historical reasons):
 *   characterGrid   → create_character_grid
 *   videoGen        → create_video_node   (note: *_node* suffix)
 *   imageGen        → create_image_node
 *   textNode        → create_text_node    (no double _node)
 *   llmChat         → create_llm_node
 * We maintain an explicit map to stay consistent with the Agent contract.
 */
import { describe, it, expect } from 'vitest'
import { NODE_REGISTRY } from '@/data/nodeDefinitions'
import { AGENT_TOOLS } from '@/providers/toolDefinitions'

// Mapping from NODE_REGISTRY.type → expected Agent tool name.
// Keep this in sync with `agentTools.ts` executor switch cases.
const NODE_TO_TOOL: Record<string, string> = {
  characterGrid: 'create_character_grid',
  sceneGrid: 'create_scene_grid',
  keyframeGrid: 'create_keyframe_grid',
  imageGen: 'create_image_node',
  videoGen: 'create_video_node',
  textNode: 'create_text_node',
  audioNode: 'create_audio_node',
  llmChat: 'create_llm_node',
  storyboard: 'create_storyboard_node',
  characterExtract: 'create_character_extract_node',
  characterManager: 'create_character_manager_node',
  styleLock: 'create_style_lock_node',
  continuityCheck: 'create_continuity_check_node',
  videoStitch: 'create_video_stitch_node',
  imageEdit: 'create_image_edit_node',
  timeline: 'create_timeline_node',
}

describe('agent-tool-schemas: node-create tool parity', () => {
  const toolNames = new Set(AGENT_TOOLS.map(t => t.function?.name).filter(Boolean))

  for (const def of NODE_REGISTRY) {
    const expectedTool = NODE_TO_TOOL[def.type]

    it(`NODE_REGISTRY.${def.type} has an entry in NODE_TO_TOOL and the tool exists`, () => {
      expect(expectedTool).toBeTruthy()  // catches new node types added to registry without updating this map
      expect(toolNames.has(expectedTool!)).toBe(true)
    })
  }

  it('parity summary: all 16 registered node types map to a registered Agent tool', () => {
    for (const def of NODE_REGISTRY) {
      expect(toolNames.has(NODE_TO_TOOL[def.type] || '')).toBe(true)
    }
    expect(Object.keys(NODE_TO_TOOL).length).toBe(NODE_REGISTRY.length)
  })
})
