# Design — agent-experience-overhaul

## Context

### 当前架构（双 Agent 系统）

**前端 Agent 主循环**（`@d:\PythonProject\lang-video-work-flow\src\store\chatStore.ts:244-472`）：
- 无界 `for` 循环 + `agentLoopController.evaluate()`（5 维 budget + loop/stall detection）
- 每轮：`smartCompress` 上下文 → `backendApi.agentChat`（非流式）→ 解析 `tool_calls` → 本地 dispatch（`agentTools.executeToolCall`）→ 注入 `[REFLECTION]` 反思
- 工具执行混合：节点 CRUD 走 `flowStore`（浏览器内）；视频/图片生成代理到后端 `/api/generate/*`；记忆走 zustand persist；模型查询走后端 DB
- 提示词由 `chatPromptBuilder.buildAgentSystemPromptSegments` 生成 6 段（core/role/skills/image_hint/memory/canvas_state）+ `cache_control`

**后端 Agent 编排**（`@d:\PythonProject\lang-video-work-flow\server\app\agents\orchestrator.py:214-258`）：
- LangGraph `StateGraph` 9 节点：`detect_scenario → plan_story → design_style → design_characters → plan_shots → build_canvas → execute_canvas → review_gate`
- 自带 `route_after_review` 重试路由（fail → retry_characters / retry_shots / retry_canvas）
- 通过 WebSocket 把 `canvas_commands` 回流前端（当前是 stub，未实际使用）

**症状**：
- 两套 prompt（前端 `chatPromptBuilder` + 后端各 specialist agent 的 prompt）
- 两套工具（前端 `agentTools` 41 个 + 后端 `app/tools/canvas_tools.py` 一套独立的）
- 两套记忆（前端 `agentMemoryStore` + 后端 review 历史）
- 工作流编排实际只有前端在用，后端 LangGraph 编排基本是 dead code

### 业界 SaaS Agent 部署模式

| 产品 | Agent 主体 | 客户端 | 流式 | Subagent |
|------|-----------|--------|------|----------|
| ChatGPT / Operator | 后端 | UI Only | SSE | 是 |
| Cursor Composer | 后端 | UI + 工具桥 | SSE | 是 |
| Devin | 后端（沙箱） | Web 终端 | WS | 是 |
| Bolt.new / v0.dev | 后端 | UI + WebContainer | SSE | 否 |
| Replit Agent | 后端 | UI + 远端 IDE | SSE | 是 |
| Claude.ai (web) | 后端 | UI Only | SSE | 否 |
| Manus | 后端 | UI Only | SSE | 是 |
| LangGraph Cloud | 后端 | API only | SSE/WS | 是 |
| Claude Code (CLI) | 客户端 | 本地 | 本地流 | 是 |
| Aider / Cline | 客户端 | 本地 | 本地流 | 否 |

**结论**：所有真正的 SaaS Agent 都把主体放后端；前端 Agent 仅在本地 IDE/CLI 形态可见。本项目作为 SaaS 必须收敛到后端主体。

### Constraints

