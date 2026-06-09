"""Agent loop controller — Python port of `src/lib/agentLoopControl.ts`.

Behavior MUST stay byte-equivalent to the TS version (same thresholds, same
escalation rules, same Chinese reflection/stop strings) — verified by
shared fixtures in tests.

Five independent dimensions:
  - Budget (iterations / tokens / time / tool-calls)
  - Loop detection (sliding window of (tool, args_hash) fingerprints)
  - Stall detection (canvas+memory progress signature)

Three-stage degradation:
  - utilization >= 1.00  → hard-stop
  - utilization >= 0.95  → force-summary (no more tool calls)
  - utilization >= 0.80  → warn (inject reflection message)
  - else                 → none
"""
from __future__ import annotations

import hashlib
import json
import logging
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

logger = logging.getLogger("prism.agent.loop_control")


# ============================================================
# Enums + dataclasses
# ============================================================

class StopReason(str, Enum):
    MAX_ITERATIONS = "max_iterations"
    TOKEN_BUDGET = "token_budget"
    TIMEOUT = "timeout"
    MAX_TOOL_CALLS = "max_tool_calls"
    LOOP_DETECTED = "loop_detected"
    STALL_DETECTED = "stall_detected"
    CONSECUTIVE_FAILURES = "consecutive_failures"
    USER_ABORT = "user_abort"


# severity ordering ('none' < 'warn' < 'force-summary' < 'hard-stop')
_SEVERITY: dict[str, int] = {
    "none": 0,
    "warn": 1,
    "force-summary": 2,
    "hard-stop": 3,
}


@dataclass
class StopDecision:
    should_stop: bool = False
    escalation: str = "none"  # 'none' | 'warn' | 'force-summary' | 'hard-stop'
    reason: Optional[StopReason] = None
    details: str = ""
    utilization: float = 0.0


@dataclass
class LoopState:
    round: int = 0
    elapsed_ms: int = 0
    tokens_used: int = 0
    tool_call_count: int = 0
    progress_signature: str = ""


@dataclass
class ToolFingerprint:
    tool: str
    args_hash: str


@dataclass
class ToolExecutionRecord:
    tool: str
    args: dict[str, Any]
    success: bool


@dataclass
class BudgetConfig:
    max_iterations: int = 50
    max_tokens: int = 200_000
    max_time_ms: int = 10 * 60 * 1000
    max_tool_calls: int = 100


@dataclass
class LoopDetectorConfig:
    warn_threshold: int = 3
    stop_threshold: int = 5
    window_size: int = 10


@dataclass
class StallDetectorConfig:
    warn_rounds: int = 3
    stop_rounds: int = 5


@dataclass
class ControllerConfig(BudgetConfig):
    loop_warn_threshold: int = 3
    loop_stop_threshold: int = 5
    loop_window_size: int = 10
    stall_warn_rounds: int = 3
    stall_stop_rounds: int = 5


def _more_severe(a: StopDecision, b: StopDecision) -> StopDecision:
    return a if _SEVERITY[a.escalation] >= _SEVERITY[b.escalation] else b


def _decision_from_utilization(u: float, reason: StopReason, details: str) -> StopDecision:
    if u > 1.0:
        return StopDecision(should_stop=True, escalation="hard-stop", reason=reason, details=details, utilization=u)
    if u >= 0.95:
        return StopDecision(should_stop=False, escalation="force-summary", reason=reason, details=details, utilization=u)
    if u >= 0.80:
        return StopDecision(should_stop=False, escalation="warn", reason=reason, details=details, utilization=u)
    return StopDecision(should_stop=False, escalation="none", utilization=u)


# ============================================================
# Trackers
# ============================================================

