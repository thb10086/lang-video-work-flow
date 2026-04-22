## ADDED Requirements

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
