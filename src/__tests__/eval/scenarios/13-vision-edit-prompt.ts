/**
 * Scenario 13 — Vision verify EDIT_PROMPT path
 *
 * Canvas has an imageGen whose outputImage is *severely* off-target
 * (matchScore=25, recommendation='edit_prompt'). A naïve retry would just
 * regenerate the same bad image — the Agent must instead edit the prompt
 * to clarify what's missing, then retry.
 *
 * Validates:
 *   - verify_image_semantic recognises severe mismatch and returns
 *     recommendation='edit_prompt'
 *   - Agent picks update_node (not plain retry_node) to fix the root cause
 *   - Updated prompt reflects the missing elements from the verifier
 */

import { roundCall, roundFinish } from '../mockLLM'
import type { Scenario } from '../types'

const scenario: Scenario = {
  id: '13-vision-edit-prompt',
  name: 'Vision Verify — Edit Prompt (severe mismatch)',
  userMessage:
    '镜头3 画面完全偏离了剧本，先检查一下哪里不对，然后改好提示词再重新生成。剧本要求是夜晚天台俯瞰城市的远景。',
  initialCanvas: {
    nodes: [
      {
        id: 'img_shot3',
        type: 'imageGen',
        position: { x: 100, y: 100 },
        data: {
          label: '镜头3 关键帧',
          // Prompt too generic — no time/angle/location details
          prompt: 'A person standing on a building',
          status: 'success',
          outputImage: 'mock://images/shot3-bad.png',
          retryCount: 0,
        },
      },
    ],
  },
  expectedToolCalls: ['get_canvas_state', 'verify_image_semantic', 'update_node', 'retry_node'],
  toolCallOrder: 'ordered',
  budget: {
    maxToolCalls: 6,
    maxTokens: 15_000,
    maxElapsedMs: 3_000,
  },
  mockBackend: {
    verify: {
      response: {
        matchScore: 25,
        detectedSubjects: ['person', 'generic building', 'daylight'],
        missingElements: ['rooftop perspective', 'night atmosphere', 'city skyline wide shot'],
        unexpectedElements: ['daylight', 'ground-level framing'],
        recommendation: 'edit_prompt',
        reasoning: '提示词过于模糊，画面与剧本严重不符',
      },
    },
  },
  mockLLMScript: [
    roundCall('get_canvas_state', {}),
    roundCall('verify_image_semantic', {
      nodeId: 'img_shot3',
      expectedSubjects: ['rooftop overlooking city', 'night', 'wide shot'],
      threshold: 70,
    }),
    roundCall('update_node', {
      nodeId: 'img_shot3',
      updates: {
        prompt:
          'Wide aerial shot from a skyscraper rooftop at night, character standing at the edge overlooking a vast neon city skyline below, deep cyberpunk atmosphere, cinematic framing',
      },
    }),
    roundCall('retry_node', { nodeId: 'img_shot3' }),
    roundFinish('镜头3 偏差严重（matchScore=25），已修正提示词加入夜晚天台俯瞰远景并重新生成。'),
  ],
  verifier: ({ canvas, toolLog }) => {
    const issues: string[] = []
    const calls = new Map(toolLog.map(t => [t.tool, t]))

    // All four tools must have been called in order
    const toolOrder = toolLog.map(t => t.tool)
    for (const t of ['get_canvas_state', 'verify_image_semantic', 'update_node', 'retry_node']) {
      const rec = calls.get(t)
      if (!rec) issues.push(`Expected tool "${t}" was not called`)
      else if (!rec.success) issues.push(`Tool "${t}" failed: ${rec.message.slice(0, 80)}`)
    }

    // Sequence sanity: update_node must happen AFTER verify but BEFORE retry
    const vIdx = toolOrder.indexOf('verify_image_semantic')
    const uIdx = toolOrder.indexOf('update_node')
    const rIdx = toolOrder.indexOf('retry_node')
    if (vIdx >= 0 && uIdx >= 0 && uIdx < vIdx) issues.push('update_node fired before verify_image_semantic')
    if (uIdx >= 0 && rIdx >= 0 && rIdx < uIdx) issues.push('retry_node fired before update_node — misses the edit')

    // verify message must surface edit_prompt verdict + missing elements
    const verifyCall = calls.get('verify_image_semantic')
    if (verifyCall) {
      if (!verifyCall.message.includes('"recommendation": "edit_prompt"')) {
        issues.push('verify_image_semantic did not return recommendation=edit_prompt')
      }
      if (!verifyCall.message.includes('rooftop perspective')) {
        issues.push('verify_image_semantic did not surface rooftop missing element')
      }
    }

    // Canvas state: prompt must now contain "rooftop" + "night" + "skyline"
    const imgNode = canvas.nodes.find(n => n.id === 'img_shot3')
    if (!imgNode) {
      issues.push('Image node disappeared after edit+retry')
    } else {
      const prompt = String(imgNode.data?.prompt ?? '').toLowerCase()
      if (!prompt.includes('rooftop')) issues.push('Updated prompt missing "rooftop"')
      if (!prompt.includes('night')) issues.push('Updated prompt missing "night"')
      if (!prompt.includes('skyline')) issues.push('Updated prompt missing "skyline"')
    }

    const score = Math.max(0, 100 - issues.length * 15)
    return { passed: issues.length === 0, score, issues }
  },
}

export default scenario
