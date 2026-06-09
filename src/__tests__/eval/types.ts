/**
 * Eval Harness — Type Definitions
 *
 * Declarative scenario DSL that lets test authors add new Agent evaluation
 * cases by dropping a single `.ts` file into `scenarios/`. The executor
 * (`runEval.ts`) does not hard-code any scenario specifics.
 *
 * Design goals:
 *  - Zero hardcoding: every knob (budget, expected tools, mock responses) lives
 *    on the Scenario, not the runner
 *  - TypeScript-enforced completeness: missing required fields = compile error
 *  - Deterministic replay: `mockLLMScript` produces identical tool_call
 *    sequences across runs so CI is stable
 */

// ============================================================
// Core Scenario contract
// ============================================================

export interface Scenario {
  /** kebab-case unique id, e.g. "01-product-ad" */
  id: string

  /** Human-readable name shown in reports */
  name: string

  /** The user's initial chat message that kicks off the run */
  userMessage: string

  /**
   * Optional base64 / data-url images attached to the initial message.
   * For fixture files, authors may import and embed; the runner does not
   * perform disk I/O for images.
   */
  userImages?: string[]

  /** Tool names the Agent is expected to invoke during the run */
  expectedToolCalls: string[]

  /**
   * 'ordered': tool calls must happen in exactly `expectedToolCalls` order
   * 'any'    : tool calls can appear in any order (default)
   */
  toolCallOrder?: 'ordered' | 'any'

  /** Hard limits — exceeding any will mark the scenario failed */
  budget: ScenarioBudget

  /** Final canvas/tool-log verifier */
  verifier: (ctx: VerifierContext) => VerifierResult

  /**
   * Deterministic LLM replay script. When provided, the mock LLM returns
   * these tool_calls/content in order. Omit to use a real LLM proxy
   * (for nightly / smoke runs).
   */
  mockLLMScript?: MockLLMScript

  /** Mock backend overrides (success/failure/latency) */
  mockBackend?: MockBackendConfig

  /**
   * Initial canvas state to seed before the user message arrives. Useful for
   * scenarios that test modifications to existing workflows.
   */
  initialCanvas?: InitialCanvas

  /**
   * Mock client tool bridge configuration — only meaningful for SSE-driven
   * runs (`AGENT_BACKEND_RUNTIME=true`). Lets tests inject failures, latency,
   * or canned responses for client-scope tools (canvas.* / images.*).
   */
  mockClientBridgeConfig?: MockClientBridgeConfig

  /**
   * Subagents the scenario expects to be spawned (assert via `agent.delegate`
   * tool calls + `subagent_finished` events). Each entry is a role name.
   */
  expectedSubagents?: string[]

  /**
   * Node ids the verifier expects to appear in tool_result.affected_node_ids
   * across the run, used by canvas ↔ chat binding regression tests. Pass `[]`
   * to assert *no* node refs (e.g. for read-only sessions).
   */
  expectedNodeRefs?: string[]
}

export interface ScenarioBudget {
  maxToolCalls: number
  maxTokens: number
  maxElapsedMs: number
}

// ============================================================
// Verifier
// ============================================================

/**
 * Snapshot of the canvas passed to verifiers. We expose only the read-only
 * bits verifiers actually need, and decouple the type from the live store
 * (so adding store fields doesn't force verifier signature changes).
 */
export interface CanvasSnapshot {
  nodes: Array<{
    id: string
    type: string
    data: Record<string, unknown>
  }>
  edges: Array<{
    source: string
    target: string
    sourceHandle?: string | null
    targetHandle?: string | null
  }>
}

export interface VerifierContext {
  canvas: CanvasSnapshot
  toolLog: ToolCallRecord[]
  /** Final assistant text if any */
  finalMessage: string
}

export interface VerifierResult {
  passed: boolean
  /** 0-100 */
  score: number
  /** Human-readable issues to surface in reports */
  issues: string[]
}

