"""
Concurrency tests for `agent.parallel_delegate` (task 3.1.2).

The handler in `app.agents.subagent._handle_parallel_delegate` uses an
`asyncio.Semaphore(concurrency)` (default 5, max 10) to bound how many
subagents run simultaneously when fanning out. This test pins that
contract so future refactors don't accidentally let the fan-out blow
through the cap.

Approach:
  - Patch the heavy collaborators (`_spawn_subagent_row`,
    `_run_subagent`) so we don't touch the DB or LangGraph.
  - The fake `_run_subagent` increments a shared counter on entry,
    sleeps long enough for asyncio to interleave waiting tasks, then
    decrements. We track the peak counter value and assert it equals
    the requested `concurrency` (when N >= concurrency).
  - The fake `parent_db.get(AgentSession, ...)` returns a stub session
    so the depth check passes.
"""
from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _StubSession:
    """Minimal stand-in for `AgentSession` used by `_handle_parallel_delegate`.

    `_depth_of` only reads `.metadata_json`; everything else (`user_id`,
    `project_id`, `model`, etc.) is consumed by `_spawn_subagent_row`,
    which we monkeypatch away.
    """

    def __init__(self, metadata: dict[str, Any] | None = None) -> None:
        self.metadata_json = metadata or {}


def _make_parent_db(parent_session: _StubSession) -> AsyncMock:
    """Async DB stub whose `.get(AgentSession, id)` returns the parent."""
    db = AsyncMock()
    db.get = AsyncMock(return_value=parent_session)
    return db


def _build_specs(n: int) -> list[dict[str, Any]]:
    return [{"role": "assistant", "goal": f"task-{i}"} for i in range(n)]


class _ConcurrencyTracker:
    """Counts current/peak in-flight `_run_subagent` invocations."""

    def __init__(self) -> None:
        self.current = 0
        self.peak = 0
        self._lock = asyncio.Lock()

    async def enter(self) -> None:
        async with self._lock:
            self.current += 1
            if self.current > self.peak:
                self.peak = self.current

    async def leave(self) -> None:
        async with self._lock:
            self.current -= 1


def _patch_subagent_collaborators(
    monkeypatch: pytest.MonkeyPatch,
    tracker: _ConcurrencyTracker,
    *,
    work_ms: int = 30,
) -> None:
    """Patch the heavy parts of `subagent` so the handler runs in-memory."""
    from app.agents import subagent

    spawn_counter = {"n": 0}

    async def _fake_spawn(*, parent: Any, role: str) -> int:
        spawn_counter["n"] += 1
        return 1000 + spawn_counter["n"]

    async def _fake_run(*, sub_session_id: int, goal: str, **_kw: Any) -> dict[str, Any]:
        await tracker.enter()
        try:
            # Sleep to give other tasks a chance to enter the semaphore;
            # this is what makes peak parallelism observable.
            await asyncio.sleep(work_ms / 1000.0)
            return {"ok": True, "data": {"text": f"done:{goal}"}, "session_id": sub_session_id}
        finally:
            await tracker.leave()

    monkeypatch.setattr(subagent, "_spawn_subagent_row", _fake_spawn, raising=True)
    monkeypatch.setattr(subagent, "_run_subagent", _fake_run, raising=True)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_default_concurrency_caps_at_five(monkeypatch: pytest.MonkeyPatch) -> None:
    """When the caller omits `concurrency`, the handler must default to 5."""
    from app.agents.subagent import _handle_parallel_delegate

    tracker = _ConcurrencyTracker()
    _patch_subagent_collaborators(monkeypatch, tracker)
    db = _make_parent_db(_StubSession())

    result = await _handle_parallel_delegate(
        {"subagents": _build_specs(10)},  # 10 fan-out, default concurrency=5
        {"db": db, "session_id": 42},
    )

    assert result.ok is True
    assert result.data["total"] == 10
    assert result.data["succeeded"] == 10
    assert tracker.peak == 5, f"expected peak 5, observed {tracker.peak}"


@pytest.mark.asyncio
async def test_explicit_concurrency_is_respected(monkeypatch: pytest.MonkeyPatch) -> None:
    """A caller-provided `concurrency` value caps in-flight subagents."""
    from app.agents.subagent import _handle_parallel_delegate

    tracker = _ConcurrencyTracker()
    _patch_subagent_collaborators(monkeypatch, tracker)
    db = _make_parent_db(_StubSession())

    result = await _handle_parallel_delegate(
        {"subagents": _build_specs(8), "concurrency": 3},
        {"db": db, "session_id": 1},
    )

    assert result.ok is True
    assert result.data["total"] == 8
    assert tracker.peak == 3, f"expected peak 3, observed {tracker.peak}"


@pytest.mark.asyncio
async def test_concurrency_one_serializes(monkeypatch: pytest.MonkeyPatch) -> None:
    """`concurrency=1` collapses fan-out to sequential execution."""
    from app.agents.subagent import _handle_parallel_delegate

    tracker = _ConcurrencyTracker()
    _patch_subagent_collaborators(monkeypatch, tracker)
    db = _make_parent_db(_StubSession())

    await _handle_parallel_delegate(
        {"subagents": _build_specs(5), "concurrency": 1},
        {"db": db, "session_id": 1},
    )

    assert tracker.peak == 1, f"expected serialized run, observed peak {tracker.peak}"


