## Why

当前 Agent 架构相对 Anthropic 官方发表的 Agent 最佳实践（*Writing Effective Tools*、*Effective Harnesses for Long-Running Agents*、*Agent Skills*）存在 **4 个可量化的缺口**：

1. **"盲生成"问题**：`@src/providers/toolVerify.ts:43-217` 的 `verify_task` 仅做字符串匹配（prompt 含中文？字段为空？名字包含外貌词？），**无法判断生成的图片/视频是否真的符合 prompt 语义**。Anthropic 明确指出"Claude tends to mark a feature complete without proper testing"——这就是这个症状。
2. **Prompt 缓存失效**：`@src/store/chatPromptBuilder.ts:362-577` 是 ~3100 token 的单体 System Prompt，`rolePrompt` 在顶部导致切换角色就让整个前缀缓存失效。Anthropic 数据显示 Claude Code 通过合理的 caching 达到 **92% 缓存命中、81% 成本下降**；当前我们缓存命中率约为 0。
3. **工具响应无预算**：`get_canvas_state` / `list_assets` / `get_node_output` 没有 token 上限，50 节点画布可返回 8K+ tokens，直接把 context compaction 逼到触发阈值。Claude Code 的 tool response 硬上限是 25,000 tokens。
4. **无可量化评估**：37 个工具 × 16 个 SKILLS × 6 个 phase 的组合空间巨大，但我们只有工具级单元测试，**零 E2E Agent 评估**。任何 prompt/工具改动都凭感觉，无法证明"改进"真的是改进。

## What Changes

以 4 个互相解耦的新 capability 覆盖上述 4 个缺口，全部遵循「通用化、可配置化、消除硬编码」的原则。

### New Capabilities

- `agent-eval-harness`: Agent 端到端评估框架——声明式场景 DSL（prompt + userImages + expectedToolCalls + verifier + budget）+ Mock LLM + Mock 生成服务 + 指标收集（tool_calls/tokens/time/score），产出 baseline 报告并在 CI 禁止回归
- `agent-vision-verify`: 基于 LLM Vision 的图像/视频语义校验工具 `verify_image_semantic`——对 `imageGen.outputImage` / `videoGen.firstFrameImage` 调用 Gemini Vision，返回 matchScore / detectedSubjects / missingElements / recommendation，彻底取代 `verify_task` 第 4 维的"角色外貌一致性"启发式
- `agent-prompt-architecture`: System Prompt 分 4 层——stable-core / role-block / phase-skills / dynamic-suffix，每层拥有独立的稳定性语义与 `cache_control` 标记；剥离 `chatPromptBuilder` 内硬编码 Pipeline 指令到新的 phase-gated SKILL 模块 `video_workflow_recipe` 与 `multimodal_input`
- `agent-tool-response-budget`: 统一工具响应预算机制——通用 `truncateToolResponse(payload, {maxTokens, format})` helper + 所有查询类工具强制接受 `response_format: 'concise' | 'detailed'` 参数；`response_format` 默认 `concise`，超出 25K token 硬截断并附带结构化 hint（告诉 Agent 如何用 pagination 拉剩余数据）

### Modified Capabilities

（当前 `openspec/specs/` 为空，无既存 spec 需要 delta 修改；所有相关既存 capability 如 `agent-tool-schemas`、`agent-phase-state` 仍处于 pending change 中，后续归档时会自然融合。）

## Impact

- **代码**：`src/providers/toolVerify.ts`（解耦 visual check）/ `src/store/chatPromptBuilder.ts`（拆层 + caching）/ `src/providers/toolHelpers.ts`（新增 `truncateToolResponse`）/ `src/prompts/skills/index.ts`（新增 2 个 SKILL 模块）/ `src/__tests__/eval/`（全新目录）
- **API**：后端新增 `/api/verify/image`（调 Gemini Vision）；Agent Chat payload 新增 `cache_control` 字段（若上游支持）
- **依赖**：无新增运行时依赖；测试层可能引入 `msw` 或复用现有 vitest mocks 模拟 LLM/生成 API
- **迁移**：100% 向后兼容。旧 `verify_task` 保留；`response_format` 参数在所有查询工具 **可选默认 concise**，不传仍按旧行为返回全量
- **文档**：更新 `@SKILLS` 相关 md；新增 `docs/agent-eval.md` 介绍如何写 scenario 和跑 `npm run eval`
