# agent-tool-tiering Specification

## Purpose

把 40 个 Agent 工具按使用频率 + 上下文相关性 partition 成三 Tier，**默认只暴露当前轮次相关的子集**让 LLM 输入端 token 占用相比一次性塞 40 个 schema 降 ≥ 60%（实测首轮 −43% 至 −73%）：Tier 1 是核心 ~8 个（任何对话都装载，如 `get_canvas_state` / `verify_task` / `discover_tools`）；Tier 2 是建图 ~14 个（`create_*_node` / `connect_nodes` / `delete_node` / `update_node` 等，由 `selectTier(context)` 在 user 消息含创作意图时按需引入）；Tier 3 是 specialist 工具（plan_task / save_memory / asset-library 5 件套等）只在显式关键词命中或 LLM 主动调 `discover_tools` 时披露。`discover_tools` 是逃生口 — 三种用法：`{ query: "资产" }` 关键词模糊匹配返回相关工具完整 schema、`{ tier: 3 }` 拿整层、`{}` 拿 40 工具的 compact index（name + 一句话描述）让 LLM 自查"还有什么能用"。`getAgentTools({ includeAll: true })` 保留向后兼容（legacy 测试 / 外部脚本不破）。dev 模式打印 `[agent-tools] tier=… tools=N ~Xtok` 方便回归测；production 静默。本能力是 `agent-tool-schemas` 的 dispatcher 层。

## Requirements

### Requirement: Tiered Agent Tool Exposure

The system SHALL partition `AGENT_TOOLS` into three tiers and expose only the relevant tier to the LLM per conversation turn, reducing default tool-schema token footprint by at least 60%.

#### Scenario: Empty-canvas first turn loads creation tier
- **WHEN** a user opens a fresh canvas and sends the first message
- **THEN** `getAgentTools()` returns Tier 1 (~8 core tools) + Tier 2 (~14 creation tools)
- **AND** the total schema byte count is ≤ 40% of the full 40-tool payload

#### Scenario: Pure navigation turn loads only core
- **WHEN** the selector heuristic classifies the user message as non-creative (e.g. "当前画布什么情况？")
- **THEN** `getAgentTools()` returns only Tier 1 (~8 tools)

#### Scenario: Explicit asset keywords load asset tier
- **WHEN** the user message matches `/素材库|asset|资产/`
- **THEN** the returned tool list includes Tier 1 + the 5 asset-library tools from Tier 3
- **AND** unrelated Tier 3 tools (plan_task, save_memory, etc.) are NOT returned

#### Scenario: Force-all opt-in preserves backward compatibility
- **WHEN** `getAgentTools({ includeAll: true })` is called
- **THEN** all 40 tools plus `discover_tools` are returned in the original order
- **AND** no filtering is applied

### Requirement: Tool Discovery Self-Service

The system SHALL provide a `discover_tools` function that allows the LLM to request additional tool schemas at runtime without requiring a fresh session.

#### Scenario: Query by capability keyword returns matching schemas
- **WHEN** the LLM calls `discover_tools({ query: "资产" })`
- **THEN** the result lists the 5 asset-library tools with their full parameters schema
- **AND** returns `success: true`

#### Scenario: Query by tier number returns entire tier
- **WHEN** the LLM calls `discover_tools({ tier: 3 })`
- **THEN** the result contains every Tier 3 tool name and description

#### Scenario: Empty query returns index summary
- **WHEN** the LLM calls `discover_tools({})`
- **THEN** the result is a compact index (name + one-line description) of all 40 tools grouped by tier

### Requirement: Token Budget Telemetry

The system SHALL log the tool-schema payload size every time `getAgentTools()` is invoked in dev mode.

#### Scenario: Dev console shows token estimate
- **WHEN** `getAgentTools()` is called under `import.meta.env.DEV === true`
- **THEN** `console.info` is called with the pattern `[agent-tools] tier=… tools=N ~Xtok`

#### Scenario: Production is silent
- **WHEN** `getAgentTools()` is called under production
- **THEN** no console output is produced
