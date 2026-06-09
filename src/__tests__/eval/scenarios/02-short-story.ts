/**
 * Scenario 02 — Three-Shot Cyberpunk Short
 *
 * User describes a short story. Agent plans, then generates the workflow,
 * then verifies. Validates that generate_workflow produces the right
 * cardinality (1 character + 3 shots).
 */

import { roundCall, roundFinish } from '../mockLLM'
import type { Scenario } from '../types'
import { isLegacyCharacterNode } from '../../_helpers/characterAssetTestHelpers'

const scenario: Scenario = {
  id: '02-short-story',
  name: 'Three-Shot Cyberpunk Short',
  userMessage:
    '帮我做个赛博朋克风格的 3 镜头短片，主角叫林夏，红发黑衣，穿越霓虹雨夜的东京街头，最后在天台俯瞰城市。',
  expectedToolCalls: ['plan_task', 'generate_workflow', 'verify_task'],
  toolCallOrder: 'ordered',
  budget: {
    maxToolCalls: 8,
    maxTokens: 60_000,
    maxElapsedMs: 5_000,
  },
  mockLLMScript: [
    roundCall('plan_task', {
      goal: '创建赛博朋克 3 镜头短片',
      steps: [
        '生成完整工作流骨架',
        '执行关键帧',
        '提交视频生成',
        '自检画布质量',
      ],
    }),
    roundCall('generate_workflow', {
      title: '霓虹雨夜 · 林夏',
      description: '赛博朋克风 3 镜头短片，主角林夏穿越东京街头，最后在天台俯瞰',
      scenario: 'short_drama',
      characterNames: ['林夏'],
      characterDescriptions: [
        'Lin Xia: young Asian woman, crimson red shoulder-length hair, sharp eyes, black leather jacket, dark cyberpunk aesthetic',
      ],
      sceneNames: ['霓虹街', '东京天台'],
      sceneDescriptions: [
        'Tokyo neon-lit alley under heavy rain, reflective wet asphalt, purple and cyan holograms on buildings',
        'Rooftop at night overlooking Tokyo cityscape, distant neon billboards, light drizzle',
      ],
      shotCount: 3,
      shotPrompts: [
        'Cyberpunk Tokyo alley, rainy neon-lit street, Lin Xia with crimson red hair and black leather jacket walking toward camera, reflective wet asphalt, cinematic 4k',
        'Medium shot, Lin Xia (crimson red hair, black leather jacket) pausing under holographic signs, sharp eyes, neon reflections on face',
        'Wide shot, Lin Xia (crimson red hair, black leather jacket) on rooftop overlooking Tokyo cityscape, rain and neon, cinematic composition, 4k',
      ],
      videoPrompts: [
        'Slow tracking push-in. Lin Xia walks forward. Neon reflections. Cinematic 4K. No morphing.',
        'Static medium shot. Subtle head turn. Neon lighting dynamic. 4K.',
        'Slow pull-back reveal of cityscape behind character. 4K.',
      ],
      styleDescription: 'Cyberpunk neon-noir, cold cyan and magenta palette, heavy rain, cinematic film grain',
    }),
    roundCall('verify_task', { checkConnections: true, expectedNodes: 8 }),
    roundFinish('赛博朋克 3 镜头工作流已创建：1 角色 + 2 场景 + 3 关键帧 + 3 视频 + 风格锁定。'),
  ],
  verifier: ({ canvas, toolLog }) => {
    const issues: string[] = []
    const calls = new Map(toolLog.map(t => [t.tool, t]))

    for (const t of ['plan_task', 'generate_workflow', 'verify_task']) {
      const rec = calls.get(t)
      if (!rec) issues.push(`Expected tool "${t}" was not called`)
      else if (!rec.success) issues.push(`Tool "${t}" failed: ${rec.message.slice(0, 80)}`)
    }

    const characterCount = canvas.nodes.filter(n => isLegacyCharacterNode(n, 'characterGrid')).length
    const imageGenCount = canvas.nodes.filter(n => n.type === 'imageGen').length
    const videoGenCount = canvas.nodes.filter(n => n.type === 'videoGen').length

    if (characterCount < 1) issues.push(`Expected >=1 characterGrid, got ${characterCount}`)
    if (imageGenCount < 3) issues.push(`Expected 3 imageGen, got ${imageGenCount}`)
    if (videoGenCount < 3) issues.push(`Expected 3 videoGen, got ${videoGenCount}`)

    // Dependency sanity: at least one edge into an imageGen (from styleLock or character)
    const imageGenIds = new Set(canvas.nodes.filter(n => n.type === 'imageGen').map(n => n.id))
    const imageGenHasIncoming = canvas.edges.some(e => imageGenIds.has(e.target))
    if (!imageGenHasIncoming && imageGenCount > 0) {
      issues.push('imageGen nodes have no incoming edges (character/style references missing)')
    }

    const score = Math.max(0, 100 - issues.length * 12)
    return { passed: issues.length === 0, score, issues }
  },
}

export default scenario
