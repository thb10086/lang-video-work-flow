/**
 * agentLoopControl.test.ts — Tests for the flexible agent loop controller.
 *
 * Validates:
 *   1. Multi-dimensional budget (iterations / tokens / time / tool-calls)
 *   2. Loop detection (same tool+args fingerprint repeated)
 *   3. Stall detection (no canvas/memory state change)
 *   4. Graceful degradation (warn at 80%, summarize at 95%, stop at 100%)
 *   5. Composable termination conditions (OR semantics)
 *   6. Explicit stop reasons
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createAgentLoopController,
  StopReason,
  LoopDetector,
  BudgetTracker,
  StallDetector,
  type LoopState,
  type ToolExecutionRecord,
} from '@/lib/agentLoopControl'

function mkState(overrides: Partial<LoopState> = {}): LoopState {
  return {
    round: 1,
    elapsedMs: 1000,
    tokensUsed: 1000,
    toolCallCount: 1,
    toolHistory: [],
    progressSignature: 'empty',
    ...overrides,
  }
}

describe('BudgetTracker', () => {
  it('returns no stop signal when well under budget', () => {
    const tracker = new BudgetTracker({
      maxIterations: 50,
      maxTokens: 200_000,
      maxTimeMs: 600_000,
      maxToolCalls: 100,
    })
    const decision = tracker.evaluate(mkState({ round: 10, tokensUsed: 50_000, elapsedMs: 60_000, toolCallCount: 20 }))
    expect(decision.shouldStop).toBe(false)
    expect(decision.escalation).toBe('none')
  })

  it('triggers warn at 80% of max iterations', () => {
    const tracker = new BudgetTracker({
      maxIterations: 10,
      maxTokens: 200_000,
      maxTimeMs: 600_000,
      maxToolCalls: 100,
    })
    const decision = tracker.evaluate(mkState({ round: 8 }))
    expect(decision.shouldStop).toBe(false)
    expect(decision.escalation).toBe('warn')
    expect(decision.reason).toBe(StopReason.MAX_ITERATIONS)
  })

  it('triggers force-summary at 95% of token budget', () => {
    const tracker = new BudgetTracker({
      maxIterations: 50,
      maxTokens: 100_000,
      maxTimeMs: 600_000,
      maxToolCalls: 100,
    })
    const decision = tracker.evaluate(mkState({ tokensUsed: 95_000 }))
    expect(decision.shouldStop).toBe(false)
    expect(decision.escalation).toBe('force-summary')
    expect(decision.reason).toBe(StopReason.TOKEN_BUDGET)
  })

  it('triggers hard stop at 100% of time budget', () => {
    const tracker = new BudgetTracker({
      maxIterations: 50,
      maxTokens: 200_000,
      maxTimeMs: 60_000,
      maxToolCalls: 100,
    })
    const decision = tracker.evaluate(mkState({ elapsedMs: 60_001 }))
    expect(decision.shouldStop).toBe(true)
    expect(decision.escalation).toBe('hard-stop')
    expect(decision.reason).toBe(StopReason.TIMEOUT)
  })

  it('triggers hard stop on tool call count exceeded', () => {
    const tracker = new BudgetTracker({
      maxIterations: 50,
      maxTokens: 200_000,
      maxTimeMs: 600_000,
      maxToolCalls: 10,
    })
    const decision = tracker.evaluate(mkState({ toolCallCount: 11 }))
    expect(decision.shouldStop).toBe(true)
    expect(decision.reason).toBe(StopReason.MAX_TOOL_CALLS)
  })

  it('reports the most critical dimension (tokens > iterations)', () => {
    const tracker = new BudgetTracker({
      maxIterations: 100,
      maxTokens: 10_000,
      maxTimeMs: 600_000,
      maxToolCalls: 1000,
    })
    // Only tokens near budget; iterations at only 10% but tokens at 95%
    const decision = tracker.evaluate(mkState({ round: 10, tokensUsed: 9500 }))
    expect(decision.escalation).toBe('force-summary')
    expect(decision.reason).toBe(StopReason.TOKEN_BUDGET)
  })
})

describe('LoopDetector', () => {
  it('detects 3× repeated tool signature as warn', () => {
    const det = new LoopDetector({ warnThreshold: 3, stopThreshold: 5, windowSize: 10 })
    const sig = { tool: 'create_image_node', argsHash: 'abc' }
    for (let i = 0; i < 3; i++) det.record(sig)
    const decision = det.evaluate(mkState())
    expect(decision.escalation).toBe('warn')
    expect(decision.reason).toBe(StopReason.LOOP_DETECTED)
    expect(decision.details).toContain('create_image_node')
  })

  it('stops at 5× repeated tool signature', () => {
    const det = new LoopDetector({ warnThreshold: 3, stopThreshold: 5, windowSize: 10 })
    const sig = { tool: 'verify_task', argsHash: '' }
    for (let i = 0; i < 5; i++) det.record(sig)
    const decision = det.evaluate(mkState())
    expect(decision.shouldStop).toBe(true)
    expect(decision.escalation).toBe('hard-stop')
  })

  it('does not trigger when different tools are interleaved', () => {
    const det = new LoopDetector({ warnThreshold: 3, stopThreshold: 5, windowSize: 10 })
    det.record({ tool: 'create_image_node', argsHash: 'a' })
    det.record({ tool: 'create_video_node', argsHash: 'b' })
    det.record({ tool: 'create_image_node', argsHash: 'a' })
    det.record({ tool: 'verify_task', argsHash: '' })
    const decision = det.evaluate(mkState())
    expect(decision.shouldStop).toBe(false)
    expect(decision.escalation).toBe('none')
  })

  it('window slides — old repeats drop off', () => {
    const det = new LoopDetector({ warnThreshold: 3, stopThreshold: 5, windowSize: 3 })
    const sig = { tool: 'verify_task', argsHash: '' }
    // Fill window with 3 different tools
    det.record({ tool: 'A', argsHash: '' })
    det.record({ tool: 'B', argsHash: '' })
    det.record({ tool: 'C', argsHash: '' })
    // Now add 2× sig — not 3 yet, only within window
    det.record(sig)
    det.record(sig)
    const decision = det.evaluate(mkState())
    expect(decision.escalation).toBe('none')
  })

  it('different args for same tool do not count as loop', () => {
    const det = new LoopDetector({ warnThreshold: 3, stopThreshold: 5, windowSize: 10 })
    det.record({ tool: 'create_image_node', argsHash: 'a' })
    det.record({ tool: 'create_image_node', argsHash: 'b' })
    det.record({ tool: 'create_image_node', argsHash: 'c' })
    const decision = det.evaluate(mkState())
    expect(decision.escalation).toBe('none')
  })
})

describe('StallDetector', () => {
  it('warns when progress signature unchanged for N rounds', () => {
    const det = new StallDetector({ warnRounds: 3, stopRounds: 5 })
    det.observe('state-v1', 1)
    det.observe('state-v1', 2)
    det.observe('state-v1', 3)
    const decision = det.evaluate(mkState({ round: 3, progressSignature: 'state-v1' }))
    expect(decision.escalation).toBe('warn')
    expect(decision.reason).toBe(StopReason.STALL_DETECTED)
  })

  it('stops after sustained stall', () => {
    const det = new StallDetector({ warnRounds: 3, stopRounds: 5 })
    for (let r = 1; r <= 5; r++) det.observe('same', r)
    const decision = det.evaluate(mkState({ round: 5 }))
    expect(decision.shouldStop).toBe(true)
  })

  it('resets counter when progress changes', () => {
    const det = new StallDetector({ warnRounds: 3, stopRounds: 5 })
    det.observe('v1', 1)
    det.observe('v1', 2)
    det.observe('v1', 3) // would warn
    det.observe('v2', 4) // progress! reset
    const decision = det.evaluate(mkState({ round: 4, progressSignature: 'v2' }))
    expect(decision.escalation).toBe('none')
  })
})

describe('createAgentLoopController — integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('allows normal progress', () => {
    const ctrl = createAgentLoopController({
      maxIterations: 50,
      maxTokens: 200_000,
      maxTimeMs: 600_000,
      maxToolCalls: 100,
    })
    const decision = ctrl.evaluate(mkState({ round: 5 }))
    expect(decision.shouldStop).toBe(false)
    expect(decision.escalation).toBe('none')
  })

  it('picks the most severe escalation across conditions', () => {
    const ctrl = createAgentLoopController({
      maxIterations: 10,
      maxTokens: 10_000,
      maxTimeMs: 600_000,
      maxToolCalls: 100,
    })
    // Round 8 of 10 = warn (80%); tokens 9500/10000 = force-summary (95%)
    // Should pick force-summary (more severe)
    const decision = ctrl.evaluate(mkState({ round: 8, tokensUsed: 9500 }))
    expect(decision.escalation).toBe('force-summary')
  })

  it('hard-stop wins over force-summary wins over warn', () => {
    const ctrl = createAgentLoopController({
      maxIterations: 10,
      maxTokens: 200_000,
      maxTimeMs: 60_000,
      maxToolCalls: 100,
    })
    // iterations at 80% = warn, time at 100% = hard-stop
    const decision = ctrl.evaluate(mkState({ round: 8, elapsedMs: 60_001 }))
    expect(decision.escalation).toBe('hard-stop')
    expect(decision.reason).toBe(StopReason.TIMEOUT)
  })

  it('records tool calls and detects loops', () => {
    const ctrl = createAgentLoopController({
      maxIterations: 50,
      maxTokens: 200_000,
      maxTimeMs: 600_000,
      maxToolCalls: 100,
    })
    // Repeat same tool+args 5× → loop detected
    const rec: ToolExecutionRecord = { tool: 'review_generated_image', args: { nodeId: 'n1' }, success: true }
    for (let i = 0; i < 5; i++) ctrl.recordToolCall(rec)
    const decision = ctrl.evaluate(mkState({ toolCallCount: 5 }))
    expect(decision.shouldStop).toBe(true)
    expect(decision.reason).toBe(StopReason.LOOP_DETECTED)
  })

  it('produces reflection message for warn escalation', () => {
    const ctrl = createAgentLoopController({
      maxIterations: 10,
      maxTokens: 200_000,
      maxTimeMs: 600_000,
      maxToolCalls: 100,
    })
    const decision = ctrl.evaluate(mkState({ round: 8 }))
    expect(decision.escalation).toBe('warn')
    const msg = ctrl.buildReflection(decision)
    expect(msg).toContain('接近预算')
    expect(msg.toLowerCase()).toContain('iteration')
  })

  it('produces force-summary message when at 95%', () => {
    const ctrl = createAgentLoopController({
      maxIterations: 50,
      maxTokens: 10_000,
      maxTimeMs: 600_000,
      maxToolCalls: 100,
    })
    const decision = ctrl.evaluate(mkState({ tokensUsed: 9500 }))
    expect(decision.escalation).toBe('force-summary')
    const msg = ctrl.buildReflection(decision)
    expect(msg).toContain('最终总结')
    expect(msg).toContain('不要再调用工具')
  })

  it('produces explicit stop reason message', () => {
    const ctrl = createAgentLoopController({
      maxIterations: 5,
      maxTokens: 200_000,
      maxTimeMs: 600_000,
      maxToolCalls: 100,
    })
    const decision = ctrl.evaluate(mkState({ round: 6 }))
    expect(decision.shouldStop).toBe(true)
    const msg = ctrl.buildStopMessage(decision)
    expect(msg).toMatch(/已达\S+轮/)
  })

  it('observes state changes for stall detection', () => {
    const ctrl = createAgentLoopController({
      maxIterations: 50,
      maxTokens: 200_000,
      maxTimeMs: 600_000,
      maxToolCalls: 100,
      stallWarnRounds: 3,
      stallStopRounds: 5,
    })
    for (let r = 1; r <= 5; r++) {
      ctrl.observeProgress('same-state', r)
    }
    const decision = ctrl.evaluate(mkState({ round: 5, progressSignature: 'same-state' }))
    expect(decision.shouldStop).toBe(true)
    expect(decision.reason).toBe(StopReason.STALL_DETECTED)
  })
})