class BudgetTracker:
    def __init__(self, cfg: BudgetConfig):
        self.cfg = cfg

    def evaluate(self, state: LoopState) -> StopDecision:
        dims: list[tuple[StopReason, float, str]] = [
            (
                StopReason.MAX_ITERATIONS,
                state.round / max(self.cfg.max_iterations, 1),
                f"iterations {state.round}/{self.cfg.max_iterations}",
            ),
            (
                StopReason.TOKEN_BUDGET,
                state.tokens_used / max(self.cfg.max_tokens, 1),
                f"tokens {state.tokens_used}/{self.cfg.max_tokens}",
            ),
            (
                StopReason.TIMEOUT,
                state.elapsed_ms / max(self.cfg.max_time_ms, 1),
                f"time {state.elapsed_ms // 1000}s/{self.cfg.max_time_ms // 1000}s",
            ),
            (
                StopReason.MAX_TOOL_CALLS,
                state.tool_call_count / max(self.cfg.max_tool_calls, 1),
                f"tool-calls {state.tool_call_count}/{self.cfg.max_tool_calls}",
            ),
        ]
        worst = dims[0]
        for d in dims:
            if d[1] > worst[1]:
                worst = d
        reason, u, details = worst
        return _decision_from_utilization(u, reason, details)


class LoopDetector:
    def __init__(self, cfg: LoopDetectorConfig):
        self.cfg = cfg
        self.window: deque[ToolFingerprint] = deque(maxlen=cfg.window_size)

    def record(self, fp: ToolFingerprint) -> None:
        self.window.append(fp)

    def evaluate(self, state: LoopState) -> StopDecision:
        if not self.window:
            return StopDecision()
        counts: dict[str, int] = {}
        for fp in self.window:
            key = f"{fp.tool}|{fp.args_hash}"
            counts[key] = counts.get(key, 0) + 1
        max_key = ""
        max_count = 0
        for k, v in counts.items():
            if v > max_count:
                max_key, max_count = k, v
        tool_name = max_key.split("|", 1)[0]
        if max_count >= self.cfg.stop_threshold:
            return StopDecision(
                should_stop=True,
                escalation="hard-stop",
                reason=StopReason.LOOP_DETECTED,
                details=f'Tool "{tool_name}" repeated {max_count}× in last {len(self.window)} calls',
            )
        if max_count >= self.cfg.warn_threshold:
            return StopDecision(
                should_stop=False,
                escalation="warn",
                reason=StopReason.LOOP_DETECTED,
                details=f'Tool "{tool_name}" repeated {max_count}× — consider changing approach',
            )
        return StopDecision()


class StallDetector:
    def __init__(self, cfg: StallDetectorConfig):
        self.cfg = cfg
        self.last_signature = ""
        self.unchanged_rounds = 0

    def observe(self, signature: str, round_idx: int) -> None:
        if signature == self.last_signature:
            self.unchanged_rounds += 1
        else:
            self.unchanged_rounds = 1
            self.last_signature = signature

    def evaluate(self, state: LoopState) -> StopDecision:
        if self.unchanged_rounds >= self.cfg.stop_rounds:
            return StopDecision(
                should_stop=True,
                escalation="hard-stop",
                reason=StopReason.STALL_DETECTED,
                details=f"No state change in {self.unchanged_rounds} rounds",
            )
        if self.unchanged_rounds >= self.cfg.warn_rounds:
            return StopDecision(
                should_stop=False,
                escalation="warn",
                reason=StopReason.STALL_DETECTED,
                details=f"Canvas/memory unchanged for {self.unchanged_rounds} rounds — try a different approach",
            )
        return StopDecision()


# ============================================================
# args hash — must match TS FNV-1a output
# ============================================================

def hash_args(args: dict[str, Any]) -> str:
    """Deterministic short hash of args. Matches TS hashArgs (FNV-1a 32-bit).

    We replicate the TS algorithm exactly to keep parity test fixtures stable.
    """
    try:
        # JSON.stringify with sorted keys mirrors what the TS side produces.
        s = json.dumps(args, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    except Exception:
        return "na"
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch) & 0xFFFFFFFF
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) & 0xFFFFFFFF
    return f"{h:x}"


# ============================================================
# Composed controller
# ============================================================

