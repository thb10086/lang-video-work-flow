## ADDED Requirements

### Requirement: Tool Results Carry Affected Node IDs

Every server-side `tool_result` event whose tool mutated or executed canvas nodes SHALL include `affected_node_ids: string[]` in the data payload. Tools that don't touch nodes (memory, planning, model queries) SHALL omit the field.

#### Scenario: create_image_node emits node_ref event

- **WHEN** the agent calls `canvas.add_node({ type: 'imageGen' })` and the client returns `{ nodeId: 'n42' }`
- **THEN** the corresponding `tool_result` event includes `data.affected_node_ids = ['n42']` AND a separate `node_ref{ message_id, node_ids: ['n42'] }` event is emitted afterward

#### Scenario: Memory save tool does NOT include affected_node_ids

- **WHEN** the agent calls `memory.save(...)`
- **THEN** the `tool_result.data` does not contain `affected_node_ids` (memory ops don't reference canvas)

### Requirement: ChatMessage Records Node References

Frontend `ChatMessage` type SHALL gain an optional `nodeRefs?: string[]` field. The thin client MUST populate this array as `node_ref` events arrive, deduplicating IDs and assigning to the message currently being streamed.

#### Scenario: nodeRefs accumulate across tool calls

- **WHEN** within a single assistant turn the agent calls `add_node` twice (creating n1, n2) and `connect_nodes` once
- **THEN** the assistant message has `nodeRefs = ['n1', 'n2']` (connect_nodes touches existing nodes, no new IDs added)

#### Scenario: nodeRefs persist across messages

- **WHEN** the user sends a follow-up message that references "镜头2"
- **THEN** the resolver finds messages with `nodeRefs` containing the corresponding node ID and surfaces them to the new turn's context

### Requirement: Hover Message Highlights Canvas Nodes

The frontend SHALL highlight canvas nodes when the user hovers over a chat message containing `nodeRefs`. The highlight MUST:

- Render a `ring-2 ring-primary` style on each referenced node
- Smoothly animate (≤ 200ms transition)
- Auto-clear when hover leaves the message

#### Scenario: Hover triggers ring highlight

- **WHEN** the user hovers over an assistant message with `nodeRefs = ['n1', 'n3']`
- **THEN** nodes n1 and n3 visually receive a primary-color ring; on mouse-leave the ring fades within 200ms

#### Scenario: Multiple node refs all highlight

- **WHEN** the message has 5 `nodeRefs` and 4 are off-screen
- **THEN** all 5 nodes receive the highlight regardless of viewport position

### Requirement: Canvas Click Anchors to Earliest Related Message

The frontend SHALL implement `Ctrl+Click` on a canvas node to scroll the chat panel to the earliest message whose `nodeRefs` contains that node ID and briefly flash the message background.

#### Scenario: Ctrl+Click jumps to first relevant message

- **WHEN** the user `Ctrl+Click`s on node n42 and message m5 is the earliest with `nodeRefs.includes('n42')`
- **THEN** the chat scroll position adjusts to bring m5 into view and m5's background flashes for 800ms

#### Scenario: No related messages — show toast

- **WHEN** the user `Ctrl+Click`s on a node never referenced in chat
- **THEN** a toast appears: "该节点尚未在对话中提及"

### Requirement: Progress Timeline Tool Cards Are Clickable

Every tool-call card in the `ProgressTimeline` whose underlying tool produced `affected_node_ids` SHALL be clickable. Clicking SHALL:

1. Highlight the affected nodes (ring style as in hover spec)
2. Scroll chat to the corresponding tool log entry
3. Optionally fit the canvas viewport to enclose all affected nodes (via React Flow `fitView({ nodes })`)

#### Scenario: Click tool card focuses canvas

- **WHEN** the user clicks the timeline card for "create_image_node (镜头2 关键帧)"
- **THEN** the canvas viewport zooms/pans to fit node n5 (the 镜头2 节点) and the chat scrolls to the tool log entry

#### Scenario: Click safe tool card (no canvas effect)

- **WHEN** the user clicks the timeline card for `list_models`
- **THEN** no canvas highlight occurs (because the tool has no `affected_node_ids`); the chat scroll still happens