1. 现有 ~400 vitest 必须不回归（`@d:\PythonProject\lang-video-work-flow\src\__tests__\` + `@d:\PythonProject\lang-video-work-flow\server\tests\`）
2. 现有 OpenSpec specs（`agent-prompt-architecture` / `agent-tool-response-budget` / `agent-eval-harness` / `agent-vision-verify`）的契约必须延续
3. 浏览器内工具（节点 CRUD / 拖拽 / 上传预览）天然只能在客户端执行，后端 Agent 必须能反向调用
4. 必须支持长任务（视频生成 60-300s）+ 多轮工具调用 + 中途取消，需要可恢复的会话状态
5. 不破坏现有工作流 JSON 格式（旧画布加载即用）

## Goals / Non-Goals

**Goals**：
- 把 Agent 主体迁移到后端，前端转为薄客户端 + SSE 接收 + 反向 RPC
- 流式渲染：用户看到 token-level 推理 + 实时工具调用气泡，主观丝滑感对齐 Cursor / Claude.ai
- 子代理委派：复杂任务（如批量分镜）能 fan-out 并行
- 高风险审批 + 节点锁定：用户始终拥有否决权
- 聊天 ↔ 画布双向绑定：Agent 操作哪个节点，UI 立即可视化关联
- 结构化 ToolResult：替代字符串 message，让 LLM 更稳健决策
- Prompt 减肥 + Few-shot：core ≤ 400 tokens，关键场景嵌入 golden trajectory
- 节点重构：合并冗余的 character 三件套，新增 `timeline` 节点
- Identity Embedding 抽象：跨视频模型路由 reference 通道收敛为单一适配器
- 现有 ~400 测试零回归，新增 ≥ 80 测试覆盖新能力

**Non-Goals**：
- 不重写 React Flow 渲染层
- 不替换 Zustand / TailwindCSS 技术栈
- 不实现真实 IP-Adapter / FaceID 视觉嵌入（仅定义抽象层）
- 不引入新的 vector DB（记忆继续走 MySQL JSON 字段，未来再升级）
- 不改 COS / 模型代理 / DB schema 之外的基础设施
- 不动后端 LangGraph 9 节点 specialist agent 的内部 prompt（保留作为 subagent 的能力包）

## Decisions

### D-1. Agent 主体下沉到后端

**决策**：废弃 `chatStore.processUserMessage` 中 `for (let round = 0; ; round++)` 主循环；后端新增 `app/agents/runtime.py` 承载 Agent 主循环；前端 `chatStore` 仅保留 UI 状态管理（messages / agentStats）。

**为什么**：业界数据 + 安全/计费/长任务/多端一致性硬要求（见 Context 表）。

**Alternatives 拒绝**：
- 「双 Agent 并存明确分工」→ 长期重复实现 prompt/tool/memory，bug 难定位
- 「保留前端 + 加强后端」→ 同上，加倍痛苦
- 「Deprecate 后端」→ 安全/计费/长任务全失，反 SaaS 模式

**实施细节**：
- **runtime 基于 LangGraph `StateGraph`**：复用项目已有的 LangGraph 基础（`@d:\PythonProject\lang-video-work-flow\server\app\agents\orchestrator.py`），把"Agent 主循环"建模为可恢复的 StateGraph：
  - 节点：`prepare_prompt → llm_call → dispatch_tool_call → emit_observation → check_termination`
  - `StateGraph` 自带 `MemorySaver` / `SqliteSaver` checkpointing → 长任务断线后从最近 checkpoint 恢复（前端 Loop 不可能做到）
  - 子代理用 `StateGraph` 的 subgraph 嵌套实现，天然支持并行 fan-out
  - 现有 `orchestrator.py` 的 9 节点 specialist agents（plan_story / design_style / design_characters / plan_shots / ...）作为 LangGraph **subgraph 工具**继续可用，被主循环 `delegate_to_subagent` 调度
- 5 维 budget + loop/stall detection 翻译为 Python，作为 LangGraph 节点 `check_termination` 的纯函数依赖
- 前端 `chatStore.processUserMessage` 改为：调用 `agentSseClient.run({ message, images })`，订阅事件流并更新 messages
- 旧 `agentTools.ts` 被拆为：
  - `clientTools.ts`（仅 UI/画布相关：addNode / connectNodes / undo / 高亮 等，仍在浏览器执行）
  - 后端 `app/agents/tools/`（其余全部 — 视频生成、模型查询、记忆、计划、子代理）

**LangGraph 相比前端 for-loop 的能力提升**：
| 能力 | 前端 Loop | LangGraph Runtime |
|------|----------|-------------------|
| Checkpoint 恢复 | 关浏览器即丢 | SqliteSaver 自动落盘 + resume |
| 子图嵌套 | 手动管理 | StateGraph 原生 subgraph |
| 并行 fan-out | 无 | `Send` API 真并行 |
| 条件路由 | 散落在 if/else | `add_conditional_edges` 显式状态机 |
| Human-in-the-loop | 拦不住 | `interrupt_before` 节点级断点 |
| 时间旅行调试 | 无 | LangSmith trace + replay |
| 多模型组合 | 单 LLM | 不同节点不同模型（plan 用便宜模型，refine 用贵模型）

### D-2. SSE 流式协议（事件 schema）

**决策**：采用 SSE（Server-Sent Events）单向流 + REST 反向 RPC 双通道，而非 WebSocket。

**为什么**：
- SSE 自动重连、HTTP 友好、CDN/反向代理穿透好
- 反向 RPC（`POST /api/agent/sessions/{id}/client-tool-result`）天然走标准 HTTP，与 SSE 解耦
- WebSocket 在反向代理下需要额外配置，且双向状态管理更复杂

**事件类型**（`@server/app/agents/streaming.py`）：

```python
class AgentEvent(TypedDict, total=False):
    type: Literal[
        "session_start",       # {session_id, model, role}
        "phase_change",        # {phase, reason}
        "reasoning_delta",     # {text} — token-level streaming
        "tool_call",           # {call_id, name, args, scope: 'server'|'client'}
        "tool_result",         # {call_id, ok, data, hints, next_step?}
        "client_tool_request", # {call_id, name, args} — 反向 RPC
        "subagent_started",    # {subagent_id, parent_call_id, goal}
        "subagent_finished",   # {subagent_id, result}
        "approval_required",   # {call_id, name, args, risk_level, diff?}
        "node_ref",            # {message_id, node_ids[]} — 双向绑定
        "stats_update",        # {tokens, elapsed_ms, rounds, tool_calls}
        "error",               # {code, message, recoverable}
        "final",               # {text, tool_calls_summary}
        "done",
    ]
    seq: int
