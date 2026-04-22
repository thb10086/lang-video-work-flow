## ADDED Requirements

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
