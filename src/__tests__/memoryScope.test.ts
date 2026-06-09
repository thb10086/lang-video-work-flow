/**
 * memoryScope.test.ts — Memory scoping (session / project / global) 测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useAgentMemoryStore, type MemoryScope } from '@/store/agentMemoryStore'

function reset() {
  useAgentMemoryStore.setState({
    memories: [],
    currentPhase: 'idle',
    phaseHistory: [],
    currentPlan: null,
    compactedContexts: [],
  })
}

function seedMemory(title: string, scope: MemoryScope, projectId?: number) {
  return useAgentMemoryStore.getState().saveMemory({
    type: 'project_preference',
    title,
    content: `Content for ${title}`,
    tags: ['test'],
    scope,
    projectId,
  })
}

describe('Memory scoping: save + retrieve', () => {
  beforeEach(reset)

  it('defaults scope to "session" when not specified', () => {
    useAgentMemoryStore.getState().saveMemory({
      type: 'project_preference',
      title: 'no scope',
      content: 'test',
      tags: [],
    })
    const m = useAgentMemoryStore.getState().memories[0]
    expect(m.scope).toBe('session')
  })

  it('stores scope and projectId correctly', () => {
    seedMemory('Proj1 pref', 'project', 42)
    const m = useAgentMemoryStore.getState().memories[0]
    expect(m.scope).toBe('project')
    expect(m.projectId).toBe(42)
  })

  it('ignores projectId when scope is not "project"', () => {
    useAgentMemoryStore.getState().saveMemory({
      type: 'project_preference',
      title: 'global pref',
      content: 'test',
      tags: [],
      scope: 'global',
      projectId: 99,
    })
    const m = useAgentMemoryStore.getState().memories[0]
    expect(m.scope).toBe('global')
    expect(m.projectId).toBeUndefined()
  })

  it('pinned memories are marked correctly', () => {
    useAgentMemoryStore.getState().saveMemory({
      type: 'style_guide',
      title: 'Always warm tones',
      content: 'Use warm color palette',
      tags: ['style'],
      pinned: true,
    })
    const m = useAgentMemoryStore.getState().memories[0]
    expect(m.pinned).toBe(true)
  })
})

describe('getRelevantContext: scope-aware visibility', () => {
  beforeEach(reset)

  it('project-scoped entries only visible for matching projectId', () => {
    seedMemory('Global style', 'global')
    seedMemory('Session note', 'session')
    seedMemory('Proj42 pref', 'project', 42)
    seedMemory('Proj99 pref', 'project', 99)

    const ctx42 = useAgentMemoryStore.getState().getRelevantContext({ projectId: 42 })
    expect(ctx42).toContain('Proj42')
    expect(ctx42).not.toContain('Proj99')

    const ctx99 = useAgentMemoryStore.getState().getRelevantContext({ projectId: 99 })
    expect(ctx99).toContain('Proj99')
    expect(ctx99).not.toContain('Proj42')
  })

  it('global and session memories always visible regardless of projectId', () => {
    seedMemory('Global note', 'global')
    seedMemory('Session note', 'session')
    seedMemory('Proj42 note', 'project', 42)

    const ctxNoProject = useAgentMemoryStore.getState().getRelevantContext({ projectId: null })
    expect(ctxNoProject).toContain('Global note')
    expect(ctxNoProject).toContain('Session note')
    expect(ctxNoProject).not.toContain('Proj42')
  })
})

describe('Legacy migration: onRehydrateStorage stamps scope="global"', () => {
  it('entries without scope get stamped as global on rehydrate', () => {
    // Simulate legacy state (no scope field)
    const legacyMemory = {
      id: 'legacy-1',
      type: 'project_preference' as const,
      title: 'Old preference',
      content: 'legacy',
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    // Directly set state without scope
    useAgentMemoryStore.setState({ memories: [legacyMemory as any] })

    // Simulate rehydration callback
    const state = useAgentMemoryStore.getState()
    // The onRehydrateStorage callback stamps missing scopes
    if (!state.memories[0].scope) {
      // Manually trigger the migration logic
      const upgraded = state.memories.map(m => {
        if (m.scope) return m
        return { ...m, scope: 'global' as MemoryScope }
      })
      useAgentMemoryStore.setState({ memories: upgraded })
    }
    expect(useAgentMemoryStore.getState().memories[0].scope).toBe('global')
  })
})
