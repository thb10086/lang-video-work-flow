/**
 * Scenario 11 — Vision verify ACCEPT path
 *
 * Canvas has an imageGen node with an outputImage. User asks whether the
 * frame looks right. Agent inspects the canvas, calls `verify_image_semantic`
 * on the target node, the mock vision backend returns matchScore=92 with
 * recommendation='accept', so the Agent confirms the frame is good.
 *
 * Validates:
 *   - verify_image_semantic is dispatched with the right nodeId + subjects
 *   - The mock vision verify hooked via `mockBackend.verify` fires exactly
 *     once and is consumed by the tool handler
 *   - Tool result contains structured JSON with matchScore + recommendation
 */

import { roundCall, roundFinish } from '../mockLLM'
import type { Scenario } from '../types'

const scenario: Scenario = {
  id: '11-vision-accept',
  name: 'Vision Verify — Accept (high matchScore)',
  userMessage: '镜头1 的关键帧已经生成了，帮我确认一下画面里确实有林夏这个角色，如果没问题就不用改了。',
  initialCanvas: {
    nodes: [
      {
        id: 'img_shot1',
        type: 'imageGen',
        position: { x: 100, y: 100 },
        data: {
          label: '镜头1 关键帧',
          prompt:
            'A young Asian woman with crimson red shoulder-length hair, Lin Xia, standing on a cyberpunk rooftop at night',
          status: 'success',
          outputImage: 'mock://images/shot1.png',
        },
      },
    ],
  },
  expectedToolCalls: ['get_canvas_state', 'verify_image_semantic'],
  toolCallOrder: 'ordered',
  budget: {
    maxToolCalls: 5,
    maxTokens: 15_000,
    maxElapsedMs: 3_000,
  },
  mockBackend: {
    verify: {
      response: {
        matchScore: 92,
        detectedSubjects: ['character Lin Xia', 'cyberpunk rooftop'],
        missingElements: [],
        unexpectedElements: [],
        recommendation: 'accept',
        reasoning: '林夏特征清晰，屋顶赛博朋克风格明显',
      },
    },
  },
  mockLLMScript: [
    roundCall('get_canvas_state', {}),
    roundCall('verify_image_semantic', {
      nodeId: 'img_shot1',
      expectedSubjects: ['character Lin Xia', 'cyberpunk rooftop at night'],
      threshold: 70,
    }),
    roundFinish('镜头1 的画面检查通过（matchScore=92）— 林夏特征清晰，构图符合预期。'),
  ],
  verifier: ({ canvas, toolLog }) => {
    const issues: string[] = []
    const calls = new Map(toolLog.map(t => [t.tool, t]))

    // Sequence sanity
    for (const t of ['get_canvas_state', 'verify_image_semantic']) {
      const rec = calls.get(t)
      if (!rec) issues.push(`Expected tool "${t}" was not called`)
      else if (!rec.success) issues.push(`Tool "${t}" failed: ${rec.message.slice(0, 80)}`)
    }

    // verify_image_semantic targeted the right node + carried expected subjects
    const verifyCall = calls.get('verify_image_semantic')
    if (verifyCall) {
      if (verifyCall.args.nodeId !== 'img_shot1') {
        issues.push(`verify_image_semantic nodeId mismatch: got ${verifyCall.args.nodeId}`)
      }
      const subjects = verifyCall.args.expectedSubjects as string[] | undefined
      if (!subjects || subjects.length === 0) {
        issues.push('verify_image_semantic was called without expectedSubjects')
      }
      // Tool message must contain the accept verdict JSON
      if (!verifyCall.message.includes('matchScore=92')) {
        issues.push('verify_image_semantic message missing matchScore=92')
      }
      if (!verifyCall.message.includes('"recommendation": "accept"')) {
        issues.push('verify_image_semantic did not return recommendation=accept')
      }
    }

    // Canvas must not have been mutated — this scenario is a pure check
    const imgNode = canvas.nodes.find(n => n.id === 'img_shot1')
    if (!imgNode) issues.push('Initial imageGen node disappeared')

    const score = Math.max(0, 100 - issues.length * 20)
    return { passed: issues.length === 0, score, issues }
  },
}

export default scenario
