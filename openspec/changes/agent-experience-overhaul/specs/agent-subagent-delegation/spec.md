## ADDED Requirements

### Requirement: `delegate_to_subagent` Tool Spawns Isolated Subagents

The backend SHALL provide a tool `delegate_to_subagent({ role, goal, budget?, return_schema?, parent_tools_allowed?: string[] })` that spawns a short-lived subagent.

The subagent MUST:
- Run the same `runtime.py` recursively but with an independent `BudgetTracker` (default 50K tokens / 5 min / 30 tool calls; overridable by `budget` arg)
- Use a fresh `messages[]` containing only the system prompt + the `goal` string + any explicitly passed `parent_context` (default: nothing inherited)
- Start in `phase=idle` regardless of parent phase
- Return a structured result conforming to `return_schema` (JSON Schema); if missing, the subagent's final assistant text is wrapped as `{ text: <content> }`

#### Scenario: Subagent goal succeeds with structured return

- **WHEN** the parent calls `delegate_to_subagent({ role: 'cinematographer', goal: 'write 8 shot prompts for a cyberpunk chase', return_schema: { type: 'object', properties: { shots: { type: 'array' } } } })`
- **THEN** the subagent runs to completion and returns `{ ok: true, data: { shots: [...] } }`; the parent receives this as a `tool_result`

#### Scenario: Subagent budget exhaustion does not affect parent

- **WHEN** the subagent hits its 50K-token budget
- **THEN** it returns `{ ok: false, error: { code: 'subagent_budget_exhausted' } }` and the parent's budget is unchanged; the parent decides whether to retry or proceed

#### Scenario: Subagent depth cap prevents recursion bombs

- **WHEN** a subagent itself calls `delegate_to_subagent` and `subagent_max_depth` (default 2) is reached
- **THEN** the call fails with `{ ok: false, error: { code: 'subagent_depth_exceeded' } }` without spawning

### Requirement: Parent Receives Subagent Lifecycle Events via SSE

The parent session's SSE stream SHALL include `subagent_started{ subagent_id, parent_call_id, role, goal }` when a subagent spawns, and `subagent_finished{ subagent_id, ok, data?, error? }` when it terminates.

The frontend MUST be able to render subagent timelines as nested under the parent's progress timeline without losing causality.

#### Scenario: UI renders nested subagent timeline

- **WHEN** the parent fans out 3 subagents in parallel
- **THEN** the `ProgressTimeline` shows 3 collapsible subagent rows beneath the `delegate_to_subagent` tool call card, each with its own tool-call list

### Requirement: Subagent Tool Whitelist Defaults Restrictive

A spawned subagent's tool registry SHALL default to a restrictive whitelist:

- All `canvas.*` client tools: **denied** (subagents do not directly mutate canvas)
- `delegate_to_subagent`: **denied** (depth cap)
- All others (memory / model / planning / generation): **allowed**

The parent MAY pass `parent_tools_allowed: string[]` to selectively re-enable tools (e.g., re-allowing `canvas.add_node` for a workflow-builder subagent), but `delegate_to_subagent` re-enabling is rejected with a `400` error.

#### Scenario: Default whitelist denies canvas access

- **WHEN** a subagent attempts to call `canvas.add_node`
- **THEN** the tool registry rejects the call with `{ ok: false, error: { code: 'tool_not_allowed_in_subagent' } }`

#### Scenario: Parent re-enables specific tools

- **WHEN** parent invokes `delegate_to_subagent({ ..., parent_tools_allowed: ['canvas.add_node', 'canvas.connect_nodes'] })`
- **THEN** the subagent can call those two tools but other `canvas.*` tools remain denied

### Requirement: Parallel Subagent Fan-Out Is Supported

A single tool call `parallel_delegate({ subagents: [{ role, goal, ... }, ...] })` SHALL spawn N subagents concurrently and return a single `tool_result` carrying their results in input order.

The total wall-clock duration MUST equal the slowest subagent (within the budget caps) rather than the sum.

#### Scenario: Three parallel subagents finish in max-duration time

- **WHEN** parent calls `parallel_delegate({ subagents: [a, b, c] })` where a/b/c take 10s/15s/8s respectively
- **THEN** the parent receives the combined `tool_result` after ~15s (not 33s); all 3 subagents' SSE events interleave in the parent stream
