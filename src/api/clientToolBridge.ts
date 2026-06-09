/**
 * Client Tool Bridge — handles reverse RPC from the backend Agent runtime.
 *
 * The backend emits `client_tool_request` SSE events when the LLM calls a
 * tool whose `scope === 'client'` (canvas mutations, image collection,
 * COS uploads, UI affordances). This module owns:
 *
 *   1. Registry of `name → handler`
 *   2. Dispatch with built-in timeout
 *   3. POST result back to backend via `agentSseClient.postClientToolResult`
 *
 * Why client-side? Three categories of operations are intrinsically
 * browser-bound:
 *   - **Canvas mutation**: React Flow lives in the browser; mutating it
 *     remotely would require streaming graph diffs. Direct local execution
 *     is simpler + zero latency.
 *   - **DOM-bound interactions**: file picker, drag overlay, clipboard.
 *   - **Local state sources**: chatStore message history, flowStore
 *     selection, UI focus.
 *
 * The handlers are intentionally thin wrappers around `flowStore` /
 * `chatStore` actions — they exist so the registry can be type-checked
 * and so we can layer cross-cutting concerns (timeout, locked-node check,
 * error wrapping) in one place.
 */
import { useFlowStore } from '@/store/flowStore'
import { useChatStore } from '@/store/chatStore'
import { backendApi } from '@/api/backend'
import { postClientToolResult } from '@/api/agentSseClient'

// ============================================================
// Handler types
// ============================================================

export interface ClientToolContext {
  sessionId: number
  callId: string
}

export type ClientToolHandler = (
  args: Record<string, unknown>,
  ctx: ClientToolContext,
) => Promise<Record<string, unknown> | void>

// ============================================================
// Registry
// ============================================================

const _registry = new Map<string, ClientToolHandler>()

export function registerClientTool(name: string, handler: ClientToolHandler): void {
  if (_registry.has(name)) {
    console.warn(`[clientToolBridge] overwriting handler for ${name}`)
  }
  _registry.set(name, handler)
}

export function getClientToolNames(): string[] {
  return Array.from(_registry.keys())
}

// ============================================================
// Dispatch — called by the SSE event handler in chatStore (Phase 1)
// ============================================================

const DEFAULT_TIMEOUT_MS = 5000

export async function dispatchClientTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ClientToolContext,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  const handler = _registry.get(name)

  // Unknown tool — POST back failure synchronously so backend can move on.
  if (!handler) {
    await postClientToolResult(ctx.sessionId, {
      call_id: ctx.callId,
      ok: false,
      error: `unknown_client_tool: ${name}`,
    })
    return
  }

  // Race the handler against a timeout. If the handler hangs (e.g. UI
  // blocked), we still report a failure so the runtime can proceed.
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<{ __timeout: true }>((resolve) => {
    timer = setTimeout(() => resolve({ __timeout: true }), timeoutMs)
  })

  let result: { ok: boolean; data?: unknown; error?: string }
  try {
    const winner = await Promise.race([
      handler(args, ctx).then((data) => ({ ok: true, data })),
      timeoutPromise,
    ])
    if ('__timeout' in winner) {
      result = { ok: false, error: 'client_timeout' }
    } else {
      result = winner as { ok: boolean; data?: unknown }
    }
  } catch (err) {
    result = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    if (timer) clearTimeout(timer)
  }

  // Best-effort POST. If the network is gone the runtime will hit its own
  // timeout (server-side, default 5s) and synthesize a failure tool_result.
  try {
    await postClientToolResult(ctx.sessionId, {
      call_id: ctx.callId,
      ok: result.ok,
      data: result.data,
      error: result.error,
    })
  } catch (postErr) {
    console.warn('[clientToolBridge] result POST failed', postErr)
  }
}

// ============================================================
// Helpers
// ============================================================

function assertString(value: unknown, key: string): string {
  if (typeof value !== 'string' || !value) {
    throw new Error(`missing or invalid ${key}`)
  }
  return value
}

function assertObject(value: unknown, key: string): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    throw new Error(`missing or invalid ${key}`)
  }
  return value as Record<string, unknown>
}

// ============================================================
// Built-in handlers — canvas.* / images.* / ui.*
// ============================================================