```

**重连恢复**：每个事件携带 `seq: int`；客户端断线时 `Last-Event-ID` 头携带最后 seq，服务端从 `agent_events` 表回放。

**Alternatives 拒绝**：
- 纯 WebSocket：复杂度高，反向代理痛
- HTTP polling：延迟差，浪费请求
- gRPC streaming：浏览器不友好

### D-3. 反向 RPC（`client_tool_request`）

**决策**：后端 Agent 调用纯客户端工具时，发出 `client_tool_request` SSE 事件；前端 `clientToolBridge` 执行后通过 `POST /api/agent/sessions/{id}/client-tool-result` 回传，后端继续 Agent 循环。

**为什么**：
- 节点 CRUD 在浏览器原生执行，避免后端 → 前端 → 后端的幽灵双跳
- 高亮/拖拽/UI 操作只能在前端
- 上传图片预览/拖放检测需要 DOM API

**协议**：

```typescript
interface ClientToolRequest {
  call_id: string
  name: 'canvas.add_node' | 'canvas.connect_nodes' | 'canvas.update_node'
       | 'canvas.delete_node' | 'canvas.highlight' | 'canvas.undo'
       | 'images.collect_user_uploads' | 'images.upload_to_cos'
       | 'ui.show_diff'
  args: Record<string, unknown>
  timeout_ms: number  // 默认 5000
}

