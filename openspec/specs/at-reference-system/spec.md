# at-reference-system Specification

## Purpose

让 prompt 文本里的 `@asset_id` 成为一等公民 token — 用户在任何 prompt 输入框里键入 `@` 即触发资产 picker（最近 / 相关性排序 top 8），命中后插入 `@{assetId}`，textarea 上方实时渲染解析后的 chip 链。覆盖范围：`VideoGenNode.prompt` / `ImageGenNode.prompt` / `LLMChatNode.systemPrompt` / `LLMChatNode.userInput` / `TextNode.content` / `StoryboardNode.script`。变体寻址支持 `@char_sarah:` 触发 variation 子选择器。每次节点 execute 前 pre-execute resolver 遍历 prompt：把每个 `@{assetId}` 替换为对应 asset 的 `appearance`（或 `appearance + variation_delta`），并把所有引用资产的 `reference_images` 收成 union 喂给后续注入 adapter（`model-reference-adapter`）。无法解析的 token（asset 已删 / 不存在）原文穿透 + WARN 日志，**不阻塞执行**。同时与 legacy `flowStore.characterAppearances` 双向同步：库里每个 character asset 自动 mirror 到旧 registry，旧 `characterGrid.description` 里没匹配 asset 的条目在节点 header 显示"Save to library?"按钮一键迁移。本能力依赖 `asset-library`，被 `model-reference-adapter` 与 `libtv-asset-panel` 消费。

## Requirements

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
