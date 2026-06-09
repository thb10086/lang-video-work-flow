## ADDED Requirements

### Requirement: SSE Endpoint Streams Typed Agent Events

The backend SHALL expose `GET /api/agent/sessions/{id}/events` as a Server-Sent Events stream emitting typed `AgentEvent` payloads. Each event MUST carry `seq: int` (monotonically increasing per session) and a `type` from the closed set:

```
session_start | phase_change | reasoning_delta | tool_call | tool_result
| client_tool_request | subagent_started | subagent_finished | approval_required
| node_ref | stats_update | error | final | done
```

Events MUST be JSON-encoded and serialized following the SSE spec (`data: {...}\n\n`).

#### Scenario: Stream begins with session_start

- **WHEN** the client connects to `/api/agent/sessions/{id}/events`
- **THEN** the first emitted event is `session_start` containing `{ session_id, model, role, seq: 0 }`

#### Scenario: Stream ends with final + done

- **WHEN** the agent loop terminates (success, budget hit, or error)
- **THEN** the last two events MUST be `final` (carrying the assistant text) followed by `done`, after which the connection is closed by the server

#### Scenario: Reasoning is streamed token-level when supported

- **WHEN** the underlying LLM supports streaming reasoning (e.g., Claude Sonnet, GPT-5.4)
- **THEN** the runtime emits `reasoning_delta` events with incremental `text` chunks; the client accumulates them into the assistant message bubble

#### Scenario: Reasoning falls back to single delta when not supported

- **WHEN** the model does not support streaming
- **THEN** the runtime emits exactly one `reasoning_delta` event containing the full assistant content right before the corresponding `tool_call` or `final`

### Requirement: Last-Event-ID Reconnect Replays Missed Events

The SSE endpoint SHALL honor the `Last-Event-ID` HTTP header. On reconnect, the server MUST replay all events with `seq > Last-Event-ID` from `agent_events` before resuming live streaming.

#### Scenario: Network blip recovery

- **WHEN** the client reconnects with `Last-Event-ID: 42` and the server has emitted events up to seq 50 since
- **THEN** the server emits events seq 43..50 sequentially before transitioning back to live mode

#### Scenario: Idempotent client reception

- **WHEN** the client briefly receives event seq 43 twice (network retransmission)
- **THEN** the client deduplicates by `seq` and does not re-render or re-dispatch the duplicate

### Requirement: Long-Polling Fallback for Restrictive Networks

The endpoint SHALL accept `?transport=poll` query parameter that switches to a long-polling mode (returns batched events as a JSON array, then closes; client polls again with updated `cursor`). This fallback MUST yield identical event ordering and content to the SSE mode.

#### Scenario: Polling fallback preserves event order

- **WHEN** the client polls `GET /api/agent/sessions/{id}/events?transport=poll&cursor=10`
- **THEN** the response is a JSON array of events with `seq > 10`, ordered ascending, and the response includes `next_cursor` for the subsequent poll

### Requirement: Reverse RPC Endpoint Receives Client Tool Results

The backend SHALL expose `POST /api/agent/sessions/{id}/client-tool-result` accepting `{ call_id, ok: boolean, data?, error? }`. The runtime MUST resume the awaiting tool call with this payload as the `tool_result`.

#### Scenario: Successful client tool result resumes loop

- **WHEN** the runtime emits `client_tool_request{call_id: 'c1', name: 'canvas.add_node'}` and the client posts `{call_id: 'c1', ok: true, data: {nodeId: 'n42'}}`
- **THEN** the runtime emits `tool_result{call_id: 'c1', ok: true, data: {nodeId: 'n42'}}` and proceeds with the next reasoning step

#### Scenario: Client timeout fails the call

- **WHEN** no `client-tool-result` arrives within `timeout_ms` (default 5000) of the `client_tool_request`
- **THEN** the runtime synthesizes `tool_result{call_id, ok: false, error: { code: 'client_timeout' } }` and feeds it back into the loop

### Requirement: Approval Endpoint Captures User Decisions

The backend SHALL expose `POST /api/agent/sessions/{id}/approval/{call_id}` accepting `{ approved: boolean, reason?: string }`. The runtime MUST resume the awaiting tool with `{ok: false, message: 'user_denied'}` if `approved=false`, or invoke the original tool body if `approved=true`.

#### Scenario: User approves a delete_node call

- **WHEN** runtime emits `approval_required{call_id: 'c2', name: 'canvas.delete_node', risk_level: 'high'}` and user posts `{approved: true}`
- **THEN** the original tool body executes and a normal `tool_result` event follows
