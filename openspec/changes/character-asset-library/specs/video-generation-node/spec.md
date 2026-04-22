## ADDED Requirements

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
