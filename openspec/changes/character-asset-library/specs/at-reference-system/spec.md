## ADDED Requirements

### Requirement: `@` Autocomplete in Prompt Inputs
Every prompt-bearing textarea in the canvas (currently: `VideoGenNode.prompt`, `ImageGenNode.prompt`, `LLMChatNode.systemPrompt`/`userInput`, `TextNode.content`, `StoryboardNode.script`) SHALL open an asset picker when the user types a literal `@` character. The picker shows up to 8 most recent / relevance-ranked assets matching the text after `@`. Accepting a pick inserts an `@{assetId}` token into the field.

Cross-capability dependency: depends on `asset-library`.

#### Scenario: Basic @ autocomplete
- **GIVEN** the user has character `char_sarah` in their library
- **WHEN** they type "@sar" in a videoGen prompt
- **THEN** a popover shows "Sarah" as a suggestion; selecting it replaces `@sar` with `@char_sarah` in the field
- **AND** a small chip "Sarah" appears above the textarea indicating the resolved reference

#### Scenario: Variation picker after colon
- **GIVEN** the user has character `char_sarah` with variation `var_formal`
- **WHEN** they type `@char_sarah:` in a prompt
- **THEN** the picker filters to show only variations of `char_sarah` (e.g. "formal", "casual")

#### Scenario: Unknown reference degrades gracefully
- **GIVEN** a prompt contains `@char_unknown` pointing to a deleted asset
- **WHEN** the node executes
- **THEN** the unknown token is passed through as literal text without raising an error; a warning is logged and displayed in the node's error area after execution

### Requirement: Pre-Execute Resolver
Before any `videoGen`/`imageGen` node submits to the backend, a pre-execute resolver SHALL walk the node's prompt, replace every `@{assetId}` token with the asset's `appearance` (or `appearance + variation_delta`), and collect the union of all referenced assets' `reference_images` into a field consumable by the injection adapter.

#### Scenario: Resolver expands tokens and aggregates images
- **GIVEN** an imageGen prompt reads "wide shot of @char_sarah:formal meeting @char_bob at @scene_cafe"
- **WHEN** the node executes
- **THEN** the outgoing `prompt` contains the three resolved appearance strings concatenated naturally (tokens replaced in place)
- **AND** the outgoing `reference_images` is the unique union of `sarah.formal.reference_images + bob.reference_images + cafe.reference_images`
- **AND** the `assetRefs` field on the execution payload lists the three asset ids for downstream analytics

#### Scenario: Unresolved tokens do not block execution
- **WHEN** any token fails to resolve
- **THEN** the resolver emits a `WARN` log line with the offending token and proceeds with the rest of the prompt untouched

### Requirement: Bidirectional Sync with Legacy `characterAppearances`
For backward compatibility with existing workflows, the resolver SHALL keep the legacy `flowStore.characterAppearances` registry populated by mirroring every character-kind asset found in the active library into `characterAppearances[name_en || name] = appearance`. Conversely, any legacy appearance entered via `characterGrid.description` WITHOUT a matching asset SHALL be offered as "Save to library?" in the character grid node header.

#### Scenario: One-shot migration on asset library load
- **GIVEN** the user has 3 pre-existing characters in `flowStore.characterAppearances` but no assets in the library
- **WHEN** they open the Asset Library panel for the first time
- **THEN** a banner shows "Import 3 existing characters?"; confirming creates 3 `character` assets with the name + appearance from the registry and marks them as `metadata.imported_from: "legacy"`
