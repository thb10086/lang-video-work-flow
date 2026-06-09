/**
 * Eval Runner — Scenario Execution Engine
 *
 * Zero hardcoded scenarios: dynamically loads every `.ts` file from
 * `scenarios/`. For each scenario:
 *   1. Reset stores (flowStore, agentMemoryStore, chatStore)
 *   2. Install MockBackend patching backendApi.*
 *   3. Install MockLLM patching backendApi.agentChat
 *   4. Seed initial canvas if provided
 *   5. Drive chatStore.processUserMessage(...)
 *   6. Wait for loop termination
 *   7. Collect metrics + build CanvasSnapshot
 *   8. Call verifier
 *   9. Restore originals
 *
 * The runner itself knows nothing about specific scenarios — the Scenario
 * contract in types.ts is the only API.
 */

import { backendApi } from '@/api/backend'
import { useFlowStore } from '@/store/flowStore'
import { useAgentMemoryStore } from '@/store/agentMemoryStore'
import { useChatStore } from '@/store/chatStore'
import { setToolCallObserver } from '@/providers/agentTools'
import { estimateTokens } from '@/store/chatPromptBuilder'
import { MockLLMController } from './mockLLM'
import { MockBackendController } from './mockBackend'
import type {
  Scenario,
  ScenarioMetrics,
  ToolCallRecord,
  CanvasSnapshot,
  VerifierContext,
  InitialCanvas,
} from './types'

// ============================================================
// Public API
// ============================================================

export interface RunScenarioResult extends ScenarioMetrics {}

/**
 * Execute a single scenario end-to-end and return its metrics.
 *
 * The function guarantees cleanup (mock restoration, store reset) via a
 * try/finally block even if the scenario throws.
 */
export async function runScenario(scenario: Scenario): Promise<RunScenarioResult> {
  const startTime = Date.now()
  const toolLog: ToolCallRecord[] = []
  // Wall-clock timestamps for each observable event (currently each tool
  // call counts as one event — we'll add SSE event timestamps once the
  // runner becomes SSE-aware in a follow-up PR). Used by 0.11.4 latency
  // metrics computed below.
  const eventTimestamps: number[] = []

  // ── Reset all stores to a known baseline ──
  resetAllStores()
  seedCanvas(scenario.initialCanvas)

  // ── Install MockBackend ──
  const mockBackend = new MockBackendController(scenario.mockBackend ?? {})
  const disposeBackend = mockBackend.install()

  // ── Install MockLLM (replaces agentChat) ──
  if (!scenario.mockLLMScript) {
    disposeBackend()
    throw new Error(
      `Scenario "${scenario.id}" has no mockLLMScript. Provide one so the evaluation is deterministic, ` +
      `or run against a real LLM via a different runner.`
    )
  }
  const mockLLM = new MockLLMController(scenario.mockLLMScript)
  const originalAgentChat = backendApi.agentChat
  backendApi.agentChat = async () => {
    return mockLLM.next() as unknown as Record<string, unknown>
  }

  // ── Register tool-call observer for logging + MockLLM branching ──
  // roundIndex is derived from MockLLM cursor so conditional branches can
  // examine the last tool's outcome deterministically.
  setToolCallObserver((name, args, result, elapsedMs) => {
    const record: ToolCallRecord = {
      tool: name,
      args: args as Record<string, unknown>,
      success: result.success,
      message: result.message,
      roundIndex: Math.max(0, mockLLM.currentIndex - 1),
      elapsedMs,
    }
    toolLog.push(record)
    eventTimestamps.push(Date.now())
    mockLLM.observeToolResult(record)
  })

  let finalMessage = ''
  let tokensUsed = 0
  let toolResponseTokens = 0

  try {
    // ── Drive the chat loop ──
    const chat = useChatStore.getState()
    await chat.processUserMessage(scenario.userMessage, scenario.userImages)

    // Wait for loop to finalize (processUserMessage awaits the full loop)
    const finalMessages = useChatStore.getState().messages
    const lastAssistant = [...finalMessages].reverse().find(m => m.role === 'assistant' && m.content)
    finalMessage = lastAssistant?.content ?? ''

    // Final token estimate — sum of all message contents PLUS tool response
    // payloads (which never surface in chatStore.messages but are sent back
    // to the LLM on every round and therefore count toward context usage).
    const messageTokens = finalMessages.reduce(
      (acc, m) => acc + estimateTokens(typeof m.content === 'string' ? m.content : ''),
      0,
    )
    toolResponseTokens = toolLog.reduce((acc, r) => acc + estimateTokens(r.message), 0)
    tokensUsed = messageTokens + toolResponseTokens
  } finally {
    // ── Restore everything, even on error ──
    backendApi.agentChat = originalAgentChat
    setToolCallObserver(null)
    disposeBackend()
  }

  const elapsedMs = Date.now() - startTime
  const canvas = snapshotCanvas()

  // ── 0.11.4 latency metrics ──
  // Computed from `eventTimestamps`, which today only records tool calls
  // but is structured so SSE event arrivals can be appended verbatim once
  // the runner is updated to drive `chatStore` via the SSE client.
  const timeToFirstEventMs = eventTimestamps.length > 0
    ? eventTimestamps[0] - startTime
    : 0
  const timeToFirstToolCallMs = toolLog.length > 0
    ? toolLog[0].elapsedMs >= 0
      ? eventTimestamps[0] - startTime  // = first observable side-effect
      : 0
    : 0
  let meanEventIntervalMs = 0
  if (eventTimestamps.length >= 2) {
    let total = 0
    for (let i = 1; i < eventTimestamps.length; i++) {
      total += eventTimestamps[i] - eventTimestamps[i - 1]
    }
    meanEventIntervalMs = Math.round(total / (eventTimestamps.length - 1))
  }

  // ── Run verifier ──
  const verifierCtx: VerifierContext = { canvas, toolLog, finalMessage }
  const vr = scenario.verifier(verifierCtx)

  // ── Check budget ──
  const overBudget = {
    toolCalls: toolLog.length > scenario.budget.maxToolCalls,
    tokens: tokensUsed > scenario.budget.maxTokens,
    elapsed: elapsedMs > scenario.budget.maxElapsedMs,
  }

  // ── Check tool call expectations ──
  const toolExpectationIssues = checkToolExpectations(scenario, toolLog)
  const allIssues = [...vr.issues, ...toolExpectationIssues]

  const anyOverBudget = overBudget.toolCalls || overBudget.tokens || overBudget.elapsed
  const passed = vr.passed && allIssues.length === 0 && !anyOverBudget

  return {
    id: scenario.id,
    name: scenario.name,
    passed,
    score: vr.score,
    toolCallCount: toolLog.length,
    tokensUsed,
    toolResponseTokens,
    elapsedMs,
    timeToFirstEventMs,
    timeToFirstToolCallMs,
    meanEventIntervalMs,
    issues: allIssues,
    overBudget,
    toolLog,
  }
}

