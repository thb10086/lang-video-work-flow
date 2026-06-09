/**
 * workflowMigrations — one-time cleanups applied at app start so old persisted
 * workflows don't break the current schema.
 *
 * Each migration is idempotent and logs to `console.warn` only when it
 * actually mutates the store, so clean workflows stay silent.
 */

import type { Edge, Node } from '@xyflow/react'

import { useFlowStore } from './flowStore'

/** Node types that existed in past releases but have been deleted. */
const REMOVED_NODE_TYPES: ReadonlySet<string> = new Set([
  'imageCrop', // removed in node-functional-parity-cleanup change
])

/**
 * Legacy → unified character node mapping (task 2.4.2).
 *
 * Each legacy node type collapses to the unified `characterAsset` type
 * with its semantic discriminator stored in `data.mode`. Handle ids
 * are preserved as-is across the rename: while we *could* rename
 * `grid-out` to `character-out` for visual consistency, the design
 * grid output is a square IMAGE consumed by image/video `ref-in`
 * sockets — completely different from the CHARACTER record produced
 * by `extract`/`registry`. Edge `sourceHandle`/`targetHandle` are
 * therefore left untouched; downstream consumers continue to type-
 * check correctly.
 */
const CHARACTER_LEGACY_TYPE_TO_MODE: Readonly<Record<string, 'design' | 'extract' | 'registry'>> = {
  characterGrid: 'design',
  characterExtract: 'extract',
  characterManager: 'registry',
}

const CHARACTER_ASSET_TYPE = 'characterAsset' as const

/**
 * Pure migration: rewrites every node whose `type` is a legacy
 * character type to `characterAsset` with `data.mode` set, leaving
 * everything else (id / position / dimensions / data fields / edges)
 * intact.
 *
 * Returns the new arrays plus a count of nodes that were actually
 * mutated so the store-wrapper can decide whether to log.
 *
 * Idempotent: running it on an already-migrated canvas is a no-op
 * (count = 0). If a node already carries `type: 'characterAsset'` but
 * is missing `data.mode`, the function defaults it to `'design'` to
 * keep the dispatcher's contract (any unknown mode falls back to
 * design) consistent at the data layer too — but this counts as a
 * mutation.
 */
export function migrateCharacterAssetNodes(
  nodes: readonly Node[],
  edges: readonly Edge[],
): { nodes: Node[]; edges: Edge[]; migratedNodeCount: number } {
  let migratedNodeCount = 0

  const nextNodes = nodes.map((n) => {
    const legacyMode = CHARACTER_LEGACY_TYPE_TO_MODE[String(n.type)]
    if (legacyMode !== undefined) {
      migratedNodeCount += 1
      return {
        ...n,
        type: CHARACTER_ASSET_TYPE,
        data: {
          ...(n.data ?? {}),
          mode: legacyMode,
        },
      } as Node
    }

    // Already-unified node missing the mode discriminator — heal it.
    if (n.type === CHARACTER_ASSET_TYPE) {
      const data = (n.data ?? {}) as Record<string, unknown>
      const m = data.mode
      if (m !== 'design' && m !== 'extract' && m !== 'registry') {
        migratedNodeCount += 1
        return {
          ...n,
          data: { ...data, mode: 'design' },
        } as Node
      }
    }

    return n
  })

  // Edges: nothing to remap — handle ids are preserved across the
  // type rename. We still return a fresh array so callers can swap it
  // back into the store without referential aliasing surprises.
  const nextEdges = edges.slice()

  return { nodes: nextNodes, edges: nextEdges, migratedNodeCount }
}

/**
 * Filter out any nodes whose `type` is in `REMOVED_NODE_TYPES`, along with
 * every edge touching such a node. Returns the count of removed nodes so the
 * caller can decide whether to log.
 */
export function dropRemovedNodeTypes(): number {
  const store = useFlowStore.getState()
  const keepNodes = store.nodes.filter(n => !REMOVED_NODE_TYPES.has(String(n.type)))
  const removedCount = store.nodes.length - keepNodes.length
  if (removedCount === 0) return 0

  const keepNodeIds = new Set(keepNodes.map(n => n.id))
  const keepEdges = store.edges.filter(
    e => keepNodeIds.has(e.source) && keepNodeIds.has(e.target),
  )

  // Use the setters if they exist on the store; otherwise mutate via zustand.
  // flowStore exposes `setNodes`/`setEdges` via its helper methods, but the
  // safest path is a direct zustand `setState` so we don't trigger history.
  useFlowStore.setState({ nodes: keepNodes, edges: keepEdges })

  console.warn(
    `[migration] dropped ${removedCount} legacy node(s) of removed type(s): ` +
    Array.from(REMOVED_NODE_TYPES).join(', '),
  )
  return removedCount
}

/**
 * Apply `migrateCharacterAssetNodes` to the live store. Counterpart of
 * `dropRemovedNodeTypes`: silent on clean canvases, logs once on
 * mutation. Returns the migrated-node count for caller telemetry.
 */
export function applyCharacterAssetMigration(): number {
  const store = useFlowStore.getState()
  const result = migrateCharacterAssetNodes(store.nodes, store.edges)
  if (result.migratedNodeCount === 0) return 0

  useFlowStore.setState({ nodes: result.nodes, edges: result.edges })
  console.warn(
    `[migration] migrated ${result.migratedNodeCount} legacy character node(s) ` +
    `(characterGrid/Extract/Manager) → unified characterAsset node`,
  )
  return result.migratedNodeCount
}

/** Run every migration once at app start. Safe to call from an effect. */
export function runWorkflowMigrations(): void {
  dropRemovedNodeTypes()

  // Re-enabled at task 2.4.4 (unified character node end-to-end). The
  // canvas now renders `characterAsset` via `WorkflowCanvas.tsx`,
  // `nodeExecutor.ts` dispatches by `characterKind(node)` for both
  // legacy and unified types, and `flowStore.addNode` translates new
  // legacy-typed creates to the unified schema. Persisted canvases
  // that still carry `characterGrid`/`characterExtract`/`characterManager`
  // types from older releases get migrated here; freshly-created nodes
  // already arrive in unified form.
  applyCharacterAssetMigration()
}
