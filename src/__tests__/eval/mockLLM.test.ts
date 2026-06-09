import { describe, it, expect } from 'vitest'
import {
  MockLLMController,
  roundCall,
  roundCalls,
  roundFinish,
  roundIf,
} from './mockLLM'
import type { ToolCallRecord } from './types'

function makeToolResult(partial: Partial<ToolCallRecord>): ToolCallRecord {
  return {
    tool: 'noop',
    args: {},
    success: true,
    message: '',
    roundIndex: 0,
    elapsedMs: 0,
    ...partial,
  }
}

describe('MockLLMController', () => {
  // ── Pattern 1: fixed tool calls ──

  it('returns scripted tool_calls for fixed rounds', () => {
    const ctrl = new MockLLMController([
      roundCall('plan_task', { goal: 'test', steps: ['a', 'b'] }),
      roundFinish('done'),
    ])
    const r1 = ctrl.next()
    expect(r1.choices[0].finish_reason).toBe('tool_calls')
    expect(r1.choices[0].message.tool_calls).toHaveLength(1)
    expect(r1.choices[0].message.tool_calls![0].function.name).toBe('plan_task')
    // arguments must be valid JSON
    expect(() => JSON.parse(r1.choices[0].message.tool_calls![0].function.arguments)).not.toThrow()

    const r2 = ctrl.next()
    expect(r2.choices[0].finish_reason).toBe('stop')
    expect(r2.choices[0].message.content).toBe('done')
  })

  it('supports parallel tool_calls in a single round', () => {
    const ctrl = new MockLLMController([
      roundCalls([
        { tool: 'execute_node', args: { nodeId: 'a' } },
        { tool: 'execute_node', args: { nodeId: 'b' } },
      ]),
      roundFinish('done'),
    ])
    const r1 = ctrl.next()
    expect(r1.choices[0].message.tool_calls).toHaveLength(2)
  })

  // ── Pattern 2: conditional branching ──

  it('branches on lastToolResult.success', () => {
    const ctrl = new MockLLMController([
      roundCall('execute_node', { nodeId: 'x' }),
      roundIf(
        last => last?.success === true,
        roundFinish('success path'),
        roundCall('retry_node', { nodeId: 'x' })
      ),
    ])
    ctrl.next() // execute_node
    ctrl.observeToolResult(makeToolResult({ success: true }))
    const r2 = ctrl.next()
    expect(r2.choices[0].message.content).toBe('success path')
  })

  it('conditional else branch triggers on failure', () => {
    const ctrl = new MockLLMController([
      roundCall('execute_node', { nodeId: 'x' }),
      roundIf(
        last => last?.success === true,
        roundFinish('success path'),
        roundCall('retry_node', { nodeId: 'x' })
      ),
      roundFinish('retried'),
    ])
    ctrl.next() // execute_node
    ctrl.observeToolResult(makeToolResult({ success: false }))
    const r2 = ctrl.next()
    expect(r2.choices[0].message.tool_calls?.[0].function.name).toBe('retry_node')
    const r3 = ctrl.next()
    expect(r3.choices[0].message.content).toBe('retried')
  })

  // ── Pattern 3: error / edge cases ──

  it('throws on empty script', () => {
    expect(() => new MockLLMController([])).toThrow(/non-empty/)
  })

  it('throws with helpful message when script is exhausted', () => {
    const ctrl = new MockLLMController([roundCall('get_canvas_state', {})])
    ctrl.next()
    expect(() => ctrl.next()).toThrow(/exhausted|finish/)
  })

  it('currentIndex tracks script position', () => {
    const ctrl = new MockLLMController([
      roundCall('a', {}),
      roundCall('b', {}),
      roundFinish('ok'),
    ])
    expect(ctrl.currentIndex).toBe(0)
    ctrl.next()
    expect(ctrl.currentIndex).toBe(1)
    ctrl.next()
    ctrl.next()
    expect(ctrl.currentIndex).toBe(3)
  })

  it('tool_call ids are stable across runs', () => {
    const script = [
      roundCall('plan_task', { goal: 'x', steps: [] }),
      roundFinish('done'),
    ]
    const ctrlA = new MockLLMController(script)
    const ctrlB = new MockLLMController(script)
    const a = ctrlA.next()
    const b = ctrlB.next()
    expect(a.choices[0].message.tool_calls![0].id).toBe(b.choices[0].message.tool_calls![0].id)
  })
})
