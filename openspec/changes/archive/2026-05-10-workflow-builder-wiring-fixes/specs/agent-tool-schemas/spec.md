## MODIFIED Requirements

### Requirement: Agent Tool Factory Supports Tiering

`getAgentTools` SHALL accept an optional `tier` selector and an `includeAll` opt-in to preserve backward compatibility, replacing the previous always-return-40-tools behavior.

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

## ADDED Requirements

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
