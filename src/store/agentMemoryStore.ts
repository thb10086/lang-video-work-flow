/**
 * Agent Memory Store
 * 
 * 借鉴 Claude Code 记忆架构:
 * - Long-term Memory: localStorage 持久化，跨会话保留（项目偏好、角色设定、常用风格）
 * - Short-term Memory: 当前会话上下文，自动压缩
 * - Working Memory: 当前任务状态（计划、进度、待验证项）
 * 
 * 参考: Claude Code CLAUDE.md + memory/NOTES.md 模式
 * 参考: Cursor Agent 的 context compaction 机制
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ── Task Plan (Cursor Agent Pattern) ──
export interface TaskStep {
  id: string
  description: string
  status: 'pending' | 'in_progress' | 'done' | 'failed'
  result?: string
}

export interface TaskPlan {
  goal: string
  steps: TaskStep[]
  createdAt: number
  completedAt?: number
}

// ── Memory Entry ──
/**
 * Scope mirrors Claude Code's hierarchical memory levels:
 * - session: tab-bound, wiped on reload (useful for "this turn I chose 16:9")
 * - project: canvas-bound (keyed by flowStore.projectId); only loaded when
 *   that project is active — mirrors CLAUDE.md per-repo
 * - global: user-level, always available across every project
 */
export type MemoryScope = 'session' | 'project' | 'global'

// ── Agent workflow phase (Claude Code explicit-state pattern) ──
// Rather than infer the Agent's stage from tool-use history (brittle),
// the Agent self-declares it via `set_phase`. Tier selection then gates
// tool availability per phase (see `getAgentTools` in toolDefinitions).
export type PhaseId =
  | 'idle'       // no phase gating — default; Agent works freely
  | 'planning'   // shaping plan — disallow create_*_node
  | 'designing'  // character/scene/style prep — allow Tier 2 but not execute
  | 'building'   // actively creating nodes — full Tier 2
  | 'reviewing'  // self-review — allow review tools, deny destructive ops
  | 'executing'  // running batched renders — allow retry/batch/parallel

export interface PhaseHistoryEntry {
  phase: PhaseId
  reason: string
  timestamp: number
}

export interface MemoryEntry {
  id: string
  type: 'project_preference' | 'character_profile' | 'style_guide' | 'workflow_pattern' | 'user_feedback' | 'task_summary'
  title: string
  content: string
  tags: string[]
  createdAt: number
  updatedAt: number
  // ── Claude Code-style scoping (added in agent-pro-upgrade) ──
  scope?: MemoryScope // default 'session' when omitted at save; 'global' for legacy-migrated rows
  projectId?: number  // only meaningful when scope === 'project'
  pinned?: boolean    // always included in relevance ranker top-K regardless of tag match
  lastAccessedAt?: number // refreshed on recall; used for recency decay
}

// ── Compacted Context ──
export interface CompactedContext {
  summary: string
  keyDecisions: string[]
  timestamp: number
}

export interface AgentMemoryState {
  // Long-term Memory (persisted)
  memories: MemoryEntry[]

  // Phase state (persisted) — Claude Code explicit-state pattern
  currentPhase: PhaseId
  phaseHistory: PhaseHistoryEntry[]

  // Working Memory (current session)
  currentPlan: TaskPlan | null
  compactedContexts: CompactedContext[]
  
  // Actions - Memory
  saveMemory: (entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>) => string
  updateMemory: (id: string, updates: Partial<MemoryEntry>) => void
  deleteMemory: (id: string) => void
  recallMemories: (query: string, limit?: number) => MemoryEntry[]
  /** Remove memory entries matching any of {id,tag,scope,olderThan}. Returns removed count. */
  forgetMemory: (filter: { id?: string; tag?: string; scope?: MemoryScope; olderThan?: number }) => number
  
  // Actions - Task Planning
  createPlan: (goal: string, steps: string[]) => TaskPlan
  updateStepStatus: (stepId: string, status: TaskStep['status'], result?: string) => void
  completePlan: () => void
  clearPlan: () => void
  
  // Actions - Phase state machine
  setPhase: (phase: PhaseId, reason?: string) => void

  // Actions - Context Compaction
  addCompactedContext: (summary: string, keyDecisions: string[]) => void
  /**
   * Return the system-prompt memory block. If `opts.message` is provided,
   * memories are relevance-ranked against it (tag overlap + recency + pinned
   * boost); otherwise the index-style fallback is used.
   */
  getRelevantContext: (opts?: { message?: string; projectId?: number | null; k?: number; maxChars?: number }) => string
  
