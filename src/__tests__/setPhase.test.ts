/**
 * setPhase.test.ts — set_phase 工具 + phase state machine 测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useAgentMemoryStore } from '@/store/agentMemoryStore'
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

describe('setPhase store action', () => {
  beforeEach(reset)

  it('changes currentPhase and appends to history', () => {
    useAgentMemoryStore.getState().setPhase('planning', '用户要求先规划')
    const state = useAgentMemoryStore.getState()
    expect(state.currentPhase).toBe('planning')
    expect(state.phaseHistory).toHaveLength(1)
    expect(state.phaseHistory[0].phase).toBe('planning')
    expect(state.phaseHistory[0].reason).toBe('用户要求先规划')
  })

  it('transitions through multiple phases', () => {
    const store = useAgentMemoryStore.getState()
    store.setPhase('planning', 'step 1')
    store.setPhase('designing', 'step 2')
    store.setPhase('building', 'step 3')
    const state = useAgentMemoryStore.getState()
    expect(state.currentPhase).toBe('building')
    expect(state.phaseHistory).toHaveLength(3)
    expect(state.phaseHistory.map(h => h.phase)).toEqual(['planning', 'designing', 'building'])
  })

  it('caps history at 50 entries', () => {
    const store = useAgentMemoryStore.getState()
    for (let i = 0; i < 55; i++) {
      store.setPhase(i % 2 === 0 ? 'building' : 'reviewing', `round ${i}`)
    }
    expect(useAgentMemoryStore.getState().phaseHistory.length).toBeLessThanOrEqual(50)
  })

  it('reason defaults to empty string when omitted', () => {
    useAgentMemoryStore.getState().setPhase('executing')
    expect(useAgentMemoryStore.getState().phaseHistory[0].reason).toBe('')
  })
})

describe('set_phase tool dispatch', () => {
  beforeEach(reset)

  it('sets phase via tool call', async () => {
    const res = await executeToolCall('set_phase', { phase: 'designing', reason: '准备设计角色' })
    expect(res.success).toBe(true)
    expect(useAgentMemoryStore.getState().currentPhase).toBe('designing')
    expect(res.message).toContain('designing')
  })

  it('rejects invalid phase', async () => {
    const res = await executeToolCall('set_phase', { phase: 'invalid_phase' })
    expect(res.success).toBe(false)
    expect(useAgentMemoryStore.getState().currentPhase).toBe('idle')
  })

  it('accepts all valid phase values', async () => {
    const phases = ['idle', 'planning', 'designing', 'building', 'reviewing', 'executing']
    for (const phase of phases) {
      const res = await executeToolCall('set_phase', { phase })
      expect(res.success).toBe(true)
      expect(useAgentMemoryStore.getState().currentPhase).toBe(phase)
    }
  })
})