// ============================================================
// Tool call tracking
// ============================================================

export interface ToolCallRecord {
  tool: string
  args: Record<string, unknown>
  success: boolean
  message: string
  roundIndex: number
  elapsedMs: number
}

// ============================================================
// Mock LLM — deterministic replay
// ============================================================

/**
 * A script is a list of rounds. Each round describes what the mock LLM
 * should "output" when it sees the current conversation state.
 *
 * Supports:
 *  - fixed tool_calls list
 *  - conditional branch on previous tool result (for testing retry logic)
 *  - text-only finish (assistant ends the loop)
 */
export type MockLLMScript = MockLLMRound[]

export type MockLLMRound =
  | MockLLMFixedRound
  | MockLLMConditionalRound
  | MockLLMFinishRound

export interface MockLLMFixedRound {
  kind: 'tool_calls'
  /** If multiple, mock LLM issues them all in a single turn (parallel) */
  calls: MockLLMToolCall[]
}

export interface MockLLMConditionalRound {
  kind: 'conditional'
  /** Predicate on the last tool result */
  when: (lastResult: ToolCallRecord | null) => boolean
  thenDo: MockLLMRound
  elseDo: MockLLMRound
}

export interface MockLLMFinishRound {
  kind: 'finish'
  /** Final assistant message */
  content: string
}

export interface MockLLMToolCall {
  tool: string
  args: Record<string, unknown>
}

// ============================================================
// Mock backend configuration
// ============================================================

export interface MockBackendConfig {
  image?: MockServiceConfig<MockImageResponse>
  video?: MockServiceConfig<MockVideoResponse>
  audio?: MockServiceConfig<MockImageResponse>
  /** Vision verify (`POST /api/verify/image`) */
  verify?: MockServiceConfig<MockVerifyResponse>
  /** COS upload */
  upload?: MockServiceConfig<MockUploadResponse>
}

export interface MockServiceConfig<TResponse> {
  /** Simulated latency in ms. Default 0 (sync). */
  latencyMs?: number
  /** Fail the first N calls before returning success. Default 0. */
  failFirstNCalls?: number
  /** Static response payload (applied after any fail-first-N behaviour) */
  response?: TResponse
  /** Custom dynamic responder — takes precedence over `response` */
  customResponse?: (callIndex: number) => TResponse | Promise<TResponse>
}

export interface MockImageResponse {
  images: Array<{ url: string; data?: string; mime_type?: string }>
  text?: string
}

export interface MockVideoResponse {
  task_id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  output_url?: string
  error?: string
}

export interface MockVerifyResponse {
  matchScore: number
  detectedSubjects: string[]
  missingElements: string[]
  unexpectedElements: string[]
  recommendation: 'accept' | 'retry' | 'edit_prompt'
  reasoning: string
}

export interface MockUploadResponse {
  url: string
  key: string
}

// ============================================================
// Mock client tool bridge — for SSE-driven runs
// ============================================================

/**
 * Configures the in-memory client tool bridge that intercepts
 * `client_tool_request` events emitted by the backend runtime and replies
 * with canned/synthesized results — without ever touching the real DOM
 * or React Flow.
 *
 * Behaviour:
 *  - Tools listed in `failNthCall` fail on the Nth invocation (1-indexed),
 *    succeed otherwise. Used to test the agent's retry/recovery loop.
 *  - `latencyMs` injects per-call delay before responding, used to test
 *    the agent's `client_timeout` handling.
 *  - `customResponse` overrides the default success payload entirely.
 */
export interface MockClientBridgeConfig {
  /** Per-tool failure injection: 1-indexed call ordinals to fail. */
  failNthCall?: Record<string, number[]>
  /** Per-tool latency in ms before responding. */
  latencyMs?: Record<string, number>
  /** Per-tool custom responder — takes precedence over the default canvas mock. */
  customResponse?: Record<string, (args: Record<string, unknown>, callIndex: number) => unknown>
  /** Force a `client_timeout` after the bridge replies (simulates network drop). Default false. */
  forceTimeout?: boolean
}

