/**
 * e2e-agent-loop.test.ts — End-to-end Agent loop integration tests
 *
 * Tests the full chain:
 *   buildAgentSystemPrompt → getAgentTools (phase-aware) → tool dispatch
 *   → memory save/recall/forget → SKILLS phase unification
 *
 * These tests do NOT call real LLM APIs — they validate the complete
 * front-end pipeline that feeds into the backend proxy.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useFlowStore } from '@/store/flowStore'
import { useAgentMemoryStore } from '@/store/agentMemoryStore'
import { buildAgentSystemPrompt } from '@/store/chatPromptBuilder'
import { getAgentTools, AGENT_TOOLS } from '@/providers/toolDefinitions'
import { executeToolCall } from '@/providers/agentTools'
import { buildSkillsPromptByPhase } from '@/prompts/skills'

function resetStores() {
  useFlowStore.setState({
    nodes: [],
    edges: [],
    projectId: 42,
  })
  useAgentMemoryStore.setState({
    memories: [],
    currentPlan: null,
    compactedContexts: [],
    currentPhase: 'idle',
    phaseHistory: [],
  })
}

describe('E2E: Full Agent pipeline integration', () => {
  beforeEach(resetStores)

  // ── 1. System Prompt includes all required sections ──

  it('system prompt contains SKILLS, canvas state, and memory context', () => {
    const prompt = buildAgentSystemPrompt('director')
    expect(prompt).toContain('SKILLS')
    expect(prompt).toContain('画布状态')
    expect(prompt).toContain('当前上下文')
  })

  it('system prompt includes image hint when images present', () => {
    const prompt = buildAgentSystemPrompt('director', { imageCount: 3 })
    expect(prompt).toContain('3 张图像')
    expect(prompt).toContain('create_from_images')
  })

  it('system prompt uses Agent-declared phase for SKILLS injection', () => {
    useAgentMemoryStore.setState({ currentPhase: 'reviewing' })
    const prompt = buildAgentSystemPrompt('director')
    expect(prompt).toContain('reviewing 阶段')
    expect(prompt).toContain('review_generated_image')
    expect(prompt).toContain('质量门控')
  })

  // ── 2. Tool gating pipeline ──

  it('getAgentTools respects phase gating (planning blocks create_*_node)', () => {
    const tools = getAgentTools({
      phase: 'planning',
      context: { userMessage: '规划一下', canvasEmpty: true },
    })
    const names = tools.map(t => t.function?.name)
    expect(names).toContain('plan_task')
    expect(names).toContain('discover_tools')
    expect(names).not.toContain('create_video_node')
    expect(names).not.toContain('create_image_node')
  })

  it('getAgentTools allows creation in building phase', () => {
    const tools = getAgentTools({
      phase: 'building',
      context: { userMessage: '创建节点', canvasEmpty: true },
    })
    const names = tools.map(t => t.function?.name)
    expect(names).toContain('create_video_node')
    expect(names).toContain('create_image_node')
    expect(names).toContain('create_from_images')
  })

  // ── 3. Memory lifecycle ──

  it('save → recall → forget cycle (with scope + AND filter)', async () => {
    // Save
    const saveRes = await executeToolCall('save_memory', {
      title: 'E2E Pref',
      content: 'User prefers dark theme',
      tags: ['ui', 'theme'],
      scope: 'project',
      type: 'project_preference',
    })
    expect(saveRes.success).toBe(true)
    expect(saveRes.message).toContain('project')

    // Recall
    const recallRes = await executeToolCall('recall_memory', { query: 'dark theme' })
    expect(recallRes.success).toBe(true)
    expect(recallRes.message).toContain('E2E Pref')

    // Forget (AND: scope=project AND tag=ui)
    const forgetRes = await executeToolCall('forget_memory', { scope: 'project', tag: 'ui' })
    expect(forgetRes.success).toBe(true)
    expect(forgetRes.message).toMatch(/1/)

    // Verify gone
    expect(useAgentMemoryStore.getState().memories).toHaveLength(0)
  })

  // ── 4. Phase lifecycle ──

  it('set_phase → SKILLS changes → tool gating changes', async () => {
    // Start idle
    expect(useAgentMemoryStore.getState().currentPhase).toBe('idle')

    // Transition to planning
    const res1 = await executeToolCall('set_phase', { phase: 'planning', reason: 'E2E test' })
    expect(res1.success).toBe(true)
    expect(useAgentMemoryStore.getState().currentPhase).toBe('planning')

    // SKILLS now scoped to planning
    const skills = buildSkillsPromptByPhase('planning')
    expect(skills).toContain('planning 阶段')
    expect(skills).toContain('工作流')

    // Transition to reviewing
    const res2 = await executeToolCall('set_phase', { phase: 'reviewing', reason: 'done building' })
    expect(res2.success).toBe(true)

    // SKILLS now scoped to reviewing
    const reviewSkills = buildSkillsPromptByPhase('reviewing')
    expect(reviewSkills).toContain('reviewing 阶段')
    expect(reviewSkills).toContain('review_generated_image')

    // Tool gating: reviewing phase blocks creation
    const tools = getAgentTools({
      phase: 'reviewing',
      context: { userMessage: '检查', canvasEmpty: false },
    })
    const names = tools.map(t => t.function?.name)
    expect(names).toContain('review_content')
    expect(names).toContain('review_generated_image')
    expect(names).not.toContain('create_video_node')
    expect(names).not.toContain('delete_node')
  })

  // ── 5. Node creation → review pipeline ──

  it('create node → review_generated_image pipeline', async () => {
    // Create a character grid
    const createRes = await executeToolCall('create_character_grid', {
      name: 'E2E Hero',
      description: 'A brave hero with red hair',
    })
    expect(createRes.success).toBe(true)
    const nodeId = createRes.nodeIds?.[0]
    expect(nodeId).toBeDefined()

    // Review it (should score low — no output yet)
    const reviewRes = await executeToolCall('review_generated_image', { nodeId })
    expect(reviewRes.success).toBe(true)
    expect(reviewRes.message).toContain('score')
  })

  // ── 6. discover_tools returns correct schema ──

  it('discover_tools returns review_generated_image when querying "review"', async () => {
    const res = await executeToolCall('discover_tools', { query: 'review' })
    expect(res.success).toBe(true)
    expect(res.message).toContain('review_generated_image')
    expect(res.message).toContain('review_content')
  })

  // ── 7. Memory relevance ranking in system prompt ──

  it('relevant memories injected into system prompt based on user message', () => {
    const memStore = useAgentMemoryStore.getState()
    memStore.saveMemory({
      type: 'project_preference',
      title: '角色风格偏好',
      content: '用户偏好赛博朋克风格角色设计',
      tags: ['角色', '赛博朋克'],
      scope: 'global',
    })
    memStore.saveMemory({
      type: 'project_preference',
      title: '视频时长',
      content: '每段视频8秒',
      tags: ['视频', '时长'],
      scope: 'global',
    })

    const prompt = buildAgentSystemPrompt('director', { userMessage: '设计一个赛博朋克角色' })
    // The relevant memory about 赛博朋克 should appear
    expect(prompt).toContain('赛博朋克')
  })

  // ── 8. Auto-compact session memories ──

  it('session memories auto-compact at 21 entries', () => {
    const memStore = useAgentMemoryStore.getState()
    for (let i = 0; i < 21; i++) {
      memStore.saveMemory({
        type: 'task_summary',
        title: `Note-${i}`,
        content: `Content ${i}`,
        tags: [],
        scope: 'session',
      })
    }
    const memories = useAgentMemoryStore.getState().memories
    const sessionMems = memories.filter(m => m.scope === 'session')
    // After compaction: 21 - 10 old + 1 rollup = 12
    expect(sessionMems.length).toBe(12)
    expect(sessionMems.some(m => m.title.includes('会话上下文摘要'))).toBe(true)
  })

  // ── 9. AGENT_TOOLS parity check ──

  it('every AGENT_TOOLS entry has a case in executeToolCall', async () => {
    // All tools except generate_workflow which needs special setup
    const skipTools = new Set(['generate_workflow', 'batch_execute', 'parallel_execute'])

    for (const tool of AGENT_TOOLS) {
      const name = tool.function?.name
      if (!name || skipTools.has(name)) continue

      // Just verify it doesn't throw "unknown tool" — may return success:false for missing args
      const res = await executeToolCall(name, {})
      // If the tool is truly unknown, executeToolCall returns { success: false, message: 'Unknown tool: ...' }
      if (!res.success && res.message.startsWith('Unknown tool:')) {
        throw new Error(`Tool '${name}' missing from executeToolCall switch`)
      }
    }
  })
})
