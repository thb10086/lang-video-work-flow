/**
 * forgetMemory.test.ts — forget_memory 工具 + auto-compact 测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useAgentMemoryStore, type MemoryEntry } from '@/store/agentMemoryStore'
import { executeToolCall } from '@/providers/agentTools'

function reset() {
  useAgentMemoryStore.setState({
    memories: [],
    currentPhase: 'idle',
    phaseHistory: [],
    currentPlan: null,
    compactedContexts: [],
  })
}

function seedMemory(overrides: Partial<MemoryEntry> & { title: string }): string {
  const store = useAgentMemoryStore.getState()
  return store.saveMemory({
    type: overrides.type || 'project_preference',
    title: overrides.title,
    content: overrides.content || 'test content',
    tags: overrides.tags || [],
    scope: overrides.scope,
    projectId: overrides.projectId,
    pinned: overrides.pinned,
  })
}

describe('forgetMemory store action', () => {
  beforeEach(reset)

  it('deletes by exact id', () => {
    const id = seedMemory({ title: '偏好1' })
    seedMemory({ title: '偏好2' })
    const removed = useAgentMemoryStore.getState().forgetMemory({ id })
    expect(removed).toBe(1)
    expect(useAgentMemoryStore.getState().memories).toHaveLength(1)
    expect(useAgentMemoryStore.getState().memories[0].title).toBe('偏好2')
  })

  it('deletes by tag (case-insensitive)', () => {
    seedMemory({ title: 'A', tags: ['Style', 'warm'] })
    seedMemory({ title: 'B', tags: ['style'] })
    seedMemory({ title: 'C', tags: ['other'] })
    const removed = useAgentMemoryStore.getState().forgetMemory({ tag: 'style' })
    expect(removed).toBe(2)
    expect(useAgentMemoryStore.getState().memories).toHaveLength(1)
  })

  it('deletes by scope', () => {
    seedMemory({ title: 'S1', scope: 'session' })
    seedMemory({ title: 'S2', scope: 'session' })
    seedMemory({ title: 'G1', scope: 'global' })
    const removed = useAgentMemoryStore.getState().forgetMemory({ scope: 'session' })
    expect(removed).toBe(2)
    expect(useAgentMemoryStore.getState().memories).toHaveLength(1)
    expect(useAgentMemoryStore.getState().memories[0].scope).toBe('global')
  })

  it('deletes by olderThan', () => {
    const id1 = seedMemory({ title: 'Old' })
    seedMemory({ title: 'New' })
    // Directly backdate updatedAt on the first entry (updateMemory would override updatedAt to now)
    useAgentMemoryStore.setState(s => ({
      memories: s.memories.map(m => m.id === id1 ? { ...m, updatedAt: Date.now() - 100_000 } : m),
    }))
    const removed = useAgentMemoryStore.getState().forgetMemory({ olderThan: 50_000 })
    expect(removed).toBe(1)
    expect(useAgentMemoryStore.getState().memories).toHaveLength(1)
    expect(useAgentMemoryStore.getState().memories[0].title).toBe('New')
  })

  it('returns 0 when no filter provided', () => {
    seedMemory({ title: 'X' })
    const removed = useAgentMemoryStore.getState().forgetMemory({})
    expect(removed).toBe(0)
    expect(useAgentMemoryStore.getState().memories).toHaveLength(1)
  })

  it('AND semantics: scope+tag only removes entries matching BOTH', () => {
    seedMemory({ title: 'S-old', scope: 'session', tags: ['obsolete'] })
    seedMemory({ title: 'S-keep', scope: 'session', tags: ['important'] })
    seedMemory({ title: 'G-old', scope: 'global', tags: ['obsolete'] })
    const removed = useAgentMemoryStore.getState().forgetMemory({ scope: 'session', tag: 'obsolete' })
    expect(removed).toBe(1) // only S-old matches both scope=session AND tag=obsolete
    const remaining = useAgentMemoryStore.getState().memories
    expect(remaining).toHaveLength(2)
    expect(remaining.map(m => m.title).sort()).toEqual(['G-old', 'S-keep'])
  })

  it('AND semantics: scope+olderThan only removes old session entries', () => {
    const id1 = seedMemory({ title: 'OldSession', scope: 'session' })
    seedMemory({ title: 'NewSession', scope: 'session' })
    seedMemory({ title: 'OldGlobal', scope: 'global' })
    // Backdate OldSession and OldGlobal
    const oldTime = Date.now() - 200_000
    useAgentMemoryStore.setState(s => ({
      memories: s.memories.map(m =>
        m.title.startsWith('Old') ? { ...m, updatedAt: oldTime } : m
      ),
    }))
    const removed = useAgentMemoryStore.getState().forgetMemory({ scope: 'session', olderThan: 100_000 })
    expect(removed).toBe(1) // only OldSession matches both
    expect(useAgentMemoryStore.getState().memories).toHaveLength(2)
  })
})

describe('forget_memory tool dispatch', () => {
  beforeEach(reset)

  it('succeeds with tag filter', async () => {
    seedMemory({ title: 'A', tags: ['obsolete'] })
    seedMemory({ title: 'B', tags: ['obsolete'] })
    const res = await executeToolCall('forget_memory', { tag: 'obsolete' })
    expect(res.success).toBe(true)
    expect(res.message).toMatch(/2/)
  })

  it('fails without any filter', async () => {
    seedMemory({ title: 'Safe' })
    const res = await executeToolCall('forget_memory', {})
    expect(res.success).toBe(false)
  })
})

describe('auto-compact: session memories > 20 → rollup', () => {
  beforeEach(reset)

  it('rolls up oldest 10 session memories into a summary when count exceeds 20', () => {
    // Seed 21 session-scoped memories
    for (let i = 0; i < 21; i++) {
      seedMemory({ title: `Session-${i}`, scope: 'session', content: `content ${i}` })
    }
    const mems = useAgentMemoryStore.getState().memories
    const sessionMems = mems.filter(m => m.scope === 'session')
    // After auto-compact, should have ~12 session entries (11 kept + 1 rollup)
    expect(sessionMems.length).toBeLessThanOrEqual(13)
    const rollup = mems.find(m => m.title.includes('摘要'))
    expect(rollup).toBeDefined()
    expect(rollup!.type).toBe('task_summary')
    expect(rollup!.tags).toContain('rollup')
  })

  it('does not compact global memories', () => {
    for (let i = 0; i < 25; i++) {
      seedMemory({ title: `Global-${i}`, scope: 'global', content: `content ${i}` })
    }
    const mems = useAgentMemoryStore.getState().memories
    const rollup = mems.find(m => m.title.includes('摘要'))
    expect(rollup).toBeUndefined()
  })
})
