# video-generation-node Specification

## Purpose

`videoGen` 是画布上的核心生成节点，承载多模型动态参数渲染 + 用户切换模型时的字段迁移。能力对**用户**保证：切换模型时表单不"卡住" — 共用字段（如 `prompt` / `duration`）保留值，模型独有字段（如 Seedance 的 `generate_audio` / `size` 7-ratio）按目标模型 schema 显示或隐藏；新模型声明的 default 自动填充让节点立即可提交；schema 加载期 50ms 内出现骨架屏不冻结 UI。能力对**后端**保证：执行时载荷仅含目标模型 schema 内的合法字段，旧模型留下的 stale 字段静默清理，不会让 adapter 端报错。本能力依赖 `model-param-registry` 提供 schema 数据，是其在画布层的对应物。

## Requirements

### Requirement: Per-Model Dynamic Controls
The `videoGen` node in the canvas SHALL render its parameter controls based on the ParamField schema of the currently selected model. When the user switches model in the node, the visible controls SHALL update to match the new model's schema.

#### Scenario: Switch from Seedance to VEO hides audio toggle
- **GIVEN** a `videoGen` node with `model=doubao-seedance-2-0` showing a "有声" toggle
- **WHEN** the user selects `veo3.1-fast` in the model dropdown
- **THEN** the "有声" toggle disappears, the `size` 7-ratio select is replaced by `aspect_ratio` 3-option select, and fields unique to Seedance are removed from the visible form

#### Scenario: Switch from Seedance to Kling preserves shared fields
- **GIVEN** a `videoGen` node with `model=doubao-seedance-2-0, prompt="A cat"` and `duration=6`
- **WHEN** the user selects `kling-v3` whose schema also exposes `duration`
- **THEN** the `prompt` and `duration=6` values remain; unsupported fields are hidden

### Requirement: Stale Parameter Cleanup on Execute
When a `videoGen` node executes, the payload sent to the backend SHALL contain only keys present in the current model's schema, dropping any stale keys left in `node.data` from previous model choices.

#### Scenario: Legacy field dropped silently
- **GIVEN** a `videoGen` node whose `data` contains `generate_audio=true` (leftover from Seedance) but current `model=veo3.1-fast`
- **WHEN** the user clicks "生成"
- **THEN** the backend receives `params` WITHOUT `generate_audio`, and the submission succeeds

### Requirement: Model Defaults Applied on Selection
When the user selects a new model, fields that the new model declares with a `default` value and are currently unset in `node.data` SHALL be auto-populated with those defaults so the node is immediately submittable.

#### Scenario: Defaults fill missing fields
- **GIVEN** a freshly created `videoGen` node
- **WHEN** the user selects `doubao-seedance-2-0` (schema defines `duration=5, resolution=720p, size=16:9`)
- **THEN** those three fields are set in `node.data` and rendered in the form

### Requirement: Schema Loading UX
While the schema for a newly-selected model is loading from the backend, the node SHALL render a compact skeleton for the param area (not blank, not frozen) and disable the "Generate" button.

#### Scenario: Loading skeleton shows during fetch
- **WHEN** the user selects a model whose schema is not cached
- **THEN** a 3-row shimmer skeleton appears in the param area within 50ms and disappears when the schema resolves

### Requirement: Asset Tag Chip Row
`VideoGenNode` and `ImageGenNode` SHALL render a row of "asset tag chips" above the prompt textarea listing every asset currently referenced by the prompt (via `@assetId` tokens OR `node.data.assetRefs`). Each chip shows the asset's name plus a small color-coded kind indicator (character=indigo, scene=teal, style=amber). Clicking a chip opens the Asset Detail modal.

Cross-capability dependency: depends on `at-reference-system`, `asset-library`.

#### Scenario: Chips reflect prompt tokens
- **GIVEN** a videoGen prompt reads "wide shot of @char_sarah at @scene_cafe"
- **THEN** two chips render: "Sarah" (indigo) and "Cafe" (teal), in the order they first appear in the prompt

#### Scenario: Adding a ref updates chips in real time
- **WHEN** the user types "@" and selects "Bob" in the autocomplete
- **THEN** a new "Bob" chip appears within the next render; the prompt now contains the `@char_bob` token

#### Scenario: Removing a token removes the chip
- **WHEN** the user manually deletes the `@char_sarah` token from the prompt
- **THEN** the "Sarah" chip disappears; the node's visual state stays consistent

### Requirement: Backend Unreachable UX
The `VideoGenNode` (and `ImageGenNode`) SHALL surface `useBackendModels.error` in its header area when the fetch fails. The fallback model dropdown SHALL NOT silently reduce to a single default; instead it SHALL show an inline warning "⚠ 后端未连接，仅显示默认模型" with a Retry button that invalidates the hook cache and refetches.

#### Scenario: Backend down on first mount
- **GIVEN** the backend `/api/models` returns network error
- **WHEN** the user adds a videoGen node
- **THEN** a red warning banner is rendered above the model dropdown; the dropdown contains only `DEFAULT_VIDEO_MODEL` (Seedance); a Retry button is visible

#### Scenario: Retry recovers the full list
- **WHEN** the user clicks Retry after the backend comes back
- **THEN** the hook cache is cleared, a new fetch runs; on success the warning disappears and the dropdown repopulates with all registered video models

#### Scenario: Partial failure per capability
- **GIVEN** `/api/models?capability=video` succeeds but `/api/models?capability=image` fails
- **THEN** `VideoGenNode` has no warning; `ImageGenNode` shows the warning independently

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