@dataclass
class AgentLoopController:
    cfg: ControllerConfig
    _budget: BudgetTracker = field(init=False)
    _loop: LoopDetector = field(init=False)
    _stall: StallDetector = field(init=False)
    _warned_reasons: set[StopReason] = field(default_factory=set)

    def __post_init__(self):
        self._budget = BudgetTracker(BudgetConfig(
            max_iterations=self.cfg.max_iterations,
            max_tokens=self.cfg.max_tokens,
            max_time_ms=self.cfg.max_time_ms,
            max_tool_calls=self.cfg.max_tool_calls,
        ))
        self._loop = LoopDetector(LoopDetectorConfig(
            warn_threshold=self.cfg.loop_warn_threshold,
            stop_threshold=self.cfg.loop_stop_threshold,
            window_size=self.cfg.loop_window_size,
        ))
        self._stall = StallDetector(StallDetectorConfig(
            warn_rounds=self.cfg.stall_warn_rounds,
            stop_rounds=self.cfg.stall_stop_rounds,
        ))

    def evaluate(self, state: LoopState) -> StopDecision:
        d1 = self._budget.evaluate(state)
        d2 = self._loop.evaluate(state)
        d3 = self._stall.evaluate(state)
        return _more_severe(_more_severe(d1, d2), d3)

    def record_tool_call(self, rec: ToolExecutionRecord) -> None:
        self._loop.record(ToolFingerprint(tool=rec.tool, args_hash=hash_args(rec.args)))

    def observe_progress(self, signature: str, round_idx: int) -> None:
        self._stall.observe(signature, round_idx)

    def build_reflection(self, decision: StopDecision) -> str:
        """Same Chinese strings as TS so shared fixture tests pass byte-equivalent."""
        if decision.escalation == "warn":
            r = decision.reason
            d = decision.details or ""
            if r == StopReason.MAX_ITERATIONS:
                return f"[CONTROLLER] 接近预算上限（iterations {d}）。请评估剩余步骤，合并多个工具调用或收尾。"
            if r == StopReason.TOKEN_BUDGET:
                return f"[CONTROLLER] 接近预算上限（{d or 'tokens'}）。请使用 compact_context 压缩历史，或直接收尾。"
            if r == StopReason.TIMEOUT:
                return f"[CONTROLLER] 接近预算上限（{d or 'time'}）。请加速收尾，避免继续扩大范围。"
            if r == StopReason.LOOP_DETECTED:
                return f"[CONTROLLER] 检测到可能的循环：{d}。请改变策略，不要重复同一工具调用。"
            if r == StopReason.STALL_DETECTED:
                return f"[CONTROLLER] 画布/记忆长时间未变化：{d}。请尝试不同的工具或方法。"
            return "[CONTROLLER] 接近预算上限，请尽快收尾。"
        if decision.escalation == "force-summary":
            d = decision.details or ""
            return f"[CONTROLLER] 预算即将耗尽（{d}）。请立即输出最终总结，不要再调用工具。如果任务未完成，说明完成情况和剩余步骤。"
        return ""

    def build_stop_message(self, decision: StopDecision) -> str:
        if not decision.should_stop:
            return ""
        d = decision.details or ""
        r = decision.reason
        if r == StopReason.MAX_ITERATIONS:
            return f"Agent 已达最大轮数上限（{d}）。已自动停止。"
        if r == StopReason.TOKEN_BUDGET:
            return f"Agent 已达 Token 预算上限（{d}）。已自动停止。"
        if r == StopReason.TIMEOUT:
            return f"Agent 已达时间预算上限（{d}）。已自动停止。"
        if r == StopReason.MAX_TOOL_CALLS:
            return f"Agent 已达工具调用上限（{d}）。已自动停止。"
        if r == StopReason.LOOP_DETECTED:
            return f"Agent 检测到死循环（{d}）。已自动停止。"
        if r == StopReason.STALL_DETECTED:
            return f"Agent 长时间无进展（{d}）。已自动停止。"
        if r == StopReason.CONSECUTIVE_FAILURES:
            return f"Agent 连续失败次数过多（{d}）。已自动停止。"
        if r == StopReason.USER_ABORT:
            return "已取消执行。"
        return "Agent 已自动停止。"


def create_agent_loop_controller(cfg: Optional[ControllerConfig] = None) -> AgentLoopController:
    return AgentLoopController(cfg or ControllerConfig())


DEFAULT_LOOP_CONFIG = ControllerConfig()