// ── canvas.add_node({ type, position?, data }) → { nodeId } ──
registerClientTool('canvas.add_node', async (args) => {
  const type = assertString(args.type, 'type')
  const data = assertObject(args.data ?? {}, 'data')
  const position = (args.position as { x: number; y: number } | undefined) ?? { x: 0, y: 0 }
  const nodeId = useFlowStore.getState().addNode(type, position, data)
  return { nodeId }
})

// ── canvas.update_node({ node_id, patch }) ──
registerClientTool('canvas.update_node', async (args) => {
  const nodeId = assertString(args.node_id, 'node_id')
  const patch = assertObject(args.patch, 'patch')
  // Locked-node guard
  const node = useFlowStore.getState().nodes.find((n) => n.id === nodeId)
  if (!node) throw new Error(`node_not_found: ${nodeId}`)
  if ((node.data as { locked?: boolean })?.locked) {
    throw new Error('node_locked')
  }
  useFlowStore.getState().updateNodeData(nodeId, patch)
  return { ok: true }
})

// ── canvas.delete_node({ node_id, force? }) ──
registerClientTool('canvas.delete_node', async (args) => {
  const nodeId = assertString(args.node_id, 'node_id')
  const force = Boolean(args.force)
  const node = useFlowStore.getState().nodes.find((n) => n.id === nodeId)
  if (!node) throw new Error(`node_not_found: ${nodeId}`)
  if ((node.data as { locked?: boolean })?.locked && !force) {
    throw new Error('node_locked')
  }
  useFlowStore.getState().removeNode(nodeId)
  return { ok: true }
})

// ── canvas.connect_nodes({ source_label, target_label }) ──
// NOTE: this is a placeholder — the actual port resolution is done by
// the existing `connect_nodes` handler in `agentTools.ts`. Phase 0 keeps
// this stub returning `not_implemented` until the legacy handler is
// migrated to be reusable from the bridge.
registerClientTool('canvas.connect_nodes', async () => {
  throw new Error('canvas.connect_nodes not implemented in Phase 0 (use agentTools.connect_nodes for now)')
})

// ── canvas.highlight({ node_ids }) ──
// Visual hint only; updates the highlight state in flowStore (added later
// in task 2.2.2). For now this is a no-op stub.
registerClientTool('canvas.highlight', async (args) => {
  const ids = (args.node_ids as string[] | undefined) ?? []
  // Placeholder — flowStore.setHighlight lands in task 2.2.2
  void ids
  return { ok: true }
})

// ── canvas.undo() ──
registerClientTool('canvas.undo', async () => {
  const before = useFlowStore.getState().nodes.length
  useFlowStore.getState().undo()
  const after = useFlowStore.getState().nodes.length
  return { ok: true, restored: Math.abs(before - after) }
})

// ── images.collect_user_uploads() → { images: string[] } ──
registerClientTool('images.collect_user_uploads', async () => {
  const msgs = useChatStore.getState().messages
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.role === 'user' && m.images && m.images.length > 0) {
      return { images: [...m.images] }
    }
  }
  return { images: [] }
})

// ── images.upload_to_cos({ data_url }) → { url } ──
registerClientTool('images.upload_to_cos', async (args) => {
  const dataUrl = assertString(args.data_url, 'data_url')
  const result = await backendApi.uploadImage(dataUrl)
  return { url: result.url }
})

// ── ui.show_diff({ before, after }) ──
// Placeholder: surfaces a diff to the approval UI. Implemented in task 2.3.
registerClientTool('ui.show_diff', async () => {
  return { ok: true, shown: false, note: 'show_diff is implemented in task 2.3' }
})

