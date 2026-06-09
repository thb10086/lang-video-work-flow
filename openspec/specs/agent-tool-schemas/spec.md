# agent-tool-schemas Specification

## Purpose

Agent 工具的 OpenAI function-calling schema 不应硬编码 — 与生成相关的工具（`create_video_node` / `create_image_node` / `create_audio_node` / `update_node` / `execute_node` 等）的 `parameters.properties` 由 Model Param Registry **运行时生成**，仅暴露当前选中或默认模型支持的字段；非通用字段在 description 里标注 `[仅适用于 <model_ids>]`。配套提供轻量级 `get_model_params(model_id)` 让 LLM 按需查询冷门模型的完整 schema，避免一次性把全部模型字段塞进主工具列表。所有创建 / 更新 / 执行类 handler 共用同一个 `paramSanitizer` 路由出参，保证 Agent 调用与后端 adapter 之间无静默 drift。本能力是 `model-param-registry` 在 Agent 接口层的对应物。

## Requirements

### Requirement: Model-Aware Tool Schemas for Node Creation
The Agent tools `create_video_node`, `create_image_node`, and `create_audio_node` SHALL present OpenAI function-calling schemas whose `parameters.properties` are derived from the Model Param Registry, not hardcoded. The schema exposed to the LLM for a given turn SHALL reflect **only the currently selected or default model's fields**.

Cross-capability dependency: depends on `model-param-registry`.

#### Scenario: Default model drives the create_video_node schema
- **GIVEN** the frontend agent is initialized with default video model = `doubao-seedance-2-0`
- **WHEN** the Agent receives the tool list
- **THEN** `create_video_node.parameters` contains: `prompt`, `model`, `duration`, `size`, `resolution`, `generate_audio`, `camera_fixed`, `return_last_frame`, `seed` — each with description derived from the DB schema's `label`

#### Scenario: Model override in tool call validates against that model's schema
- **WHEN** the Agent calls `create_video_node({ "model": "veo3.1-fast", "generate_audio": true })`
- **THEN** the tool handler returns a structured error `{ success: false, message: "参数 generate_audio 不被 veo3.1-fast 支持 (仅 Seedance)" }` and does not create the node

### Requirement: On-Demand Schema Introspection Tool
The agent tool catalog SHALL include a lightweight `get_model_params(model_id)` tool that returns the current ParamField schema as a JSON string, enabling the LLM to inspect rarely-used models without bloating the main tool list.

#### Scenario: Agent inspects a niche model before creating a node
- **WHEN** the user asks the agent to use `kling-v3` and the Agent has no prior context
- **THEN** the Agent calls `get_model_params({"model_id": "kling-v3"})`, receives the schema JSON, and uses that to compose a subsequent `create_video_node` call with correct field names

### Requirement: Unified Param Sanitization in Tool Handlers
The handlers for `create_video_node`, `update_node` (when the updated node is a `videoGen`/`imageGen`/`audioNode`), `retry_node`, `execute_node`, and `parallel_execute` SHALL route the outgoing params through the same sanitizer used at adapter boundary, so silent drift between Agent calls and backend is impossible.

#### Scenario: update_node strips illegal fields
- **WHEN** the Agent calls `update_node({ nodeLabel: "关键帧1", updates: { model: "sora-2-vip", camera_fixed: true } })`
- **THEN** the handler applies `model=sora-2-vip`, drops `camera_fixed` (not in Sora schema), and the final message lists both the change and the dropped field

#### Scenario: execute_node sends only valid fields
- **WHEN** a `videoGen` node with legacy fields is executed
- **THEN** the network payload to `POST /api/generate/video` contains only schema-valid keys, regardless of what is in `node.data`

### Requirement: Workflow Templates Adapt Without Hardcoding
Built-in workflow templates (`workflowTemplates.ts`) SHALL reference capabilities (`video-default`, `image-default`) rather than hardcoding model-specific fields. The template instantiator SHALL fill params from the resolved model's defaults.

