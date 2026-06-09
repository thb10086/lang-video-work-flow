/**
 * Mock LLM — Deterministic Replay for Eval Harness
 *
 * Replaces `backendApi.agentChat` during evaluation runs. Each scenario's
 * `mockLLMScript` is consumed one "round" per invocation. Supports:
 *   - fixed tool_calls rounds
 *   - conditional branches based on the last tool's result (retry testing)
 *   - final assistant message to end the loop
 *
 * The mock is a pure function of (script, callIndex, lastToolResult) — no
 * hidden state outside the `MockLLMController`, which makes CI runs fully
 * reproducible.
 */

import type {
  MockLLMScript,
  MockLLMRound,
  MockLLMFixedRound,
  MockLLMConditionalRound,
  MockLLMFinishRound,
  MockLLMToolCall,
  ToolCallRecord,
} from './types'

/**
 * Stateful controller that tracks position in the script and produces an
 * OpenAI-compatible response shape per call. Scoped to a single scenario run.
 */
export class MockLLMController {
  private callIndex = 0
  private readonly script: MockLLMScript
  /** Populated by the runner after each tool executes so conditional rounds can branch */
  private lastToolResult: ToolCallRecord | null = null

  constructor(script: MockLLMScript) {
    if (!Array.isArray(script) || script.length === 0) {
      throw new Error('MockLLMController requires a non-empty script')
    }
    this.script = script
  }

  /**
   * Feed the result of the most recently executed tool so conditional rounds
   * can branch on success/failure.
   */
  observeToolResult(record: ToolCallRecord): void {
    this.lastToolResult = record
  }

  /**
   * Produce the next LLM response. Throws if the script is exhausted without
   * hitting a `finish` round — surfaces incomplete scripts loudly.
   */
  next(): MockLLMResponse {
    if (this.callIndex >= this.script.length) {
      throw new Error(
        `MockLLM script exhausted at round ${this.callIndex}. ` +
        'Add a `kind: "finish"` round at the end of the script to terminate the loop cleanly.'
      )
    }
    const round = this.script[this.callIndex++]
    const resolved = resolveRound(round, this.lastToolResult)
    return buildOpenAIResponse(resolved, this.callIndex)
  }

  /** Current cursor — exposed for tests/debugging */
  get currentIndex(): number {
    return this.callIndex
  }

  get totalRounds(): number {
    return this.script.length
  }
}

// ============================================================
// Round resolution
// ============================================================

/**
 * Walk through conditional rounds until a concrete `tool_calls` or `finish`
 * round is produced. Nested conditionals are supported.
 */
function resolveRound(
  round: MockLLMRound,
  lastResult: ToolCallRecord | null
): MockLLMFixedRound | MockLLMFinishRound {
  let current: MockLLMRound = round
  // Guard against malformed scripts that self-reference — max 16 unwraps
  for (let depth = 0; depth < 16; depth++) {
    if (current.kind === 'tool_calls') return current
    if (current.kind === 'finish') return current
    // conditional
    const cond = current as MockLLMConditionalRound
    current = cond.when(lastResult) ? cond.thenDo : cond.elseDo
  }
  throw new Error('MockLLM conditional resolution exceeded depth limit (possible cycle)')
}

// ============================================================
// OpenAI-compatible response builder
// ============================================================

/**
 * Matches the shape `chatStore.ts` expects from `backendApi.agentChat`:
 *   {
 *     choices: [{
 *       message: {
 *         content: string | null,
 *         tool_calls?: [{ id, function: { name, arguments } }]
 *       }
 *     }]
 *   }
 */
export interface MockLLMResponse {
  choices: Array<{
    message: {
      content: string | null
      tool_calls?: Array<{
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }>
    }
    finish_reason: 'tool_calls' | 'stop'
  }>
  /** Usage is approximated — runner's estimateTotalTokens is the source of truth */
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

function buildOpenAIResponse(
  round: MockLLMFixedRound | MockLLMFinishRound,
  roundNumber: number
): MockLLMResponse {
  if (round.kind === 'finish') {
    return {
      choices: [{
        message: { content: round.content },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }
  }
  const tool_calls = round.calls.map((c, i) => buildToolCall(c, roundNumber, i))
  return {
    choices: [{
      message: { content: null, tool_calls },
      finish_reason: 'tool_calls',
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }
}

function buildToolCall(
  c: MockLLMToolCall,
  round: number,
  idx: number
): { id: string; type: 'function'; function: { name: string; arguments: string } } {
  return {
    id: `mock_call_r${round}_${idx}`,
    type: 'function',
    function: {
      name: c.tool,
      arguments: JSON.stringify(c.args ?? {}),
    },
  }
}

// ============================================================
// Fluent script builders (ergonomic API for scenario authors)
// ============================================================

/** `roundCall('create_text_node', { ... })` → a single-call round */
export function roundCall(tool: string, args: Record<string, unknown> = {}): MockLLMFixedRound {
  return { kind: 'tool_calls', calls: [{ tool, args }] }
}

/** `roundCalls([{ tool, args }, ...])` → parallel tool calls in one round */
export function roundCalls(calls: MockLLMToolCall[]): MockLLMFixedRound {
  return { kind: 'tool_calls', calls }
}

/** `roundFinish('done')` → assistant ends the conversation */
export function roundFinish(content: string): MockLLMFinishRound {
  return { kind: 'finish', content }
}

/**
 * Conditional branch. Example:
 *   roundIf(
 *     last => last?.success === true,
 *     roundFinish('ok'),
 *     roundCall('retry_node', { nodeId: 'x' })
 *   )
 */
export function roundIf(
  when: (lastResult: ToolCallRecord | null) => boolean,
  thenDo: MockLLMRound,
  elseDo: MockLLMRound
): MockLLMConditionalRound {
  return { kind: 'conditional', when, thenDo, elseDo }
}
