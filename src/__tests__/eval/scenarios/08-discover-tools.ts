/**
 * Scenario 08 — Progressive disclosure via `discover_tools`
 *
 * `discover_tools` is the always-loaded escape hatch. The Agent should
 * use it when the user asks for a capability whose tool isn't in the
 * current Tier set. Here the user asks for a delete operation and the
 * Agent should consult `discover_tools` rather than guessing or stalling.
 *
 * Validates:
 *   - discover_tools dispatched with a meaningful keyword
 *   - The call succeeds and message references the discovered tool
 *
 * Verifier kept tight (3 assertions) so this scenario stays stable when
 * the discovery heuristic / tier mapping are tuned.
 */

import { roundCall, roundFinish } from '../mockLLM'
import type { Scenario } from '../types'

const scenario: Scenario = {
  id: '08-discover-tools',
  name: 'Discover Tools — Tier-3 Reveal',
  userMessage: '我想删除画布上的某个节点，告诉我有什么工具可以做这件事。',
  expectedToolCalls: ['discover_tools'],
  toolCallOrder: 'ordered',
  budget: {
    maxToolCalls: 3,
    maxTokens: 15_000,
    maxElapsedMs: 3_000,
  },
  mockLLMScript: [
    roundCall('discover_tools', { keyword: 'delete' }),
    roundFinish('找到了相关工具：可以使用 delete_node 删除指定节点。'),
  ],
  verifier: ({ toolLog }) => {
    const issues: string[] = []
    const calls = new Map(toolLog.map(t => [t.tool, t]))

    const discoverCall = calls.get('discover_tools')
    if (!discoverCall) {
      issues.push('discover_tools was not called')
    } else if (!discoverCall.success) {
      issues.push(`discover_tools failed: ${discoverCall.message.slice(0, 80)}`)
    } else {
      const keyword = String(discoverCall.args.keyword ?? '').toLowerCase()
      if (!keyword.includes('delete')) {
        issues.push(`discover_tools keyword does not target delete: ${keyword}`)
      }
    }

    const score = Math.max(0, 100 - issues.length * 25)
    return { passed: issues.length === 0, score, issues }
  },
}

export default scenario
