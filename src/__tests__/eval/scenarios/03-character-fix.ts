/**
 * Scenario 03 — Update an existing character's appearance
 *
 * Seeds canvas with an existing characterGrid node. User asks to change the
 * hair color. Agent should inspect the canvas, find the node, update it.
 *
 * Validates: update_node arg mapping + canvas mutation path.
 */

import { roundCall, roundFinish } from '../mockLLM'
import type { Scenario } from '../types'
import { isLegacyCharacterNode } from '../../_helpers/characterAssetTestHelpers'

const scenario: Scenario = {
  id: '03-character-fix',
  name: 'Update Character Appearance',
  userMessage: '把林夏的头发颜色从红色改成白色，其他保持不变。',
  initialCanvas: {
    nodes: [
      {
        id: 'char_linxia',
        type: 'characterGrid',
        position: { x: 100, y: 100 },
        data: {
          label: '角色: 林夏',
          name: '林夏',
          description:
            'Lin Xia: young Asian woman, crimson red shoulder-length hair, sharp eyes, black leather jacket, cyberpunk aesthetic',
          style: 'anime',
          status: 'success',
          outputImage: 'mock://existing-linxia.png',
        },
      },
    ],
  },
  expectedToolCalls: ['get_canvas_state', 'update_node'],
  toolCallOrder: 'ordered',
  budget: {
    maxToolCalls: 5,
    maxTokens: 15_000,
    maxElapsedMs: 3_000,
  },
  mockLLMScript: [
    roundCall('get_canvas_state', {}),
    roundCall('update_node', {
      nodeId: 'char_linxia',
      updates: {
        description:
          'Lin Xia: young Asian woman, platinum white shoulder-length hair, sharp eyes, black leather jacket, cyberpunk aesthetic',
      },
    }),
    roundFinish('林夏的发色已更新为白色。'),
  ],
  verifier: ({ canvas, toolLog }) => {
    const issues: string[] = []
    const calls = new Map(toolLog.map(t => [t.tool, t]))

    for (const t of ['get_canvas_state', 'update_node']) {
      const rec = calls.get(t)
      if (!rec) issues.push(`Expected tool "${t}" was not called`)
      else if (!rec.success) issues.push(`Tool "${t}" failed: ${rec.message.slice(0, 80)}`)
    }

    // Canvas state: description must now contain "white" and no longer "crimson red"
    const charNode = canvas.nodes.find(n => n.id === 'char_linxia')
    if (!charNode) {
      issues.push('Character node "char_linxia" lost after update')
    } else {
      const desc = String(charNode.data.description ?? '').toLowerCase()
      if (!desc.includes('white')) issues.push('Updated description does not mention "white"')
      if (desc.includes('crimson red')) issues.push('Updated description still has "crimson red"')
    }

    // Did not create new character nodes (no runaway creation)
    const characterCount = canvas.nodes.filter(n => isLegacyCharacterNode(n, 'characterGrid')).length
    if (characterCount !== 1) issues.push(`Expected exactly 1 characterGrid, got ${characterCount}`)

    const score = Math.max(0, 100 - issues.length * 20)
    return { passed: issues.length === 0, score, issues }
  },
}

export default scenario
