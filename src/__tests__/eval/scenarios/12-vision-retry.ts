/**
 * Scenario 12 — Vision verify RETRY path
 *
 * Canvas has an imageGen node with an outputImage that only partially matches
 * the prompt. Vision verify returns matchScore=55 with recommendation='retry'.
 * Agent decides to retry the node (regenerate) without changing the prompt.
 *
 * Validates:
 *   - verify_image_semantic flags the mismatch
 *   - Agent picks the RIGHT follow-up action (retry_node, not update_node)
 *   - missingElements surfaced in the tool result
 */

import { roundCall, roundFinish } from '../mockLLM'
import type { Scenario } from '../types'

const scenario: Scenario = {
  id: '12-vision-retry',
  name: 'Vision Verify — Retry (score below threshold)',
  userMessage: '镜头2 的关键帧看起来不太对，帮我检查一下然后重新生成。',
  initialCanvas: {
    nodes: [
      {
        id: 'img_shot2',
        type: 'imageGen',
        position: { x: 100, y: 100 },
        data: {
          label: '镜头2 关键帧',
          prompt:
            'A bustling cyberpunk street at night with neon signs and rain, wide-angle shot',
          status: 'success',
          outputImage: 'mock://images/shot2-wrong.png',
          retryCount: 0,
        },
      },
    ],
  },
  expectedToolCalls: ['get_canvas_state', 'verify_image_semantic', 'retry_node'],
  toolCallOrder: 'ordered',
  budget: {
    maxToolCalls: 6,
    maxTokens: 15_000,
    maxElapsedMs: 3_000,
  },
  mockBackend: {
    verify: {
      response: {
        matchScore: 55,
        detectedSubjects: ['daytime urban scene'],
        missingElements: ['cyberpunk neon signs', 'night atmosphere', 'rain'],
        unexpectedElements: ['daylight'],
        recommendation: 'retry',
        reasoning: '画面为白天街景，缺失霓虹、雨夜氛围',
      },
    },
  },
  mockLLMScript: [
    roundCall('get_canvas_state', {}),
    roundCall('verify_image_semantic', {
      nodeId: 'img_shot2',
      expectedSubjects: ['cyberpunk street at night', 'neon signs', 'rain'],
      threshold: 70,
    }),
    roundCall('retry_node', { nodeId: 'img_shot2' }),
    roundFinish('镜头2 校验不通过（matchScore=55，缺失霓虹/雨夜氛围），已触发重试。'),
  ],
  verifier: ({ canvas, toolLog }) => {
    const issues: string[] = []
    const calls = new Map(toolLog.map(t => [t.tool, t]))

    // Expected sequence in order
    const toolOrder = toolLog.map(t => t.tool)
    const verifyIdx = toolOrder.indexOf('verify_image_semantic')
    const retryIdx = toolOrder.indexOf('retry_node')
    if (verifyIdx < 0) issues.push('verify_image_semantic was not called')
    if (retryIdx < 0) issues.push('retry_node was not called')
    if (verifyIdx >= 0 && retryIdx >= 0 && verifyIdx > retryIdx) {
      issues.push('retry_node fired before verify_image_semantic — wrong order')
    }

    const verifyCall = calls.get('verify_image_semantic')
    if (verifyCall) {
      if (!verifyCall.success) issues.push(`verify_image_semantic failed: ${verifyCall.message.slice(0, 80)}`)
      // Must surface the missing elements in the structured JSON body
      if (!verifyCall.message.includes('cyberpunk neon signs')) {
        issues.push('verify_image_semantic did not surface missingElements')
      }
      if (!verifyCall.message.includes('"recommendation": "retry"')) {
        issues.push('verify_image_semantic did not return recommendation=retry')
      }
    }

    const retryCall = calls.get('retry_node')
    if (retryCall) {
      if (!retryCall.success) issues.push(`retry_node failed: ${retryCall.message.slice(0, 80)}`)
      if (retryCall.args.nodeId !== 'img_shot2') {
        issues.push(`retry_node targeted wrong node: ${retryCall.args.nodeId}`)
      }
    }

    // Canvas should have the image node reset by retry_node (status=idle, retryCount>=1)
    const imgNode = canvas.nodes.find(n => n.id === 'img_shot2')
    if (!imgNode) {
      issues.push('Image node disappeared after retry_node')
    } else {
      const retryCount = Number(imgNode.data?.retryCount ?? 0)
      if (retryCount < 1) {
        issues.push(`retry_node did not increment retryCount (got ${retryCount})`)
      }
    }

    const score = Math.max(0, 100 - issues.length * 20)
    return { passed: issues.length === 0, score, issues }
  },
}

export default scenario