@pytest.mark.asyncio
async def test_zero_concurrency_falls_back_to_default(monkeypatch: pytest.MonkeyPatch) -> None:
    """`concurrency=0` is treated as falsy by `args.get("concurrency") or 5`,
    so it silently falls back to the default cap (5) — the key contract is
    that the handler never deadlocks (peak > 0) and never exceeds 5.
    """
    from app.agents.subagent import _handle_parallel_delegate

    tracker = _ConcurrencyTracker()
    _patch_subagent_collaborators(monkeypatch, tracker)
    db = _make_parent_db(_StubSession())

    result = await _handle_parallel_delegate(
        {"subagents": _build_specs(3), "concurrency": 0},
        {"db": db, "session_id": 1},
    )

    assert result.data["total"] == 3
    # 3 specs, default cap 5 → peak limited by fan-out, not the cap.
    assert 1 <= tracker.peak <= 3


@pytest.mark.asyncio
async def test_peak_never_exceeds_fanout(monkeypatch: pytest.MonkeyPatch) -> None:
    """When `concurrency >= N`, peak parallelism equals N (not the cap)."""
    from app.agents.subagent import _handle_parallel_delegate

    tracker = _ConcurrencyTracker()
    _patch_subagent_collaborators(monkeypatch, tracker)
    db = _make_parent_db(_StubSession())

    await _handle_parallel_delegate(
        {"subagents": _build_specs(2), "concurrency": 10},
        {"db": db, "session_id": 1},
    )

    assert tracker.peak == 2, f"only 2 fan-out, peak should be 2, got {tracker.peak}"


@pytest.mark.asyncio
async def test_empty_subagents_returns_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """Guard: empty / non-list `subagents` short-circuits without running anything."""
    from app.agents.subagent import _handle_parallel_delegate

    tracker = _ConcurrencyTracker()
    _patch_subagent_collaborators(monkeypatch, tracker)
    db = _make_parent_db(_StubSession())

    res_empty = await _handle_parallel_delegate(
        {"subagents": []},
        {"db": db, "session_id": 1},
    )
    assert res_empty.ok is False
    assert res_empty.error is not None and res_empty.error.code == "missing_args"

    res_missing = await _handle_parallel_delegate(
        {},
        {"db": db, "session_id": 1},
    )
    assert res_missing.ok is False
    assert res_missing.error is not None and res_missing.error.code == "missing_args"

    # Tracker must not have observed any subagent runs.
    assert tracker.peak == 0
    assert tracker.current == 0


@pytest.mark.asyncio
async def test_depth_cap_short_circuits(monkeypatch: pytest.MonkeyPatch) -> None:
    """A parent already at `_subagent_depth=2` cannot fan out — recursion guard."""
    from app.agents.subagent import _handle_parallel_delegate, DEFAULT_MAX_DEPTH

    tracker = _ConcurrencyTracker()
    _patch_subagent_collaborators(monkeypatch, tracker)

    deep_parent = _StubSession({"_subagent_depth": DEFAULT_MAX_DEPTH})
    db = _make_parent_db(deep_parent)

    result = await _handle_parallel_delegate(
        {"subagents": _build_specs(3), "concurrency": 5},
        {"db": db, "session_id": 1},
    )

    assert result.ok is False
    assert result.error is not None and result.error.code == "subagent_depth_exceeded"
    assert tracker.peak == 0, "should not have spawned any subagent"


@pytest.mark.asyncio
async def test_failed_subagents_count_separately_from_succeeded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Specs missing `goal` produce per-spec failures without aborting siblings."""
    from app.agents.subagent import _handle_parallel_delegate

    tracker = _ConcurrencyTracker()
    _patch_subagent_collaborators(monkeypatch, tracker)
    db = _make_parent_db(_StubSession())

    result = await _handle_parallel_delegate(
        {
            "subagents": [
                {"role": "assistant", "goal": "valid-1"},
                {"role": "assistant", "goal": ""},  # empty -> per-spec error
                {"role": "assistant", "goal": "valid-2"},
            ],
            "concurrency": 3,
        },
        {"db": db, "session_id": 1},
    )

    assert result.data["total"] == 3
    assert result.data["succeeded"] == 2
    # The middle entry should carry an explicit error marker.
    failures = [r for r in result.data["results"] if not r.get("ok")]
    assert len(failures) == 1
    assert failures[0].get("error") == "empty_goal"


@pytest.mark.asyncio
async def test_registered_schema_pins_concurrency_bounds() -> None:
    """The OpenAI schema for `agent.parallel_delegate` exposes 1..10 concurrency.

    Pins the contract so a registry edit can't silently widen / drop the bound.
    """
    from app.agents import subagent
    from app.agents.tool_registry import get_registry

    # Ensure the tool is in the registry (calls `register()` once).
    try:
        subagent.register()
    except ValueError:
        # Already registered by a prior test — idempotent for our purposes.
        pass
    tool = get_registry().resolve("agent.parallel_delegate")
    assert tool is not None, "agent.parallel_delegate must be registered"

    props = tool.parameters["properties"]
    assert "concurrency" in props
    cc = props["concurrency"]
    assert cc["type"] == "integer"
    assert cc["default"] == 5
    assert cc["minimum"] == 1
    assert cc["maximum"] == 10
    assert tool.tier == "tier3"
    assert tool.risk_level == "medium"
