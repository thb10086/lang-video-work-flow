/**
 * Tests for the layered PromptSegment architecture
 * (src/store/chatPromptBuilder.ts:buildAgentSystemPromptSegments).
 *
 * Core invariants:
 *   - Every segment has a unique id and a non-empty text (when included).
 *   - Segments are in canonical order: core → role → skills → image_hint → memory → canvas_state.
 *   - Stability tiers are monotonically non-increasing: stable > semi-stable > dynamic.
 *   - The legacy buildAgentSystemPrompt() output equals joining segments with "\n\n".
 *   - The `core` segment fits the target 800-token budget so Anthropic prompt
 *     caching can realistically cache it within a single cache-control block.
 *   - The `multimodal_input` SKILL only loads when imageCount > 0.
 *   - The `video_workflow_recipe` SKILL loads in building/planning/executing phases.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildAgentSystemPrompt,
  buildAgentSystemPromptSegments,
  buildSystemContentBlocks,
  estimateTokens,
  type PromptSegment,
} from '@/store/chatPromptBuilder'
import { useAgentMemoryStore } from '@/store/agentMemoryStore'
import { useFlowStore } from '@/store/flowStore'

const CORE_TOKEN_BUDGET = 800

function resetAgentState() {
  useFlowStore.setState({ nodes: [], edges: [], projectId: null })
  useAgentMemoryStore.setState({
    memories: [],
    currentPlan: null,
    compactedContexts: [],
    currentPhase: 'idle',
    phaseHistory: [],
  })
}

describe('PromptSegment architecture', () => {
  beforeEach(resetAgentState)

  it('returns segments with unique ids', () => {
    const segs = buildAgentSystemPromptSegments('assistant')
    const ids = segs.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every segment has a non-empty text', () => {
    const segs = buildAgentSystemPromptSegments('assistant')
    for (const s of segs) {
      expect(s.text.length, `segment ${s.id} has empty text`).toBeGreaterThan(0)
    }
  })

  it('starts with core then role', () => {
    const segs = buildAgentSystemPromptSegments('assistant')
    expect(segs[0].id).toBe('core')
    expect(segs[0].stability).toBe('stable')
    expect(segs[1].id).toBe('role')
    expect(segs[1].stability).toBe('semi-stable')
  })

  it('places canvas_state last and marks it dynamic', () => {
    const segs = buildAgentSystemPromptSegments('assistant')
    const last = segs[segs.length - 1]
    expect(last.id).toBe('canvas_state')
    expect(last.stability).toBe('dynamic')
  })

  it('stability tiers are monotonically non-increasing', () => {
    const segs = buildAgentSystemPromptSegments('assistant')
    const order = { stable: 2, 'semi-stable': 1, dynamic: 0 } as const
    for (let i = 1; i < segs.length; i++) {
      expect(
        order[segs[i].stability] <= order[segs[i - 1].stability],
        `segment ${segs[i - 1].id} (${segs[i - 1].stability}) precedes ${segs[i].id} (${segs[i].stability})`,
      ).toBe(true)
    }
  })

  it('core segment fits the ~800 token budget', () => {
    const segs = buildAgentSystemPromptSegments('assistant')
    const core = segs.find(s => s.id === 'core')!
    const tokens = estimateTokens(core.text)
    expect(tokens, `core is ${tokens} tokens, over budget of ${CORE_TOKEN_BUDGET}`).toBeLessThanOrEqual(
      CORE_TOKEN_BUDGET,
    )
  })

  it('legacy buildAgentSystemPrompt matches segment join', () => {
    const expected = buildAgentSystemPromptSegments('assistant')
      .map(s => s.text)
      .filter(Boolean)
      .join('\n\n')
    expect(buildAgentSystemPrompt('assistant')).toBe(expected)
  })

  it('does NOT load multimodal_input skill body when imageCount=0', () => {
    const segs = buildAgentSystemPromptSegments('assistant', { imageCount: 0 })
    const skills = segs.find(s => s.id.startsWith('skills:'))
    // The skill NAME may appear in the "其他可用模块" footer of the skills
    // section, but its body (containing "单图流程" / routing table) must not
    // be present, nor should the id contain ":withImages".
    expect(skills?.id ?? '').not.toContain(':withImages')
    if (skills) {
      expect(skills.text).not.toContain('### 多模态输入处理')
      expect(skills.text).not.toContain('单图流程')
    }
  })

  it('loads multimodal_input skill body when imageCount>0', () => {
    // Force a phase that has skills (pre_production via empty canvas is the default)
    const segs = buildAgentSystemPromptSegments('assistant', { imageCount: 2 })
    const skills = segs.find(s => s.id.startsWith('skills:'))
    expect(skills, 'skills segment should be present').toBeDefined()
    expect(skills!.id).toContain(':withImages')
    // Assert the actual skill body loaded, not merely the name in a footer
    expect(skills!.text).toContain('### 多模态输入处理')
    expect(skills!.text).toContain('单图流程')
  })

  it('includes image_hint segment only when imageCount>0', () => {
    const segsNoImg = buildAgentSystemPromptSegments('assistant', { imageCount: 0 })
    expect(segsNoImg.find(s => s.id === 'image_hint')).toBeUndefined()

    const segsImg = buildAgentSystemPromptSegments('assistant', { imageCount: 3 })
    const hint = segsImg.find(s => s.id === 'image_hint')
    expect(hint).toBeDefined()
    expect(hint!.stability).toBe('dynamic')
    expect(hint!.text).toContain('3 张图像')
  })

  it('loads video_workflow_recipe skill in building phase', () => {
    useAgentMemoryStore.setState({ currentPhase: 'building' })
    const segs = buildAgentSystemPromptSegments('assistant')
    const skills = segs.find(s => s.id.startsWith('skills:'))
    expect(skills).toBeDefined()
    expect(skills!.text).toContain('视频制片 Pipeline')
    expect(skills!.text).toContain('generate_workflow')
  })

  it('loads video_workflow_recipe skill in production phase', () => {
    // Seed a canvas with image nodes so detectCurrentPhase returns 'production'
    useFlowStore.setState({
      nodes: [
        { id: 'img1', type: 'imageGen', position: { x: 0, y: 0 }, data: { status: 'idle' } },
      ],
      edges: [],
      projectId: null,
    })
    const segs = buildAgentSystemPromptSegments('assistant')
    const skills = segs.find(s => s.id.startsWith('skills:'))
    expect(skills).toBeDefined()
    expect(skills!.text).toContain('视频制片 Pipeline')
  })

  it('does not embed the pipeline block in the core segment', () => {
    const segs = buildAgentSystemPromptSegments('assistant')
    const core = segs.find(s => s.id === 'core')!
    // Old monolithic phrases that should be gone from core
    expect(core.text).not.toContain('路径A：快速模式')
    expect(core.text).not.toContain('路径B：逐步模式')
    expect(core.text).not.toContain('用户图片处理协议')
  })

  it('role segment differs between roles', () => {
    const asst = buildAgentSystemPromptSegments('assistant')
    const dir = buildAgentSystemPromptSegments('director')
    const asstRole = asst.find(s => s.id === 'role')!.text
    const dirRole = dir.find(s => s.id === 'role')!.text
    expect(asstRole).not.toBe(dirRole)
  })

  // ── Vision Verify skill presence (regression for the doc-vs-code mismatch fix) ──

  it('loads vision_verify skill in reviewing phase', () => {
    useAgentMemoryStore.setState({ currentPhase: 'reviewing' })
    const segs = buildAgentSystemPromptSegments('assistant')
    const skills = segs.find(s => s.id.startsWith('skills:'))
    expect(skills, 'skills segment should be present in reviewing phase').toBeDefined()
    expect(skills!.text).toContain('视觉质量校验')
    expect(skills!.text).toContain('verify_image_semantic')
  })

  it('loads vision_verify skill in post_production canvas phase', () => {
    // Seed a canvas in post-production (videoStitch + audio)
    useFlowStore.setState({
      nodes: [
        { id: 'stitch1', type: 'videoStitch', position: { x: 0, y: 0 }, data: { status: 'idle' } },
        { id: 'audio1', type: 'audioNode', position: { x: 0, y: 0 }, data: { status: 'idle' } },
      ],
      edges: [],
      projectId: null,
    })
    const segs = buildAgentSystemPromptSegments('assistant')
    const skills = segs.find(s => s.id.startsWith('skills:'))
    expect(skills).toBeDefined()
    expect(skills!.text).toContain('视觉质量校验')
  })

  it('does NOT load vision_verify skill during building phase', () => {
    useAgentMemoryStore.setState({ currentPhase: 'building' })
    const segs = buildAgentSystemPromptSegments('assistant')
    const skills = segs.find(s => s.id.startsWith('skills:'))
    expect(skills).toBeDefined()
    // The skill name may appear in "其他可用模块" footer but the body header
    // (### 视觉质量校验) must NOT be in the loaded section.
    expect(skills!.text).not.toContain('### 视觉质量校验')
  })
})

describe('buildSystemContentBlocks', () => {
  const mkSegs = (items: Array<[string, PromptSegment['stability'], string]>): PromptSegment[] =>
    items.map(([id, stability, text]) => ({ id, stability, text }))

  it('emits one text block per non-empty segment', () => {
    const segs = mkSegs([
      ['core', 'stable', 'A'],
      ['role', 'semi-stable', 'B'],
      ['canvas', 'dynamic', 'C'],
    ])
    const blocks = buildSystemContentBlocks(segs)
    expect(blocks).toHaveLength(3)
    blocks.forEach(b => expect(b.type).toBe('text'))
  })

  it('attaches cache_control only to the last cacheable segment', () => {
    const segs = mkSegs([
      ['core', 'stable', 'A'],
      ['role', 'semi-stable', 'B'],
      ['skills', 'semi-stable', 'C'],
      ['canvas', 'dynamic', 'D'],
    ])
    const blocks = buildSystemContentBlocks(segs)
    expect(blocks[0].cache_control).toBeUndefined() // core
    expect(blocks[1].cache_control).toBeUndefined() // role
    expect(blocks[2].cache_control).toEqual({ type: 'ephemeral' }) // skills — last cacheable
    expect(blocks[3].cache_control).toBeUndefined() // canvas — dynamic
  })

  it('never attaches cache_control to dynamic segments', () => {
    const segs = mkSegs([
      ['core', 'stable', 'A'],
      ['mem', 'dynamic', 'B'],
      ['canvas', 'dynamic', 'C'],
    ])
    const blocks = buildSystemContentBlocks(segs)
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(blocks[1].cache_control).toBeUndefined()
    expect(blocks[2].cache_control).toBeUndefined()
  })

  it('elides empty-text segments entirely', () => {
    const segs = mkSegs([
      ['core', 'stable', 'A'],
      ['empty', 'semi-stable', ''],
      ['canvas', 'dynamic', 'C'],
    ])
    const blocks = buildSystemContentBlocks(segs)
    expect(blocks).toHaveLength(2)
    expect(blocks.map(b => b.text)).toEqual(['A', 'C'])
  })

  it('handles all-dynamic input by emitting no cache breakpoints', () => {
    const segs = mkSegs([
      ['a', 'dynamic', 'X'],
      ['b', 'dynamic', 'Y'],
    ])
    const blocks = buildSystemContentBlocks(segs)
    expect(blocks.every(b => b.cache_control === undefined)).toBe(true)
  })

  it('works end-to-end from a real segment build', () => {
    const segs = buildAgentSystemPromptSegments('assistant')
    const blocks = buildSystemContentBlocks(segs)
    // At least one cache breakpoint must be present (stable core block)
    expect(blocks.some(b => b.cache_control)).toBe(true)
    // No more than 4 breakpoints (Anthropic's hard limit)
    const markers = blocks.filter(b => b.cache_control).length
    expect(markers).toBeLessThanOrEqual(4)
  })
})
