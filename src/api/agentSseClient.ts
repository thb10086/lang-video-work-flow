/**
 * Agent SSE Client — connects the thin frontend to the backend Agent runtime.
 *
 * Responsibilities:
 *   1. Create a session via `POST /api/agent/sessions`
 *   2. Open an SSE stream via `GET /api/agent/sessions/{id}/events`
 *   3. Auto-reconnect with `Last-Event-ID` so missed events replay
 *   4. Dedupe events by `seq` (defensive against double-replay)
 *   5. Forward `client_tool_request` events to the registered bridge so the
 *      browser can execute and POST back the result
 *   6. Surface `approval_required` events to the approval queue
 *
 * The frontend `chatStore` consumes the AsyncIterable<AgentEvent> returned
 * by `run(...)` and updates UI state per event type.
 *
 * Wire format mirrors `server/app/agents/streaming.py:AgentEventPayload`.
 */
import { ENV } from '@/lib/env'

const BACKEND_URL = ENV.BACKEND_URL

// ============================================================
// Wire-format types (mirror server/app/agents/streaming.py)
// ============================================================

export type AgentEventType =
  | 'session_start'
  | 'phase_change'
  | 'reasoning_delta'
  | 'tool_call'
  | 'tool_result'
  | 'client_tool_request'
  | 'subagent_started'
  | 'subagent_finished'
  | 'approval_required'
  | 'approval_decision'
  | 'node_ref'
  | 'stats_update'
  | 'error'
  | 'final'
  | 'done'

export interface AgentEvent {
  type: AgentEventType
  seq: number
  timestamp?: string
  // Type-specific payload — flat shape, matches backend
  session_id?: string
  model?: string
  role?: string
  phase?: string
  reason?: string
  text?: string
  call_id?: string
  name?: string
  args?: Record<string, unknown>
  scope?: 'server' | 'client'
  ok?: boolean
  data?: unknown
  hints?: string[]
  next_step?: string
  error?: { code: string; message: string; recoverable: boolean }
  timeout_ms?: number
  subagent_id?: string
  parent_call_id?: string
  goal?: string
  approved?: boolean
  risk_level?: 'safe' | 'low' | 'medium' | 'high' | 'critical'
  diff?: Record<string, unknown>
  message_id?: string
  node_ids?: string[]
  tokens?: number
  elapsed_ms?: number
  rounds?: number
  tool_calls?: number
  code?: string
  message?: string
  recoverable?: boolean
  stop_reason?: string
  tool_calls_summary?: Array<Record<string, unknown>>
}

export interface RunOptions {
  message: string
  images?: string[]
  role?: string
  model?: string
  projectId?: number | null
  /** AbortSignal to cancel the session. */
  signal?: AbortSignal
}

export interface RunHandle {
  /** Backend session id. Available after `POST /sessions` resolves. */
  sessionId: number
  /** Async iterable of typed events. Iteration ends after `done` arrives. */
  events: AsyncIterable<AgentEvent>
  /** Cancel the session both server- and client-side. */
  cancel: () => Promise<void>
}

// ============================================================
// Reverse RPC: client tool result POST helper
// ============================================================

export interface ClientToolResultPayload {
  call_id: string
  ok: boolean
  data?: unknown
  error?: string
}

export async function postClientToolResult(
  sessionId: number,
  body: ClientToolResultPayload,
): Promise<void> {
  const url = `${BACKEND_URL}/api/agent/sessions/${sessionId}/client-tool-result`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let msg = res.statusText
    try {
      const b = await res.json()
      msg = b.detail || b.message || msg
    } catch { /* swallow */ }
    throw new Error(`client-tool-result POST failed (${res.status}): ${msg}`)
  }
}

// ============================================================
// Reverse RPC: approval decision POST helper
// ============================================================

export interface ApprovalDecisionPayload {
  approved: boolean
  reason?: string
}

