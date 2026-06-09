## Why

**用户可见问题**：Agent 当前同时存在前端循环（`@d:\PythonProject\lang-video-work-flow\src\store\chatStore.ts:244-472`）与后端 LangGraph 编排（`@d:\PythonProject\lang-video-work-flow\server\app\agents\orchestrator.py:214-258`）两套主体，prompt/tool/memory 三处重复维护，调试错位、能力割裂、产品丝滑感缺失：
1. **非流式响应** — `backendApi.agentChat` 一次性返回，UI 仅靠 `thinking` 占位符兜底，用户感知不到推理与工具调用的真实进度
2. **聊天与画布隔离** — Agent 修改了"镜头 2"，画布上不会高亮该节点；用户点击节点也无法跳回相关聊天上下文
3. **无 Subagent 机制** — 8 个分镜的提示词必须串在主循环里写，无法 fan-out 并行
4. **高风险操作无拦截** — `delete_node` / `generate_workflow` / `batch_execute` 直接落地，用户无法审批
5. **工具结果非结构化** — `ToolCallResult.message: string` 让 LLM 自己 parse，错误恢复线索弱
6. **核心 prompt 偏长** — `core` 段约 700 tokens，缺少 few-shot 示例
7. **节点功能重叠** — `characterGrid` / `characterManager` / `characterExtract` 三件套职责重叠，状态机不统一
8. **跨模型 reference 路由不收敛** — 视频模型（Seedance/VEO/Sora/Kling）的 reference 字段差异散落在 `videoGen` 提交逻辑中

**现状不可持续**：所有成熟 SaaS Agent（ChatGPT / Cursor Composer / Devin / Bolt / Replit / Claude.ai / Manus / LangGraph Cloud）都把 Agent 放后端 — 因为安全（API Key / 凭证）、计费（token 记账）、长任务（checkpoint 恢复）、多端一致（跨设备会话）、可观测（日志/eval）都要求服务端主体。前端 Agent 是项目早期快速验证的产物，到了产品化阶段必须收敛。

## What Changes

迁移 **Agent 主体到后端**（FastAPI + LangGraph 升级版承载主循环 / 工具调度 / 记忆 / 计划 / 子代理 / 流式输出），前端转为**薄客户端**（UI + 画布 CRUD + SSE 接收 + 反向 `client_tool_call` RPC），同步落地 9 大能力点：

- **架构迁移**：废弃前端 `chatStore` 主循环，改为接收后端 SSE 事件；后端新增 `/api/agent/run` SSE 端点 + 工具注册表 + 反向 RPC 协议
- **流式协议**：定义 `reasoning_delta` / `tool_call` / `tool_result` / `phase_change` / `client_tool_request` / `final` 事件类型；前端 `AgentChat` 实时渲染 token-level 推理 + 工具调用气泡
- **Subagent 委派**：`delegate_to_subagent({ role, goal, budget })` 工具孵化短生命周期子代理（独立 budget + 隔离 context + 结构化返回）
- **画布-对话双向绑定**：聊天消息携带 `nodeRefs[]`，hover 高亮画布节点；节点 `Ctrl+点击` 锚定到关联聊天消息；进度时间轴显示阶段/工具/重试
- **审批与安全**：高风险工具（delete_node / generate_workflow / batch_execute / parallel_execute）默认要求 user approval（设置可关闭）；节点 `locked: true` 阻止 Agent 写入
- **结构化 ToolResult**：`{ ok, data, hints[], next_step? }` 取代字符串 message；工具命名规范化为 `<noun>.<verb>`（向后兼容旧名 alias）
- **Prompt 减肥 + Few-shot**：`core` 段 ≤ 400 tokens；新增 SKILL `agent-examples` 嵌入 1-2 条 golden trajectory；role × phase 矩阵明确
- **节点重构**：`characterGrid` / `characterManager` / `characterExtract` 合并为统一 `characterAsset`；新增 `timeline` 节点支持音视频节奏对齐
- **Identity Embedding 抽象**：Asset 增加 `identity_embedding` 字段，`modelReferenceAdapter` 在 Seedance / VEO / Sora / Kling 间统一路由 reference 通道（含 fallback）