  // Utility
  getMemorySnapshot: () => string
}

let _memoryCounter = 0
function genMemId() {
  return `mem_${Date.now()}_${++_memoryCounter}`
}
function genStepId() {
  return `step_${Date.now()}_${++_memoryCounter}`
}

// ── Relevance ranker ──
// Pure function (exported for tests). Ranks by tag-overlap + recency half-life
// with a pinned-always bonus. Recency uses 7-day half-life.
const RECENCY_HALF_LIFE_DAYS = 7

function tokenize(s: string): string[] {
  if (!s) return []
  // Split on whitespace, punctuation, Chinese punctuation.
  return s.toLowerCase().split(/[\s,.!?;:，。！？；：、]+/).filter(t => t.length >= 2)
}

export function rankMemories(
  message: string,
  memories: MemoryEntry[],
  opts: { k?: number; now?: number } = {}
): MemoryEntry[] {
  const k = opts.k ?? 5
  const now = opts.now ?? Date.now()
  const msgTokens = new Set(tokenize(message))

  // Score: tagMatches*2 + keywordInTitle*1 + recency + pinnedBoost
  const scored = memories.map(m => {
    let score = 0
    // Tag overlap — strong signal
    for (const tag of m.tags || []) {
      if (msgTokens.has(tag.toLowerCase())) score += 2
    }
    // Title token overlap — weak signal
    for (const t of tokenize(m.title)) {
      if (msgTokens.has(t)) score += 1
    }
    // Recency half-life (access or update)
    const t0 = m.lastAccessedAt || m.updatedAt
    const ageDays = Math.max(0, (now - t0) / (1000 * 60 * 60 * 24))
    score += Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS) // 0..1 decaying
    // Pinned boost — guarantees inclusion regardless of overlap
    if (m.pinned) score += 100
    return { m, score }
  })

  // Pinned always first (sorted by score within pinned), then top-(k - pinned) by score.
  scored.sort((a, b) => b.score - a.score)
  const picked: MemoryEntry[] = []
  const seen = new Set<string>()
  for (const { m, score } of scored) {
    if (picked.length >= k) break
    // Include pinned always, or score > 0 meaning some signal (recency alone
    // would be ~0 for very old entries → filter out pure noise).
    if (m.pinned || score > 0.2) {
      if (!seen.has(m.id)) {
        picked.push(m)
        seen.add(m.id)
      }
    }
  }
  return picked
}

