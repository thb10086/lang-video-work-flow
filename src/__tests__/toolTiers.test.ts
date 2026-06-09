/**
 * toolTiers.test.ts — 覆盖 Tier 分层 + selectTier 启发式 + getAgentTools 过滤
 * 符合 spec `agent-tool-tiering`。
 */

import { describe, it, expect } from 'vitest'
import {
  selectTier,
  expandTierSelection,
  allTierToolNames,
  tierOf,
  TIER_1_CORE,
  TIER_2_CREATION,
  TIER_3_ADVANCED,
} from '@/providers/toolTiers'
import { AGENT_TOOLS, getAgentTools } from '@/providers/toolDefinitions'
import { NODE_REGISTRY } from '@/data/nodeDefinitions'

describe('toolTiers: static partitioning', () => {
  it('Tier 1 contains core navigation + meta tools', () => {
    expect(TIER_1_CORE).toContain('generate_workflow')
    expect(TIER_1_CORE).toContain('detect_scenario')
    expect(TIER_1_CORE).toContain('get_canvas_state')
    expect(TIER_1_CORE).toContain('verify_task')
    expect(TIER_1_CORE).toContain('discover_tools')
  })

  it('Tier 2 contains every create_*_node plus delete_node', () => {
    for (const name of ['create_character_grid', 'create_scene_grid', 'create_image_node',
      'create_video_node', 'create_audio_node', 'create_llm_node', 'create_text_node',
      'create_storyboard_node', 'create_character_extract_node', 'create_character_manager_node',
      'create_style_lock_node', 'create_image_edit_node', 'create_video_stitch_node',
      'create_continuity_check_node', 'delete_node']) {
      expect(TIER_2_CREATION).toContain(name)
    }
  })

  it('Tier 3 holds asset / memory / optimisation long-tail', () => {
    for (const name of ['list_assets', 'create_asset', 'save_memory', 'recall_memory',
      'optimize_prompt', 'review_content', 'plan_task', 'inject_user_images']) {
      expect(TIER_3_ADVANCED).toContain(name)
    }
  })

  it('tier membership is disjoint', () => {
    const t1 = new Set(TIER_1_CORE)
    const t2 = new Set(TIER_2_CREATION)
    const t3 = new Set(TIER_3_ADVANCED)
    for (const n of t1) { expect(t2.has(n)).toBe(false); expect(t3.has(n)).toBe(false) }
    for (const n of t2) expect(t3.has(n)).toBe(false)
  })

  it('Tier 2 covers every NODE_REGISTRY node type (creation parity)', () => {
    const tier2 = new Set(TIER_2_CREATION)
    // Known map — snake_case mirrors agentNodeParity.test.ts
    const expected: Record<string, string> = {
      characterGrid: 'create_character_grid',
      keyframeGrid: 'create_keyframe_grid',
      sceneGrid: 'create_scene_grid',
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
    for (const def of NODE_REGISTRY) {
      expect(tier2.has(expected[def.type])).toBe(true)
    }
  })

  it('allTierToolNames equals the union of AGENT_TOOLS names (ignoring discover_tools already in Tier 1)', () => {
    const union = allTierToolNames()
    const agentToolNames = new Set(AGENT_TOOLS.map(t => t.function?.name).filter(Boolean) as string[])
    expect(union.size).toBe(agentToolNames.size)
    for (const name of agentToolNames) expect(union.has(name)).toBe(true)
  })
})

describe('toolTiers: tierOf reverse lookup', () => {
  it('correctly classifies samples from each tier', () => {
    expect(tierOf('generate_workflow')).toBe('tier1')
    expect(tierOf('create_video_node')).toBe('tier2')
    expect(tierOf('save_memory')).toBe('tier3')
  })

  it('returns null for unknown tool names', () => {
    expect(tierOf('no_such_tool')).toBeNull()
  })
})

describe('selectTier: heuristic signals', () => {
  it('creation keyword → tier1 + tier2', () => {
    const sel = selectTier('帮我生成一个产品广告视频')
    expect(sel.tiers).toContain('tier1')
    expect(sel.tiers).toContain('tier2')
  })

  it('empty canvas → auto tier2 regardless of message', () => {
    const sel = selectTier('看看画布', { canvasEmpty: true })
    expect(sel.tiers).toContain('tier2')
  })

  it('navigation-only message → tier1 only', () => {
    const sel = selectTier('当前画布上有什么？', { canvasEmpty: false })
    expect(sel.tiers).toEqual(['tier1'])
    expect(sel.addOns).toEqual([])
  })

  it('asset keyword → adds asset tools', () => {
    const sel = selectTier('查一下素材库里的角色')
    expect(sel.addOns).toContain('list_assets')
    expect(sel.addOns).toContain('create_asset')
  })

  it('optimize keyword → adds optimize_prompt + review_content', () => {
    const sel = selectTier('优化一下镜头1的 prompt')
    expect(sel.addOns).toContain('optimize_prompt')
    expect(sel.addOns).toContain('review_content')
  })

  it('memory keyword → adds save/recall', () => {
    const sel = selectTier('请记住这个角色设定')
    expect(sel.addOns).toContain('save_memory')
    expect(sel.addOns).toContain('recall_memory')
  })

  it('forceTier override skips heuristics', () => {
    const sel = selectTier('生成视频', { forceTier: ['tier1'] })
    expect(sel.tiers).toEqual(['tier1'])
    expect(sel.addOns).toEqual([])
  })
})

describe('expandTierSelection: merges tiers + addOns', () => {
  it('tier1 only returns exactly TIER_1_CORE', () => {
    const set = expandTierSelection({ tiers: ['tier1'], addOns: [] })
    expect(set.size).toBe(TIER_1_CORE.length)
  })

  it('tier1+tier2 returns TIER_1_CORE + TIER_2_CREATION', () => {
    const set = expandTierSelection({ tiers: ['tier1', 'tier2'], addOns: [] })
    expect(set.size).toBe(TIER_1_CORE.length + TIER_2_CREATION.length)
  })

  it('addOns merge even when their tier is not in tiers', () => {
    const set = expandTierSelection({ tiers: ['tier1'], addOns: ['save_memory'] })
    expect(set.has('save_memory')).toBe(true)
    expect(set.size).toBe(TIER_1_CORE.length + 1)
  })
})

describe('getAgentTools: tier-filtered output', () => {
  it('default empty-canvas creation call emits ~Tier 1+2 tools', () => {
    const tools = getAgentTools({
      context: { userMessage: '生成漫剧', canvasEmpty: true },
    })
    expect(tools.length).toBeGreaterThanOrEqual(15)
    expect(tools.length).toBeLessThanOrEqual(28)
    const names = new Set(tools.map(t => t.function?.name))
    expect(names.has('discover_tools')).toBe(true)
    expect(names.has('generate_workflow')).toBe(true)
    expect(names.has('create_video_node')).toBe(true)
    // Tier 3 should NOT appear under default heuristic
    expect(names.has('save_memory')).toBe(false)
  })

  it('navigation message → only tier 1 tools (≤ TIER_1_CORE.length)', () => {
    const tools = getAgentTools({
      context: { userMessage: '画布现在是什么情况？', canvasEmpty: false },
    })
    expect(tools.length).toBeLessThanOrEqual(TIER_1_CORE.length)
    const names = new Set(tools.map(t => t.function?.name))
    expect(names.has('create_video_node')).toBe(false)
  })

  it('asset keyword → includes asset-library tools', () => {
    const tools = getAgentTools({
      context: { userMessage: '看下素材库', canvasEmpty: false },
    })
    const names = new Set(tools.map(t => t.function?.name))
    expect(names.has('list_assets')).toBe(true)
    expect(names.has('create_asset')).toBe(true)
    // But NOT unrelated Tier 3 tools
    expect(names.has('plan_task')).toBe(false)
  })

  it('includeAll: true returns every tool in AGENT_TOOLS', () => {
    const tools = getAgentTools({ includeAll: true })
    expect(tools.length).toBe(AGENT_TOOLS.length)
  })

  it('explicit tier=["tier3"] only returns tier3 tools + discover_tools escape hatch', () => {
    const tools = getAgentTools({ tier: ['tier3'] })
    const names = new Set(tools.map(t => t.function?.name))
    expect(names.has('save_memory')).toBe(true)
    expect(names.has('discover_tools')).toBe(true) // always present
    expect(names.has('create_video_node')).toBe(false)
  })

  it('legacy positional call signature behaves like includeAll', () => {
    const tools = getAgentTools([], [], [])
    expect(tools.length).toBe(AGENT_TOOLS.length)
  })
})

// ── agent-pro-upgrade additions ──

describe('toolTiers: new tool tier membership', () => {
  it('create_from_images is in Tier 2', () => {
    expect(TIER_2_CREATION).toContain('create_from_images')
    expect(tierOf('create_from_images')).toBe('tier2')
  })

  it('review_generated_image is in Tier 3', () => {
    expect(TIER_3_ADVANCED).toContain('review_generated_image')
    expect(tierOf('review_generated_image')).toBe('tier3')
  })

  it('forget_memory is in Tier 3', () => {
    expect(TIER_3_ADVANCED).toContain('forget_memory')
    expect(tierOf('forget_memory')).toBe('tier3')
  })

  it('set_phase is in Tier 1', () => {
    expect(TIER_1_CORE).toContain('set_phase')
    expect(tierOf('set_phase')).toBe('tier1')
  })
})

describe('selectTier: review keyword includes review_generated_image', () => {
  it('review keyword → adds review_content + review_generated_image', () => {
    const sel = selectTier('帮我审查一下画布上的图片质量')
    expect(sel.addOns).toContain('review_content')
    expect(sel.addOns).toContain('review_generated_image')
  })

  // Regression for REVIEW_RE keyword expansion — natural Chinese phrasings
  // that users actually type should surface verify_image_semantic.
  it('"确认" triggers review add-ons including verify_image_semantic', () => {
    const sel = selectTier('帮我确认一下镜头1的画面对不对', { canvasEmpty: false })
    expect(sel.addOns).toContain('review_content')
    expect(sel.addOns).toContain('review_generated_image')
    expect(sel.addOns).toContain('verify_image_semantic')
  })

  it('"检查" triggers review add-ons', () => {
    const sel = selectTier('检查一下关键帧是否符合剧本', { canvasEmpty: false })
    expect(sel.addOns).toContain('verify_image_semantic')
  })

  it('"校验" triggers review add-ons', () => {
    const sel = selectTier('最终校验一下画面质量', { canvasEmpty: false })
    expect(sel.addOns).toContain('verify_image_semantic')
  })

  it('English "verify" triggers review add-ons', () => {
    const sel = selectTier('please verify the final shot', { canvasEmpty: false })
    expect(sel.addOns).toContain('verify_image_semantic')
  })

  it('verify_image_semantic belongs to Tier 3', () => {
    expect(TIER_3_ADVANCED).toContain('verify_image_semantic')
    expect(tierOf('verify_image_semantic')).toBe('tier3')
  })
})
