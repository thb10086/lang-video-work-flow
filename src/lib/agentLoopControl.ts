/**
 * agentLoopControl.ts — Flexible multi-dimensional Agent loop controller.
 *
 * Replaces the naive `for (round = 0; round < 25; round++)` with a composable
 * termination system inspired by:
 *   • Claude Code SDK:   max_turns + max_budget_usd + effort level + auto-compaction
 *   • LangGraph:          recursion_limit as a safety net (default 25 → bumped to 50)
 *   • Cursor Agent Max:   token budget over iteration count
 *   • AutoGen:            composable termination conditions (MaxMessage | Token | Timeout | FunctionCall)
 *
 * Core ideas:
 *   1. Five independent budget dimensions (iterations / tokens / time / tool-calls / loops / stall)
 *   2. Graceful three-stage degradation: warn (80%) → force-summary (95%) → hard-stop (100%)
 *   3. Explicit StopReason — tells the user and the LLM why we stopped
 *   4. Loop detection via (tool, argsHash) fingerprint window
 *   5. Stall detection via canvas/memory state signature
 */

// ── Types ───────────────────────────────────────────────────────────────────

export const enum StopReason {
  MAX_ITERATIONS = 'max_iterations',
  TOKEN_BUDGET = 'token_budget',
  TIMEOUT = 'timeout',
  MAX_TOOL_CALLS = 'max_tool_calls',
  LOOP_DETECTED = 'loop_detected',
  STALL_DETECTED = 'stall_detected',
  CONSECUTIVE_FAILURES = 'consecutive_failures',
  USER_ABORT = 'user_abort',
}

export type Escalation = 'none' | 'warn' | 'force-summary' | 'hard-stop'

export interface StopDecision {
  shouldStop: boolean
  escalation: Escalation
  reason?: StopReason
  details?: string
  /** 0..1, how close to the most critical limit we are */
  utilization?: number
}

export interface LoopState {
  round: number
  elapsedMs: number
  tokensUsed: number
  toolCallCount: number
  /** Ring buffer of recent tool signatures. Populated by the controller. */
  toolHistory: ToolFingerprint[]
  /** A stable hash of current canvas + memory state for stall detection. */
  progressSignature: string
}

export interface ToolFingerprint {
  tool: string
  argsHash: string
}

export interface ToolExecutionRecord {
  tool: string
  args: Record<string, unknown>
  success: boolean
}

export interface BudgetConfig {
  maxIterations: number
  maxTokens: number
  maxTimeMs: number
  maxToolCalls: number
}

export interface LoopDetectorConfig {
  /** Repeats needed to inject a warning reflection. */
  warnThreshold: number
  /** Repeats needed to hard-stop the loop. */
  stopThreshold: number
  /** Ring buffer size. */
  windowSize: number
}

export interface StallDetectorConfig {
  /** Consecutive rounds with unchanged signature before warn. */
  warnRounds: number
  /** Consecutive rounds with unchanged signature before hard-stop. */
  stopRounds: number
}

export interface ControllerConfig extends BudgetConfig {
  loopWarnThreshold?: number
  loopStopThreshold?: number
  loopWindowSize?: number
  stallWarnRounds?: number
  stallStopRounds?: number
}

// ── Utility: severity ordering ──────────────────────────────────────────────

const SEVERITY: Record<Escalation, number> = {
  none: 0,
  warn: 1,
  'force-summary': 2,
  'hard-stop': 3,
}

function moreSevere(a: StopDecision, b: StopDecision): StopDecision {
  return SEVERITY[a.escalation] >= SEVERITY[b.escalation] ? a : b
}

// ── BudgetTracker ───────────────────────────────────────────────────────────
//
// Tracks four independent budgets; reports the most critical one. Maps
// utilization → escalation level:
//   u >= 1.0 → hard-stop
//   u >= 0.95 → force-summary
//   u >= 0.80 → warn
//   else → none

export class BudgetTracker {
  constructor(private readonly cfg: BudgetConfig) {}

  evaluate(state: LoopState): StopDecision {
    const dims: Array<[StopReason, number, string]> = [
      [StopReason.MAX_ITERATIONS, state.round / this.cfg.maxIterations, `iterations ${state.round}/${this.cfg.maxIterations}`],
      [StopReason.TOKEN_BUDGET, state.tokensUsed / this.cfg.maxTokens, `tokens ${state.tokensUsed}/${this.cfg.maxTokens}`],
      [StopReason.TIMEOUT, state.elapsedMs / this.cfg.maxTimeMs, `time ${Math.round(state.elapsedMs / 1000)}s/${Math.round(this.cfg.maxTimeMs / 1000)}s`],
      [StopReason.MAX_TOOL_CALLS, state.toolCallCount / this.cfg.maxToolCalls, `tool-calls ${state.toolCallCount}/${this.cfg.maxToolCalls}`],
    ]

    // Pick the dimension with highest utilization
    let worst = dims[0]
    for (const d of dims) if (d[1] > worst[1]) worst = d

    const [reason, u, details] = worst
    return decisionFromUtilization(u, reason, details)
  }
}

