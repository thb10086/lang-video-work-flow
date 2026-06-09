## ADDED Requirements

### Requirement: Backend Hosts Agent Main Loop

The Agent main loop SHALL execute on the backend (`server/app/agents/runtime.py`). The frontend MUST NOT contain a tool-dispatch loop; it only initiates a session and consumes streamed events.

The runtime SHALL preserve the 5-dimension budget + loop-detection + stall-detection semantics of the legacy frontend `agentLoopControl.ts`:

- maxIterations (default 50)
- maxTokens (default 200_000)
- maxTimeMs (default 600_000)
- maxToolCalls (default 100)
- LoopDetector (sliding window N=10, warn 3x, stop 5x)
- StallDetector (canvas+memory signature unchanged ≥ 5 rounds)

#### Scenario: Frontend posts a user message, backend orchestrates the loop

- **WHEN** the user submits a message via `POST /api/agent/sessions` with `{ message, images? }`
- **THEN** the backend creates a row in `agent_sessions`, returns `{ session_id }`, and the SSE stream from `GET /api/agent/sessions/{id}/events` immediately emits `session_start` followed by reasoning/tool events as the loop progresses

#### Scenario: Budget hard stop terminates the loop

- **WHEN** the runtime accumulates ≥ 200_000 tokens or runs > 600_000 ms
- **THEN** the loop emits a `final` event whose text starts with the stop reason (`"budget_exceeded: tokens"` / `"budget_exceeded: time"`) and `done` event closes the stream

#### Scenario: Loop detector terminates after repeated identical tool calls

- **WHEN** the same `(tool_name, args_hash)` tuple is called 5 times within the last 10 calls
- **THEN** the loop emits a `final` event with stop reason `"loop_detected: <tool_name>"` and exits

#### Scenario: Stall detector terminates after canvas+memory signature unchanged

- **WHEN** the canvas + memory progress signature is unchanged for 5 consecutive rounds
- **THEN** the loop emits `final` with stop reason `"stalled"` and exits

### Requirement: Frontend chatStore Stops Hosting the Loop

The frontend `src/store/chatStore.ts` SHALL no longer execute tool-dispatch loop code in production. Its `processUserMessage` action SHALL delegate to `agentSseClient.run(...)` and update local UI state from streamed events only.

A feature flag `AGENT_FRONTEND_LOOP_FALLBACK` MAY temporarily enable the legacy code path during the migration period; it MUST default to `false` after Phase 1 completion.

#### Scenario: Fallback flag off — only backend executes loop

- **WHEN** `AGENT_FRONTEND_LOOP_FALLBACK = false` and the user sends a message
- **THEN** no `for round` iteration runs in the browser; all `tool_call` events arrive via SSE and dispatch is exclusively client-tool RPC

#### Scenario: Fallback flag on — legacy path resumed

- **WHEN** `AGENT_FRONTEND_LOOP_FALLBACK = true`
- **THEN** the frontend uses the legacy `chatStore.processUserMessage` loop and ignores SSE events; behavior matches the version before this change

### Requirement: Sessions Are Persisted and Resumable

Agent sessions SHALL persist their state (`budget_state`, `loop_state`, current `phase`) to the `agent_sessions` table. All emitted events SHALL be appended to `agent_events` keyed by `(session_id, seq)`.

A session that becomes idle (no activity > 30 min) SHALL be auto-paused; on user resume the runtime MUST rebuild internal state from the persisted columns and continue from the last completed tool call.

#### Scenario: Session pauses after idle timeout

- **WHEN** a session has no event activity for > 30 minutes
- **THEN** its `status` transitions to `paused` and `budget_state` / `loop_state` are persisted

#### Scenario: User resumes a paused session

- **WHEN** the user calls `POST /api/agent/sessions/{id}/resume` on a paused session
- **THEN** the runtime rehydrates from persisted state and continues; the SSE stream emits a `session_resumed` event followed by the next reasoning/tool event

### Requirement: Memory Persistence Moves to Backend

Agent memory (replacing frontend `agentMemoryStore`) SHALL persist to the `agent_memories` table with `scope ∈ {session, project, global}`, `pinned`, `last_accessed_at`. Tag-overlap + recency relevance ranking from the legacy implementation MUST be preserved byte-equivalent in unit tests against shared fixtures.

#### Scenario: Project-scoped memory only loads when on matching project

- **WHEN** session A loads with `project_id = 7` and there exists a memory row with `scope='project', project_id=4`
- **THEN** that memory MUST NOT be injected into session A's prompt context

#### Scenario: Pinned global memory always included

- **WHEN** ranking memories for a user message that overlaps no tags
- **THEN** any memory with `pinned = true AND scope ∈ ('global', matching project)` is still included in the top-K injection

#### Scenario: Auto-rollup at > 20 session memories

- **WHEN** the count of `scope='session'` memories for a session exceeds 20
- **THEN** the oldest 10 are collapsed into a single `task_summary` rollup row whose body is the joined titles capped at 600 characters
