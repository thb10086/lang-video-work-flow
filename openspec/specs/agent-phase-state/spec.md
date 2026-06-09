# agent-phase-state Specification

## Purpose

为 Agent 引入**显式 phase 状态机**让工具可见性可预测、tier 选择可推理 — 此前 SKILLS 注册表已假设 phase 存在（`plan → design → build → review`）但 LLM 不会自报 phase，导致 `verify_task` 可能在工作流尚未生成完成时就触发，Tier 3 工具也没真正按 phase 隔离。本能力把 phase 状态升级为 `agentMemoryStore.currentPhase: 'idle' | 'planning' | 'designing' | 'building' | 'reviewing' | 'executing'`（默认 `idle`）+ `phaseHistory[]` 审计日志；新增 Tier 1 工具 `set_phase({ phase, reason })` 让 LLM 自报当前阶段，无效 phase 直接 reject 并附枚举提示。`getAgentTools({ phase? })` 在 tier 过滤之上叠加 phase 白名单：`planning` 屏蔽 `create_*_node`，`reviewing` 屏蔽 destructive 工具且暴露 review 类工具，`idle` 是 no-op（向后兼容）。配套 Tier 2 工具 `review_generated_image({ nodeId, aspects? })` 提供结构化观察（`hasOutput` / `outputUrl` / `promptTokenCount` / `referencedAssets[]` / `observations[]` / `visionScore: null`），底层走可插拔 `_reviewAdapter` 为后续 Vision 接入预留口子。

## Requirements

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