function decisionFromUtilization(u: number, reason: StopReason, details: string): StopDecision {
  if (u > 1.0) {
    return { shouldStop: true, escalation: 'hard-stop', reason, details, utilization: u }
  }
  if (u >= 0.95) {
    return { shouldStop: false, escalation: 'force-summary', reason, details, utilization: u }
  }
  if (u >= 0.80) {
    return { shouldStop: false, escalation: 'warn', reason, details, utilization: u }
  }
  return { shouldStop: false, escalation: 'none', utilization: u }
}

// ── LoopDetector ────────────────────────────────────────────────────────────
//
// Keeps a sliding window of recent (tool, argsHash) fingerprints. If the same
// fingerprint appears >= warnThreshold times inside the window, emit a warn
// reflection; >= stopThreshold → hard-stop.

export class LoopDetector {
  private readonly window: ToolFingerprint[] = []

  constructor(private readonly cfg: LoopDetectorConfig) {}

  record(fp: ToolFingerprint): void {
    this.window.push(fp)
    if (this.window.length > this.cfg.windowSize) {
      this.window.shift()
    }
  }

  evaluate(_state: LoopState): StopDecision {
    if (this.window.length === 0) return { shouldStop: false, escalation: 'none' }

    // Count fingerprint occurrences
    const counts = new Map<string, number>()
    for (const fp of this.window) {
      const key = `${fp.tool}|${fp.argsHash}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }

    let maxKey = ''
    let maxCount = 0
    for (const [k, v] of counts) {
      if (v > maxCount) { maxKey = k; maxCount = v }
    }

    const toolName = maxKey.split('|')[0]
    if (maxCount >= this.cfg.stopThreshold) {
      return {
        shouldStop: true,
        escalation: 'hard-stop',
        reason: StopReason.LOOP_DETECTED,
        details: `Tool "${toolName}" repeated ${maxCount}× in last ${this.window.length} calls`,
      }
    }
    if (maxCount >= this.cfg.warnThreshold) {
      return {
        shouldStop: false,
        escalation: 'warn',
        reason: StopReason.LOOP_DETECTED,
        details: `Tool "${toolName}" repeated ${maxCount}× — consider changing approach`,
      }
    }
    return { shouldStop: false, escalation: 'none' }
  }
}

// ── StallDetector ───────────────────────────────────────────────────────────
//
// Observes the canvas/memory "progress signature" (stable hash of state). If
// it doesn't change for N rounds, the agent is probably stuck.

export class StallDetector {
  private lastSignature = ''
  private unchangedRounds = 0

  constructor(private readonly cfg: StallDetectorConfig) {}

  observe(signature: string, _round: number): void {
    if (signature === this.lastSignature) {
      this.unchangedRounds++
    } else {
      this.unchangedRounds = 1 // current round counts as 1
      this.lastSignature = signature
    }
  }

  evaluate(_state: LoopState): StopDecision {
    if (this.unchangedRounds >= this.cfg.stopRounds) {
      return {
        shouldStop: true,
        escalation: 'hard-stop',
        reason: StopReason.STALL_DETECTED,
        details: `No state change in ${this.unchangedRounds} rounds`,
      }
    }
    if (this.unchangedRounds >= this.cfg.warnRounds) {
      return {
        shouldStop: false,
        escalation: 'warn',
        reason: StopReason.STALL_DETECTED,
        details: `Canvas/memory unchanged for ${this.unchangedRounds} rounds — try a different approach`,
      }
    }
    return { shouldStop: false, escalation: 'none' }
  }
}

// ── Controller (composed) ───────────────────────────────────────────────────

export interface AgentLoopController {
  evaluate(state: LoopState): StopDecision
  recordToolCall(rec: ToolExecutionRecord): void
  observeProgress(signature: string, round: number): void
  buildReflection(decision: StopDecision): string
  buildStopMessage(decision: StopDecision): string
}

/** Cheap, stable hash of an args object. Not crypto — just for loop keys. */
function hashArgs(args: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(args, Object.keys(args).sort())
    // Tiny FNV-1a
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
    }
    return h.toString(16)
  } catch {
    return 'na'
  }
}

export function createAgentLoopController(cfg: ControllerConfig): AgentLoopController {
  const budget = new BudgetTracker({
    maxIterations: cfg.maxIterations,
    maxTokens: cfg.maxTokens,
    maxTimeMs: cfg.maxTimeMs,
    maxToolCalls: cfg.maxToolCalls,
  })
  const loop = new LoopDetector({
    warnThreshold: cfg.loopWarnThreshold ?? 3,
    stopThreshold: cfg.loopStopThreshold ?? 5,
    windowSize: cfg.loopWindowSize ?? 10,
  })
  const stall = new StallDetector({
    warnRounds: cfg.stallWarnRounds ?? 3,
    stopRounds: cfg.stallStopRounds ?? 5,
  })

  return {
    evaluate(state: LoopState): StopDecision {
      const d1 = budget.evaluate(state)
      const d2 = loop.evaluate(state)
      const d3 = stall.evaluate(state)
      return moreSevere(moreSevere(d1, d2), d3)
    },

    recordToolCall(rec: ToolExecutionRecord): void {
      loop.record({ tool: rec.tool, argsHash: hashArgs(rec.args) })
    },

    observeProgress(signature: string, round: number): void {
      stall.observe(signature, round)
    },

    buildReflection(decision: StopDecision): string {
      if (decision.escalation === 'warn') {
        switch (decision.reason) {
          case StopReason.MAX_ITERATIONS:
            return `[CONTROLLER] 接近预算上限（iterations ${decision.details ?? ''}）。请评估剩余步骤，合并多个工具调用或收尾。`
          case StopReason.TOKEN_BUDGET:
            return `[CONTROLLER] 接近预算上限（${decision.details ?? 'tokens'}）。请使用 compact_context 压缩历史，或直接收尾。`
          case StopReason.TIMEOUT:
            return `[CONTROLLER] 接近预算上限（${decision.details ?? 'time'}）。请加速收尾，避免继续扩大范围。`
          case StopReason.LOOP_DETECTED:
            return `[CONTROLLER] 检测到可能的循环：${decision.details ?? ''}。请改变策略，不要重复同一工具调用。`
          case StopReason.STALL_DETECTED:
            return `[CONTROLLER] 画布/记忆长时间未变化：${decision.details ?? ''}。请尝试不同的工具或方法。`
          default:
            return '[CONTROLLER] 接近预算上限，请尽快收尾。'
        }
      }
      if (decision.escalation === 'force-summary') {
        return `[CONTROLLER] 预算即将耗尽（${decision.details ?? ''}）。请立即输出最终总结，不要再调用工具。如果任务未完成，说明完成情况和剩余步骤。`
      }
      return ''
    },

    buildStopMessage(decision: StopDecision): string {
      if (!decision.shouldStop) return ''
      switch (decision.reason) {
        case StopReason.MAX_ITERATIONS:
          return `Agent 已达最大轮数上限（${decision.details ?? ''}）。已自动停止。`
        case StopReason.TOKEN_BUDGET:
          return `Agent 已达 Token 预算上限（${decision.details ?? ''}）。已自动停止。`
        case StopReason.TIMEOUT:
          return `Agent 已达时间预算上限（${decision.details ?? ''}）。已自动停止。`
        case StopReason.MAX_TOOL_CALLS:
          return `Agent 已达工具调用上限（${decision.details ?? ''}）。已自动停止。`
        case StopReason.LOOP_DETECTED:
          return `Agent 检测到死循环（${decision.details ?? ''}）。已自动停止。`
        case StopReason.STALL_DETECTED:
          return `Agent 长时间无进展（${decision.details ?? ''}）。已自动停止。`
        case StopReason.CONSECUTIVE_FAILURES:
          return `Agent 连续失败次数过多（${decision.details ?? ''}）。已自动停止。`
        case StopReason.USER_ABORT:
          return '已取消执行。'
        default:
          return 'Agent 已自动停止。'
      }
    },
  }
}

// Default configuration — sensible for most tasks. Tunable via settingsStore.
export const DEFAULT_LOOP_CONFIG: ControllerConfig = {
  maxIterations: 50,           // 2× LangGraph default; real ceiling
  maxTokens: 200_000,          // ~6× Claude Code auto-compact threshold; most LLMs cap here
  maxTimeMs: 30 * 60 * 1000,   // 30 minute wall-clock (image+video gen polling needs time)
  maxToolCalls: 100,           // hard cap on aggregate calls
  loopWarnThreshold: 3,
  loopStopThreshold: 5,
  loopWindowSize: 10,
  stallWarnRounds: 3,
  stallStopRounds: 5,
}
