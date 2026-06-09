/**
 * Test helpers for the legacy → unified character node migration
 * (tasks 2.4.1–2.4.4).
 *
 * Many existing tests assert on the canvas via `node.type === 'characterGrid'`
 * (or `'characterExtract'` / `'characterManager'`). After the migration in
 * `flowStore.addNode` collapses those into `'characterAsset'` with a
 * `data.mode` discriminator, the bare type comparison no longer matches.
 *
 * Rather than duplicate the legacy-vs-unified branch at every assertion
 * site, tests now go through the helpers below. They accept the legacy
 * type string (which is what the test naturally describes) and return
 * true for *either* a legacy node OR the unified equivalent.
 *
 * The helpers stay test-only (under `__tests__/_helpers/`) on purpose —
 * production code uses the canonical `characterKind` helper exported
 * from `@/providers/nodeExecutor`. Both implementations agree on the
 * same legacy↔mode mapping.
 */

import type { Node } from '@xyflow/react'

// `Node` is re-used by the public `nodesOfType` signature below; keep
// the import here so consumers see the same React Flow type they hand in.

const LEGACY_TYPE_TO_MODE = {
  characterGrid: 'design',
  characterExtract: 'extract',
  characterManager: 'registry',
} as const

export type LegacyCharacterType = keyof typeof LEGACY_TYPE_TO_MODE
export type CharacterMode = (typeof LEGACY_TYPE_TO_MODE)[LegacyCharacterType]

/**
 * Minimal shape needed to inspect a node's character role. Keeping the
 * input loose (`type?: string`, `data?: unknown`) means call sites that
 * derive ad-hoc test objects (e.g. without React Flow's full
 * `Record<string, unknown>` data type) still type-check.
 */
type NodeLike = { type?: string; data?: unknown } | null | undefined

/**
 * True when `node` is the legacy character type or the post-migration
 * `characterAsset` node carrying the corresponding `data.mode`.
 *
 * Use this in place of `node.type === 'characterGrid'` so tests work
 * before AND after a workflow/store has been migrated.
 */
export function isLegacyCharacterNode(
  node: NodeLike,
  legacyType: LegacyCharacterType,
): boolean {
  if (!node) return false
  if (node.type === legacyType) return true
  if (node.type === 'characterAsset') {
    const mode = (node.data as { mode?: unknown } | undefined)?.mode
    return mode === LEGACY_TYPE_TO_MODE[legacyType]
  }
  return false
}

/**
 * Drop-in replacement for the test-local `byType` helpers seen in
 * `agentGenerationEvaluation.test.ts` / `workflowQuality.test.ts`.
 * Returns the matching nodes (caller can `.length` if a count is what
 * they want).
 */
export function nodesOfType(
  nodes: readonly Node[],
  type: string,
): Node[] {
  if (type === 'characterGrid' || type === 'characterExtract' || type === 'characterManager') {
    return nodes.filter(n => isLegacyCharacterNode(n, type as LegacyCharacterType))
  }
  return nodes.filter(n => n.type === type)
}
