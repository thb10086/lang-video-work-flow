## ADDED Requirements

### Requirement: Comic Drama Workflow Includes CharacterManager
`buildComicDrama` (`src/providers/workflowBuilders.ts`) MUST emit exactly one `characterManager` node per generated workflow, placed between the `characterGrid` column and the `imageGen` column. Every `characterGrid` node in the workflow MUST have an edge `grid-out → character-in` into the manager.

Rationale: this wires the LibTV-style character consistency mechanism that `character-in` propagation (added in the previous change) was built to support.

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
No scenario builder SHALL emit a node whose `type` is not present in `NODE_REGISTRY`. Specifically, `imageCrop` MUST NOT appear in any scenario's output (and the `imageCrop` node type is being removed from the codebase in this change).

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
