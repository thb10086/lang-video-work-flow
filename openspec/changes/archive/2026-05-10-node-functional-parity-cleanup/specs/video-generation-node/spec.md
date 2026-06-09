## ADDED Requirements

### Requirement: Uniform Node SubmitButton Contract
Every node component that renders a `SubmitButton` MUST wire its `onClick` to trigger execution of the node (via `executeNode(id)` or a local `handleX` that eventually invokes it). Empty placeholder handlers (e.g. `() => {}` with "wired later" comments) SHALL NOT exist in committed code.

Cross-capability dependency: `workflow-generation` (Agent relies on this invariant when generating runnable graphs).

#### Scenario: AudioNode submit dispatches execution
- **GIVEN** an `audioNode` on the canvas with `text="旁白内容"`
- **WHEN** the user clicks the SubmitButton
- **THEN** `executeNode(nodeId)` is called, which routes to `executeAudioNode`; the node's `status` becomes `'pending'` (TTS adapter is interim) with a user-visible informational message rather than the button remaining inert

#### Scenario: Lint-style check prevents regressions
- **GIVEN** a code review diff introduces a new node component
- **WHEN** the component renders `<SubmitButton onClick={() => {}}/>` or equivalent empty handler
- **THEN** CI (grep-based lint rule) flags the file and blocks merge

#### Scenario: Existing nodes continue to work
- **GIVEN** all other nodes (VideoGen / ImageGen / Storyboard / StyleLock / etc.)
- **WHEN** the user clicks their SubmitButton
- **THEN** behaviour is unchanged vs. the previous release

### Requirement: Single Canonical Field Per Node Data Slot
For each semantic field on any node, `node.data` MUST have exactly one canonical key. Variant names (deprecated aliases) MAY be read by the executor for backward compatibility for exactly one release, and MUST be documented with a removal date in the executor code.

The specific canonicalization this change enforces:
- `imageEdit` node: canonical key is `editInstruction`. The alias `editPrompt` is deprecated.

#### Scenario: Agent writes canonical key
- **WHEN** `create_image_edit_node({ editInstruction: "换背景为海滩" })` is invoked
- **THEN** the created node's `data.editInstruction` equals "换背景为海滩"; `data.editPrompt` is undefined

#### Scenario: UI reads and writes the canonical key
- **GIVEN** an imageEdit node created by Agent with `editInstruction="换背景"`
- **WHEN** the node renders
- **THEN** the textarea shows "换背景" (previously empty due to skew)
- **AND WHEN** the user types a new value
- **THEN** `node.data.editInstruction` is updated (not `editPrompt`)

#### Scenario: Legacy saved workflow still loads
- **GIVEN** a user's persisted Zustand state contains an imageEdit node with `data.editPrompt="旧数据"` and no `editInstruction`
- **WHEN** the app loads and the node renders
- **THEN** the textarea shows "旧数据" (executor fallback reads deprecated key); on the user's next edit the value is migrated to `editInstruction`