// ── timeline.create({ label?, video_node_ids[], audio_node_ids?, auto_execute? }) ──
//
// Semantic shortcut equivalent to canvas.add_node + N × canvas.connect +
// (optionally) executeNode. Lets the LLM commit a timeline in a single
// tool call instead of orchestrating 5+ steps. Returns the new timeline
// node id and the connection summary so the agent can reference it later.
registerClientTool('timeline.create', async (args) => {
  const videoIds = (args.video_node_ids as string[] | undefined) ?? []
  const audioIds = (args.audio_node_ids as string[] | undefined) ?? []
  const label = (args.label as string | undefined) || '时间轴'
  const autoExecute = args.auto_execute !== false

  if (videoIds.length === 0) {
    throw new Error('video_node_ids must contain at least one node id')
  }

  const flow = useFlowStore.getState()

  // Validate all referenced upstream nodes exist before mutating anything,
  // so partial-failures don't leave dangling timeline nodes on the canvas.
  for (const id of [...videoIds, ...audioIds]) {
    if (!flow.nodes.find((n) => n.id === id)) {
      throw new Error(`upstream node not found: ${id}`)
    }
  }

  // Place the new timeline downstream of the right-most upstream node so
  // the canvas reads left-to-right.
  const upstreamMaxX = [...videoIds, ...audioIds].reduce((max, id) => {
    const n = flow.nodes.find((nn) => nn.id === id)
    return Math.max(max, n?.position?.x ?? 0)
  }, 0)
  const position = { x: upstreamMaxX + 360, y: 0 }

  const timelineId = flow.addNode('timeline', position, {
    label,
    videoClips: [],
    audioClips: [],
    outputCuts: null,
    status: 'idle',
  })

  // Connect via the public store API. We don't cross-import the React Flow
  // edge id helper here; flowStore.onConnect synthesizes one.
  for (const src of videoIds) {
    flow.onConnect({ source: src, target: timelineId, sourceHandle: null, targetHandle: 'video-in' })
  }
  for (const src of audioIds) {
    flow.onConnect({ source: src, target: timelineId, sourceHandle: null, targetHandle: 'audio-in' })
  }

  if (autoExecute) {
    // Lazy import keeps this file independent of the executor module graph.
    const { executeNode } = await import('@/providers/nodeExecutor')
    await executeNode(timelineId)
  }

  return {
    nodeId: timelineId,
    connected: { video: videoIds.length, audio: audioIds.length },
    affected_node_ids: [timelineId],
  }
})

// ── character.* — semantic shortcuts for the unified `characterAsset`
// node introduced in tasks 2.4.1-2.4.4. The backend exposes these as
// client-scope tools (see `client_tools.py`) so the LLM gets a single
// purposeful entry per mode instead of asking it to choose
// `canvas.add_node({type: 'characterAsset', data: {mode: 'design', …}})`.
// We deliberately call `flowStore.addNode` with the *unified* type so
// the new schema flows through end-to-end; the addNode translator in
// `flowStore.ts` would otherwise also rewrite legacy types, but going
// through the canonical type here makes the on-the-wire path explicit
// and self-documenting.

registerClientTool('character.create_grid', async (args) => {
  const name = assertString(args.name, 'name')
  const description = (args.description as string | undefined) ?? ''
  const style = (args.style as string | undefined) ?? 'anime'
  const flow = useFlowStore.getState()
  const nodeId = flow.addNode('characterAsset', { x: 0, y: 0 }, {
    mode: 'design',
    label: `角色: ${name}`,
    name,
    description,
    style,
    outputImage: null,
    status: 'idle',
  })
  // Mirror the legacy frontend behavior in `agentTools.ts` —
  // registering the appearance lets downstream imageGen/videoGen
  // anchor on @<name> tokens automatically.
  if (description) {
    flow.setCharacterAppearance(name, description)
  }
  return { nodeId, affected_node_ids: [nodeId] }
})

registerClientTool('character.create_extract', async (args) => {
  const videoUrl = (args.video_url as string | undefined) ?? null
  const timestamps = (args.timestamps as string | undefined) ?? '1,3'
  const label = (args.label as string | undefined) ?? '角色提取'
  const nodeId = useFlowStore.getState().addNode('characterAsset', { x: 0, y: 0 }, {
    mode: 'extract',
    label,
    videoUrl,
    taskId: null,
    timestamps,
    characterId: null,
    characterUrl: null,
    status: 'idle',
  })
  return { nodeId, affected_node_ids: [nodeId] }
})

registerClientTool('character.create_registry', async (args) => {
  const label = (args.label as string | undefined) ?? '角色管理器'
  const nodeId = useFlowStore.getState().addNode('characterAsset', { x: 0, y: 0 }, {
    mode: 'registry',
    label,
    characters: [],
  })
  return { nodeId, affected_node_ids: [nodeId] }
})

export const clientToolBridge = {
  register: registerClientTool,
  dispatch: dispatchClientTool,
  list: getClientToolNames,
}