**Non-goals**：本 change 不重写画布渲染层（保留 React Flow）；不引入 IP-Adapter/FaceID 真实视觉嵌入（仅定义抽象层）；不替换 React/Zustand 技术栈；不改动 COS / DB / 模型代理基础设施。

## Capabilities

### New Capabilities

- `agent-server-runtime`：后端 Agent 主循环（迭代/工具调度/反思/HALT）+ Plan/Memory/Subagent/Phase 状态机；替代前端 `chatStore` 主循环
- `agent-streaming-protocol`：SSE/WebSocket 双向事件协议（reasoning_delta / tool_call / tool_result / phase_change / client_tool_request / final / error）+ 重连恢复
- `agent-thin-client`：前端薄客户端运行时 — 接收 SSE、维护 UI 状态、执行 client_tool_call、上报用户审批
- `agent-subagent-delegation`：子代理孵化机制 — 短生命周期 + 隔离 context + 独立 budget + 结构化返回
- `agent-approval-and-safety`：高风险工具人审协议 + 节点锁定 + 操作 diff 预览
- `agent-canvas-conversation-binding`：聊天 ↔ 画布双向链接（nodeRefs / hover 高亮 / 反向锚定）
- `agent-progress-timeline`：步骤时间轴 UI — 阶段卡片 + 工具调用气泡 + 重试折叠
- `agent-tool-result-contract`：结构化 ToolResult schema + 工具命名规范化（含旧名 alias 兼容）
- `agent-identity-embedding`：Identity 统一抽象 + 跨视频模型 reference 路由器

### Modified Capabilities

- `agent-prompt-architecture`：`core` 段瘦身（≤ 400 tokens）+ Few-shot SKILL 注入 + role × phase 矩阵；保留段落分层 + cache_control
- `agent-tool-tiering`：新增 `dry_run_node` / `undo_last_action` / `bulk_update_nodes` / `preview_propagation` 工具；统一 `<noun>.<verb>` 命名
- `agent-eval-harness`：新增 streaming latency / subagent success rate / canvas-binding accuracy 评估指标

## Impact

- **后端**：`server/app/agents/` 新增 `runtime.py`（Agent 主循环）/ `tool_registry.py` / `subagent.py` / `streaming.py`；`server/app/routers/` 新增 `/api/agent/run` SSE 端点；DB 新增 `agent_sessions` / `agent_events` 表（用于会话恢复 + 审计）
- **前端**：废弃 `chatStore` 主循环逻辑（保留 store 用于 UI 状态）；新增 `agentSseClient.ts` + `clientToolBridge.ts`；`AgentChat.tsx` 重构为流式渲染；新增 `ProgressTimeline.tsx`、`ApprovalDialog.tsx`、`NodeChatBinding.tsx`
- **节点**：`characterGrid` / `characterManager` / `characterExtract` 合并为 `characterAsset`（含一次性 workflow migration）；新增 `timeline` 节点
- **工具**：从 ~40 个收敛为约 35 个（合并 + 删冗）；统一命名 + 旧名 alias 至少 1 个版本周期
- **Prompt**：`core` 段 700 → ≤ 400 tokens；19 个 SKILL 收敛为 ~12 个（合并 promptCraft / qualityControl / multimodalInput / visionVerify）
- **向后兼容**：旧工作流 JSON 通过 `workflowMigrations.ts` 自动升级；旧工具名继续可用（标记 deprecated）；前端短期保留旧 `chatStore` 路径作 feature flag fallback
- **测试**：现有 ~400 测试不允许回归；新增 ≥ 80 个测试覆盖 SSE / Subagent / 审批 / Identity 路由 / 工具结构化结果
