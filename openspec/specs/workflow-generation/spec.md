# workflow-generation Specification

## Purpose

为 6 种 scenario（`product_ad` / `short_drama` / `comic_drama` / `tutorial` / `store_tour` / `music_video`）提供**生成可运行图**的 builder 工厂 — 每个 builder 输出节点 + 边的 React Flow 子图，必须达到三个不变量：(1) **角色 pipeline 完整** — 任何 character workflow 都生成单一 `characterManager`，所有 `characterGrid` 边连到 manager，下游 `imageGen` 通过 `character-out` 拉取 — 让 LibTV 风格的 character consistency 机制真正生效；(2) **场景引用传播** — 任何含 `sceneGrid` 的 builder 都把 scene 边连到所有下游 `imageGen`（`grid-out → scene-in` 或回退 `ref-in`），`scene asset id` 同步写入 `imageGen.data.assetRefs` 让 reference adapter 能用；(3) **storyboard 必有 script 输入** — 任何 builder emit 的 `storyboard` 都至少有一条 incoming edge 带 script 文本（`script-in` 或 `textNode → storyboard.script-in`），孤立 storyboard 是 bug。Port 合法性强制 — builder 不能 connect 到 `NODE_PORT_REGISTRY` 没有的 handle（如 `tutorial` 把 LLM 输出写入 `textNode.content` 用 `updateNodeData` 而不是创建 phantom 边）。死类型零容忍 — `imageCrop` 不能在任何 scenario 输出里出现；旧 persisted state 里的 `imageCrop` 节点在 app load 时被 migration filter 过滤 + 同步移除相关边。整体评估每个 scenario 必须达到 Grade A（≥ 90/100），跨 scenario 平均 ≥ 96。本能力依赖 `agent-tool-schemas`（builder 调用的 create_*_node 工具）和 `video-generation-node`（character pipeline 消费方）。

## Requirements

### Requirement: Comic Drama Workflow Includes CharacterManager
`buildComicDrama` (`src/providers/workflowBuilders.ts`) MUST emit exactly one `characterManager` node per generated workflow, placed between the `characterGrid` column and the `imageGen` column. Every `characterGrid` node in the workflow MUST have an edge `grid-out → character-in` into the manager.

Rationale: this wires the LibTV-style character consistency mechanism that `character-in` propagation was built to support.

Cross-capability dependency: `video-generation-node` (consumers pull from `characterManager` via `character-out`).

#### Scenario: Single-character comic drama
- **WHEN** `buildWorkflow({ scenario: 'comic_drama', characterNames: ['小明'], shotCount: 3, ... })` is called
- **THEN** the resulting node list contains exactly one `characterManager`; exactly one edge `characterGrid(小明) → characterManager` with `sourceHandle='grid-out'`, `targetHandle='character-in'`

#### Scenario: Multi-character comic drama
- **WHEN** `buildWorkflow({ scenario: 'comic_drama', characterNames: ['小明','小红'], ... })` is called
- **THEN** exactly one `characterManager` is emitted; both character grids connect to it (two `character-in` edges); no direct `characterGrid → imageGen` ref-in edges are removed (existing behaviour preserved)

### Requirement: Short Drama Workflow Includes CharacterManager
`buildShortDrama` MUST emit one `characterManager` under the same rules as comic drama (one node per workflow, edge per characterGrid).

#### Scenario: Realistic short drama
- **WHEN** `buildWorkflow({ scenario: 'short_drama', characterNames: ['Sarah'], shotCount: 4 })` is called
- **THEN** exactly one `characterManager` appears in the node list; edge from `characterGrid(Sarah)` to the manager exists; the workflow summary message mentions "角色库" or "manager"

### Requirement: No Dead Node Types in Generated Output
No scenario builder SHALL emit a node whose `type` is not present in `NODE_REGISTRY`. Specifically, `imageCrop` MUST NOT appear in any scenario's output (and the `imageCrop` node type is removed from the codebase).

#### Scenario: No imageCrop in any scenario
- **WHEN** `buildWorkflow({ scenario: s, ... })` is called for each `s` in ['short_drama', 'comic_drama', 'product_ad', 'store_tour', 'tutorial', 'music_video']
- **THEN** the resulting node list contains zero nodes of type `imageCrop`

#### Scenario: Every emitted type is registered
- **WHEN** any builder runs with any args
- **THEN** every emitted `node.type` has a matching entry in `NODE_REGISTRY` (parity check held by unit test)

