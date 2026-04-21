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
export interface MemoryEntry {
  id: string
  type: 'project_preference' | 'character_profile' | 'style_guide' | 'workflow_pattern' | 'user_feedback' | 'task_summary'
  title: string
  content: string
  tags: string[]
  createdAt: number
  updatedAt: number
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
  
  // Working Memory (current session)
  currentPlan: TaskPlan | null
  compactedContexts: CompactedContext[]
  
  // Actions - Memory
  saveMemory: (entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>) => string
  updateMemory: (id: string, updates: Partial<MemoryEntry>) => void
  deleteMemory: (id: string) => void
  recallMemories: (query: string, limit?: number) => MemoryEntry[]
  
  // Actions - Task Planning
  createPlan: (goal: string, steps: string[]) => TaskPlan
  updateStepStatus: (stepId: string, status: TaskStep['status'], result?: string) => void
  completePlan: () => void
  clearPlan: () => void
  
  // Actions - Context Compaction
  addCompactedContext: (summary: string, keyDecisions: string[]) => void
  getRelevantContext: () => string
  
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

export const useAgentMemoryStore = create<AgentMemoryState>()(
  persist(
    (set, get) => ({
      memories: [],
      currentPlan: null,
      compactedContexts: [],

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
        const newEntry: MemoryEntry = {
          ...entry,
          id,
          createdAt: now,
          updatedAt: now,
        }
        // Cap at 50 memories — prune oldest when exceeded
        const memories = get().memories
        const trimmed = memories.length >= 50 ? memories.slice(-49) : memories
        set({ memories: [...trimmed, newEntry] })
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

      getRelevantContext: () => {
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

        // Index-based memory injection: title + type only, not full content
        // (Claude Code pattern: index layer is always loaded, details on demand)
        const recentMemories = memories.slice(-8)
        if (recentMemories.length > 0) {
          const memIndex = recentMemories.map(m =>
            `- [${m.type}] ${m.title}${m.content.length > 80 ? ` (${m.content.slice(0, 60)}...)` : `: ${m.content}`}`
          ).join('\n')
          parts.push(`记忆索引 (${memories.length}条):\n${memIndex}`)
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
        // Don't persist working memory (plan, compacted contexts)
      }),
    }
  )
)
