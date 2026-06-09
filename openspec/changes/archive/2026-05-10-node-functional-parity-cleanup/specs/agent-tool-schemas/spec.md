## ADDED Requirements

### Requirement: Agent Can Create Every Registered Node Type
Every node type listed in `NODE_REGISTRY` (`src/data/nodeDefinitions.ts`) MUST have a corresponding `create_<snake_case_type>_node` Agent tool registered in `AGENT_TOOLS`. Missing tools indicate either (a) the node type is Agent-unavailable by design — in which case the node type MUST be removed from `NODE_REGISTRY` — or (b) the tool is missing and needs to be added.

This change specifically adds:
- `create_character_extract_node` — creates a `characterExtract` node from a video source
- `create_character_manager_node` — creates a passive `characterManager` registry node

Cross-capability dependency: `workflow-generation` (consumes these tools).

#### Scenario: Parity check passes after this change
- **WHEN** the parity script iterates `NODE_REGISTRY` and checks that each entry has a corresponding Agent tool
- **THEN** all 14 registered types report PASS

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
Documentation and SKILL text (`src/prompts/skills/*.ts`, `src/providers/toolScenario.ts`) MUST reference only tools and node types that exist in the current codebase. Legacy references (e.g. `imageCrop` in `toolScenario.ts:31`) MUST be either updated to the current pipeline or removed with this change.

#### Scenario: Scenario pipeline text matches builder output
- **GIVEN** `toolScenario.ts` describes `comic_drama` pipeline
- **WHEN** `buildComicDrama` runs with sample args
- **THEN** every node-type name mentioned in the scenario's `pipeline` string is actually emitted by the builder (no `imageCrop` placeholder)
