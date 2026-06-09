## ADDED Requirements

### Requirement: Tools Return Structured ToolResult

All Agent tools (server-side and client-side) SHALL return a structured `ToolResult` envelope:

```typescript
interface ToolResult<T = unknown> {
  ok: boolean
  data?: T               // structured payload on success
  hints?: string[]       // suggestions for next action (e.g., "verify with get_node_output")
  next_step?: string     // recommended next tool name (or null)
  error?: { code: string; message: string; recoverable: boolean }
  meta?: { elapsed_ms: number; cost_tokens?: number }
}
```

Tools MUST NOT return free-form `message: string` as the primary result; any human-readable summary MUST be derived from `data`/`hints` at render time.

#### Scenario: Successful tool returns structured data

- **WHEN** `canvas.add_node({ type: 'imageGen', ... })` succeeds
- **THEN** the result is `{ ok: true, data: { nodeId: 'n42', label: '图片生成' }, next_step: 'connect_nodes', meta: { elapsed_ms: 12 } }`

#### Scenario: Failed tool returns structured error

- **WHEN** `node.execute({ nodeId: 'n_missing' })` cannot find the node
- **THEN** the result is `{ ok: false, error: { code: 'node_not_found', message: '找不到节点 n_missing', recoverable: false } }`

#### Scenario: Recoverable error includes hints

- **WHEN** `node.execute` hits a 503 from the model proxy
- **THEN** the result is `{ ok: false, error: { code: 'model_overloaded', recoverable: true }, hints: ['retry after 30s', 'consider switching model via update_node'] }`

### Requirement: Legacy `ToolCallResult` Adapter Maintains Compatibility

Code paths that still expect the legacy `ToolCallResult { success, message, nodeIds? }` shape SHALL receive an automatically adapted view via `toLegacyResult(result: ToolResult): ToolCallResult`. The adapter MUST:

- Map `ok → success`
- Synthesize `message` by joining hints + data summary (deterministic, ≤ 200 chars)
- Extract `nodeIds` from `data.affected_node_ids` if present
- Preserve all backward-compat callers without code change

#### Scenario: Old caller sees legacy shape

- **WHEN** legacy `agentTools.executeToolCall(...)` calls a new-shape tool
- **THEN** the wrapper returns `ToolCallResult { success: true, message: <synthesized>, nodeIds: [...] }`; calling code does not need updates

#### Scenario: New caller sees structured shape

- **WHEN** the SSE-based runtime invokes the same tool
- **THEN** the runtime sees the full `ToolResult` and emits `tool_result` event preserving `data`/`hints`/`next_step`

### Requirement: Tool Naming Follows `<noun>.<verb>` Convention

All new tools and existing tools (post-migration) SHALL use the `<noun>.<verb>` naming pattern:

- `character.create_grid`, `character.create_extract`, `character.create_registry`
- `canvas.add_node`, `canvas.connect`, `canvas.update_node`, `canvas.delete_node`, `canvas.undo`
- `node.execute`, `node.execute_parallel`, `node.execute_batch`, `node.retry`, `node.get_output`
- `plan.create`, `plan.update_step`, `plan.complete`
- `memory.save`, `memory.recall`, `memory.forget`
- `model.list`, `model.get_params`
- `asset.list`, `asset.create`, `asset.update`, `asset.link_to_node`, `asset.resolve_refs`
- `phase.set`
- `agent.delegate`, `agent.parallel_delegate`
- `quality.review_content`, `quality.review_image`, `quality.optimize_prompt`, `quality.verify_semantic`

Legacy snake_case names (e.g., `create_character_grid`) SHALL remain accepted as **deprecated aliases** for one release cycle, then removed.

#### Scenario: New name resolves to same handler

- **WHEN** the agent calls `character.create_grid(...)` or `create_character_grid(...)`
- **THEN** both invocations dispatch to the same handler and return identical results

#### Scenario: Deprecated alias logs a warning

- **WHEN** the agent calls a legacy alias
- **THEN** the runtime logs at WARN level `tool_alias_used: old=create_character_grid new=character.create_grid` for analytics; the response is unchanged

### Requirement: New Ergonomic Tools Are Added

The tool registry SHALL include the following new tools:

- `canvas.dry_run({ type, data }) → { preview: SerializedNode, would_create: boolean }` — returns what would be created without mutating
- `canvas.undo() → { restored }` — invokes `flowStore.undo()`
- `canvas.bulk_update({ filter, patch }) → { updated_count }` — applies a patch to all nodes matching `filter`
- `canvas.preview_propagation({ source_node_id }) → { downstream_updates }` — shows what fields would propagate without executing

These tools SHALL be Tier 2 (`creation`) except `bulk_update` which is `medium`-risk.

#### Scenario: dry_run does not mutate

- **WHEN** the agent calls `canvas.dry_run({ type: 'imageGen', data: { ... } })`
- **THEN** the result includes a serialized node preview; `flowStore.nodes` count is unchanged

#### Scenario: bulk_update touches matched nodes only

- **WHEN** the agent calls `canvas.bulk_update({ filter: { type: 'videoGen' }, patch: { aspect_ratio: '9:16' } })` on a canvas with 5 video nodes and 3 image nodes
- **THEN** all 5 video nodes have `aspect_ratio = '9:16'`; image nodes are untouched; result is `{ updated_count: 5 }`

#### Scenario: undo restores last action

- **WHEN** the agent calls `canvas.undo()` after creating node n42
- **THEN** node n42 is removed from `flowStore.nodes`; result is `{ restored: 1 }`
