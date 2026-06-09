## MODIFIED Requirements

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
