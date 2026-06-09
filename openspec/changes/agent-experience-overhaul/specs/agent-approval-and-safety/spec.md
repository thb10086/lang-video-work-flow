## ADDED Requirements

### Requirement: Tool Risk Levels Are Centrally Registered

The backend SHALL maintain a `RISK_LEVELS: dict[str, RiskLevel]` registry in `tool_registry.py`, where every tool name maps to one of:

- `safe`: pure read (no state change, no API cost)
- `low`: single-node CRUD on canvas (additive)
- `medium`: single execution that consumes API quota
- `high`: batch / destructive (delete, batch_execute, parallel_execute)
- `critical`: project-wide (generate_workflow, clear_all, forget_memory)

The mapping MUST cover 100% of registered tools; tools without an explicit entry SHALL default to `medium` and emit a warning at startup.

#### Scenario: Registry coverage check at startup

- **WHEN** the FastAPI app boots
- **THEN** `tool_registry.validate_risk_coverage()` runs and logs a warning for every tool missing from `RISK_LEVELS`; CI test fails if any tool is uncovered

#### Scenario: Risk level surfaced in tool listing

- **WHEN** the `discover_tools` tool is called
- **THEN** every returned tool entry includes `risk: "<level>"` so the LLM can reason about cost/safety

### Requirement: High-Risk Tools Block on User Approval

When a tool with `risk_level ∈ ('high', 'critical')` is invoked, the runtime SHALL emit `approval_required{ call_id, name, args, risk_level, diff? }` to the SSE stream and pause execution of that call.

The runtime MUST resume only after `POST /api/agent/sessions/{id}/approval/{call_id}` returns either `{approved: true}` (execute) or `{approved: false}` (yield `tool_result{ok: false, error: 'user_denied'}`).

The user setting `approve_medium_too: true` SHALL extend approval to `medium` tools; default is `false`.

#### Scenario: delete_node requires approval by default

- **WHEN** the agent attempts `canvas.delete_node({ node_id: 'n1' })`
- **THEN** the runtime emits `approval_required` with `risk_level='high'` and a `diff` showing `{nodes_to_delete: ['n1: 镜头2 关键帧']}`; nothing is mutated until user responds

#### Scenario: User toggles approve_medium_too on

- **WHEN** the user setting `approve_medium_too = true` and the agent calls `canvas.execute_node(...)`
- **THEN** an `approval_required` event is emitted (because `execute_node` is `medium`); user can approve or deny

#### Scenario: critical tool diff shows field-level

- **WHEN** the agent calls `canvas.generate_workflow(...)`
- **THEN** the `diff` payload includes a list of nodes that would be created plus their proposed labels and types

### Requirement: Approval Decisions Are Audited

Every approval/denial SHALL be appended to `agent_events` with `type='approval_decision'` and `payload: { call_id, approved, reason?, user_id }` for audit and analytics.

#### Scenario: Audit log captures all decisions

- **WHEN** the user denies a `delete_node` call
- **THEN** `agent_events` contains a row with `type='approval_decision'`, `payload.approved=false`, `payload.call_id` matching the original call

### Requirement: Node Lock Prevents Agent Mutation

`flowStore` nodes SHALL accept an optional `data.locked: boolean`. When true:

- `canvas.update_node` rejects with `{ ok: false, error: 'node_locked' }`
- `canvas.delete_node` rejects unless `force: true` is explicitly passed (and `force` is itself a `critical`-risk arg requiring approval)
- `canvas.execute_node` is allowed (locked refers to data, not execution)

#### Scenario: Locked node blocks update

- **WHEN** node n1 has `locked: true` and agent calls `canvas.update_node({ node_id: 'n1', patch: { prompt: 'new' } })`
- **THEN** the bridge returns `{ ok: false, error: 'node_locked' }`; the chat tool log shows the failure

#### Scenario: Force-delete a locked node still requires user approval

- **WHEN** agent calls `canvas.delete_node({ node_id: 'n1', force: true })` on a locked node
- **THEN** the runtime emits `approval_required` (risk_level='critical' due to `force`); only after explicit approval does deletion proceed

### Requirement: Batch Approval Coalescing

When the agent invokes a batch tool (e.g., `node.execute_parallel({ node_labels: [...] })`), the runtime SHALL emit a single `approval_required` event covering the batch (with `args.node_labels` listed in the diff), not N separate approval prompts.

#### Scenario: Single approval covers parallel execution

- **WHEN** agent calls `node.execute_parallel({ node_labels: ['shot1', ..., 'shot8'] })` and the operation is `high`-risk
- **THEN** ONE `approval_required` event is emitted listing all 8 nodes; user clicks Approve once and all 8 execute