#### Scenario: Template no longer hardcodes duration
- **GIVEN** the "短剧 6 镜头" template
- **WHEN** the template is instantiated and the default video model is `doubao-seedance-2-0`
- **THEN** each videoGen node has `duration=5`, `size=16:9`, `resolution=720p` (from Seedance defaults); with no references to `generate_audio` in the template itself

### Requirement: Agent Can Create Every Registered Node Type
Every node type listed in `NODE_REGISTRY` (`src/data/nodeDefinitions.ts`) MUST have a corresponding `create_<snake_case_type>_node` Agent tool registered in `AGENT_TOOLS`. Missing tools indicate either (a) the node type is Agent-unavailable by design — in which case the node type MUST be removed from `NODE_REGISTRY` — or (b) the tool is missing and needs to be added.

This includes `create_character_extract_node` (creates a `characterExtract` node from a video source) and `create_character_manager_node` (creates a passive `characterManager` registry node).

Cross-capability dependency: `workflow-generation` (consumes these tools).

#### Scenario: Parity check passes
- **WHEN** the parity script iterates `NODE_REGISTRY` and checks that each entry has a corresponding Agent tool
- **THEN** all registered types report PASS

#### Scenario: Agent creates a characterExtract node
- **WHEN** Agent invokes `create_character_extract_node({ videoUrl: "https://cos/video.mp4", timestamps: "2,5" })`
- **THEN** a new node with `type="characterExtract"`, `data.videoUrl="https://cos/video.mp4"`, `data.timestamps="2,5"`, `data.status="idle"` is added to the canvas; the returned `nodeIds` array contains the new node's id

#### Scenario: Agent creates a characterManager node with no required args
- **WHEN** Agent invokes `create_character_manager_node({})`
- **THEN** a new node with `type="characterManager"`, `data.characters=[]`, `data.label="角色管理器"` is added; `nodeIds` is returned

### Requirement: Schema Derivation for Capability Tools
Every `create_*_node` tool whose node type is associated with a model selection (`imageGen`, `videoGen`, `audioNode`, `llmChat`) SHALL derive its `model` enum and capability-specific param schema from the backend's registered model list at runtime, via `getAgentTools(videoModels, imageModels, audioModels, llmModels)`. Static fallback enums MAY be embedded in the source for offline development, but the runtime tool list MUST prefer the dynamic version when available.

#### Scenario: create_audio_node exposes dynamic model list
- **GIVEN** the backend returns two audio models: `elevenlabs` and `cosyvoice`
- **WHEN** `getAgentTools([], [], [elevenlabs, cosyvoice])` is called
- **THEN** the returned tool list's `create_audio_node.parameters.properties.model.enum` equals `['elevenlabs', 'cosyvoice']` (not the static `['elevenlabs', 'fish-speech', 'cosyvoice']`)

#### Scenario: Offline mode uses static enum
- **GIVEN** backend list is empty (not yet fetched)
- **WHEN** `getAgentTools([], [], [])` is called
- **THEN** the static enum from `toolDefinitions.ts` is preserved (no silent downgrade)

### Requirement: No Dangling Tool References
Documentation and SKILL text (`src/prompts/skills/*.ts`, `src/providers/toolScenario.ts`) MUST reference only tools and node types that exist in the current codebase. Legacy references (e.g. `imageCrop` in `toolScenario.ts:31`) MUST be either updated to the current pipeline or removed.

#### Scenario: Scenario pipeline text matches builder output
- **GIVEN** `toolScenario.ts` describes `comic_drama` pipeline
- **WHEN** `buildComicDrama` runs with sample args
- **THEN** every node-type name mentioned in the scenario's `pipeline` string is actually emitted by the builder (no `imageCrop` placeholder)

