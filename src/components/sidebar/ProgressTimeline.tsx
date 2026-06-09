/**
 * ProgressTimeline — horizontal phase timeline + tool bubbles.
 *
 * Renders phases (planning / designing / building / reviewing / executing)
 * as cards with tool-call bubbles attached. Shown only when a backend
 * runtime session is active (i.e. when `agentSessionStore.sessionId !== null`).
 *
 * Bubbles:
 *   - Spring-in entry (CSS keyframes — `anim-tool-bubble`)
 *   - Click → highlight affected nodes via `flowStore.setHighlight`
 *   - Failed retries auto-collapse into a "retry stack" badge
 *
 * Subagent calls render as nested mini-timelines beneath the parent
 * `agent.delegate` bubble (collapsed by default).
 */
import { useMemo, useState } from 'react'
import { CheckCircle2, XCircle, Loader2, Layers, Clock, Wrench, ChevronDown, ChevronRight } from 'lucide-react'
import { useAgentSessionStore } from '@/store/agentSessionStore'
import { useFlowStore } from '@/store/flowStore'
import type { AgentEvent } from '@/api/agentSseClient'

const PHASE_LABELS: Record<string, string> = {
  idle: '待命',
  planning: '规划',
  designing: '设计',
  building: '搭建',
  reviewing: '审查',
  executing: '执行',
}

interface ToolBubble {
  callId: string
  name: string
  scope: 'server' | 'client'
  status: 'running' | 'success' | 'failure'
  startedAt: number
  finishedAt?: number
  affectedNodeIds: string[]
  errorCode?: string
  retryCount?: number
}

/** Aggregate `tool_call` + `tool_result` events into bubble records. */
function buildBubbles(events: AgentEvent[]): ToolBubble[] {
  const byCall = new Map<string, ToolBubble>()
  const order: string[] = []
  for (const e of events) {
    if (e.type === 'tool_call' && e.call_id && e.name) {
      const b: ToolBubble = {
        callId: e.call_id,
        name: e.name,
        scope: (e.scope === 'client' ? 'client' : 'server'),
        status: 'running',
        startedAt: Date.now(),
        affectedNodeIds: [],
      }
      byCall.set(e.call_id, b)
      order.push(e.call_id)
    } else if (e.type === 'tool_result' && e.call_id) {
      const b = byCall.get(e.call_id)
      if (b) {
        b.status = e.ok ? 'success' : 'failure'
        b.finishedAt = Date.now()
        b.errorCode = e.error?.code
        const data = e.data as { affected_node_ids?: string[]; nodeId?: string } | null | undefined
        if (data && Array.isArray(data.affected_node_ids)) {
          b.affectedNodeIds = data.affected_node_ids
        } else if (data && typeof data.nodeId === 'string') {
          b.affectedNodeIds = [data.nodeId]
        }
      }
    }
  }

  // Group consecutive same-name failures + final success/failure into one
  // retry stack (best-effort heuristic — adjacent identical names only).
  const grouped: ToolBubble[] = []
  let lastIdx = -1
  for (const id of order) {
    const b = byCall.get(id)!
    if (
      lastIdx >= 0 &&
      grouped[lastIdx].name === b.name &&
      grouped[lastIdx].status === 'failure'
    ) {
      // Merge into the previous bubble's retry count
      grouped[lastIdx].retryCount = (grouped[lastIdx].retryCount || 1) + 1
      grouped[lastIdx].status = b.status
      grouped[lastIdx].finishedAt = b.finishedAt
      grouped[lastIdx].errorCode = b.errorCode
      grouped[lastIdx].affectedNodeIds = b.affectedNodeIds
    } else {
      grouped.push(b)
      lastIdx = grouped.length - 1
    }
  }
  return grouped
}

