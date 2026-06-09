/**
 * Mock Client Tool Bridge — In-memory replacement for `clientToolBridge`
 *
 * Intercepts `client_tool_request` events emitted by the SSE-driven backend
 * runtime and synthesizes results without ever touching the real DOM,
 * React Flow, or chatStore.
 *
 * Design principles (mirrors `mockBackend.ts`):
 *  - No global mutable state: each `install()` call returns a disposer.
 *  - Default success payloads are deterministic — minimal scenarios get
 *    sensible canvas IDs without wiring anything.
 *  - Failure injection (`failNthCall`) and latency (`latencyMs`) are
 *    per-tool to mirror MockBackendConfig ergonomics.
 *
 * Why this lives next to `mockBackend.ts`:
 *  Both are scenario-scoped sandboxes. The runner installs one or both
 *  depending on whether the scenario opts into the SSE runtime path.
 */

import {
  registerClientTool,
  type ClientToolHandler,
  type ClientToolContext,
} from '@/api/clientToolBridge'
import type { MockClientBridgeConfig } from './types'

// ============================================================
// In-memory canvas — minimal model the synthesized handlers need
// ============================================================

interface MockNode {
  id: string
  type: string
  data: Record<string, unknown>
  position: { x: number; y: number }
}

interface MockEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

class InMemoryCanvas {
  nodes: MockNode[] = []
  edges: MockEdge[] = []
  private nodeCounter = 0
  private edgeCounter = 0

  addNode(type: string, data: Record<string, unknown>): MockNode {
    const id = `mock-${type}-${++this.nodeCounter}`
    const node: MockNode = {
      id,
      type,
      data,
      position: { x: this.nodeCounter * 240, y: 0 },
    }
    this.nodes.push(node)
    return node
  }

  updateNode(id: string, data: Record<string, unknown>): MockNode | null {
    const node = this.nodes.find((n) => n.id === id)
    if (!node) return null
    node.data = { ...node.data, ...data }
    return node
  }

  deleteNode(id: string): boolean {
    const before = this.nodes.length
    this.nodes = this.nodes.filter((n) => n.id !== id)
    this.edges = this.edges.filter((e) => e.source !== id && e.target !== id)
    return this.nodes.length < before
  }

  connect(source: string, target: string, sourceHandle?: string, targetHandle?: string): MockEdge {
    const id = `mock-edge-${++this.edgeCounter}`
    const edge: MockEdge = { id, source, target, sourceHandle, targetHandle }
    this.edges.push(edge)
    return edge
  }
}

// ============================================================
// Default per-tool handlers (success path)
// ============================================================

// Default handlers mirror the real bridge's CALLING CONVENTION:
//   - return raw data object on success (gets wrapped to {ok:true, data:...} by dispatch)
//   - throw an Error to signal failure (dispatch wraps it as {ok:false, error:msg})
function defaultHandlers(canvas: InMemoryCanvas): Record<string, ClientToolHandler> {
  return {
    'canvas.add_node': async (args) => {
      const type = String(args.type || 'unknown')
      const data = (args.data as Record<string, unknown>) || {}
      const node = canvas.addNode(type, data)
      return { nodeId: node.id, affected_node_ids: [node.id] }
    },
    'canvas.update_node': async (args) => {
      const id = String(args.node_id)
      const patch = (args.patch as Record<string, unknown>) || {}
      const node = canvas.updateNode(id, patch)
      if (!node) throw new Error(`node_not_found: ${id}`)
      return { ok: true, affected_node_ids: [id] }
    },
    'canvas.delete_node': async (args) => {
      const id = String(args.node_id)
      const ok = canvas.deleteNode(id)
      if (!ok) throw new Error(`node_not_found: ${id}`)
      return { ok: true, affected_node_ids: [id] }
    },
    'canvas.connect_nodes': async (args) => {
      const edge = canvas.connect(
        String(args.source_label || args.source),
        String(args.target_label || args.target),
        args.sourceHandle ? String(args.sourceHandle) : undefined,
        args.targetHandle ? String(args.targetHandle) : undefined,
      )
      return { edgeId: edge.id, affected_node_ids: [edge.source, edge.target] }
    },
    'canvas.highlight': async (args) => {
      const ids = Array.isArray(args.node_ids) ? (args.node_ids as string[]) : []
      return { ok: true, affected_node_ids: ids }
    },
    'canvas.undo': async () => ({ ok: true }),
    'images.collect_user_uploads': async () => ({ images: [] as string[] }),
    'images.upload_to_cos': async (args) => ({
      url: `mock://cos/${String(args.filename || 'file')}`,
      key: 'mock-key',
    }),
    'ui.show_diff': async () => ({ ok: true, shown: false }),
  }
}

// ============================================================
// Controller — tracks per-tool call counts so the failure & latency
// hooks can reference 1-indexed call ordinals.
// ============================================================

export interface MockClientBridgeController {
  canvas: InMemoryCanvas
  /** Number of times each tool has been invoked (cumulative for the install). */
  callCount: Record<string, number>
  /** Disposer that restores the previous handlers. */
  dispose: () => void
}

/**
 * Install the mock bridge for the duration of a scenario.
 *
 * Returns a controller exposing the in-memory canvas (so verifiers can
 * assert on it) and a disposer to restore the previous handlers.
 *
 * Concurrency note: `clientToolBridge` is a process-wide singleton, so
 * tests using this helper MUST run serially. vitest does this by default
 * within a file; cross-file isolation comes for free because each worker
 * has its own module graph.
 */
export function installMockClientBridge(
  config: MockClientBridgeConfig = {},
): MockClientBridgeController {
  const canvas = new InMemoryCanvas()
  const baseline = defaultHandlers(canvas)
  const callCount: Record<string, number> = {}

  // Save the existing handlers so dispose() can restore them. We can't
  // unregister a tool entirely (the bridge has no API for that), but we
  // can re-register no-op handlers that mirror the prior state.
  const restorers: Array<() => void> = []

  for (const [name, defaultHandler] of Object.entries(baseline)) {
    callCount[name] = 0
    const wrapped: ClientToolHandler = async (args, ctx: ClientToolContext) => {
      const idx = ++callCount[name]

      // Latency injection — sleep before any work happens.
      const latency = config.latencyMs?.[name]
      if (latency && latency > 0) {
        await new Promise((r) => setTimeout(r, latency))
      }

      // Failure injection — throw so dispatch wraps it as {ok:false}.
      if (config.failNthCall?.[name]?.includes(idx)) {
        throw new Error(`mock_injected_failure: ${name} call #${idx}`)
      }

      // Custom override takes precedence over the canvas default.
      const custom = config.customResponse?.[name]
      if (custom) {
        const result = await Promise.resolve(custom(args, idx))
        return result as Record<string, unknown>
      }

      // Default success path — handler returns raw data object.
      return defaultHandler(args, ctx)
    }
    registerClientTool(name, wrapped)
    // We don't have a way to "unregister" — registerClientTool last-wins.
    // The disposer just clears local state; the next install() will
    // overwrite again, which is what tests want.
    restorers.push(() => undefined)
  }

  return {
    canvas,
    callCount,
    dispose: () => {
      for (const r of restorers) r()
    },
  }
}
