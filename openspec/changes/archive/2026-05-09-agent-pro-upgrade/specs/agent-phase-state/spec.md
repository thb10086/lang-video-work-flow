## ADDED Requirements

### Requirement: Agent Has an Explicit Phase State

`agentMemoryStore` SHALL expose `currentPhase:
'idle' | 'planning' | 'designing' | 'building' | 'reviewing' | 'executing'`
(default `'idle'`), plus a `phaseHistory[]` audit log and a
`setPhase(phase, reason)` action.

#### Scenario: Default phase is idle

- **WHEN** a fresh `agentMemoryStore` is created
- **THEN** `currentPhase === 'idle'` and `phaseHistory.length === 0`

#### Scenario: Phase changes are logged

- **WHEN** `setPhase('building', 'user wants to build a short drama')` runs
- **THEN** `currentPhase` becomes `'building'` and `phaseHistory` appends
  `{ phase: 'building', reason: '…', timestamp: <ms> }`

#### Scenario: Phase survives across turns within a session

- **WHEN** phase is `'designing'` at end of round 3
- **THEN** at start of round 4 phase is still `'designing'`

### Requirement: `set_phase` Tool Lets LLM Switch Phases

A new Tier 1 tool `set_phase({ phase, reason })` SHALL let the Agent
self-declare which workflow phase it is entering. Phase values are
validated against the enum; invalid values reject with
`success: false`.

#### Scenario: Valid phase succeeds

- **WHEN** Agent calls `set_phase({phase: 'reviewing', reason: 'all shots generated'})`
- **THEN** `agentMemoryStore.currentPhase` becomes `'reviewing'` and the
  tool returns `success: true`

#### Scenario: Invalid phase rejects

- **WHEN** Agent calls `set_phase({phase: 'banana'})`
- **THEN** the tool returns `success: false` with a hint listing the valid
  enum values

### Requirement: Tier Selection Is Phase-Aware

`getAgentTools({ ..., phase? })` SHALL apply a phase-specific whitelist
on top of tier filtering. When `phase === 'idle'` the filter is a no-op
(current behaviour).

#### Scenario: Planning phase excludes create_*_node tools

- **WHEN** `getAgentTools({ context: {userMessage: '生成短剧', canvasEmpty: true},
  phase: 'planning' })` is called
- **THEN** the returned tool list includes `plan_task`, `save_memory`,
  `recall_memory`, `detect_scenario`, `discover_tools` but EXCLUDES
  `create_video_node` / `create_image_node` / `create_audio_node`

#### Scenario: Building phase exposes all Tier 2 creation tools

- **WHEN** `getAgentTools({ phase: 'building', context: {userMessage: '造 6 镜头'} })`
- **THEN** every `create_*_node` tool + `connect_nodes` + `delete_node`
  are present

#### Scenario: Reviewing phase gates destructive tools

- **WHEN** `getAgentTools({ phase: 'reviewing' })`
- **THEN** the list includes `review_generated_image`, `verify_task`,
  `review_content` and EXCLUDES `delete_node`, `create_video_node`

#### Scenario: Phase idle — no gating

- **WHEN** `getAgentTools({ phase: 'idle', context: {...} })` is called
- **THEN** the output equals `getAgentTools({ context: {...} })` (no phase
  filter applied)

### Requirement: `review_generated_image` Tool Provides Structured Observation

A new Tier 2 tool `review_generated_image({ nodeId, aspects? })` SHALL
return a structured observation of a generated image node. Vision model
integration is pluggable via an internal `_reviewAdapter` module; today
the adapter returns `visionScore: null`.

#### Scenario: Happy-path review of a generated imageGen node

- **WHEN** an `imageGen` node has `outputImage` set and the Agent calls
  `review_generated_image({ nodeId })`
- **THEN** the tool returns `{ success: true, message: JSON }` where JSON
  contains `hasOutput: true`, `outputUrl`, `promptTokenCount`,
  `referencedAssets[]`, `observations[]`, `visionScore: null`

#### Scenario: Node missing output

- **WHEN** the node has no `outputImage`
- **THEN** the tool returns `{ success: false, message: '...尚未生成...' }`

#### Scenario: Unknown node id

- **WHEN** `nodeId` does not exist in flowStore
- **THEN** the tool returns `{ success: false, message: '...未找到...' }`