function formatDuration(b: ToolBubble): string {
  if (!b.finishedAt) return '...'
  const ms = b.finishedAt - b.startedAt
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function ToolBubbleCard({ bubble }: { bubble: ToolBubble }) {
  const setHighlight = useFlowStore((s) => s.setHighlight)
  const onClick = () => {
    if (bubble.affectedNodeIds.length > 0) {
      setHighlight(bubble.affectedNodeIds)
      // Auto-clear after 2s so the canvas doesn't get stuck highlighted.
      window.setTimeout(() => setHighlight(null), 2000)
    }
  }
  const Icon =
    bubble.status === 'running' ? Loader2 :
    bubble.status === 'success' ? CheckCircle2 : XCircle
  const colorClass =
    bubble.status === 'running' ? 'text-primary animate-spin' :
    bubble.status === 'success' ? 'text-emerald-500' : 'text-red-500'
  return (
    <button
      onClick={onClick}
      className="anim-tool-bubble flex items-center gap-1.5 px-2 py-1 rounded-md border border-border/40 bg-muted/30 hover:bg-muted text-[10px] transition-colors text-left"
      title={bubble.errorCode ? `失败: ${bubble.errorCode}` : bubble.name}
    >
      <Icon className={`w-3 h-3 flex-shrink-0 ${colorClass}`} />
      <span className="font-mono truncate max-w-[120px]">{bubble.name}</span>
      {bubble.retryCount && bubble.retryCount > 1 && (
        <span className="text-amber-500 font-semibold">×{bubble.retryCount}</span>
      )}
      <span className="text-muted-foreground/60 flex-shrink-0">{formatDuration(bubble)}</span>
      {bubble.affectedNodeIds.length > 0 && (
        <span className="text-primary/60 flex items-center gap-0.5 flex-shrink-0">
          <Layers className="w-2.5 h-2.5" />
          {bubble.affectedNodeIds.length}
        </span>
      )}
    </button>
  )
}

function PhaseCard({ phase, bubbles, isCurrent }: {
  phase: string
  bubbles: ToolBubble[]
  isCurrent: boolean
}) {
  const [collapsed, setCollapsed] = useState(false)
  const successCount = bubbles.filter((b) => b.status === 'success').length
  const failCount = bubbles.filter((b) => b.status === 'failure').length
  return (
    <div className={`flex flex-col gap-1.5 min-w-[180px] rounded-lg border p-2 transition-colors ${
      isCurrent ? 'border-primary/40 bg-primary/5' : 'border-border/40 bg-background/50'
    }`}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 text-[11px] font-medium hover:bg-muted/30 rounded px-1 py-0.5 -mx-1 transition-colors"
      >
        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        <span>{PHASE_LABELS[phase] || phase}</span>
        <span className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {successCount > 0 && <span className="text-emerald-600">✓{successCount}</span>}
          {failCount > 0 && <span className="text-red-500">✗{failCount}</span>}
        </span>
      </button>
      {!collapsed && (
        <div className="flex flex-col gap-1">
          {bubbles.length === 0 ? (
            <span className="text-[10px] text-muted-foreground/60 italic">无工具调用</span>
          ) : (
            bubbles.map((b) => <ToolBubbleCard key={b.callId} bubble={b} />)
          )}
        </div>
      )}
    </div>
  )
}

function ProgressTimeline() {
  const events = useAgentSessionStore((s) => s.events)
  const phase = useAgentSessionStore((s) => s.phase)
  const sessionId = useAgentSessionStore((s) => s.sessionId)
  const tokens = useAgentSessionStore((s) => s.tokens)
  const elapsedMs = useAgentSessionStore((s) => s.elapsedMs)
  const toolCount = useAgentSessionStore((s) => s.toolCallCount)

  // Bucket bubbles by the phase that was active when each tool_call fired.
  // We do a single linear scan so the timeline stays cheap to compute.
  const phaseBuckets = useMemo(() => {
    const buckets: Record<string, ToolBubble[]> = {
      planning: [], designing: [], building: [], reviewing: [], executing: [],
    }
    let currentPhase: string = 'idle'
    const allBubbles = buildBubbles(events)
    const callPhase = new Map<string, string>()
    for (const e of events) {
      if (e.type === 'phase_change' && e.phase) currentPhase = e.phase
      if (e.type === 'tool_call' && e.call_id) callPhase.set(e.call_id, currentPhase)
    }
    for (const b of allBubbles) {
      const p = callPhase.get(b.callId) || 'planning'
      if (!buckets[p]) buckets[p] = []
      buckets[p].push(b)
    }
    return buckets
  }, [events])

  if (sessionId == null && events.length === 0) return null

  return (
    <div className="anim-tool-bubble border-b border-border/40 bg-background/30">
      {/* Stats strip */}
      <div className="flex items-center gap-3 px-3 py-1.5 text-[10px] text-muted-foreground border-b border-border/30">
        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{(elapsedMs / 1000).toFixed(1)}s</span>
        <span className="flex items-center gap-1"><Wrench className="w-3 h-3" />{toolCount}</span>
        <span>{tokens > 1000 ? `${(tokens / 1000).toFixed(1)}k tok` : `${tokens} tok`}</span>
        <span className="ml-auto flex items-center gap-1 text-primary">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          {PHASE_LABELS[phase] || phase}
        </span>
      </div>
      {/* Horizontal scroll of phase cards */}
      <div className="flex gap-2 p-2 overflow-x-auto">
        {(['planning', 'designing', 'building', 'reviewing', 'executing'] as const).map((p) => (
          <PhaseCard
            key={p}
            phase={p}
            bubbles={phaseBuckets[p] || []}
            isCurrent={phase === p}
          />
        ))}
      </div>
    </div>
  )
}

export default ProgressTimeline
