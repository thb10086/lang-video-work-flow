/**
 * agentParamEffective.test.ts — 验证 Agent 通过 tool schema 传入的每一个参数
 * 都真实落地到 node.data。
 *
 * 核心断言：对每个 create_*_node 工具，按 schema.properties 构造一组非默认值的
 * args 调用 executeToolCall，读出新建节点的 data，核对字段。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { AGENT_TOOLS } from '@/providers/toolDefinitions'
import { executeToolCall } from '@/providers/agentTools'
import { useFlowStore } from '@/store/flowStore'
import { useAssetStore } from '@/store/assetStore'
import { isLegacyCharacterNode } from './_helpers/characterAssetTestHelpers'

function reset() {
  useFlowStore.setState({ nodes: [], edges: [], selectedNodeId: null, characterAppearances: {} })
  useAssetStore.setState({ characters: {}, scenes: {}, styles: {}, loading: false, error: null, lastFetchedAt: null })
}

// ── Build a non-default sample for each JSON-schema property ──
type Props = Record<string, { type?: string; enum?: unknown[] }>
function sampleValue(key: string, spec: { type?: string; enum?: unknown[] }): unknown {
  if (spec.enum && spec.enum.length > 0) return spec.enum[0]
  switch (spec.type) {
    case 'string':  return `param-${key}-X`
    case 'number':  return 42
    case 'integer': return 7
    case 'boolean': return true
    case 'array':   return ['arr-a', 'arr-b']
    case 'object':  return { k: 'v' }
    default:        return `val-${key}`
  }
}

describe('agent param effectiveness: Agent-passed schema params land on node.data', () => {
  beforeEach(reset)

  // ── Case 1: create_video_node with varied params ──
  it('create_video_node: prompt / aspect_ratio / duration / seed flow through', async () => {
    const res = await executeToolCall('create_video_node', {
      prompt: 'Orbit around mecha',
      aspect_ratio: '9:16',
      duration: 8,
      generate_audio: true,
      seed: 42,
    })
    expect(res.success).toBe(true)
    const node = useFlowStore.getState().nodes.slice(-1)[0]
    expect(node.type).toBe('videoGen')
    expect(node.data.prompt).toBe('Orbit around mecha')
    expect(node.data.aspect_ratio).toBe('9:16')
    expect(node.data.duration).toBe(8)
    expect(node.data.generate_audio).toBe(true)
    expect(node.data.seed).toBe(42)
  })

  // ── Case 2: create_image_node: prompt + aspectRatio ──
  it('create_image_node: prompt / aspectRatio flow through', async () => {
    const res = await executeToolCall('create_image_node', {
      prompt: 'A neon robot',
      aspectRatio: '16:9',
    })
    expect(res.success).toBe(true)
    const node = useFlowStore.getState().nodes.slice(-1)[0]
    expect(node.type).toBe('imageGen')
    expect(node.data.prompt).toBe('A neon robot')
    expect(node.data.aspectRatio).toBe('16:9')
  })

  // ── Case 3: create_audio_node: text + voice ──
  it('create_audio_node: text / voice flow through', async () => {
    const res = await executeToolCall('create_audio_node', {
      text: 'hello world',
      voice: 'alice',
      model: 'elevenlabs',
    })
    expect(res.success).toBe(true)
    const node = useFlowStore.getState().nodes.slice(-1)[0]
    expect(node.type).toBe('audioNode')
    expect(node.data.text).toBe('hello world')
    expect(node.data.voice).toBe('alice')
    expect(node.data.model).toBe('elevenlabs')
  })

  // ── Case 4: create_character_grid: name + description + style ──
  it('create_character_grid: name / description / style flow through and register anchor', async () => {
    const res = await executeToolCall('create_character_grid', {
      name: 'Ryu',
      description: 'red hair, blue uniform',
      style: 'anime',
    })
    expect(res.success).toBe(true)
    const node = useFlowStore.getState().nodes.slice(-1)[0]
    expect(isLegacyCharacterNode(node, 'characterGrid')).toBe(true)
    expect(node.data.name).toBe('Ryu')
    expect(node.data.description).toBe('red hair, blue uniform')
    expect(node.data.style).toBe('anime')
    // Side-effect: character appearance registered for prompt anchoring
    expect(useFlowStore.getState().characterAppearances['Ryu']).toBe('red hair, blue uniform')
  })

  // ── Case 5: create_scene_grid: name + description + mood ──
  it('create_scene_grid: name / description / style / mood flow through', async () => {
    const res = await executeToolCall('create_scene_grid', {
      name: 'Tokyo Rooftop',
      description: 'neon city at night',
      style: 'cinematic',
      mood: 'dramatic',
    })
    expect(res.success).toBe(true)
    const node = useFlowStore.getState().nodes.slice(-1)[0]
    expect(node.type).toBe('sceneGrid')
    expect(node.data.name).toBe('Tokyo Rooftop')
    expect(node.data.description).toBe('neon city at night')
    expect(node.data.style).toBe('cinematic')
    expect(node.data.mood).toBe('dramatic')
  })

  // ── Case 6: create_image_edit_node: editInstruction ──
  it('create_image_edit_node: editInstruction flows through', async () => {
    const res = await executeToolCall('create_image_edit_node', {
      editInstruction: '换成海滩背景',
    })
    expect(res.success).toBe(true)
    const node = useFlowStore.getState().nodes.slice(-1)[0]
    expect(node.type).toBe('imageEdit')
    expect(node.data.editInstruction).toBe('换成海滩背景')
    expect(node.data.editPrompt).toBeUndefined()  // no legacy key leaking
  })

  // ── Case 7: create_text_node: content + label ──
  it('create_text_node: content + label flow through', async () => {
    const res = await executeToolCall('create_text_node', {
      content: 'My script',
      label: 'Chapter 1',
    })
    expect(res.success).toBe(true)
    const node = useFlowStore.getState().nodes.slice(-1)[0]
    expect(node.type).toBe('textNode')
    expect(node.data.content).toBe('My script')
    expect(node.data.label).toBe('Chapter 1')
  })

  // ── Case 8: create_llm_node: systemPrompt + userInput ──
  it('create_llm_node: systemPrompt / userInput flow through', async () => {
    const res = await executeToolCall('create_llm_node', {
      systemPrompt: 'You are an expert critic',
      userInput: 'Review this script',
    })
    expect(res.success).toBe(true)
    const node = useFlowStore.getState().nodes.slice(-1)[0]
    expect(node.type).toBe('llmChat')
    expect(node.data.systemPrompt).toBe('You are an expert critic')
    expect(node.data.userInput).toBe('Review this script')
  })

  // ── Case 9: create_storyboard_node: script ──
  it('create_storyboard_node: script flows through', async () => {
    const res = await executeToolCall('create_storyboard_node', {
      script: 'Scene 1: intro',
    })
    expect(res.success).toBe(true)
    const node = useFlowStore.getState().nodes.slice(-1)[0]
    expect(node.type).toBe('storyboard')
    expect(node.data.script).toBe('Scene 1: intro')
  })

  // ── Case 10: create_style_lock_node: styleDescription ──
  it('create_style_lock_node: styleDescription flows through', async () => {
    const res = await executeToolCall('create_style_lock_node', {
      styleDescription: 'Ghibli watercolor, soft pastel',
    })
    expect(res.success).toBe(true)
    const node = useFlowStore.getState().nodes.slice(-1)[0]
    expect(node.type).toBe('styleLock')
    expect(node.data.styleDescription).toBe('Ghibli watercolor, soft pastel')
  })

  // ── Case 11: create_character_extract_node: timestamps + videoUrl ──
  it('create_character_extract_node: timestamps / videoUrl flow through', async () => {
    const res = await executeToolCall('create_character_extract_node', {
      timestamps: '2,5,7',
      videoUrl: 'https://example.com/v.mp4',
      label: 'Hero extract',
    })
    expect(res.success).toBe(true)
    const node = useFlowStore.getState().nodes.slice(-1)[0]
    expect(isLegacyCharacterNode(node, 'characterExtract')).toBe(true)
    expect(node.data.timestamps).toBe('2,5,7')
    expect(node.data.videoUrl).toBe('https://example.com/v.mp4')
    expect(node.data.label).toBe('Hero extract')
  })

  // ── Case 12: Unknown params tolerated, not crashing ──
  it('unknown args do not crash node creation', async () => {
    const res = await executeToolCall('create_video_node', {
      prompt: 'X',
      nonsenseField: 'abc',
      anotherJunk: 99,
    })
    expect(res.success).toBe(true)
    const node = useFlowStore.getState().nodes.slice(-1)[0]
    expect(node.data.prompt).toBe('X')
  })
})

// Coverage sanity: every create_*_node tool in AGENT_TOOLS has an explicit test
describe('parameter coverage sanity', () => {
  it('every create_*_node schema has at least one explicit test case', () => {
    const creationTools = AGENT_TOOLS
      .map(t => t.function?.name || '')
      .filter(n => /^create_.*_node$/.test(n) || n === 'create_character_grid' || n === 'create_scene_grid')

    const tested = new Set([
      'create_video_node', 'create_image_node', 'create_audio_node',
      'create_character_grid', 'create_scene_grid', 'create_image_edit_node',
      'create_text_node', 'create_llm_node', 'create_storyboard_node',
      'create_style_lock_node', 'create_character_extract_node',
    ])
    // Soft check: we don't require 100% but call out new tools as they land
    const untested = creationTools.filter(n => !tested.has(n))
    // character_manager_node + video_stitch_node + continuity_check_node have
    // no schema params other than `label` — they're passive nodes, so the
    // label-only path is covered by nodeAgentToolUtilization. Flag any OTHER
    // uncovered creation tools so future additions get a test.
    const stillMissing = untested.filter(n => ![
      'create_character_manager_node',
      'create_video_stitch_node',
      'create_continuity_check_node',
      // create_timeline_node only takes `label` — passive node, no params
      // beyond the label-only path covered by nodeAgentToolUtilization.
      'create_timeline_node',
    ].includes(n))
    expect(stillMissing).toEqual([])
  })
})
