/**
 * phaseAwareTools.test.ts — Phase-aware tool gating in getAgentTools
 */

import { describe, it, expect } from 'vitest'
import { getAgentTools, type AgentPhase } from '@/providers/toolDefinitions'
import { buildSkillsPromptByPhase } from '@/prompts/skills'

function toolNames(phase: AgentPhase): Set<string> {
  const tools = getAgentTools({ includeAll: false, phase, context: { userMessage: '生成视频', canvasEmpty: true } })
  return new Set(tools.map(t => t.function?.name).filter(Boolean) as string[])
}

describe('Phase-aware tool gating', () => {
  it('idle phase → no gating (same as no phase)', () => {
    const withIdle = getAgentTools({ includeAll: false, phase: 'idle', context: { userMessage: '生成视频', canvasEmpty: true } })
    const noPhase = getAgentTools({ includeAll: false, context: { userMessage: '生成视频', canvasEmpty: true } })
    expect(withIdle.length).toBe(noPhase.length)
  })

  it('planning phase → denies create_* nodes', () => {
    const names = toolNames('planning')
    expect(names.has('plan_task')).toBe(true)
    expect(names.has('save_memory')).toBe(true)
    expect(names.has('set_phase')).toBe(true)
    // Node creation must be denied
    expect(names.has('create_video_node')).toBe(false)
    expect(names.has('create_image_node')).toBe(false)
    expect(names.has('create_character_grid')).toBe(false)
    expect(names.has('create_from_images')).toBe(false)
    expect(names.has('generate_workflow')).toBe(false)
  })

  it('designing phase → allows style/character creation, denies execute', () => {
    const names = toolNames('designing')
    expect(names.has('create_style_lock_node')).toBe(true)
    expect(names.has('create_character_grid')).toBe(true)
    expect(names.has('create_scene_grid')).toBe(true)
    expect(names.has('create_from_images')).toBe(true)
    // Execution denied
    expect(names.has('execute_node')).toBe(false)
    expect(names.has('retry_node')).toBe(false)
    expect(names.has('batch_execute')).toBe(false)
    expect(names.has('parallel_execute')).toBe(false)
  })

  it('reviewing phase → allows review tools, denies destructive ops', () => {
    const names = toolNames('reviewing')
    expect(names.has('review_generated_image')).toBe(true)
    expect(names.has('verify_task')).toBe(true)
    expect(names.has('review_content')).toBe(true)
    expect(names.has('set_phase')).toBe(true)
    expect(names.has('recall_memory')).toBe(true)
    // Destructive ops denied
    expect(names.has('delete_node')).toBe(false)
    expect(names.has('create_video_node')).toBe(false)
    expect(names.has('create_image_node')).toBe(false)
    expect(names.has('forget_memory')).toBe(false)
  })

  it('executing phase → allows execution tools, denies creation', () => {
    const names = toolNames('executing')
    expect(names.has('execute_node')).toBe(true)
    expect(names.has('batch_execute')).toBe(true)
    expect(names.has('parallel_execute')).toBe(true)
    expect(names.has('retry_node')).toBe(true)
    expect(names.has('get_node_output')).toBe(true)
    // Creation denied
    expect(names.has('create_video_node')).toBe(false)
    expect(names.has('create_image_node')).toBe(false)
    expect(names.has('create_from_images')).toBe(false)
  })

  it('discover_tools is always present in every phase', () => {
    const phases: AgentPhase[] = ['idle', 'planning', 'designing', 'building', 'reviewing', 'executing']
    for (const phase of phases) {
      const names = toolNames(phase)
      expect(names.has('discover_tools')).toBe(true)
    }
  })

  it('building phase → no explicit deny (full Tier 2 access)', () => {
    const names = toolNames('building')
    expect(names.has('create_video_node')).toBe(true)
    expect(names.has('create_image_node')).toBe(true)
    expect(names.has('execute_node')).toBe(true)
    expect(names.has('delete_node')).toBe(true)
  })
})

// ── SKILLS phase unification ──

describe('SKILLS: Agent-declared phases produce valid prompt', () => {
  it('reviewing phase → includes quality_control (review_generated_image)', () => {
    const prompt = buildSkillsPromptByPhase('reviewing')
    expect(prompt).toContain('质量门控')
    expect(prompt).toContain('review_generated_image')
    expect(prompt).toContain('review_content')
  })

  it('planning phase → includes workflow_management', () => {
    const prompt = buildSkillsPromptByPhase('planning')
    expect(prompt).toContain('工作流')
  })

  it('designing phase → includes character + scene + style', () => {
    const prompt = buildSkillsPromptByPhase('designing')
    expect(prompt).toContain('角色')
    expect(prompt).toContain('场景')
    expect(prompt).toContain('风格锁定')
  })

  it('building phase → includes image/video generation + prompt craft', () => {
    const prompt = buildSkillsPromptByPhase('building')
    expect(prompt).toContain('图片生成')
    expect(prompt).toContain('视频生成')
    expect(prompt).toContain('提示词')
  })

  it('executing phase → includes execution-related skills', () => {
    const prompt = buildSkillsPromptByPhase('executing')
    expect(prompt).toContain('视频生成')
    expect(prompt).toContain('音频')
  })

  it('idle/unknown phase → returns full SKILLS set', () => {
    const idlePrompt = buildSkillsPromptByPhase('idle')
    const fullPrompt = buildSkillsPromptByPhase('full')
    expect(idlePrompt).toBe(fullPrompt) // idle not in PHASE_SKILL_MAP → fallback to full
  })
})
