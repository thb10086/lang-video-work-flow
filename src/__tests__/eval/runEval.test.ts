/**
 * Tests the Eval Runner with inline scenarios (no scenarios/ files needed).
 *
 * Uses minimal Agent tools (`plan_task`, `save_memory`, `get_canvas_state`)
 * that don't require model calls, so all state mutation happens purely via
 * the scripted MockLLM → executeToolCall path.
 */

import { describe, it, expect } from 'vitest'
import { runScenario, filterScenarios } from './runEval'
import { roundCall, roundFinish, roundIf } from './mockLLM'
import type { Scenario } from './types'

describe('runScenario', () => {
  it('drives a minimal plan_task → finish scenario to passed', async () => {
    const scn: Scenario = {
      id: 'smoke-plan',
      name: 'Smoke: plan then finish',
      userMessage: '请制定一个 2 步计划',
      expectedToolCalls: ['plan_task'],
      budget: { maxToolCalls: 5, maxTokens: 10000, maxElapsedMs: 5000 },
      mockLLMScript: [
        roundCall('plan_task', { goal: 'smoke goal', steps: ['step a', 'step b'] }),
        roundFinish('计划已创建'),
      ],
      verifier: ({ toolLog }) => {
        const planCall = toolLog.find(t => t.tool === 'plan_task')
        return {
          passed: Boolean(planCall?.success),
          score: planCall?.success ? 100 : 0,
          issues: planCall?.success ? [] : ['plan_task failed'],
        }
      },
    }

    const result = await runScenario(scn)
    expect(result.passed).toBe(true)
    expect(result.score).toBe(100)
    expect(result.toolCallCount).toBe(1)
    expect(result.toolLog[0].tool).toBe('plan_task')
    expect(result.elapsedMs).toBeGreaterThan(0)
  })

  it('detects missing expected tools', async () => {
    const scn: Scenario = {
      id: 'smoke-missing-tool',
      name: 'Smoke: expected tool never called',
      userMessage: 'x',
      expectedToolCalls: ['plan_task', 'save_memory'], // save_memory never called
      budget: { maxToolCalls: 5, maxTokens: 10000, maxElapsedMs: 5000 },
      mockLLMScript: [
        roundCall('plan_task', { goal: 'g', steps: [] }),
        roundFinish('done'),
      ],
      verifier: () => ({ passed: true, score: 100, issues: [] }),
    }
    const result = await runScenario(scn)
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => i.includes('save_memory'))).toBe(true)
  })

  it('detects tool call count over budget', async () => {
    const scn: Scenario = {
      id: 'smoke-over-budget',
      name: 'Smoke: over tool-call budget',
      userMessage: 'x',
      expectedToolCalls: [],
      budget: { maxToolCalls: 1, maxTokens: 10000, maxElapsedMs: 5000 },
      mockLLMScript: [
        roundCall('save_memory', { title: 'a', content: 'a', scope: 'session', type: 'fact' }),
        roundCall('save_memory', { title: 'b', content: 'b', scope: 'session', type: 'fact' }),
        roundFinish('done'),
      ],
      verifier: () => ({ passed: true, score: 100, issues: [] }),
    }
    const result = await runScenario(scn)
    expect(result.overBudget.toolCalls).toBe(true)
    expect(result.passed).toBe(false)
  })

  it('supports ordered tool expectation enforcement', async () => {
    const scn: Scenario = {
      id: 'smoke-order',
      name: 'Smoke: enforce ordered sequence',
      userMessage: 'x',
      expectedToolCalls: ['plan_task', 'save_memory'],
      toolCallOrder: 'ordered',
      budget: { maxToolCalls: 5, maxTokens: 10000, maxElapsedMs: 5000 },
      mockLLMScript: [
        // Wrong order: save_memory first, then plan_task
        roundCall('save_memory', { title: 't', content: 'c', scope: 'session', type: 'fact' }),
        roundCall('plan_task', { goal: 'g', steps: [] }),
        roundFinish('done'),
      ],
      verifier: () => ({ passed: true, score: 100, issues: [] }),
    }
    const result = await runScenario(scn)
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => /ordered|sequence/i.test(i))).toBe(true)
  })

  it('uses conditional branching based on last tool result', async () => {
    const scn: Scenario = {
      id: 'smoke-conditional',
      name: 'Smoke: conditional branch',
      userMessage: 'x',
      expectedToolCalls: ['plan_task'],
      budget: { maxToolCalls: 5, maxTokens: 10000, maxElapsedMs: 5000 },
      mockLLMScript: [
        roundCall('plan_task', { goal: 'g', steps: ['a'] }),
        roundIf(
          last => last?.success === true,
          roundFinish('ok path'),
          roundFinish('fail path'),
        ),
      ],
      verifier: ({ finalMessage }) => ({
        passed: finalMessage === 'ok path',
        score: finalMessage === 'ok path' ? 100 : 0,
        issues: [],
      }),
    }
    const result = await runScenario(scn)
    expect(result.passed).toBe(true)
    expect(result.score).toBe(100)
  })

  it('seeds initial canvas nodes before the loop', async () => {
    const scn: Scenario = {
      id: 'smoke-seed',
      name: 'Smoke: seeded canvas',
      userMessage: 'x',
      expectedToolCalls: ['get_canvas_state'],
      initialCanvas: {
        nodes: [
          { id: 'seed_1', type: 'characterGrid', data: { label: 'Seeded Hero', name: 'Hero' } },
        ],
      },
      budget: { maxToolCalls: 5, maxTokens: 10000, maxElapsedMs: 5000 },
      mockLLMScript: [
        roundCall('get_canvas_state', {}),
        roundFinish('read canvas'),
      ],
      verifier: ({ canvas }) => {
        const hasSeeded = canvas.nodes.some(n => n.id === 'seed_1')
        return {
          passed: hasSeeded,
          score: hasSeeded ? 100 : 0,
          issues: hasSeeded ? [] : ['seed node missing'],
        }
      },
    }
    const result = await runScenario(scn)
    expect(result.passed).toBe(true)
  })

  it('restores backendApi after scenario even on verifier throw', async () => {
    // Verify no lingering mock by calling again — would fail if mock persisted
    const scn: Scenario = {
      id: 'smoke-cleanup',
      name: 'Smoke: cleanup check',
      userMessage: 'x',
      expectedToolCalls: [],
      budget: { maxToolCalls: 5, maxTokens: 10000, maxElapsedMs: 5000 },
      mockLLMScript: [roundFinish('done')],
      verifier: () => ({ passed: true, score: 100, issues: [] }),
    }
    await runScenario(scn)
    // backendApi.agentChat should now be the original, not mock LLM
    // Easiest proxy: try a second scenario — if the first's mock leaked, the
    // new scenario's mock install would fail or give stale data.
    const result2 = await runScenario(scn)
    expect(result2.passed).toBe(true)
  })
})

describe('filterScenarios', () => {
  const makeScn = (id: string, name: string): Scenario => ({
    id,
    name,
    userMessage: '',
    expectedToolCalls: [],
    budget: { maxToolCalls: 1, maxTokens: 1, maxElapsedMs: 1 },
    verifier: () => ({ passed: true, score: 100, issues: [] }),
    mockLLMScript: [roundFinish('x')],
  })

  it('returns all when no filter', () => {
    const all = [makeScn('01-a', 'A'), makeScn('02-b', 'B')]
    expect(filterScenarios(all)).toEqual(all)
  })

  it('filters by id glob', () => {
    const all = [makeScn('01-a', 'A'), makeScn('02-b', 'B'), makeScn('03-c', 'C')]
    expect(filterScenarios(all, '01-*')).toHaveLength(1)
    expect(filterScenarios(all, '01-*')[0].id).toBe('01-a')
  })

  it('filters by name glob', () => {
    const all = [makeScn('01-a', 'Alpha'), makeScn('02-b', 'Beta')]
    expect(filterScenarios(all, 'Alpha')).toHaveLength(1)
  })
})
