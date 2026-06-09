## ADDED Requirements

### Requirement: ProgressTimeline Component Replaces LiveStatsBar

The frontend SHALL include `src/components/sidebar/ProgressTimeline.tsx` rendering a horizontal scroll of phase cards. Each phase card MUST include:

- Phase name (planning / designing / building / reviewing / executing)
- Phase duration (seconds)
- Tool call count + success/failure breakdown
- Sub-bubbles: one per tool call within the phase

The legacy `LiveStatsBar` SHALL be deprecated; it MAY remain temporarily behind a setting `agent.use_legacy_stats_bar=true` for power users who prefer minimal UI.

#### Scenario: Five-phase project displays as five cards

- **WHEN** the agent traverses planning → designing → building → reviewing → executing
- **THEN** the timeline shows 5 cards horizontally; entering a new phase dims the previous and brightens the current

#### Scenario: Tool bubbles show in chronological order under each phase

- **WHEN** within "building" the agent calls `add_node` (10s), `connect_nodes` (1s), `execute_node` (45s)
- **THEN** the building card has 3 bubbles ordered left-to-right with widths proportional to duration; success/fail icons are visible

### Requirement: Failed Tool Calls Auto-Group as Retry Stack

Successive failed calls of the same `(tool_name, args_hash)` followed by an eventual success or final failure SHALL collapse into a single "retry group" bubble in the timeline. Expanding the group reveals each individual attempt with its error code and elapsed time.

#### Scenario: 3 retries collapse into one stack

- **WHEN** the agent retries `execute_node({nodeId: 'n5'})` 3 times (fail/fail/success)
- **THEN** the timeline shows ONE bubble labeled `execute_node (3 attempts)` colored amber; clicking expands to show 3 individual attempts with error messages

#### Scenario: Different args do NOT collapse

- **WHEN** the agent calls `execute_node({nodeId: 'n1'})` then `execute_node({nodeId: 'n2'})`
- **THEN** the timeline shows 2 separate bubbles (different args)

### Requirement: Subagent Calls Render as Nested Sub-Timeline

When `subagent_started`/`subagent_finished` events arrive, the timeline SHALL show the parent `delegate_to_subagent` bubble with an embedded sub-timeline beneath it (default collapsed; click to expand).

#### Scenario: Three parallel subagents nest correctly

- **WHEN** parent fans out 3 subagents A/B/C concurrently
- **THEN** the parent bubble shows "delegate_to_subagent ×3" with 3 nested rows; each row is its own mini-timeline of A/B/C's tool calls

#### Scenario: Subagent failure is visible at parent level

- **WHEN** subagent B fails with `subagent_budget_exhausted`
- **THEN** the parent bubble shows "2/3 succeeded"; row B is colored red and tooltip shows error code

### Requirement: Timeline Live-Updates During Streaming

The timeline SHALL render incrementally as SSE events arrive (no full re-render on every event). Adding a new bubble MUST complete in < 16ms (60fps) to avoid jank.

#### Scenario: Smooth incremental rendering

- **WHEN** 20 tool calls fire over 30 seconds
- **THEN** each new bubble is added to the DOM via React state diffing without forcing a full timeline re-render; profiling shows no layout thrashing

### Requirement: Timeline Persists in Final Message

After `done`, the timeline SHALL be persisted as part of the assistant `ChatMessage` (folded into a "Tool Trace" expandable section). Re-opening the chat MUST restore the timeline view from message data without re-fetching from server.

#### Scenario: Timeline survives page reload

- **WHEN** the user reloads the page after a complete agent session
- **THEN** the persisted assistant message still shows the timeline (collapsed by default), and clicking expands to the same content
