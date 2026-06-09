## ADDED Requirements

### Requirement: Eval Harness Targets Backend Runtime

The eval harness SHALL invoke the backend Agent runtime via SSE (`agentSseClient`) instead of the legacy frontend `chatStore.processUserMessage` loop. Each scenario MUST drive the runtime through the same RPC surface a real client would use, with the Mock LLM and Mock Backend services intercepting at the model-proxy and tool-handler layer respectively.

The legacy in-browser eval path MAY remain temporarily during Phase 0 for double-running, but MUST be removed by Phase 4 cleanup.

#### Scenario: Eval scenario runs through SSE

- **WHEN** the eval harness executes scenario `cyberpunk-short-film`
- **THEN** it instantiates a backend session via `POST /api/agent/sessions`, subscribes to events, drives client tool RPC via the in-process `clientToolBridge` mock, and verifies final canvas + tool log

#### Scenario: Phase 0 double-run validates parity

- **WHEN** the same scenario runs against (a) legacy frontend loop and (b) backend runtime
- **THEN** the harness asserts `passed`, `score` (within ±2 absolute points), and `toolCallLog` (same set of tool names; order-tolerant unless scenario specifies `ordered`) match across both paths

### Requirement: Streaming-Latency Metric

The harness SHALL collect three new metrics per scenario:

- `time_to_first_event_ms`: ms from `POST /sessions` to first SSE event
- `time_to_first_tool_call_ms`: ms from session start to first `tool_call` event
- `mean_event_interval_ms`: average ms between consecutive events

These MUST be reported in `eval-report.json` and compared against `eval-baseline.json` with a 10% regression threshold.

#### Scenario: Latency regression fails CI

- **WHEN** `time_to_first_event_ms` for any scenario regresses > 10% vs baseline
- **THEN** the eval process exits non-zero and prints the regressing scenario IDs with before/after values

### Requirement: Subagent Success Rate Metric

For scenarios that exercise `agent.delegate` or `agent.parallel_delegate`, the harness SHALL collect `subagent_success_rate = subagents_succeeded / subagents_total`.

#### Scenario: Parallel subagent fan-out reports rate

- **WHEN** a scenario fans out 5 subagents and 4 succeed
- **THEN** the report includes `subagent_success_rate = 0.8` for that scenario

### Requirement: Canvas-Binding Accuracy Metric

For scenarios involving canvas mutations, the harness SHALL verify `node_ref` events emitted from the runtime correctly map to the resulting `flowStore.nodes` IDs. The metric `canvas_binding_accuracy = correctly_bound / total_node_refs` MUST be ≥ 0.95.

#### Scenario: Mismatch between node_ref and canvas state fails

- **WHEN** the runtime emits `node_ref{ node_ids: ['n42'] }` but `flowStore` has no node with id `n42`
- **THEN** the scenario verifier flags this as `canvas_binding_failure`; if accuracy < 0.95 the scenario fails

### Requirement: Mock Client Tool Bridge

The Mock Backend Services SHALL be extended with a Mock `clientToolBridge` that intercepts `client_tool_request` events and synthesizes plausible results without touching a real DOM/React Flow.

It MUST support:
- `canvas.add_node` returning a synthetic `nodeId` and updating in-memory mock canvas state
- `canvas.connect_nodes` returning edge ID
- `canvas.update_node` / `canvas.delete_node` mutating mock state
- Configurable failure injection (`failNthCall`, `latencyMs`)

#### Scenario: Mock client bridge handles add_node

- **WHEN** the runtime emits `client_tool_request{ name: 'canvas.add_node', args: {...} }`
- **THEN** the mock bridge POSTs `{ ok: true, data: { nodeId: 'mock-1' } }` within latencyMs and updates its in-memory canvas

## MODIFIED Requirements

### Requirement: Declarative Scenario DSL

系统 SHALL 提供声明式的 Scenario 类型定义，使测试作者能仅通过声明输入/期望/预算来新增评估场景，不需改动执行器代码。

Scenario MUST 包含以下字段：

- `id`：kebab-case 唯一标识
- `userMessage`：触发 Agent 的初始用户消息
- `userImages?`：可选的 base64 或 fixture 路径数组
- `expectedToolCalls`：期望 Agent 按顺序或乱序调用的工具名数组（支持新旧名 alias 双匹配）
- `toolCallOrder?`：`'ordered' | 'any'`，默认 `'any'`
- `budget`：`{ maxToolCalls: number; maxTokens: number; maxElapsedMs: number; maxClientToolCalls?: number }`
- `verifier`：函数 `(canvas, toolLog, sseEvents) => { passed: boolean; score: number; issues: string[] }`
- `mockLLMScript?`：确定性 LLM 回放脚本，用于 CI 稳定 pass
- `mockClientBridgeConfig?`：客户端工具 mock 行为配置（latencyMs / failNthCall / per-tool-handler override）
- `expectedSubagents?`：期望产生的子代理列表（role / goal 模式匹配）
- `expectedNodeRefs?`：期望关联的节点（基于 fixture 节点 label 匹配）

#### Scenario: 作者新增一个 Scenario 无需改执行器

- **WHEN** 作者在 `src/__tests__/eval/scenarios/` 下新增一个 `.ts` 文件，默认导出符合 `Scenario` 类型的对象
- **THEN** `runEval.ts` 自动发现并加载该 scenario，不需修改任何现有代码；新字段 `mockClientBridgeConfig` / `expectedSubagents` / `expectedNodeRefs` 是可选的

#### Scenario: Scenario 字段缺失时 TypeScript 编译报错

- **WHEN** 作者忘记填 `verifier` 或 `budget`
- **THEN** TypeScript 编译期报错，且错误信息明确指出缺失字段名

#### Scenario: `toolCallOrder='ordered'` 强制顺序验证（含 alias）

- **WHEN** Scenario 声明 `toolCallOrder: 'ordered'` 且 `expectedToolCalls: ['canvas.add_node', 'canvas.connect']`
- **WHEN** Agent 实际调用顺序为 `[create_image_node (legacy alias), connect_nodes (legacy alias)]`
- **THEN** 评估判定 `passed: true`（alias 等价匹配）；如果实际顺序为 `[connect_nodes, create_image_node]` 则 `passed: false`
