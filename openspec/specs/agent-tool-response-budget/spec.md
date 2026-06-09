# agent-tool-response-budget Specification

## Purpose

为查询类 Agent 工具提供**统一的响应预算与详细度控制**，避免 `get_canvas_state` / `list_assets` / `get_node_output` 等工具在大型画布上一次返回 8K+ tokens、把 context compaction 直接逼到触发阈值。能力以高阶函数 `withResponseBudget(handler, opts)` 形式暴露 — 一次声明、全工具复用 — 而非在每个 handler 里写 duplicate 截断逻辑。包装会**自动向 OpenAI function schema 注入** `response_format: 'concise' | 'detailed'` 可选参数，并强制硬上限 `DEFAULT_TOOL_RESPONSE_MAX_TOKENS = 25000`（对齐 Claude Code 公开规范）；超限时硬截断并在 message 末尾追加 `[truncated: X tokens → Y tokens. Use filter/pagination args for specific subset.]` 结构化 hint，让 Agent 知道如何分页拉剩余数据。当前覆盖 7 个查询工具（`get_canvas_state` / `get_node_output` / `list_models` / `get_model_params` / `list_assets` / `recall_memory` / `discover_tools`）；写操作类工具（`create_*` / `execute_*` / `save_memory` / `update_node` 等）显式不包装。`settings.enableResponseBudget` 提供整体开关用于回归比对。

## Requirements
### Requirement: `withResponseBudget` Higher-Order Helper

系统 SHALL 在 `@src/providers/toolHelpers.ts` 提供通用高阶函数 `withResponseBudget`，统一包装查询类工具的响应截断和 `response_format` 支持。

函数签名：

```typescript
withResponseBudget<TArgs>(
  handler: (args: TArgs) => Promise<ToolCallResult>,
  opts?: {
    maxTokens?: number              // 默认 25000
    honorFormat?: boolean           // 默认 true
    conciseFormatter?: (res: ToolCallResult) => ToolCallResult
  }
): (args: TArgs & { response_format?: 'concise' | 'detailed' }) => Promise<ToolCallResult>
```

行为约束：

- `response_format === 'concise'` 或未传时：优先调用 `conciseFormatter`（若提供）；否则返回原结果
- `response_format === 'detailed'`：返回 handler 原始完整结果
- 无论哪种模式，最终结果 token 估算超过 `maxTokens` 时硬截断，并在 message 末尾追加固定格式 hint `[truncated: X tokens → Y tokens. Use filter/pagination args for specific subset.]`

#### Scenario: 默认 concise 模式体积减小

- **WHEN** `get_canvas_state`（已包装）在 50 节点画布上调用且不传 `response_format`
- **THEN** 返回 message 长度 ≤ detailed 模式的 50%

#### Scenario: detailed 模式返回完整数据

- **WHEN** `get_canvas_state({ response_format: 'detailed' })`
- **THEN** 返回 message 包含所有节点的所有字段（prompt/description/status/outputs）

#### Scenario: 超限硬截断并附 hint

- **WHEN** 某工具返回 30K tokens 内容
- **THEN** 返回被截断到 ≤ 25K tokens，message 末尾恰好含 `[truncated:` 开头的 hint 段

### Requirement: Auto-Injected `response_format` Parameter

被 `withResponseBudget` 包装的工具 SHALL 在其 OpenAI function schema 中自动出现 `response_format` 可选参数，无需每个 tool 手动声明。

注入规则：

- 包装时自动向 schema 的 `parameters.properties` 添加 `response_format: { type: 'string', enum: ['concise', 'detailed'], description: '响应详细度，默认 concise（仅核心字段）。需要全量数据时传 detailed。' }`
- `parameters.required` 不含该字段
- 若原 schema 已有 `response_format` 字段则跳过注入（避免冲突）

#### Scenario: 包装后 schema 自动含 response_format

- **WHEN** `withResponseBudget(handleGetCanvasState)` 注册到 executeToolCall 且 `getAgentTools()` 返回的 schema 列表中的 `get_canvas_state` 条目
- **THEN** 其 `parameters.properties.response_format.enum` 为 `['concise', 'detailed']`

#### Scenario: 原 schema 已有 response_format 时不覆盖

- **WHEN** 某工具的原 schema 已定义 `response_format`
- **THEN** 包装不重复注入，保留原定义

#### Scenario: Agent 未传参时默认按 concise 返回

- **WHEN** LLM 发出 tool_call 不带 `response_format`
- **THEN** 执行 handler 的 concise 分支

### Requirement: Query Tools Adoption

所有查询类工具 SHALL 通过 `withResponseBudget` 包装：`get_canvas_state`、`get_node_output`、`list_models`、`get_model_params`、`list_assets`、`recall_memory`、`discover_tools`。

约束：

- 包装必须在 `@src/providers/agentTools.ts` 的 handler 注册表完成，不改 handler 本身源码
- 每个被包装工具 MUST 提供 `conciseFormatter` 用于裁剪非核心字段
- 非查询类工具（`create_*` / `execute_*` / `save_memory` / `update_node` 等）**不**包装

#### Scenario: 所有目标工具被包装

- **WHEN** 读取 tool 注册表
- **THEN** 上述 7 个工具的 handler 属性包含 `__isBudgeted: true` 标记（或等价元信息）

#### Scenario: 写操作类工具未被包装

- **WHEN** 读取 tool 注册表中的 `save_memory` / `create_image_node`
- **THEN** 这些条目没有 `__isBudgeted` 标记，schema 中无 `response_format`

#### Scenario: 更换默认阈值不改 handler

- **WHEN** 开发者修改 `DEFAULT_TOOL_RESPONSE_MAX_TOKENS` 常量从 25000 改为 12000
- **THEN** 下次调用自动使用新阈值，所有被包装工具无需改代码

### Requirement: Settings Toggle for Response Budget

系统 SHALL 通过 `settings.enableResponseBudget` 允许整体关闭响应截断功能，用于调试和回归比对。

行为：

- 关闭时：`withResponseBudget` 等价透明转发，不做截断、不做 concise 转换
- Schema 中 `response_format` 参数仍保留，但实际被忽略
- 切换后下次 tool 调用立即生效，无需重启

#### Scenario: 关闭 budget 时体积回到旧行为

- **WHEN** `settings.enableResponseBudget = false`
- **WHEN** `get_canvas_state()`
- **THEN** 返回完整节点列表，不截断不 concise

#### Scenario: 开关切换立即生效

- **WHEN** 运行时切换 `settings.enableResponseBudget` 从 true 到 false
- **THEN** 下一次 tool 调用按新设置执行

#### Scenario: 关闭 budget 时仍尊重 Agent 显式的 detailed 请求

- **WHEN** `enableResponseBudget = false` 且 Agent 传 `response_format: 'detailed'`
- **THEN** 等价于默认行为，返回完整数据

