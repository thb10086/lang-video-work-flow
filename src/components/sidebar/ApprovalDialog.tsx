/**
 * ApprovalDialog — modal that surfaces high-risk tool calls awaiting
 * user decision. Subscribes to `agentSessionStore.approvalQueue` and shows
 * the head of the queue.
 *
 * Keyboard shortcuts:
 *   Cmd/Ctrl+Enter → approve
 *   Esc           → deny
 */
import { useEffect } from 'react'
import { Shield, ShieldCheck, ShieldAlert, X } from 'lucide-react'
import { useAgentSessionStore } from '@/store/agentSessionStore'

const RISK_COLORS: Record<string, { ring: string; badge: string; icon: typeof Shield }> = {
  safe:     { ring: 'ring-emerald-500/40', badge: 'bg-emerald-500/10 text-emerald-600',  icon: ShieldCheck },
  low:      { ring: 'ring-emerald-500/40', badge: 'bg-emerald-500/10 text-emerald-600',  icon: ShieldCheck },
  medium:   { ring: 'ring-amber-500/40',   badge: 'bg-amber-500/10 text-amber-600',      icon: Shield },
  high:     { ring: 'ring-orange-500/40',  badge: 'bg-orange-500/10 text-orange-600',    icon: ShieldAlert },
  critical: { ring: 'ring-red-500/40',     badge: 'bg-red-500/10 text-red-600',          icon: ShieldAlert },
}

const RISK_LABELS: Record<string, string> = {
  safe: '安全', low: '低风险', medium: '中等', high: '高风险', critical: '关键风险',
}

function ApprovalDialog() {
  const queue = useAgentSessionStore((s) => s.approvalQueue)
  const approveCall = useAgentSessionStore((s) => s.approveCall)

  const head = queue[0]

  useEffect(() => {
    if (!head) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void approveCall(head.callId, true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        void approveCall(head.callId, false, 'user_dismissed')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [head, approveCall])

  if (!head) return null

  const riskCfg = RISK_COLORS[head.riskLevel] || RISK_COLORS.medium
  const RiskIcon = riskCfg.icon

  // Best-effort diff — show node ids/labels when present.
  const diffEntries: Array<{ key: string; value: unknown }> = []
  if (head.diff && typeof head.diff === 'object') {
    for (const [k, v] of Object.entries(head.diff)) {
      diffEntries.push({ key: k, value: v })
    }
  }

  return (
    <div
      className="anim-dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          void approveCall(head.callId, false, 'user_dismissed_backdrop')
        }
      }}
    >
      <div className={`anim-dialog-panel w-full max-w-md rounded-xl bg-card border border-border shadow-2xl ring-2 ${riskCfg.ring}`}>
        {/* Header */}
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <RiskIcon className="w-5 h-5 text-foreground/80" />
          <div className="flex-1">
            <div className="text-sm font-semibold">需要确认</div>
            <div className="text-[11px] text-muted-foreground">
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded ${riskCfg.badge} font-medium`}>
                {RISK_LABELS[head.riskLevel] || head.riskLevel}
              </span>
              <span className="ml-2 font-mono">{head.toolName}</span>
            </div>
          </div>
          <button
            onClick={() => void approveCall(head.callId, false, 'user_dismissed')}
            className="p-1 rounded hover:bg-muted transition-colors"
            title="拒绝 (Esc)"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Diff body */}
        <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
          {diffEntries.length === 0 ? (
            <pre className="text-[11px] font-mono bg-muted/40 rounded px-2 py-1.5 overflow-x-auto">
              {JSON.stringify(head.args, null, 2)}
            </pre>
          ) : (
            diffEntries.map(({ key, value }) => (
              <div key={key} className="text-xs">
                <span className="font-mono text-primary/80">{key}: </span>
                {Array.isArray(value) ? (
                  <ul className="ml-4 list-disc space-y-0.5">
                    {value.slice(0, 10).map((v, i) => (
                      <li key={i} className="text-muted-foreground">
                        {typeof v === 'string' ? v : JSON.stringify(v)}
                      </li>
                    ))}
                    {value.length > 10 && (
                      <li className="text-muted-foreground/60 italic">…等 {value.length - 10} 项</li>
                    )}
                  </ul>
                ) : (
                  <pre className="inline text-muted-foreground">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</pre>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 p-3 border-t border-border bg-muted/20">
          <span className="text-[10px] text-muted-foreground/70">
            <kbd className="px-1 py-0.5 rounded border border-border bg-background font-mono text-[10px]">Cmd+Enter</kbd> 通过 ·
            <kbd className="ml-1 px-1 py-0.5 rounded border border-border bg-background font-mono text-[10px]">Esc</kbd> 拒绝
          </span>
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => void approveCall(head.callId, false, 'user_denied')}
              className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-muted transition-colors"
            >
              拒绝
            </button>
            <button
              onClick={() => void approveCall(head.callId, true)}
              className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              通过
            </button>
          </div>
        </div>

        {/* Queue indicator */}
        {queue.length > 1 && (
          <div className="px-3 pb-2 text-[10px] text-muted-foreground/60">
            队列中还有 {queue.length - 1} 个待审批
          </div>
        )}
      </div>
    </div>
  )
}

export default ApprovalDialog