export async function postApprovalDecision(
  sessionId: number,
  callId: string,
  body: ApprovalDecisionPayload,
): Promise<void> {
  const url = `${BACKEND_URL}/api/agent/sessions/${sessionId}/approval/${encodeURIComponent(callId)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`approval POST failed (${res.status}): ${res.statusText}`)
  }
}

// ============================================================
// Session lifecycle
// ============================================================

interface CreateSessionResponse {
  session_id: number
}

async function createSession(opts: RunOptions): Promise<number> {
  const url = `${BACKEND_URL}/api/agent/sessions`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: opts.message,
      images: opts.images || [],
      role: opts.role || 'assistant',
      model: opts.model || '',
      project_id: opts.projectId ?? null,
    }),
  })
  if (!res.ok) {
    let msg = res.statusText
    try {
      const b = await res.json()
      msg = b.detail || b.message || msg
    } catch { /* swallow */ }
    throw new Error(`create session failed (${res.status}): ${msg}`)
  }
  const body = (await res.json()) as CreateSessionResponse
  return body.session_id
}

async function cancelSession(sessionId: number): Promise<void> {
  try {
    await fetch(`${BACKEND_URL}/api/agent/sessions/${sessionId}/cancel`, {
      method: 'POST',
    })
  } catch {
    // Best-effort: server may already be terminal.
  }
}

// ============================================================
// SSE iteration with reconnect + dedupe
// ============================================================

async function* iterateEvents(
  sessionId: number,
  signal: AbortSignal,
): AsyncIterable<AgentEvent> {
  let lastSeq = 0
  let seenSeqs = new Set<number>()
  // Bound the dedupe set so it doesn't grow without limit on long sessions.
  const SEEN_BUDGET = 1024

  // Reconnect loop. EventSource handles its own auto-reconnect with the
  // Last-Event-ID it remembered, but we own the loop so we can also handle
  // explicit cancel + final-shutdown semantics cleanly.
  outer: while (!signal.aborted) {
    const url = new URL(`${BACKEND_URL}/api/agent/sessions/${sessionId}/events`)
    // EventSource doesn't allow custom headers in browsers, but it auto-sends
    // Last-Event-ID after the first reconnect via its built-in `id:` field.
    // For the FIRST connect after a manual disconnect we pass after_seq via
    // query param as a hint to the server (which it uses if header missing).
    if (lastSeq > 0) url.searchParams.set('after_seq', String(lastSeq))

    const es = new EventSource(url.toString(), { withCredentials: false })

    // Yield events as they arrive. We bridge EventSource → AsyncIterable
    // through a queue.
    type Cell = { value?: AgentEvent; done?: boolean; err?: Error }
    const queue: Cell[] = []
    let resolver: ((cell: Cell) => void) | null = null

    const push = (cell: Cell) => {
      if (resolver) {
        const r = resolver
        resolver = null
        r(cell)
      } else {
        queue.push(cell)
      }
    }

    es.onmessage = (ev: MessageEvent<string>) => {
      try {
        const evt = JSON.parse(ev.data) as AgentEvent
        if (typeof evt.seq === 'number') {
          if (seenSeqs.has(evt.seq)) return // dedupe
          seenSeqs.add(evt.seq)
          if (seenSeqs.size > SEEN_BUDGET) {
            // Trim to bottom half by reseeding with most recent values.
            const values = Array.from(seenSeqs).sort((a, b) => b - a).slice(0, SEEN_BUDGET / 2)
            seenSeqs = new Set(values)
          }
          if (evt.seq > lastSeq) lastSeq = evt.seq
        }
        push({ value: evt })
      } catch (parseErr) {
        console.warn('[agentSseClient] failed to parse event', parseErr, ev.data)
      }
    }

    es.onerror = () => {
      // EventSource will auto-reconnect for transient errors. We close
      // the loop's inner generator so the outer while-loop can re-create
      // a fresh stream — but only if not user-cancelled.
      push({ err: new Error('sse_error') })
    }

    const onAbort = () => {
      try { es.close() } catch { /* ignore */ }
      push({ done: true })
    }
    signal.addEventListener('abort', onAbort, { once: true })

    try {
      while (true) {
        const cell: Cell = await new Promise<Cell>((resolve) => {
          if (queue.length > 0) {
            resolve(queue.shift()!)
          } else {
            resolver = resolve
          }
        })
        if (cell.done) {
          break outer
        }
        if (cell.err) {
          // Inner error — break out, outer loop reconnects.
          break
        }
        const evt = cell.value!
        yield evt
        if (evt.type === 'done') {
          // Clean shutdown — exit both loops.
          break outer
        }
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      try { es.close() } catch { /* ignore */ }
    }

    // Reconnect with backoff before the outer loop iterates.
    if (!signal.aborted) {
      await new Promise((r) => setTimeout(r, 800))
    }
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Run a single Agent session. Returns immediately after the session is
 * created on the backend; consume the `events` iterable to drive UI.
 *
 * Cancel by calling `handle.cancel()` OR aborting the optional `signal`.
 */
export async function runAgent(opts: RunOptions): Promise<RunHandle> {
  const sessionId = await createSession(opts)

  // Combine an internal AbortController with the caller's signal so we
  // own a single abort source.
  const ctrl = new AbortController()
  const externalSignal = opts.signal
  if (externalSignal) {
    if (externalSignal.aborted) ctrl.abort()
    else externalSignal.addEventListener('abort', () => ctrl.abort(), { once: true })
  }

  const events = iterateEvents(sessionId, ctrl.signal)

  const cancel = async () => {
    if (!ctrl.signal.aborted) ctrl.abort()
    await cancelSession(sessionId)
  }

  return { sessionId, events, cancel }
}

export const agentSseClient = {
  run: runAgent,
  postClientToolResult,
  postApprovalDecision,
}