### Requirement: Agent Tool Factory Supports Tiering
`getAgentTools` SHALL accept an optional `tier` selector and an `includeAll` opt-in to preserve backward compatibility, replacing the previous always-return-40-tools behavior.

Cross-capability dependency: `agent-tool-tiering` (defines tier semantics).

#### Scenario: Tier selection trims the tool list
- **WHEN** `getAgentTools({ videoModels, imageModels, audioModels, tier: ['tier1'] })` is called
- **THEN** only Tier 1 tools are returned
- **AND** `create_video_node` / `create_image_node` / `create_audio_node` are absent (they belong to Tier 2)

#### Scenario: Default tier selection mirrors heuristic
- **WHEN** `getAgentTools({ ... })` is called without a `tier` argument
- **THEN** the function resolves `tier` via `selectTier(context)` (defaults to Tier 1 + Tier 2)
- **AND** the returned list has between 15 and 25 tools (inclusive)

#### Scenario: Backward-compat full dump
- **WHEN** `getAgentTools({ ..., includeAll: true })` is called
- **THEN** all 40 tools plus `discover_tools` are returned in the legacy ordering

#### Scenario: Dynamic schemas still override static in selected tier
- **WHEN** `tier` includes `tier2` and `videoModels` is non-empty
- **THEN** the returned `create_video_node` is the dynamically generated one from `buildCreateVideoNodeTool`
- **AND** the legacy static enum is replaced

### Requirement: Agent-to-Node Parity Held Under Tiering
Every node type registered in `NODE_REGISTRY` SHALL still map to exactly one creation tool discoverable via Tier 2, regardless of which tier is currently active.

#### Scenario: Parity across tier filter
- **WHEN** the parity test enumerates `NODE_REGISTRY` and calls `getAgentTools({ includeAll: true })`
- **THEN** every node type has a matching `create_*_node` tool as before

#### Scenario: Tier 2 fully covers node creation
- **WHEN** `getAgentTools({ tier: ['tier2'] })` is inspected
- **THEN** every node type in `NODE_REGISTRY` has its corresponding creation tool present

### Requirement: Tool Utilization Guard
The system SHALL fail a test if any `AGENT_TOOLS` entry has no executor branch in `agentTools.ts` or no call site in scenario builders, tests, or handlers.

#### Scenario: Every tool has an executor
- **WHEN** `nodeAgentToolUtilization.test.ts` inspects the switch in `agentTools.ts`
- **THEN** every tool name in `AGENT_TOOLS` has a corresponding `case` or delegated handler import

#### Scenario: Every node type is used by a builder or test
- **WHEN** the utilization test scans scenario builders and executor tests
- **THEN** each node type in `NODE_REGISTRY` appears in at least one production code path

### Requirement: Agent Parameter Effectiveness
Every parameter declared on a `create_*_node` tool schema SHALL land on `node.data` with the exact value the Agent passed, modulo string coercion.

#### Scenario: Video parameters flow through
- **WHEN** the LLM calls `create_video_node({ prompt: "X", aspect_ratio: "9:16", duration: 8, generate_audio: true, seed: 42 })`
- **THEN** the created node has `data.prompt === "X"`, `data.aspect_ratio === "9:16"`, `data.duration === 8`, `data.generate_audio === true`, `data.seed === 42`

#### Scenario: Image aspect ratio flows through
- **WHEN** the LLM calls `create_image_node({ prompt: "Y", aspectRatio: "16:9" })`
- **THEN** the created node has `data.aspectRatio === "16:9"`

#### Scenario: Audio voice flows through
- **WHEN** the LLM calls `create_audio_node({ text: "hello", voice: "alice" })`
- **THEN** the created node has `data.text === "hello"` and `data.voice === "alice"`

#### Scenario: Unknown params are dropped, not crashing
- **WHEN** the LLM calls a creation tool with extra unknown keys
- **THEN** the node is still created and the unknown keys are either stored on `node.data` or silently dropped (never cause an exception)