// 前端执行后回传
POST /api/agent/sessions/{id}/client-tool-result
Body: { call_id, ok: bool, data?: unknown, error?: string }
```

**超时与失败**：客户端 5s 内必须回报；超时后端把该 tool_call 记为 `success=false, message="client timeout"`，喂回主循环。

**Alternatives 拒绝**：把所有画布 CRUD 也下沉后端 → 后端要远程操作 React Flow 状态，复杂度爆炸；浏览器拖拽体验也无法做到流畅。

### D-4. Subagent 委派

**决策**：新增工具 `delegate_to_subagent({ role, goal, budget, return_schema })`，孵化短生命周期子代理。

**实现**：
- 子代理是同一 `runtime.py` 的递归实例，但：
  - 独立 `BudgetTracker`（默认 50K tokens / 5 min / 30 tool calls）
  - 独立 `messages[]`（不继承父 context，仅传入 `goal` + 必要 reference）
  - 独立 `phase`（初始 `idle`）
  - 工具白名单（默认禁用 `delegate_to_subagent` 防递归爆炸；显式允许 `subagent_max_depth=2`）
- 返回结构化结果：`return_schema` 是 JSON Schema，子代理被强制以该 schema 输出，否则重试

**Use cases**：
- 「写 8 个分镜的提示词」→ 主代理 fan-out 8 个子代理（同时跑），主代理 collect 结果
- 「为这个项目自动生成完整角色库」→ 委派给 `artist` subagent
- 「审查所有镜头的连续性」→ 委派给 `reviewer` subagent

**事件**：父 session 的 SSE 流里包含 `subagent_started` / `subagent_finished` 事件，前端可视化为嵌套折叠卡片。

### D-5. 高风险工具审批

**决策**：定义 `RISK_LEVELS` 注册表，标注每个工具的风险等级；高风险默认要求 user approval。

**风险等级**：
- `safe`：纯读（get_canvas_state / list_models / recall_memory）
- `low`：单节点 CRUD（create_image_node / update_node）
- `medium`：执行单节点（execute_node — 消耗 API 配额）
- `high`：批量执行 / 删除（batch_execute / parallel_execute / delete_node）
- `critical`：全局影响（generate_workflow / 跨会话 forget_memory / clear_all）

**协议**：
- `medium` 默认自动通过；用户在设置中可改为「medium 也要审批」
- `high` / `critical` 默认要求审批
- 后端发出 `approval_required` 事件，前端弹出 `ApprovalDialog` 显示 diff 预览（哪些节点会被修改/删除）
- 用户 `POST /api/agent/sessions/{id}/approval/{call_id}` 回传 approve/deny
- Deny 时工具立即返回 `{ok:false, message:"user_denied"}`，主循环继续

**节点锁定**：`flowStore` 节点 data 增加 `locked: boolean`；client tool `canvas.update_node` / `canvas.delete_node` 检测 locked 后拒绝执行。

### D-6. 结构化 ToolResult Contract

**决策**：把 `ToolCallResult { success, message: string, nodeIds?: string[] }` 升级为：

```typescript
interface ToolResult<T = unknown> {
  ok: boolean
  data?: T               // 成功时的结构化数据（替代 message 字符串）
  hints?: string[]       // 给 LLM 的下一步建议（替代散落在 OBSERVATION 中的反思）
  next_step?: string     // 推荐下一个工具（如 'execute_node' 或 null）
  error?: { code: string; message: string; recoverable: boolean }  // 失败时
  meta?: { elapsed_ms: number; cost_tokens?: number }
}
```

**为什么**：
- LLM 不再需要 parse 自然语言 message，直接消费 `data` 字段
- `hints` 让工具自己提示后续动作，主循环里的 `[OBSERVATION]` 反思可以下沉到工具层
- `error.code` 让 errorRecipes 真正可机器匹配（"network_timeout" / "model_overload" / ...）

**向后兼容**：保留旧 `ToolCallResult` 类型 + adapter 函数 `toLegacyResult(result)`，旧调用方代码无需改动；新代码直接消费 `ToolResult<T>`。

### D-7. 工具命名规范化（带 alias）

**决策**：所有工具改为 `<noun>.<verb>` 格式：
- `create_character_grid` → `character.create_grid`
- `connect_nodes` → `canvas.connect`
- `execute_node` → `node.execute`
- `parallel_execute` → `node.execute_parallel`
- `plan_task` → `plan.create`
- `update_plan_step` → `plan.update_step`
- `save_memory` → `memory.save`

**为什么**：
- 同名词分组的工具天然聚类（`character.*` / `canvas.*` / `node.*` / `plan.*` / `memory.*`），LLM 识别组归属更容易
- `discover_tools` 可以按 namespace 过滤，提示词更紧凑
- 工具命名风格统一减少 LLM 的猜命名错误

**兼容性**：`tool_aliases.py` 维护 `{ old_name: new_name }` 映射；后端 dispatch 自动转发；前端 schema 同时暴露新旧名（带 `deprecated: true` 标记），1 个版本周期后下线。

### D-8. Prompt 减肥 + Few-shot

**决策**：
- `core` 段从 ~700 tokens 压到 ≤ 400 tokens：保留使命 + 执行循环 + HALT + 输出规范；移除「执行循环 4 步详细解释」「错误处理协议表」「约束 5 条」「PromptCraft Quick Ref」 — 这些下沉到独立 SKILL `agent-essentials`，按 phase 加载
- 新增 SKILL `agent-examples`，注入 1-2 条 golden trajectory（用户输入 → 工具调用序列 → 输出），按 role × phase 选择
- Role × Phase 矩阵明确：例如 `cinematographer × production` 注入"视频提示词五段法 + 运镜词汇表"加强；`director × planning` 注入"分镜结构最佳实践"

**为什么**：
- Anthropic / OpenAI 的研究都表明 few-shot 对工具调用准确率提升显著（>15%）
- 分层缓存命中率：core 段越稳定，cache_control 命中越高（已有的 `cache_control` 机制能直接受益）

### D-9. 画布 ↔ 对话双向绑定

**决策**：
- `ChatMessage` 增加 `nodeRefs?: string[]` 字段，记录该消息涉及的节点 ID
- Agent 工具执行后，`tool_result` 事件携带 `node_ids` 触发后端 `node_ref` 事件
- 前端：消息 hover → 高亮关联节点（`flowStore.highlightedNodeIds`）；节点 `Ctrl+点击` → 查找最早涉及该节点的消息并 scroll 到聊天对应位置
- 进度时间轴（D-10）每个工具卡片可点击，点击后高亮对应节点 + 滚动到该消息

**实现**：
- 新组件 `NodeChatBinding.tsx` 监听 hover/click 事件
- `flowStore` 增加 `highlightedNodeIds: Set<string>` + `setHighlight(ids)` action
- `WorkflowCanvas.tsx` 渲染 highlight 边框（半透明 ring）

### D-10. 进度时间轴

**决策**：替代当前 `LiveStatsBar` 简陋的 4 数值条，新增 `ProgressTimeline.tsx`：
- 阶段卡片（horizontal scroll）：planning → designing → building → reviewing → executing
- 每张卡片下挂工具调用气泡（图标 + 工具名 + 持续时间 + 成功/失败 + 影响节点数）
- 失败的工具调用自动折叠到「重试组」，展开看每次重试详情
- Subagent 调用显示为嵌套子时间轴

**风格参考**：Cursor Composer 的 step list；Claude Code CLI 的 trace mode

### D-11. 节点重构（合并 character 三件套）

**决策**：合并 `characterGrid` / `characterManager` / `characterExtract` 为单一 `characterAsset` 节点，承载三种模式（mode）：
- `mode: 'design'` — 文字描述生成 3×3 九宫图（旧 characterGrid）
- `mode: 'extract'` — 从视频提取角色（旧 characterExtract）
- `mode: 'registry'` — 多角色聚合（旧 characterManager）

**为什么**：当前三件套职责重叠，连线规则混乱，Agent 经常用错节点类型；合并后端口语义清晰：
- 输入：`text-in`（描述）/ `video-in`（视频）/ `character-in`（其他角色聚合）
- 输出：`grid-out`（九宫图）/ `character-out`（角色 URL + ID）

**新增 `timeline` 节点**：把 audio + video + transitions 串到统一时间轴；支持 BPM 对齐 / cut points / 字幕轨；为后续音视频节奏绑定打基础。

**Migration**：`workflowMigrations.ts` 增加迁移函数：
- 旧 `characterGrid` 节点 → `characterAsset { mode: 'design', ...原 data }`
- 旧 `characterManager` → `characterAsset { mode: 'registry', characters: [...] }`
- 旧 `characterExtract` → `characterAsset { mode: 'extract', videoUrl, ...}`
- 端口连线自动 remap

### D-12. Identity Embedding 抽象

**决策**：`Asset.identity_embedding?: { vector_id: string; provider: string; created_at }` —— 抽象字段，今天先存 metadata（不存真实向量），未来接 IP-Adapter / FaceID / Sora Character 等。

`modelReferenceAdapter`（已存在）扩展，按模型能力路由：

| 视频模型 | identity 通道 | 回退 |
|---------|--------------|------|
| Seedance 2.0 | `reference_images: string[]` (1-3 张) | 多张参考图 |
| VEO 3.1 | `image_mode: 'reference'` + 1-2 张 | 首帧 fallback |
| Sora-2 VIP | `characterUrl + characterTimestamps` (Character API) | 无 fallback（不支持 ref） |
| Kling v3 | 仅首帧 | drop 多余 ref |

**为什么**：
- 当前 reference 路由散落在 `videoGen` 提交逻辑里，每次加新模型就要改多处
- 抽象出 `IdentityRouter` 后，新模型只需注册路由表即可
- 真实视觉嵌入未来落地时，只需让 `IdentityRouter` 优先读 `identity_embedding.vector_id`

### D-13. 数据模型变更

#### 后端 DB（新增表）

```sql
CREATE TABLE agent_sessions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT,
  project_id BIGINT,
  model VARCHAR(64),
  role VARCHAR(32),
  phase VARCHAR(32) DEFAULT 'idle',
  status ENUM('running','paused','completed','aborted','error'),
  budget_state JSON,         -- BudgetTracker 序列化
  loop_state JSON,           -- LoopDetector / StallDetector 序列化
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  INDEX (user_id, project_id, status)
);