export const useAgentMemoryStore = create<AgentMemoryState>()(
  persist(
    (set, get) => ({
      memories: [],
      currentPhase: 'idle',
      phaseHistory: [],
      currentPlan: null,
      compactedContexts: [],

      // ── Phase state machine ──
      setPhase: (phase, reason) => {
        const entry: PhaseHistoryEntry = {
          phase,
          reason: reason || '',
          timestamp: Date.now(),
        }
        // Cap history at 50 to prevent unbounded growth in long sessions.
        const history = get().phaseHistory
        const trimmedHistory = history.length >= 50 ? history.slice(-49) : history
        set({ currentPhase: phase, phaseHistory: [...trimmedHistory, entry] })
      },

      // ── Memory CRUD ──
      saveMemory: (entry) => {
        // Deduplication: update existing memory with same type+title instead of creating duplicate
        const existing = get().memories.find(m =>
          m.type === entry.type && m.title === entry.title
        )
        if (existing) {
          get().updateMemory(existing.id, { content: entry.content, tags: entry.tags })
          return existing.id
        }

        const id = genMemId()
        const now = Date.now()
        // Normalise scope: default to 'session' so agents can opt into
        // 'project' or 'global' explicitly. projectId is ignored unless
        // scope === 'project' — the handler fills it from flowStore.
        const scope: MemoryScope = entry.scope || 'session'
        const newEntry: MemoryEntry = {
          ...entry,
          id,
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
          scope,
          projectId: scope === 'project' ? entry.projectId : undefined,
          pinned: entry.pinned === true ? true : undefined,
        }
        // Cap at 50 memories — prune oldest when exceeded
        const memories = get().memories
        const trimmed = memories.length >= 50 ? memories.slice(-49) : memories
        let next = [...trimmed, newEntry]

        // ── Auto-compact session-scoped memories when over 20 entries ──
        // Claude Code /memory compact mirror: keep the most-recent 11
        // session entries verbatim and roll up the oldest 10 into a single
        // summary row. No LLM call — pure textual join capped at 600 chars.
        const sessionRows = next.filter(m => m.scope === 'session')
        if (sessionRows.length > 20) {
          const sortedSession = [...sessionRows].sort((a, b) => a.createdAt - b.createdAt)
          const toRollup = sortedSession.slice(0, 10)
          const rollupIds = new Set(toRollup.map(m => m.id))
          const rollupBody = toRollup
            .map(m => `[${m.type}] ${m.title}: ${m.content.slice(0, 40)}`)
            .join(' | ')
            .slice(0, 600)
          const rollupEntry: MemoryEntry = {
            id: genMemId(),
            type: 'task_summary',
            title: `会话上下文摘要 (10 条)`,
            content: rollupBody,
            tags: ['rollup', 'session'],
            scope: 'session',
            createdAt: toRollup[0].createdAt,
            updatedAt: now,
            lastAccessedAt: now,
          }
          next = next.filter(m => !rollupIds.has(m.id))
          next.push(rollupEntry)
        }

        set({ memories: next })
        return id
      },

      updateMemory: (id, updates) => {
        set({
          memories: get().memories.map(m =>
            m.id === id ? { ...m, ...updates, updatedAt: Date.now() } : m
          ),
        })
      },

      deleteMemory: (id) => {
        set({ memories: get().memories.filter(m => m.id !== id) })
      },

      forgetMemory: ({ id, tag, scope, olderThan }) => {
        // At least one filter must be provided.
        if (!id && !tag && !scope && typeof olderThan !== 'number') return 0
        const before = get().memories.length
        const ageCutoff = typeof olderThan === 'number' ? Date.now() - olderThan : undefined
        const tagLower = tag?.toLowerCase()
        // AND semantics: a memory is removed only when ALL provided filters match.
        const kept = get().memories.filter(m => {
          let matched = true
          if (id)                      matched = matched && m.id === id
          if (tagLower)                matched = matched && (m.tags || []).some(t => t.toLowerCase() === tagLower)
          if (scope)                   matched = matched && m.scope === scope
          if (ageCutoff !== undefined) matched = matched && m.updatedAt < ageCutoff
          return !matched // keep if NOT matched
        })
        set({ memories: kept })
        return before - kept.length
      },

      recallMemories: (query, limit = 5) => {
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
        const scored = get().memories.map(m => {
          let score = 0
          const titleLower = m.title.toLowerCase()
          const contentLower = m.content.toLowerCase()
          const tagsLower = m.tags.map(t => t.toLowerCase())

          for (const term of terms) {
            if (titleLower.includes(term)) score += 3
            if (contentLower.includes(term)) score += 2
            if (tagsLower.some(t => t.includes(term))) score += 2
          }
          // Recency bonus (decay over 30 days)
          const age = (Date.now() - m.updatedAt) / (1000 * 60 * 60 * 24)
          score += Math.max(0, 1 - age / 30)
          // Type priority: task_summary > workflow_pattern > others
          if (m.type === 'task_summary') score += 0.5
          if (m.type === 'workflow_pattern') score += 0.3
          return { entry: m, score }
        })
        return scored
          .filter(s => s.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map(s => s.entry)
      },

      // ── Task Planning ──
      createPlan: (goal, stepDescriptions) => {
        const plan: TaskPlan = {
          goal,
          steps: stepDescriptions.map(desc => ({
            id: genStepId(),
            description: desc,
            status: 'pending',
          })),
          createdAt: Date.now(),
        }
        set({ currentPlan: plan })
        return plan
      },

      updateStepStatus: (stepId, status, result) => {
        const plan = get().currentPlan
        if (!plan) return
        set({
          currentPlan: {
            ...plan,
            steps: plan.steps.map(s =>
              s.id === stepId ? { ...s, status, result } : s
            ),
          },
        })
      },

      completePlan: () => {
        const plan = get().currentPlan
        if (!plan) return
        set({
          currentPlan: { ...plan, completedAt: Date.now() },
        })
        // Auto-save as memory
        get().saveMemory({
          type: 'task_summary',
          title: `已完成: ${plan.goal}`,
          content: plan.steps.map(s => `[${s.status}] ${s.description}${s.result ? ` → ${s.result}` : ''}`).join('\n'),
          tags: ['task', 'completed'],
        })
      },

      clearPlan: () => {
        set({ currentPlan: null })
      },

      // ── Context Compaction ──
      addCompactedContext: (summary, keyDecisions) => {
        const ctx: CompactedContext = {
          summary,
          keyDecisions,
          timestamp: Date.now(),
        }
        const existing = get().compactedContexts
        // Keep last 5 compacted contexts
        set({ compactedContexts: [...existing.slice(-4), ctx] })
      },

      getRelevantContext: (opts) => {
        const { compactedContexts, currentPlan, memories } = get()
        const parts: string[] = []

        // Current plan (always include if active)
        if (currentPlan && !currentPlan.completedAt) {
          const planStr = currentPlan.steps.map(s => {
            const icon = s.status === 'done' ? '[done]' : s.status === 'in_progress' ? '[doing]' : s.status === 'failed' ? '[fail]' : '[todo]'
            return `  ${icon} ${s.description}${s.result ? ` → ${s.result}` : ''}`
          }).join('\n')
          parts.push(`当前任务: ${currentPlan.goal}\n${planStr}`)
        }

        // Compacted context (only latest)
        if (compactedContexts.length > 0) {
          const latest = compactedContexts[compactedContexts.length - 1]
          parts.push(`对话摘要: ${latest.summary.slice(0, 200)}`)
        }

        // ── Scope-aware visibility filter ──
        // project-scoped entries only surface when on the matching canvas;
        // everything else (session + global) is always visible.
        const currentProjectId = opts?.projectId ?? null
        const visible = memories.filter(m => {
          if (m.scope !== 'project') return true
          return m.projectId === currentProjectId
        })

        // ── Relevance-ranked top-K when a user message is provided ──
        // Claude Code pattern: only inject memories likely to matter this turn,
        // not the full index, to stay inside the 800-char prompt budget.
        const k = opts?.k ?? 5
        const maxChars = opts?.maxChars ?? 800
        const ranked = opts?.message
          ? rankMemories(opts.message, visible, { k })
          : visible.slice(-Math.min(k, 5))

        if (ranked.length > 0) {
          const lines = ranked.map(m => {
            const pin = m.pinned ? '[pin] ' : ''
            const body = m.content.length > 80 ? `${m.content.slice(0, 60)}...` : m.content
            return `- ${pin}[${m.type}] ${m.title}: ${body}`
          })
          let buf = ''
          let injected = 0
          for (const line of lines) {
            if ((buf.length + line.length + 1) > maxChars) break
            buf += (injected === 0 ? '' : '\n') + line
            injected++
          }
          const footer = injected < ranked.length || ranked.length < visible.length
            ? `\n...(剩余 ${visible.length - injected} 条见 recall_memory)`
            : ''
          parts.push(`相关记忆 (top-${injected}/${visible.length}):\n${buf}${footer}`)
        }

        return parts.join('\n\n')
      },

      getMemorySnapshot: () => {
        const { memories, currentPlan } = get()
        const lines: string[] = []
        lines.push(`长期记忆: ${memories.length} 条`)
        if (currentPlan) {
          const done = currentPlan.steps.filter(s => s.status === 'done').length
          lines.push(`当前任务: ${currentPlan.goal} (${done}/${currentPlan.steps.length})`)
        }
        return lines.join(' | ')
      },
    }),
    {
      name: 'ai-workflow-agent-memory',
      partialize: (state) => ({
        memories: state.memories,
        currentPhase: state.currentPhase,
        phaseHistory: state.phaseHistory,
        // Don't persist working memory (plan, compacted contexts)
      }),
      // ── One-time migration ──
      // Entries saved before agent-pro-upgrade lack a scope. Stamp them
      // 'global' so they stay universally visible (safest default —
      // pre-upgrade users treated memory as global already). Ensures the
      // relevance ranker never drops them for missing `scope`.
      onRehydrateStorage: () => (state) => {
        if (!state || !Array.isArray(state.memories)) return
        let mutated = false
        const upgraded = state.memories.map(m => {
          if (m.scope) return m
          mutated = true
          return { ...m, scope: 'global' as MemoryScope }
        })
        if (mutated) state.memories = upgraded
      },
    }
  )
)
