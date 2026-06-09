## Context

Agent 层的循环控制（`@src/lib/agentLoopControl.ts`）、工具分层（`@src/providers/toolTiers.ts`）、三层上下文压缩（`@src/store/chatPromptBuilder.ts:122-294`）、记忆系统（`@src/store/agentMemoryStore.ts`）均已齐备。剩余 4 个缺口—evaluation / vision-verify / prompt-caching / tool-response-budget—都属于**横切关注点（cross-cutting concerns）**，需要一次性在基础层引入通用抽象，防止每个节点类型/每个工具独立实现导致"到处是硬编码"。

参考 Anthropic 公开实践：
- *Effective Harnesses for Long-Running Agents* — 端到端 eval 驱动迭代 + feature-list scaffolding
- *Writing Effective Tools for Agents* — tool response token budget、response_format enum、pagination
- *Prompt Caching Docs* — 4 个 cache breakpoint + 稳定前缀设计
- *Equipping Agents with Skills* — progressive disclosure 的三级加载（metadata / SKILL.md / bundled files）

## Goals / Non-Goals

**Goals:**
- **消除硬编码**：Pipeline 指令、token 上限、verifier 阈值、vision 模型名、eval scenario 全部走配置或注册表，不内嵌在流程代码里
- **可量化改进**：每个改动都有 metric + baseline + CI gate
- **向后兼容**：所有新 API 皆为可选参数或新增 endpoint，不破坏既有调用点
- **消除冗余**：把 `chatPromptBuilder` 里重复的 Pipeline/多模态协议迁移到 SKILL 模块，避免"两份事实来源"

**Non-Goals:**
- **不**重命名既有工具（如 `execute_node`→`node_execute`）——属于破坏性变更，价值不大
- **不**引入子代理（subagent）模式——下一阶段再议
- **不**重写 `agentLoopControl` / 三层压缩 / 工具分层（已经达标）
- **不**改造后端 LangGraph——本次完全在前端 + 1 个新 verify endpoint

## Decisions

### D1. 四层 System Prompt + 显式 cache breakpoint

`buildAgentSystemPrompt()` 返回结构化数组而非拼接字符串，每段携带稳定性标签：

```typescript
type PromptSegment = {
  id: 'core' | 'role' | 'skills' | 'dynamic'
  text: string
  stability: 'stable' | 'semi-stable' | 'dynamic'
  cacheable: boolean
}
function buildAgentSystemPrompt(...): PromptSegment[]
```

Chat payload 构建时将 `stable` + `semi-stable` 段合并到 `system` 字段头部并打 `cache_control: {type: 'ephemeral'}`，`dynamic` 段追加在后面。

**Why not 直接改字符串拼接？** 因为下游 `backendApi.agentChat` 需要判断哪些 segment 可以缓存；返回结构体让调用方决定，避免在 builder 里硬编码 provider-specific 格式。

**Alternative considered**: 保留字符串返回，在 `backendApi` 里再切段。否决——正则切段脆弱，且 builder 本身就知道边界，应当显式暴露。

### D2. Vision verify 走"适配器注册"而非硬编码 Gemini

新建 `@src/providers/visionVerifyAdapter.ts`，定义：

```typescript
interface VisionVerifier {
  id: string   // 'gemini' | 'gpt5' | 'claude'
  verify(imageUrl: string, criteria: VerifyCriteria): Promise<VerifyResult>
}
export function registerVerifier(v: VisionVerifier): void
export function getActiveVerifier(): VisionVerifier  // 读 settings.visionVerifyModel
```

后端对应新增 `POST /api/verify/image`，body 含 `model: string`，内部再分发到具体 provider。

**Why 适配器？** 我们的主模型本来就是多 provider 切换（OpenAI/Gemini/Claude）；vision verify 没理由绑死一家。用户在 settings 里能切。

### D3. Tool Response Budget 走通用 helper，不改每个 handler

新增 `@src/providers/toolHelpers.ts::withResponseBudget()` 高阶函数：

```typescript
export function withResponseBudget<TArgs>(
  handler: (args: TArgs) => Promise<ToolCallResult>,
  opts?: { maxTokens?: number; honorFormat?: boolean }
): (args: TArgs & { response_format?: 'concise' | 'detailed' }) => Promise<ToolCallResult>
```

所有查询类 handler 在 `executeToolCall` 注册时用 `withResponseBudget()` 包一层；超限自动截断并给 `hint`。

**Why 高阶函数？** Anthropic 官方博客的主要示例都是"每个工具独立做截断"，但那导致 37 个工具各自 duplicate 逻辑。高阶函数一次声明，全工具复用；且 `honorFormat=false` 的工具（如 `save_memory`）可显式 opt-out。

### D4. Eval Harness 走声明式 Scenario，执行器无硬编码场景

