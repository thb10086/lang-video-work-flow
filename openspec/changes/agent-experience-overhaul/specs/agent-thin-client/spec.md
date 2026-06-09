## ADDED Requirements

### Requirement: Thin-Client SSE Receiver Maintains UI State

The frontend SHALL include `src/api/agentSseClient.ts` exposing `run({ message, images, model?, role? }): { sessionId, events: AsyncIterable<AgentEvent> }`. It MUST maintain an `EventSource` connection to `/api/agent/sessions/{id}/events`, dedupe events by `seq`, and update `agentSessionStore` and `chatStore` based on event type.

#### Scenario: User sends message, client receives stream

- **WHEN** the user submits "create a cyberpunk short film" and the client calls `agentSseClient.run(...)`
- **THEN** the client receives `session_start` → `phase_change` → multiple `tool_call`/`tool_result` → `final` → `done`, and the assistant message in `chatStore` is updated incrementally

#### Scenario: Token-level reasoning renders smoothly

- **WHEN** `reasoning_delta` events arrive at > 10/sec
- **THEN** the client throttles UI repaint to ≤ 10 Hz (100ms) by accumulating delta text and flushing on a `requestAnimationFrame` tick; no individual render blocks the main thread > 16ms

#### Scenario: Auto-reconnect on transient network failure

- **WHEN** the SSE connection drops mid-session and reconnects within 30 seconds
- **THEN** the client sends `Last-Event-ID` header with the last observed seq, deduplicates any replayed events, and the user sees no message corruption

### Requirement: Client Tool Bridge Executes Reverse RPC

The frontend SHALL include `src/api/clientToolBridge.ts` registering handlers for the `canvas.*` / `images.*` / `ui.*` tool family. On `client_tool_request` event, it MUST execute the corresponding handler and POST the result via `client-tool-result` within `timeout_ms`.

The registry MUST include at minimum:
- `canvas.add_node({ type, position, data }) → { nodeId }`
- `canvas.connect_nodes({ source_label, target_label }) → { edge_id, source_handle, target_handle }`
- `canvas.update_node({ node_id, patch }) → { ok }`
- `canvas.delete_node({ node_id, force? }) → { ok }`
- `canvas.highlight({ node_ids }) → { ok }`
- `canvas.undo() → { ok, restored_count }`
- `images.collect_user_uploads() → { images: string[] }`
- `images.upload_to_cos({ data_url }) → { url }`

#### Scenario: Backend asks client to add a node

- **WHEN** the runtime emits `client_tool_request{ name: 'canvas.add_node', args: { type: 'imageGen', position: {x:100,y:200}, data: {...} } }`
- **THEN** the client executes `flowStore.addNode(...)` and POSTs `{ call_id, ok: true, data: { nodeId: <new id> } }` within timeout

#### Scenario: Locked node blocks update

- **WHEN** `canvas.update_node` is invoked on a node whose `data.locked === true`
- **THEN** the bridge returns `{ ok: false, error: 'node_locked' }` without modifying the node

#### Scenario: Unknown client tool name returns error

- **WHEN** `client_tool_request` references an unregistered name
- **THEN** the bridge POSTs `{ ok: false, error: 'unknown_client_tool' }` so the runtime can surface the failure to the LLM

### Requirement: Approval Queue Surfaces High-Risk Tools

The frontend SHALL maintain `agentSessionStore.approvalQueue: ApprovalRequest[]`. On `approval_required` event, the request is pushed; the UI displays an `ApprovalDialog` until the user approves or denies.

#### Scenario: User must approve before delete_node executes

- **WHEN** `approval_required{ name: 'canvas.delete_node', risk_level: 'high', diff: {nodes: ['n1','n2']} }` arrives
- **THEN** the dialog shows "About to delete 2 nodes: <labels>" with Approve/Deny buttons; clicking Deny posts `{approved: false}` and the chat shows the deny in the tool log

### Requirement: Frontend chatStore Uses Streamed Updates Only

`chatStore.processUserMessage` SHALL be reduced to: (a) push the user message, (b) call `agentSseClient.run(...)`, (c) subscribe to events, (d) update `messages[]` / `agentStats` based on event payloads. It MUST NOT contain any `for round` loop, prompt building, tool dispatch, or memory writes (those live on the backend).

#### Scenario: chatStore code size shrinks dramatically

- **WHEN** Phase 4 cleanup completes
- **THEN** `chatStore.ts` LoC ≤ 250 (down from current ~510), and `processUserMessage` body ≤ 50 lines

#### Scenario: Cancel propagates to backend

- **WHEN** the user clicks Cancel during a running session
- **THEN** the client calls `POST /api/agent/sessions/{id}/cancel` and the backend emits `final{ stop_reason: 'user_cancelled' }` followed by `done`
