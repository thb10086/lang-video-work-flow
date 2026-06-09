/**
 * Tests for the in-memory client bridge mock used by SSE-driven scenarios.
 *
 * Coverage:
 *   1. Default canvas operations succeed and update the in-memory model
 *   2. Failure injection triggers when call ordinal matches `failNthCall`
 *   3. Latency injection delays at least the configured ms
 *   4. Custom response overrides the canvas default
 *   5. Unknown tools fall through to the bridge's "unknown_client_tool" path
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { installMockClientBridge } from './mockClientBridge'
import {
  dispatchClientTool,
  getClientToolNames,
} from '@/api/clientToolBridge'

// Stub out the network POST so we can inspect what the bridge would send
// back to the backend without actually issuing fetch calls.
vi.mock('@/api/agentSseClient', () => ({
  postClientToolResult: vi.fn().mockResolvedValue(undefined),
}))

import { postClientToolResult } from '@/api/agentSseClient'

const ctx = { sessionId: 1, callId: 'call-1' }

describe('mockClientBridge', () => {
  beforeEach(() => {
    vi.mocked(postClientToolResult).mockClear()
  })

  afterEach(() => {
    // Each test installs its own bridge; nothing to tear down globally
    // because registerClientTool is last-wins.
  })

  it('synthesizes canvas.add_node and tracks the in-memory canvas', async () => {
    const ctrl = installMockClientBridge()

    await dispatchClientTool('canvas.add_node', {
      type: 'imageGen',
      data: { label: 'Hero shot' },
    }, ctx)

    expect(ctrl.canvas.nodes).toHaveLength(1)
    expect(ctrl.canvas.nodes[0]).toMatchObject({
      type: 'imageGen',
      data: { label: 'Hero shot' },
    })
    expect(ctrl.callCount['canvas.add_node']).toBe(1)

    // Bridge POSTs the success result back to the backend.
    expect(postClientToolResult).toHaveBeenCalledWith(1, {
      call_id: 'call-1',
      ok: true,
      data: expect.objectContaining({
        nodeId: ctrl.canvas.nodes[0].id,
        affected_node_ids: [ctrl.canvas.nodes[0].id],
      }),
      error: undefined,
    })

    ctrl.dispose()
  })

  it('returns node_not_found when updating a missing node', async () => {
    installMockClientBridge()

    await dispatchClientTool('canvas.update_node', {
      node_id: 'does-not-exist',
      patch: { label: 'x' },
    }, ctx)

    const calls = vi.mocked(postClientToolResult).mock.calls
    const lastCall = calls[calls.length - 1]
    expect(lastCall?.[1]).toMatchObject({
      ok: false,
      error: expect.stringContaining('node_not_found'),
    })
  })

  it('injects failure on the configured Nth call (1-indexed)', async () => {
    installMockClientBridge({
      failNthCall: { 'canvas.add_node': [2] },
    })

    const lastBody = () => {
      const calls = vi.mocked(postClientToolResult).mock.calls
      return calls[calls.length - 1]?.[1]
    }

    // First call succeeds.
    await dispatchClientTool('canvas.add_node', { type: 'a' }, ctx)
    expect(lastBody()).toMatchObject({ ok: true })

    // Second call fails (mock-injected).
    await dispatchClientTool('canvas.add_node', { type: 'b' }, ctx)
    expect(lastBody()).toMatchObject({
      ok: false,
      error: expect.stringContaining('mock_injected_failure'),
    })

    // Third call succeeds again.
    await dispatchClientTool('canvas.add_node', { type: 'c' }, ctx)
    expect(lastBody()).toMatchObject({ ok: true })
  })

  it('honours latency injection (waits at least the configured ms)', async () => {
    installMockClientBridge({
      latencyMs: { 'canvas.add_node': 30 },
    })

    const start = Date.now()
    await dispatchClientTool('canvas.add_node', { type: 'a' }, ctx)
    const elapsed = Date.now() - start

    // Allow some scheduler slack but assert the delay was applied.
    expect(elapsed).toBeGreaterThanOrEqual(25)
  })

  it('routes through customResponse when provided', async () => {
    installMockClientBridge({
      customResponse: {
        'images.collect_user_uploads': () => ({ images: ['data:image/png;base64,xyz'] }),
      },
    })

    await dispatchClientTool('images.collect_user_uploads', {}, ctx)

    const calls = vi.mocked(postClientToolResult).mock.calls
    const lastCall = calls[calls.length - 1]
    expect(lastCall?.[1]).toMatchObject({
      ok: true,
      data: { images: ['data:image/png;base64,xyz'] },
    })
  })

  it('registers all expected canvas/* and images/* tool names', async () => {
    installMockClientBridge()

    const names = getClientToolNames()
    expect(names).toEqual(expect.arrayContaining([
      'canvas.add_node',
      'canvas.update_node',
      'canvas.delete_node',
      'canvas.connect_nodes',
      'canvas.highlight',
      'canvas.undo',
      'images.collect_user_uploads',
      'images.upload_to_cos',
      'ui.show_diff',
    ]))
  })
})