CREATE TABLE agent_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id BIGINT,
  seq INT,                   -- SSE 重连用
  type VARCHAR(32),
  payload JSON,
  created_at TIMESTAMP,
  INDEX (session_id, seq)
);

CREATE TABLE agent_memories (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT,
  project_id BIGINT NULL,    -- NULL = global / session
  scope ENUM('session','project','global'),
  type VARCHAR(32),
  title VARCHAR(255),
  content TEXT,
  tags JSON,
  pinned BOOLEAN DEFAULT FALSE,
  last_accessed_at TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  INDEX (user_id, scope, project_id)
);
```

**Alembic 迁移**：`server/alembic/versions/0006_agent_runtime.py`

#### 前端 Store

```typescript
// chatStore.ts — 大幅瘦身
interface ChatState {
  messages: ChatMessage[]   // 保留
  agentStats: AgentStats | null
  sessionId: string | null  // 新增
  // 删除：processUserMessage 主循环、setProcessing 大部分内部逻辑
  // 改为：startSession / cancelSession 调用 sseClient
}

// flowStore.ts — 增加
interface FlowState {
  highlightedNodeIds: Set<string>  // D-9
  setHighlight: (ids: string[] | null) => void
  // 节点 data 增加可选 locked: boolean
}

// 新 store: agentSessionStore.ts
interface AgentSessionState {
  current: { sessionId: string; phase: PhaseId; events: AgentEvent[] } | null
  approvalQueue: ApprovalRequest[]
  approveCall: (callId: string, approved: boolean) => Promise<void>
}
```

### D-14. 文件清单（高层）

#### 后端新增
- `server/app/agents/runtime.py` — 主循环
- `server/app/agents/streaming.py` — SSE 事件 schema + emitter
- `server/app/agents/tool_registry.py` — 工具注册表（含 risk levels + aliases）
- `server/app/agents/subagent.py` — 子代理孵化
- `server/app/agents/prompts/` — 后端 prompt 构建（迁移自 `chatPromptBuilder`）
- `server/app/agents/tools/` — 工具实现（迁移自前端 `agentTools` 中非客户端工具）
- `server/app/routers/agent_runtime.py` — `/api/agent/sessions/*` SSE + RPC
- `server/app/services/agent_session_service.py` — 会话/事件持久化
- `server/app/services/identity_router.py` — Identity Embedding 路由器
- `server/alembic/versions/0006_agent_runtime.py` — DB 迁移

#### 前端新增
- `src/api/agentSseClient.ts` — SSE 连接 + 重连恢复
- `src/api/clientToolBridge.ts` — 反向 RPC 客户端工具
- `src/store/agentSessionStore.ts` — 会话 / 事件 / 审批队列
- `src/components/sidebar/ProgressTimeline.tsx`
- `src/components/sidebar/ApprovalDialog.tsx`
- `src/components/canvas/NodeChatBinding.tsx`
- `src/components/nodes/CharacterAssetNode.tsx` — 合并节点
- `src/components/nodes/TimelineNode.tsx`
- `src/providers/clientTools.ts` — 仅 UI/画布相关工具

#### 前端修改
- `src/store/chatStore.ts` — 移除主循环，改为接收 SSE
- `src/store/flowStore.ts` — 增加 `highlightedNodeIds` + `locked` 节点
- `src/components/sidebar/AgentChat.tsx` — 流式渲染 + 时间轴整合
- `src/store/workflowMigrations.ts` — 节点合并迁移

#### 前端废弃（保留 alias）
- `src/store/chatPromptBuilder.ts` — 迁移到后端，保留 export proxy 一个版本
- `src/providers/agentTools.ts` 中非客户端工具 — 迁移到后端

### D-15. Migration Plan

#### Phase 0：架构脚手架（无用户可见变化）
1. 后端建 `agent_sessions / agent_events / agent_memories` 表（Alembic）
2. 后端实现 `runtime.py` 骨架 + SSE endpoint，但未启用（feature flag `AGENT_BACKEND_RUNTIME=false`）
3. 前端实现 `agentSseClient` + `clientToolBridge`，但未启用（保留 `chatStore` 旧路径作 fallback）
4. 双跑 eval：后端 runtime vs 前端 loop，结果一致才放行

#### Phase 1：能力下沉（feature flag 切换）
1. 服务端开 `AGENT_BACKEND_RUNTIME=true`，前端 `chatStore.processUserMessage` 走新 SSE 路径
2. 老路径作 fallback（feature flag `AGENT_FRONTEND_LOOP_FALLBACK=true`，1 个版本周期后下线）
3. 灰度：先内部账号，再 5% / 25% / 100%
4. 监控：SSE 重连率、tool 失败率、用户取消率、p50/p99 延迟

#### Phase 2：UI 升级
1. 上线 `ProgressTimeline` 替代 `LiveStatsBar`
2. 上线 `NodeChatBinding`（双向绑定）
3. 上线 `ApprovalDialog`（高风险审批）
4. 节点合并 + workflowMigrations（旧 character 三件套 → characterAsset）

#### Phase 3：Subagent + Identity
1. 上线 `delegate_to_subagent` 工具
2. 上线 `IdentityRouter` 抽象
3. 上线 `timeline` 节点
4. 工具命名规范化（双名并存）

#### Phase 4：清理
1. 下线前端 `chatStore` 主循环代码（保留 store）
2. 下线工具旧名（保留 alias warning 一个版本）
3. 文档更新（AGENT_SKILLS_REFERENCE.md / DEV_GUIDE.md）

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| **SSE 在企业代理 / 防火墙下被切断** | 实现重连 + Last-Event-ID 回放；提供 long-polling fallback（`?transport=poll`） |
| **后端长会话占用资源** | 会话空闲 30 min 自动 paused 落盘；恢复时按需重建 LangGraph state |
| **反向 RPC 客户端超时** | 5s 超时；超时记 tool_call 失败 + 注入反思；客户端可重试 |
| **客户端工具失败导致 Agent 卡住** | `client_tool_request` 必须有 timeout；工具结果统一 schema，失败也是合法返回 |
| **Subagent 嵌套爆炸** | `subagent_max_depth=2` 默认；budget 独立；递归调用 `delegate_to_subagent` 默认禁用 |
| **审批弹窗破坏丝滑感** | 高风险默认审批 + 用户偏好可关闭；批量操作合并为一次审批；快捷键一键确认 |
| **节点合并导致老工作流失效** | `workflowMigrations` 自动迁移 + vitest 覆盖每种旧格式；保留旧节点 type alias 一个版本 |
| **流式渲染抖动** | 客户端做 100ms throttle；reasoning_delta 累积渲染，避免每 token 重绘 |
| **工具命名 breaking change** | 新旧名并存一个版本周期 + deprecated warning；`discover_tools` 显示新名优先 |
| **Identity Embedding 抽象层无真实视觉** | 当前先做 metadata field + 路由器；视觉嵌入是 follow-up change，不阻塞本 change |
| **后端 runtime 与前端 loop 行为不一致** | Phase 0 期间双跑 eval-baseline，所有 evalScenarios 在两侧产出必须 byte-equivalent；不一致即修 |
| **chatStore 重构影响 ~390 测试** | 老 `processUserMessage` 路径保留为 fallback，所有 chatStore unit test 继续跑；新路径加专门测试 |

## Open Questions

1. **会话恢复粒度**：用户重连时，是从最后 `seq` 续播，还是给个 "resume" 按钮让用户主动选？建议：默认续播；超过 5 分钟断开提示用户重新开始
2. **Subagent 是否能调用客户端工具**：默认应该是 NO（避免反向 RPC 嵌套），如果未来需要再开。本 change 默认 subagent 工具白名单不含 `canvas.*`
3. **审批 Diff 的精度**：仅显示节点级（"将删除 3 个节点"）还是字段级（"将把 prompt 从 X 改为 Y"）？建议：critical 显示字段级，high 仅节点级，简化 UI
4. **Memory 是否在后端做向量检索**：当前继续用 tag overlap + recency，未来再升级；本 change 不引入 vector DB
5. **流式 reasoning 是否暴露给所有模型**：部分模型（Claude / GPT-5.4）原生支持 reasoning，部分不支持。Strategy：支持的就流；不支持的就发送一次 `reasoning_delta` 包含 `assistantText`