目录结构：

```
src/__tests__/eval/
├── runEval.ts                  # Scenario 执行器（通用，0 硬编码场景）
├── types.ts                    # Scenario / Verifier / Metrics 类型
├── mockLLM.ts                  # LLM Mock：按 Scenario.toolCallScript 分发
├── mockBackend.ts              # 生成/Vision/COS API Mock
├── reporters/
│   ├── consoleReporter.ts
│   └── jsonReporter.ts         # 产出 eval-report.json
└── scenarios/
    ├── 01-product-ad.ts
    ├── 02-short-story.ts
    ├── 03-character-fix.ts
    └── ...                     # Agent 自主规划的真实场景
```

每个 scenario 纯声明式：输入 + 期望工具序列（有序约束可选） + verifier 函数 + budget。执行器跑完输出 Metric 行。

**Why 分目录？** 让未来加 scenario 就是 "新增一个文件" 而不是改 `runEval.ts`。

### D5. Pipeline 指令迁移到新 SKILL 模块

把 `chatPromptBuilder` 里硬编码的 200 行"制片 Pipeline"剥离到：

- `video_workflow_recipe` SKILL：Path A + Path B 执行序列，phase ∈ {planning, building, executing}
- `multimodal_input` SKILL：用户图片处理协议，仅在 `imageCount > 0` 时注入

`@src/store/chatPromptBuilder.ts:397-568` 整块替换为 SKILL 引用。`stablePrefix` 瘦身到 ~600 token，只留执行循环 / HALT / 错误处理 / 输出规范 / 5 条约束。

**Why 不直接删？** 这些指令本身是**领域知识**，不能丢；但它们属于 building phase 的专用知识，放核心 prompt 就是冗余。

## Risks / Trade-offs

- **[R1] Vision verify API 成本**：每个 image verify 一次 Vision 调用。→ **Mitigation**：默认仅在 `verify_task` 末尾主动触发；暴露 `skipVisionVerify` 设置；缓存同一 imageUrl 的结果 5 分钟
- **[R2] Prompt caching 不支持所有上游 provider**：APIMart 代理可能不转发 `cache_control`。→ **Mitigation**：Builder 返回结构体后，`agentChat` 根据 `settings.cachingEnabled` 决定是否注入 cache_control；未开启时把所有段拼成一个普通 `system` 字符串，0 行为差异
- **[R3] `response_format` 参数扩散到所有查询工具**：Tool schema 膨胀。→ **Mitigation**：`withResponseBudget` 注册时自动注入该参数定义到 schema，不用每个 tool 手改
- **[R4] Eval baseline 会因 LLM 非确定性波动**：每次跑结果不同。→ **Mitigation**：Mock LLM 走确定性脚本（每个 scenario 预定义"LLM 应当按此顺序调这些工具"）；真实 LLM eval 作为"smoke test" 单独标注，不进 CI gate
- **[R5] Pipeline 剥离可能误删关键指令**：→ **Mitigation**：先建 eval harness（任务 1），再改 prompt（任务 3）；如果 eval pass 率下降就定位到具体 scenario 回溯

## Migration Plan

1. **阶段 1（4h）**：Eval Harness 落地 + 10 个 baseline scenarios 跑通，生成首份 `eval-report.json` 作为 baseline
2. **阶段 2（3h）**：`withResponseBudget` + `response_format` 在查询工具推开；eval pass 率不降
3. **阶段 3（3h）**：`buildAgentSystemPrompt` 改返回结构体 + cache_control 注入；eval pass 率不降，但 tokens 指标应 ≥ 40% 下降
4. **阶段 4（6h）**：`verify_image_semantic` 工具 + 后端 `/api/verify/image` + 适配器；vision verify 的 20 个正反例测试通过
5. **阶段 5（2h）**：Pipeline 指令迁到 SKILL；eval pass 率不降
6. **回滚策略**：每个阶段独立 commit，对应 feature flag（`settings.enableVisionVerify` / `settings.enablePromptCaching` / `settings.enableResponseBudget`）。CI 失败即关 flag 回退

## Open Questions

- **Q1**：Eval harness 的 Mock LLM 要不要接回真实 LLM 跑"集成 eval"？→ 建议 CI 只跑 Mock；Nightly 任务跑真实 LLM 发 Slack 报告
- **Q2**：Vision verify 用哪个模型？Gemini 3 Pro / GPT-5.1 Vision / Claude Sonnet 4 Vision 各有长短。→ 默认 Gemini（成本最低），让用户可切；eval scenario 里固定一款防波动
- **Q3**：`cache_control` 是否要走 APIMart？需要确认代理是否透传。→ 任务 1 先实测，必要时在后端 `agent_chat` 端点手动剥离不支持的字段