// ============================================================
// Scenario expectation check
// ============================================================

function checkToolExpectations(scenario: Scenario, toolLog: ToolCallRecord[]): string[] {
  const issues: string[] = []
  const actualTools = toolLog.map(r => r.tool)
  const expected = scenario.expectedToolCalls

  // Missing expected tools
  for (const tool of expected) {
    if (!actualTools.includes(tool)) {
      issues.push(`Expected tool "${tool}" was never called`)
    }
  }

  // Order check
  if (scenario.toolCallOrder === 'ordered' && expected.length > 0) {
    let cursor = 0
    for (const actual of actualTools) {
      if (cursor < expected.length && actual === expected[cursor]) {
        cursor++
      }
    }
    if (cursor < expected.length) {
      issues.push(
        `Ordered expectation violated: expected sequence ${JSON.stringify(expected)} not found in actual ${JSON.stringify(actualTools)}`
      )
    }
  }

  return issues
}

// ============================================================
// Store lifecycle helpers
// ============================================================

function resetAllStores(): void {
  useFlowStore.setState({ nodes: [], edges: [], projectId: null })
  useAgentMemoryStore.setState({
    memories: [],
    currentPlan: null,
    compactedContexts: [],
    currentPhase: 'idle',
    phaseHistory: [],
  })
  useChatStore.setState({
    messages: [],
    isProcessing: false,
    streamingMessageId: null,
    agentStats: null,
    abortController: null,
  })
}

function seedCanvas(seed?: InitialCanvas): void {
  if (!seed) return
  useFlowStore.setState({
    nodes: seed.nodes.map(n => ({
      id: n.id,
      type: n.type,
      position: n.position ?? { x: 0, y: 0 },
      data: n.data ?? {},
    })),
    edges: (seed.edges ?? []).map((e, i) => ({
      id: e.id ?? `edge_${i}`,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    })),
    projectId: seed.projectId ?? null,
  })
}

function snapshotCanvas(): CanvasSnapshot {
  const { nodes, edges } = useFlowStore.getState()
  return {
    nodes: nodes.map(n => ({
      id: n.id,
      type: String(n.type ?? ''),
      data: (n.data ?? {}) as Record<string, unknown>,
    })),
    edges: edges.map(e => ({
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
    })),
  }
}

// ============================================================
// Scenario auto-discovery
// ============================================================

/**
 * Vite/Vitest `import.meta.glob` is the canonical way to auto-discover
 * files under a directory. Each matched file must default-export a Scenario.
 *
 * New scenario files dropped into `./scenarios/` are picked up without
 * touching this runner — one of the core Eval Harness spec requirements.
 */
export async function loadAllScenarios(): Promise<Scenario[]> {
  const modules = import.meta.glob('./scenarios/*.ts', { eager: false }) as Record<
    string,
    () => Promise<{ default: Scenario }>
  >
  const scenarios: Scenario[] = []
  const seenIds = new Set<string>()
  for (const path of Object.keys(modules).sort()) {
    const mod = await modules[path]()
    const scn = mod.default
    if (!scn || typeof scn !== 'object') {
      throw new Error(`Scenario file "${path}" must have a default export of type Scenario`)
    }
    if (seenIds.has(scn.id)) {
      throw new Error(`Duplicate scenario id "${scn.id}" at "${path}"`)
    }
    seenIds.add(scn.id)
    scenarios.push(scn)
  }
  return scenarios
}

/**
 * Filter scenarios by a glob-ish `only` expression (supports `*` wildcard).
 */
export function filterScenarios(all: Scenario[], only?: string): Scenario[] {
  if (!only) return all
  const pattern = new RegExp(
    '^' + only.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
  )
  return all.filter(s => pattern.test(s.id) || pattern.test(s.name))
}
