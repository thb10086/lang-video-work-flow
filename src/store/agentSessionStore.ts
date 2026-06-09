/**
 * Agent Session Store — frontend-side state for the backend SSE runtime.
 *
 * Owns:
 *   - current session id / phase / events log
 *   - approval queue (high-risk tool calls awaiting user decision)
 *   - active controller (for cancel)
 *
 * The chatStore subscribes to events from this store to update messages.
 * UI components (ProgressTimeline / ApprovalDialog / NodeChatBinding)
 * subscribe directly.
 */
import { create } from 'zustand'
import type { AgentEvent } from '@/api/agentSseClient'
import { postApprovalDecision } from '@/api/agentSseClient'

export interface ApprovalRequest {
  callId: string
  toolName: string
  args: Record<string, unknown>
  riskLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical'
  diff?: Record<string, unknown>
  receivedAt: number
}

export interface AgentSessionState {
  // ── Active session ──
  sessionId: number | null
  phase: string
  events: AgentEvent[]
  /** Cap events buffer to avoid unbounded growth on long sessions. */
  maxEvents: number

  // ── Approval queue ──
  approvalQueue: ApprovalRequest[]

  // ── Highlighted nodes (for canvas ↔ chat binding) ──
  highlightedNodeIds: Set<string>

  // ── Stats ──
  tokens: number
  toolCallCount: number
  rounds: number
  elapsedMs: number

  // Actions
  startSession: (sessionId: number) => void
  ingestEvent: (event: AgentEvent) => void
  endSession: () => void
  setHighlight: (ids: string[] | null) => void
  approveCall: (callId: string, approved: boolean, reason?: string) => Promise<void>
  clearApprovalQueue: () => void
}

const MAX_EVENTS_DEFAULT = 2000

export const useAgentSessionStore = create<AgentSessionState>((set, get) => ({
  sessionId: null,
  phase: 'idle',
  events: [],
  maxEvents: MAX_EVENTS_DEFAULT,
  approvalQueue: [],
  highlightedNodeIds: new Set<string>(),
  tokens: 0,
  toolCallCount: 0,
  rounds: 0,
  elapsedMs: 0,

  startSession: (sessionId) => {
    set({
      sessionId,
      phase: 'idle',
      events: [],
      approvalQueue: [],
      tokens: 0,
      toolCallCount: 0,
      rounds: 0,
      elapsedMs: 0,
    })
  },

  ingestEvent: (event) => {
    const { events, maxEvents, approvalQueue } = get()
    // Append + trim
    const next = events.length >= maxEvents ? events.slice(-Math.floor(maxEvents / 2)) : events
    next.push(event)

    // Side effects per event type
    let phase = get().phase
    let queue = approvalQueue
    let tokens = get().tokens
    let toolCalls = get().toolCallCount
    let rounds = get().rounds
    let elapsed = get().elapsedMs

    switch (event.type) {
      case 'phase_change':
        if (event.phase) phase = event.phase
        break
      case 'approval_required':
        if (event.call_id && event.name && event.risk_level) {
          queue = [
            ...queue,
            {
              callId: event.call_id,
              toolName: event.name,
              args: event.args || {},
              riskLevel: event.risk_level,
              diff: event.diff,
              receivedAt: Date.now(),
            },
          ]
        }
        break
      case 'approval_decision':
        if (event.call_id) {
          queue = queue.filter((r) => r.callId !== event.call_id)
        }
        break
      case 'tool_call':
        toolCalls += 1
        break
      case 'stats_update':
        if (typeof event.tokens === 'number') tokens = event.tokens
        if (typeof event.tool_calls === 'number') toolCalls = event.tool_calls
        if (typeof event.rounds === 'number') rounds = event.rounds
        if (typeof event.elapsed_ms === 'number') elapsed = event.elapsed_ms
        break
      default:
        break
    }

    set({
      events: next,
      phase,
      approvalQueue: queue,
      tokens,
      toolCallCount: toolCalls,
      rounds,
      elapsedMs: elapsed,
    })
  },

  endSession: () => {
    set({
      sessionId: null,
      // Keep events buffer so the user can still scroll the timeline.
      // Reset queue defensively (any unanswered approval is no longer relevant).
      approvalQueue: [],
    })
  },

  setHighlight: (ids) => {
    set({ highlightedNodeIds: ids ? new Set(ids) : new Set() })
  },

  approveCall: async (callId, approved, reason) => {
    const sessionId = get().sessionId
    if (sessionId == null) return
    try {
      await postApprovalDecision(sessionId, callId, { approved, reason })
    } finally {
      set({
        approvalQueue: get().approvalQueue.filter((r) => r.callId !== callId),
      })
    }
  },

  clearApprovalQueue: () => {
    set({ approvalQueue: [] })
  },
}))