// ============================================================
// Initial canvas seeding
// ============================================================

export interface InitialCanvas {
  nodes: Array<{
    id: string
    type: string
    position?: { x: number; y: number }
    data?: Record<string, unknown>
  }>
  edges?: Array<{
    id?: string
    source: string
    target: string
    sourceHandle?: string
    targetHandle?: string
  }>
  projectId?: number | null
}

// ============================================================
// Runner output
// ============================================================

export interface ScenarioMetrics {
  id: string
  name: string
  passed: boolean
  score: number
  toolCallCount: number
  /**
   * Total estimated tokens consumed = conversation messages + tool responses.
   * This is what we regression-check against the baseline.
   */
  tokensUsed: number
  /**
   * Subset of tokensUsed attributable to tool_result payloads. Useful for
   * measuring the effect of the tool response budget optimisation — expect
   * this number to drop when concise formatters are active.
   */
  toolResponseTokens: number
  elapsedMs: number
  /**
   * Latency telemetry for the SSE-driven path (Phase 1+). For the legacy
   * frontend loop path these are still meaningful — they measure the
   * subjective "feels responsive" quality of the run:
   *   - timeToFirstEventMs: from session start to the first observable
   *     side-effect (first tool_call or first reasoning_delta).
   *   - timeToFirstToolCallMs: from session start to the very first tool
   *     dispatch — proxy for "Agent is doing something useful".
   *   - meanEventIntervalMs: mean gap between consecutive events. A
   *     regression here indicates the Agent is "stuck thinking" between
   *     visible actions.
   * Values may be 0 when there are no tool calls (chat-only finishes).
   */
  timeToFirstEventMs: number
  timeToFirstToolCallMs: number
  meanEventIntervalMs: number
  issues: string[]
  /** Over-budget flags */
  overBudget: {
    toolCalls: boolean
    tokens: boolean
    elapsed: boolean
  }
  /** Full ordered tool log for debugging */
  toolLog: ToolCallRecord[]
}

export interface EvalReport {
  generatedAt: string
  scenarios: ScenarioMetrics[]
  /**
   * Which Agent loop drove this run. `legacy` is the existing frontend
   * for-loop; `backend` is the SSE-driven LangGraph runtime — see
   * `eval-parity.mjs` for the double-run harness that compares the two.
   * Optional so older reports stay readable.
   */
  pathway?: 'legacy' | 'backend'
  /** Aggregate stats */
  summary: {
    total: number
    passed: number
    failed: number
    averageScore: number
    totalTokens: number
    totalElapsedMs: number
  }
}

// ============================================================
// Baseline comparison
// ============================================================

export interface BaselineComparison {
  scenario: string
  baselineScore: number
  currentScore: number
  /** Negative = regression */
  scoreDelta: number
  regressed: boolean
  /** Latency regressions (per-metric % delta). Populated by 0.11.5 guard. */
  latency?: {
    timeToFirstEvent: LatencyDelta
    timeToFirstToolCall: LatencyDelta
    meanEventInterval: LatencyDelta
  }
}

export interface LatencyDelta {
  baselineMs: number
  currentMs: number
  /** Positive = slower than baseline (worse). */
  pctDelta: number
  /** True iff current exceeds baseline by more than the configured tolerance. */
  regressed: boolean
}

// ============================================================
// CLI flags (consumed by runEval.ts)
// ============================================================

export interface RunnerOptions {
  /** Filter scenarios by id glob, e.g. "01-*" or "product-ad" */
  only?: string
  /** Write current run as the new baseline (overwrites) */
  updateBaseline?: boolean
  /** Baseline regression tolerance, default 0.05 (5%) */
  regressionTolerance?: number
  /** Output directory for reports (default: process.cwd()) */
  outputDir?: string
}
