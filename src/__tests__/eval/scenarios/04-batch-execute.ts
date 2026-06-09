/**
 * Scenario 04 — Direct Agent node creation via `create_image_node`
 *
 * The user names a single deliverable. The Agent should NOT spin up the
 * full `generate_workflow` orchestration for one node; it should call
 * `create_image_node` directly with the explicit args.
 *
 * Validates:
 *   - create_image_node is dispatched with the explicit prompt + aspectRatio
 *   - Resulting node carries those fields back to the canvas
 *   - No collateral nodes were created (no over-eager generation)
 *
 * Note: keeps the verifier tight (≤ 4 assertions) so this scenario is
 * stable across small canvas-default refactors.
 */

import { roundCall, roundFinish } from '../mockLLM'
import type { Scenario } from '../types'

const scenario: Scenario = {
  id: '04-batch-execute',
  name: 'Direct Image Node Creation',
  userMessage: '在画布上创建一个图片节点，prompt 是 sunset over the ocean，比例 16:9。',
  expectedToolCalls: ['create_image_node'],
  toolCallOrder: 'ordered',
  budget: {
    maxToolCalls: 3,
    maxTokens: 15_000,
    maxElapsedMs: 3_000,
  },
  mockLLMScript: [
    roundCall('create_image_node', {
      prompt: 'sunset over the ocean',
      aspectRatio: '16:9',
    }),
    roundFinish('已创建图片节点：sunset over the ocean (16:9)。'),
  ],
  verifier: ({ canvas, toolLog }) => {
    const issues: string[] = []
    const calls = new Map(toolLog.map(t => [t.tool, t]))

    const createCall = calls.get('create_image_node')
    if (!createCall) {
      issues.push('create_image_node was not called')
    } else if (!createCall.success) {
      issues.push(`create_image_node failed: ${createCall.message.slice(0, 80)}`)
    } else {
      if (createCall.args.prompt !== 'sunset over the ocean') {
        issues.push(`prompt arg mismatch: ${createCall.args.prompt}`)
      }
      if (createCall.args.aspectRatio !== '16:9') {
        issues.push(`aspectRatio arg mismatch: ${createCall.args.aspectRatio}`)
      }
    }

    // Exactly one imageGen node should exist now.
    const imageNodes = canvas.nodes.filter(n => n.type === 'imageGen')
    if (imageNodes.length !== 1) {
      issues.push(`Expected exactly 1 imageGen node, got ${imageNodes.length}`)
    } else {
      const prompt = String(imageNodes[0].data?.prompt ?? '').toLowerCase()
      if (!prompt.includes('sunset')) {
        issues.push('Created node prompt does not contain "sunset"')
      }
    }

    const score = Math.max(0, 100 - issues.length * 20)
    return { passed: issues.length === 0, score, issues }
  },
}

export default scenario