### Requirement: Legacy Workflow Migration
On app load, if the persisted Zustand state contains nodes of removed types (currently only `imageCrop`), those nodes MUST be filtered out with a single `console.warn` entry; their incoming and outgoing edges MUST also be removed so the remaining graph is consistent. The filter MUST NOT touch any other node type.

#### Scenario: Loading a legacy workflow with imageCrop
- **GIVEN** the persisted state has 5 nodes, 2 of them `imageCrop`, and 4 edges (2 touching an imageCrop)
- **WHEN** the app mounts and the migration filter runs
- **THEN** 3 nodes + 2 edges remain; a `console.warn` reads `[migration] dropped 2 legacy imageCrop node(s)`

#### Scenario: Clean workflow untouched
- **GIVEN** a workflow with zero removed-type nodes
- **WHEN** the migration filter runs
- **THEN** no nodes or edges are removed; no warning is logged

### Requirement: Scene Reference Propagation
Every scenario builder that creates `sceneGrid` nodes SHALL also create edges that route the scene reference into downstream `imageGen` nodes, so that scene consistency anchors reach the generation stage.

#### Scenario: short_drama wires sceneGrid to all imageGen
- **WHEN** `buildShortDrama` is invoked with ≥1 scene name
- **THEN** the resulting graph contains one `grid-out → scene-in` (or fallback `ref-in`) edge from every `sceneGrid` to every `imageGen`
- **AND** no `sceneGrid` node has zero outgoing edges

#### Scenario: store_tour wires sceneGrid to all imageGen
- **WHEN** `buildStoreTour` is invoked with ≥1 scene name
- **THEN** the scene-to-image wiring rule above holds
- **AND** the scene asset IDs are also attached to each imageGen's `data.assetRefs`

#### Scenario: scenario without sceneGrid is unaffected
- **WHEN** `buildProductAd` or `buildTutorial` produces no `sceneGrid`
- **THEN** no scene edges are added and no error is raised

### Requirement: Music Video Character Pipeline
`buildMusicVideo` SHALL follow the same character-manager pipeline as `buildShortDrama` / `buildComicDrama` when characters are provided, so character consistency holds across MV cuts.

#### Scenario: MV with 1 character creates a manager
- **WHEN** `buildMusicVideo` receives `characterNames: ['Dancer']` and a description
- **THEN** the resulting graph contains exactly one `characterManager` node
- **AND** every `characterGrid` is connected to it via `grid-out → character-in`

#### Scenario: MV without characters skips the manager
- **WHEN** `buildMusicVideo` is invoked with `characterNames: []`
- **THEN** no `characterManager` node is created

### Requirement: Storyboard Must Have Script Input
Any `storyboard` node emitted by a builder SHALL have at least one incoming edge carrying script text; orphan storyboards are a bug.

#### Scenario: music_video storyboard wired to script
- **WHEN** `buildMusicVideo` creates a `storyboard` node
- **THEN** an edge `source.script-out (or textNode.text-out) → storyboard.script-in` is created
- **AND** `storyboard` has ≥1 incoming edge

#### Scenario: tutorial storyboard wired from upstream
- **WHEN** `buildTutorial` creates its `storyboard` node
- **THEN** a `textNode → storyboard.script-in` edge exists
- **AND** no edge targeting non-existent `textNode.text-in` port is created

### Requirement: No Illegal Port References in Builders
No builder SHALL call `wb.connect()` with a `sourceHandle` or `targetHandle` that is missing from `NODE_PORT_REGISTRY`.

#### Scenario: tutorial llm-to-text path avoids illegal port
- **WHEN** `buildTutorial` needs to route LLM output into `textNode`
- **THEN** it writes `llmChat.response` directly into `textNode.data.content` via `store.updateNodeData`, instead of creating a phantom edge to `textNode.text-in`

#### Scenario: portRegistry violation is rejected at test time
- **WHEN** any builder creates an edge whose handle is not in the registry
- **THEN** the `agentGenerationEvaluation` test D2 dimension fails that scenario

### Requirement: Scenario Evaluation Grade Thresholds
Every registered scenario SHALL achieve Grade A (≥90/100) on the agent-generation rubric; the cross-scenario average SHALL be ≥ 96/100.

#### Scenario: all 6 scenarios reach A
- **WHEN** `agentGenerationEvaluation.test.ts` runs
- **THEN** every per-scenario report has `totalScore >= 90`

#### Scenario: overall average tightened
- **WHEN** the overall summary is computed
- **THEN** `avg >= 96` (up from current 94 baseline)
