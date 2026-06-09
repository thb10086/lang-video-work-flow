# agent-eval-harness Specification

## Purpose

为 Agent 端到端行为提供**声明式、确定性、可量化**的评估能力，是 prompt / 工具 / SKILL 任何变更的**回归门禁**。区别于面向单函数的 Vitest 单元测试，本框架驱动真实的 `chatStore` Agent 循环跑完整工具调度 + 画布变更，每个 scenario 仅声明输入 / 期望工具调用 / 预算 / verifier，由 `runEval.ts` 自动发现并执行。所有外部依赖（LLM、生成 API、COS）通过 `mockLLM` + `mockBackend` 沙箱替换，确保 CI 可复现且零配额消耗。每次运行输出 `eval-report.json`（机器可读）+ `eval-baseline.json`（首次跑后作为基线），后续运行任何指标回归 > 5% 即 CI 失败。

## Requirements
### Requirement: Declarative Scenario DSL

系统 SHALL 提供声明式的 Scenario 类型定义，使测试作者能仅通过声明输入/期望/预算来新增评估场景，不需改动执行器代码。

Scenario MUST 包含以下字段：

- `id`：kebab-case 唯一标识
- `userMessage`：触发 Agent 的初始用户消息
- `userImages?`：可选的 base64 或 fixture 路径数组
- `expectedToolCalls`：期望 Agent 按顺序或乱序调用的工具名数组
- `toolCallOrder?`：`'ordered' | 'any'`，默认 `'any'`
- `budget`：`{ maxToolCalls: number; maxTokens: number; maxElapsedMs: number }`
- `verifier`：函数 `(canvas, toolLog) => { passed: boolean; score: number; issues: string[] }`
- `mockLLMScript?`：确定性 LLM 回放脚本，用于 CI 稳定 pass

#### Scenario: 作者新增一个 Scenario 无需改执行器

- **WHEN** 作者在 `src/__tests__/eval/scenarios/` 下新增一个 `.ts` 文件，默认导出符合 `Scenario` 类型的对象
- **THEN** `runEval.ts` 自动发现并加载该 scenario，不需修改任何现有代码

#### Scenario: Scenario 字段缺失时 TypeScript 编译报错

- **WHEN** 作者忘记填 `verifier` 或 `budget`
- **THEN** TypeScript 编译期报错，且错误信息明确指出缺失字段名

#### Scenario: `toolCallOrder='ordered'` 强制顺序验证

- **WHEN** Scenario 声明 `toolCallOrder: 'ordered'` 且 `expectedToolCalls: ['A', 'B', 'C']`
- **WHEN** Agent 实际调用顺序为 `[A, C, B]`
- **THEN** 评估判定 `passed: false` 且 `issues` 中包含顺序偏差详情

### Requirement: Mock LLM for Deterministic CI

系统 SHALL 提供 Mock LLM 实现，按 Scenario 的 `mockLLMScript` 确定性返回 tool_calls，使 CI 执行 100% 可重复，无外部 API 调用。

Mock LLM MUST 支持：

- 按当前轮次返回预置 `tool_calls` 数组或文本 content
- 支持条件分支（根据上一轮 tool 返回值决定下一轮调什么）
- 失败注入（模拟 LLM 错误以测试重试逻辑）

#### Scenario: Mock LLM 按脚本返回 tool_calls

- **WHEN** Scenario 的 `mockLLMScript` 定义 Round 1 返回 `[{ name: 'generate_workflow', args: {...} }]`
- **WHEN** 评估执行到 Round 1
- **THEN** Mock LLM 返回该工具调用，驱动 Agent 执行 `generate_workflow` handler

#### Scenario: Mock LLM 支持基于 tool 结果的分支

- **WHEN** `mockLLMScript` 的 Round N 定义 `if prevToolResult.success then [...] else [...]`
- **WHEN** 前一轮工具失败
- **THEN** Mock LLM 返回 else 分支定义的工具序列（用于测试自修复路径）

#### Scenario: CI 跑 Mock LLM 场景结果稳定

- **WHEN** 同一个 scenario 连续跑 10 次
- **THEN** 10 次的 `passed` / `score` / `toolCallLog` 完全一致

### Requirement: Mock Backend Services

系统 SHALL 提供 Mock 的生成类 API（imageGen / videoGen / Vision verify / COS upload），使评估过程不消耗真实配额。

Mock backend MUST 覆盖：

- `/api/generate/image`、`/api/video/generate`、`/api/audio/generate`
- `/api/verify/image`（vision verify）
- `/api/cos/upload`
- 可配置 success / failure / latency，支持模拟超时和 429

#### Scenario: Mock 生成 API 返回伪造 image_url

- **WHEN** Scenario 调用 `imageGen` 节点并执行
- **THEN** Mock backend 返回 `{ image_url: 'mock://scenario-01/shot_1.png' }`，不访问真实 Gemini/COS

#### Scenario: Mock 延迟配置生效

- **WHEN** Scenario 声明 `mockBackend.video.latencyMs = 2000`
- **WHEN** 评估调用 videoGen
- **THEN** Mock 后端等待 2000ms 后返回成功，验证 Agent 的超时/异步处理正确

#### Scenario: Mock 失败注入触发 Agent 重试

- **WHEN** Scenario 声明 `mockBackend.image.failFirstNCalls = 2`
- **WHEN** Agent 调 `generate_image` 3 次
- **THEN** 前 2 次失败、第 3 次成功，Agent 最终产出成功节点，`toolLog` 记录 `retry_node` 或二次 `execute_node`

### Requirement: Metrics Collection and Reporting

系统 SHALL 在每个 scenario 执行过程中收集 `toolCallCount` / `tokensUsed`（估算）/ `elapsedMs` / `verifierScore`，并在执行结束输出结构化报告。

输出 MUST 包含：

- `eval-report.json`：机器可读，含每个 scenario 的全量指标
- 控制台摘要：通过率、平均 score、超预算的 scenario 高亮
- `eval-baseline.json`（首次运行生成）：后续运行对比基线，回归超 5% 则 CI 失败

#### Scenario: 执行结束产出 JSON 报告

- **WHEN** `npm run eval` 完成全部场景
- **THEN** 当前目录生成 `eval-report.json`，结构包含 `scenarios[].id/passed/score/toolCallCount/tokensUsed/elapsedMs/issues`

#### Scenario: 对比基线检测回归

- **WHEN** 存在 `eval-baseline.json` 且本次运行某 scenario 的 score 比 baseline 低 > 5%
- **THEN** 进程以非零退出码终止，控制台打印回归详情

#### Scenario: 首次运行自动生成 baseline

- **WHEN** 不存在 `eval-baseline.json` 文件且运行 `npm run eval -- --update-baseline`
- **THEN** 系统将本次报告另存为 `eval-baseline.json`

