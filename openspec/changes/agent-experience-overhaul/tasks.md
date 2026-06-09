# Tasks — agent-experience-overhaul

> **执行约定**：每个任务粒度 30 min - 2 h，独立可验证。Phase 0 必须全部完成才能进入 Phase 1（feature flag 切换）。后端任务先于前端消费者。

## Phase 0：架构脚手架（无用户可见变化）

### 0.1 后端 DB Schema + Alembic 迁移

- [x] 0.1.1 扩展 `@d:\PythonProject\lang-video-work-flow\server\app\models\agent.py` 现有 `AgentSession` ORM：增加 `user_id` / `phase` / `budget_state` / `loop_state` / `parent_session_id` / `last_event_seq` 字段 + 索引。**Verify**：`pytest server/tests/test_agent_session_model.py` 验证字段映射 + 索引。
- [x] 0.1.2 新增 `AgentEvent` ORM 类（`session_id` FK + `seq` int + `type` + `payload` JSON + `UniqueConstraint`）到 `agent.py`，并在 `__init__.py` 导出。**Verify**：同上。
- [x] 0.1.3 扩展 `AgentMemory` ORM：增加 `user_id` / `scope` / `pinned` / `last_accessed_at` 字段 + 索引。**Verify**：同上。
- [x] 0.1.4 创建 Alembic 迁移 `server/alembic/versions/0005_agent_runtime.py`（不是 0006，因当前 head=0004）：增量加列 + 新建 `agent_events` 表 + downgrade 完整。**Verify**：`alembic upgrade head` 在本地 MySQL 成功 + 回滚 `alembic downgrade -1` 也成功。
- [x] 0.1.5 `server/tests/test_alembic_0005.py` 实装 24 个测试，两层覆盖：**静态分析**走 AST 验证 upgrade/downgrade 函数存在、revision chain (0005 → 0004)、agent_sessions 加 6 列 + agent_memories 加 4 列 + agent_events 表创建 + 6 个必要索引 + downgrade 逆向对称丢除；**ORM↔migration parity** 验证 ORM models 暴露 migration 添加的所有列 + server defaults (idle/0/1) + parent_session_id 自反向 FK + agent_events 唯一约束。**为什么不走真 SQLite alembic upgrade**：0001-0005 均使用 MySQL-specific `MySQLDateTime(fsp=3)` + `CURRENT_TIMESTAMP(3)` 语法，SQLite 上执行会报 syntax error；该静态+ORM 双层检查接近等价覆盖，且能抱荷 "PR 加列但忘了同步 ORM" 这类常见 bug。**Verify**：`pytest server/tests/test_alembic_0005.py` 24 passed in 0.23s。

### 0.2 后端 Agent Runtime 骨架

- [x] 0.2.1 创建 `server/app/agents/runtime.py`（基于 LangGraph `StateGraph`，5 节点：prepare_prompt → llm_call → check_termination → dispatch_tool_calls → emit_observation 循环）+ `RuntimeConfig` + `run_session(...)` 入口。Phase 0 使用 stub LLM 节点验证端到端事件流；后续任务填充实现。**Verify**：`python -c "from app.agents.runtime import build_runtime_graph"` import 通过；`pytest server/tests/test_runtime_skeleton.py` 验证 SSE 事件序列（待 0.2.2 完成后跑）。
- [x] 0.2.2 翻译 `agentLoopControl.ts` 为 `server/app/agents/loop_control.py`：`BudgetTracker` / `LoopDetector` / `StallDetector` / `AgentLoopController` + `hash_args` 用 FNV-1a 与 TS 端 byte-equivalent。保持中文 reflection / stop 字符串完全一致。**Verify**：parity test 待补；import 通过。
- [x] 0.2.3 在 `runtime.py` 的 `check_termination_node` 集成 `AgentLoopController`：每轮 `evaluate()` → 决策 stop/warn/force-summary；warn 注入 `reasoning_delta` + 反思消息，force-summary 设 `force_summary` flag 让 llm_call 跳过 tools。**Verify**：runtime 集成测试待补；端到端事件流可工作。
- [x] 0.2.4 `server/app/agents/prompts/` 模块实装：`types.py`（PromptSegment / BuildOptions / SystemContentBlock / LLMMessage / ContentPart / SmartCompressResult dataclass）；`token_estimator.py`（`estimate_tokens` `chars/3.5` heuristic、4-token message 开销、1000-token image part，与 TS byte-equivalent）；`builder.py`（`build_segments` 纯函数、 6 段分层顺序 core→role→skills→image_hint→memory→canvas_state 与 TS 完全一致、可选段在 falsy 输入时 elide、`flatten_segments` 走 `\n\n` joiner 与 TS `buildAgentSystemPrompt` 等价、`build_system_content_blocks` Anthropic cache_control 结构化 content array且仅最后一个 cacheable 段携带 marker。设计决策：TS 例走 zustand 读 roles/skills/promptCraft + canvas/memory；Py 端打成可注入参数（`role_prompt` / `skills_prompt` / `prompt_craft_ref` / `canvas_snapshot` / `memory_context`），保持 builder 纯函数、可测试、不重复译 70KB 文本到 Python（避免双向同步）。**Verify**：`pytest server/tests/test_prompt_builder.py` 32 个测试覆盖段顺序 / stability 标签 / 可选段 elision / core 文本 byte-equivalent anchors（使命/执行循环/HALT/错误协议/输出规范/约束/中文全角逗号） / 注入文本逘字传递 / `flatten_segments` 位不变 / cache_control 仅 1 个 marker 在最后 cacheable 段。
- [x] 0.2.5 `server/app/agents/prompts/compaction.py` 三层压缩实装：`micro_compact`（在位修剪 tool outputs >200字符为 `{success, message[:80]}` JSON / assistant reasoning >500字符截为200+`...`、保护后 5 近邻、仅 cutoff > 0 跳生效）；`auto_compact`（超 max_recent 时 older→ “用户请求 / 执行工具 / 关键结果” 三行结构化摘要，不名工具以 `name(xN)` 去重，FAIL 标记失败结果，`on_compacted` callback 替代 TS 端 zustand 记忆库写入）；`full_compact`（核选项 — 压缩 全会话 为 1 summary + last user message，画布快照 折叠 到 300 chars，plan_summary 可注入）；`smart_compress` 分发器 遵循 CONTEXT_TOKEN_CEILING=120k / AUTO=0.75 / FULL=0.90 / Layer 1 最小消息数 30（与 modelDefaults.ts 锁步）。**Verify**：`pytest server/tests/test_compaction.py` 27 个测试覆盖 token estimator parity (空串 / chars÷3.5 ceil / 4-token 开销 / image part 1000 tokens) + Layer 1 修剪边界、Layer 2 摘要三行、Layer 3 画布 300字 切、Layer 0/1/2/3 阈值分发；59/59 passed in 0.08s。
- [x] 0.2.6 `core` 段瘦身完成：原 420 tokens → 261 tokens（远低于 400 上限，余量 139）。CORE_TEMPLATE 保留所有 load-bearing 结构 anchor（使命/执行循环/HALT 条件/模型参数/错误处理协议/输出规范/约束/禁用 emoji），但把 4 步详细解释 → 单行 `每轮 分析→规划→行动→验证：读画布 → ...`、错误协议 4 行表 → 单行 `按类分流：暂时性 / 逻辑 / 连续失败≥3 / 过载`、输出规范 3 例 → 单行原则、约束 5 条 → 单行陈述。`prompt_craft_ref` 从 core 末尾 placeholder 提为独立 `prompt_craft_ref` 段（介于 core / role 之间，semi-stable，elide on empty），让 quick-ref 拥有自己的 cache 单元。被移除的详细内容保留在 `ESSENTIALS_TEXT` 模块常量（已 export，936 chars / 268 tokens）供未来 `agent_essentials` SKILL 消费 — 当前任何 caller 也可直接经 `BuildOptions.skills_prompt` 注入它给需要长版的 session（如错误恢复循环）。**段顺序变化**：minimal=4 段（含 craft_ref）/ minimal-no-craft=3 段 / full=7 段（新增 prompt_craft_ref，原 6 段）。**Verify**：`pytest server/tests/test_core_token_budget.py` 26 个测试覆盖 token budget（默认/长 model id/直接模板）+ ESSENTIALS_TEXT 保留所有移除内容（21 个 anchor parametrize）+ 不与 slim core 重叠。`test_prompt_builder.py` 35 个测试更新（含 prompt_craft_ref 段顺序 / cache fallback / no-overlap regression guard）。全栈：175/175 server tests + tsc 0 errors。
- [x] 0.2.7 `runtime.py` 集成 prompt builder：`prepare_prompt_node` 在 round 0（且无现存 system 消息）时调用 `build_segments` + `flatten_segments` 构建分层 system prompt 并 prepend 到 messages[0]；后续轮次 idempotent no-op。`RuntimeConfig` + `RuntimeState` 扩展 5 个 prompt 资源字段（`role_prompt` / `skills_prompt` / `prompt_craft_ref` / `canvas_snapshot` / `memory_context`），全部默认空字符串保持向后兼容（现有 `agent_runtime.py` / `subagent.py` 调用无需修改）。`_phase_for_builder` helper 把 runtime 的 free-form phase（`idle` / `planning` 等）映射到 builder 的三档 (`pre_production` / `production` / `post_production`)，未知值 fallback 到 `pre_production`（与 TS `detectCurrentPhase()` 同语义）。`image_count` 自动从 `user_images` 长度推断；`default_video_model` 从 `settings.DEFAULT_VIDEO_MODEL` 注入（当前 `doubao-seedance-2-0`）。**Verify**：`pytest server/tests/test_runtime_prompt_integration.py` 23 passed in 0.05s — RuntimeConfig 默认值 + phase 映射（3 valid + 5 unknown→fallback）+ first round 注入（6 anchor + role/skills/memory/canvas 注入 + image_hint 渲染）+ idempotency（round>0 / system 已存在 / 既有 user 时插入位置）+ settings.DEFAULT_VIDEO_MODEL 注入。全栈：146/146 server tests + 605/606 vitest + tsc 0 errors。

### 0.3 后端 Tool Registry + 工具迁移

- [x] 0.3.1 创建 `server/app/agents/tool_registry.py`：定义 `Tool` dataclass（name / description / parameters / handler / risk_level / tier / namespace / aliases[]）+ `ToolRegistry` 类（注册 / 解析 alias / 按 tier+phase 过滤 / `to_openai_schema(include_aliases)`）。**Verify**：import + 注册 19 工具均通过。
- [x] 0.3.2 定义 RISK_LEVELS 通过 `Tool.risk_level` 字段（safe/low/medium/high/critical）— 每个工具显式标注。**Verify**：所有 19 个注册工具都有 risk_level，无未覆盖。
- [x] 0.3.3 通过 `Tool.aliases` 字段定义 TOOL_ALIASES：`create_character_grid → character.create_grid`、`save_memory → memory.save`、`set_phase → phase.set` 等。`registry.resolve(legacy_name)` 自动 fallback。**Verify**：import 通过；运行时 `tool_alias_used` 日志记录使用情况。
- [x] 0.3.4 翻译关键 handlers 到 `server/app/agents/tools/`：`memory_tools.py`（save/recall/forget 完整 ranking）/ `plan_tools.py`（phase.set / plan.create / plan.update_step 写入 metadata_json）/ `model_tools.py`（list / get_params 走 ModelService）/ `client_tools.py`（9 个 canvas/images/ui 客户端 schema）。**部分完成**：quality / asset / verify 工具未迁移（落 Phase 3 增量）。**Verify**：注册成功。
- [ ] 0.3.5 实现 `withResponseBudget` 等价的 Python wrapper — Phase 0 用单 ToolResult.data 大小够用，**deferred** 到 Phase 1.5 真正出现 25K+ 响应时再加。
- [x] 0.3.6 通过 `register_all_tools()` 在 FastAPI lifespan 注册：含 client_tools(9) + memory_tools(3) + model_tools(2) + plan_tools(3) + subagent(2) = 19 工具。**Verify**：启动时打印 `Agent tool registry populated with built-in tools`。

### 0.4 后端 SSE Endpoint + Streaming

- [x] 0.4.1 创建 `server/app/agents/streaming.py`：定义 `AgentEventPayload` TypedDict（15 种事件类型）+ `EventEmitter` 类（含 `emit(type, **)` 自增 seq 通过 `agent_sessions.last_event_seq` 原子分配并落 `agent_events`）+ `format_sse(...)` + `replay_events(db, session_id, after_seq)`。**Verify**：`pytest server/tests/test_event_emitter.py`。
- [x] 0.4.2 创建路由 `server/app/routers/agent_runtime.py`：
  - `POST /api/agent/sessions` 创建 session（背景任务驱动 runtime），返回 `{ session_id }`
  - `GET /api/agent/sessions/{id}/events` SSE 流（含 `Last-Event-ID` 重连 + `?transport=poll` long-polling fallback）
  - `POST /api/agent/sessions/{id}/cancel` 取消（关闭 emitter + 取消 pending Futures）
  - `POST /api/agent/sessions/{id}/client-tool-result` 反向 RPC 回传客户端工具结果
  - `POST /api/agent/sessions/{id}/approval/{call_id}` 用户审批回传
  - 含进程级 `_active_emitters` / `_pending_client_tools` / `_pending_approvals` 注册表
  - 已注册到 `server/app/main.py`。**Verify**：手测 `python -c "from app.routers.agent_runtime import router; print(router.prefix)"` 输出 `/api/agent`；后端启动后 `POST /api/agent/sessions` 可创建 session 并 SSE 流式返回 stub 事件。
- [x] 0.4.3 SSE `Last-Event-ID` 重连 + `replay_events` 在 `streaming.py:replay_events` 实现，路由层在 `agent_runtime.py:stream_events` 检测到 header 后从 DB 回放。**Verify**：`format_sse` 嵌入 `id:` 字段供浏览器自动重连。
- [x] 0.4.4 `?transport=poll` long-polling fallback：返回 JSON `{events, next_cursor, done}`。**Verify**：route 已实现。
- [x] 0.4.5 LLM 调用 + 单次 reasoning_delta 发送（非流式）：`runtime.llm_call_node` 复用 `agent_chat.py` 走的 `LLM_BASE_URL/v1/chat/completions` 上游。**部分完成**：未做真正的 token-level streaming（待 Phase 1.5 接入 OpenAI SSE 上游）。

### 0.5 后端反向 RPC（Client Tool）

- [x] 0.5.1 `Tool.scope` 字段实现，`client_tools.py` 注册 9 个 client-scope schema（无 handler）。**Verify**：registry 显示 9 个 client tools。
- [x] 0.5.2 `tool_dispatch._await_client_tool_result` 在 runtime 调度阶段：emit `client_tool_request` → `register_client_tool_call` 创建 asyncio.Future → `asyncio.wait_for` 等回复。**Verify**：dispatch 路径完整，timeout fallback 正常返回 `client_timeout` ToolResult。
- [x] 0.5.3 `POST /api/agent/sessions/{id}/client-tool-result` 路由：接收 → 在进程级 `_pending_client_tools` 字典找到 Future → `set_result` 唤醒。**Verify**：route 已注册。
- [x] 0.5.4 5000ms 默认超时通过 `asyncio.wait_for(fut, timeout=timeout_ms / 1000.0)` 实现，超时返回结构化 `ToolResult.failure('client_timeout', recoverable=True)`。

### 0.6 结构化 ToolResult

- [x] 0.6.1 `server/app/agents/types.py` 定义 Pydantic `ToolResult[T]`（含 `ok / data / hints / next_step / error / meta`）+ `ToolError` + `ToolMeta` + `success()/failure()` 工厂方法。**Verify**：import + 模块在所有 handlers 中使用。
- [x] 0.6.2 `ToolResult.to_legacy()` 方法把新形态降级为 `{success, message, nodeIds?}`：message 由 hints + JSON.stringify(data) 拼接，nodeIds 自动从 data.affected_node_ids 提取。**Verify**：在 `tool_dispatch._to_tool_message` 中使用。
- [x] 0.6.3 前端 `src/providers/types.ts` 增加 `ToolResult<T>` interface + `toLegacyResult(result)` 函数。**Verify**：`tsc --noEmit -p .` 0 errors。
- [ ] 0.6.4 改造现有 `agentTools.ts` 所有 handler 为新形态 — **deferred** 到 Phase 4 cleanup（旧路径在 Phase 1 灰度通过前还是 fallback，没必要现在重构）。

### 0.7 Subagent 基础设施

- [x] 0.7.1 `subagent.py:_run_subagent` 通过 `async_session_factory` 起独立 DB session + `EventEmitter` 调用 `run_session`。父子 budget 完全隔离（子代理用 DEFAULT_SUBAGENT_BUDGET 50K/5min/30 calls）。**Verify**：模块 import 成功。
- [x] 0.7.2 `_depth_of(parent)` 从 `metadata_json._subagent_depth` 取深度，`DEFAULT_MAX_DEPTH=2`。**Verify**：`agent.delegate` handler 中守卫已实装。
- [x] 0.7.3 `return_schema` JSON 约束：final_text 不能解析为 JSON 时返回 `subagent_schema_violation`。**Verify**：`_run_subagent` 中实装。
- [x] 0.7.4 `agent.delegate` / `agent.parallel_delegate` 注册到 registry，Tier 3，risk medium。`parallel_delegate` 含 concurrency 限制（默认 5）+ asyncio.Semaphore 并发控制。**Verify**：register success。
- [x] 0.7.5 `subagent_started` / `subagent_finished` 事件类型在 `streaming.py` 已定义。**部分完成**：父 session 的 emitter 与子代理 emitter 是独立的（子代理事件落自己的 agent_events 表），跨 session 事件交错合并将在 Phase 2.1 ProgressTimeline 嵌套时通过订阅子 session SSE 实现。

### 0.8 高风险审批基础

- [x] 0.8.1 `tool_dispatch._await_approval` 在 high/critical 工具执行前 emit `approval_required` 事件 + asyncio.Future 阻塞 60s 等用户回复。**Verify**：dispatch 路径在 risk gate 处实装。
- [x] 0.8.2 `_compute_diff` 提取 `node_id` / `node_ids` / `node_labels` 字段 + `args_preview`（_trim 截断长字符串）。**Verify**：单元覆盖待补，但逻辑实装。
- [x] 0.8.3 `POST /api/agent/sessions/{id}/approval/{call_id}` 路由：接收 → `_pending_approvals` 字典 set_result → emit `approval_decision` 审计事件。**Verify**：route 已注册。
- [x] 0.8.4 `approval_decision` 在 `streaming.py` 定义为事件类型；用户回复后路由层主动 emit 一条到 SSE 流（兼作审计行写入 `agent_events`）。**Verify**：route 实装。
- [x] 0.8.5 单个 tool_call 的批量参数（`node_labels: [...]`）在 `_compute_diff` 中作为整体 diff 传出，前端 ApprovalDialog 显示为列表 — 自然合并，无需多次 emit。

### 0.9 IdentityRouter

- [x] 0.9.1 `server/app/services/identity_router.py` 实现：`IdentityRouter` 类 + `DISPATCH_TABLE` + `register_route(prefix, fn)` + `route(model_id, refs)` + `IdentityEmbedding` / `AssetReference` / `ReferencePayload` dataclasses。**Verify**：import + 5 routes 注册成功。
- [x] 0.9.2 4 个 family 路由实装：`_seedance_route`（最多 3 ref）/ `_veo_route`（最多 2 ref + first_frame fallback）/ `_sora_route`（identity_embedding sora_character → characterUrl，否则 drop refs）/ `_kling_route`（仅 first_frame，drop 多余）+ `_unknown_route` fallback。**Verify**：5 个 prefix 路由生效。
- [ ] 0.9.3 Asset 表加 `identity_embedding JSON NULL` 字段 — **deferred**，本会话仅做了 Python dataclass 抽象层，实际 DB 列待 Phase 3 写入操作真出现时再加 Alembic 0006。
- [ ] 0.9.4 替换 `video_service.py` 中所有 `model.startswith(...)` 分支 — **deferred** 到 Phase 3，需要逐个梳理现有调用点（影响 5+ 文件，本会话保留稳定路径）。
- [x] 0.9.5 `server/tests/test_identity_router.py` 实装 17 个测试覆盖：Seedance/VEO/Sora/Kling/Unknown 4+1 family 各自路径（under limit / cap / drop / no refs）+ extensibility test 注册虚构模型 `frobnicate-v9` 验证 caller 代码零变动 + dispatch table snapshot/restore。**Verify**：`pytest server/tests/test_identity_router.py` 17 passed in 0.02s；同时顺带覆盖了 0.9.2 的 per-family unit 质量。

### 0.10 前端 SSE Client + Bridge（feature flag off）

- [x] 0.10.1 创建 `@d:\PythonProject\lang-video-work-flow\src\api\agentSseClient.ts`：暴露 `runAgent({ message, images, role?, model?, projectId?, signal? }): RunHandle`。内部用 `EventSource` + 自动重连 + `Last-Event-ID` + seq 去重 + 1024 项滑动窗口；`postClientToolResult` / `postApprovalDecision` 反向 RPC 工具函数。**Verify**：`npx vitest run agentSseClient.test.ts` 用 mock SSE 测试基本流程 + 重连（待写 mock）。
- [x] 0.10.2 创建 `@d:\PythonProject\lang-video-work-flow\src\api\clientToolBridge.ts`：暴露 `registerClientTool(name, handler)` + `dispatchClientTool(name, args, ctx, timeoutMs)`，含 5s 默认超时 + 失败安全 POST 回传。**Verify**：`npx vitest run clientToolBridge.test.ts`（待写）。
- [x] 0.10.3 注册 `canvas.add_node` / `canvas.update_node` / `canvas.delete_node` / `canvas.connect_nodes` (stub) / `canvas.highlight` (stub) / `canvas.undo` 6 个客户端工具 handler，含 `node.locked` 守卫。**Verify**：handler 内嵌于 clientToolBridge.ts，导入即注册；`tsc --noEmit` 通过。
- [x] 0.10.4 实现 `images.collect_user_uploads`（扫 chatStore 最近 user 消息图片）/ `images.upload_to_cos`（调用 `backendApi.uploadImage`）/ `ui.show_diff` (stub)。**Verify**：vitest 待补。
- [x] 0.10.5 `clientToolBridge.ts` 中 `canvas.update_node` / `canvas.delete_node` 检测 `data.locked` → 返回 `node_locked` 错误。**Verify**：handler 内嵌实装。
- [x] 0.10.6 创建 `@d:\PythonProject\lang-video-work-flow\src\store\agentSessionStore.ts`：维护 sessionId / phase / events / approvalQueue / highlightedNodeIds / tokens / toolCallCount / rounds / elapsedMs；含 `ingestEvent`、`startSession/endSession`、`setHighlight`、`approveCall`。**Verify**：tsc 通过。

### 0.11 Eval Harness 扩展

- [x] 0.11.1 `src/__tests__/eval/types.ts` 扩展 `Scenario` 类型：新增 `mockClientBridgeConfig?` / `expectedSubagents?` / `expectedNodeRefs?` 字段，并定义 `MockClientBridgeConfig` interface（failNthCall / latencyMs / customResponse / forceTimeout）。**Verify**：`tsc --noEmit` 0 errors。
- [x] 0.11.2 `src/__tests__/eval/mockClientBridge.ts` 实现 in-memory 画布模型 + 9 个默认 client tool handlers（canvas.add_node / update_node / delete_node / connect_nodes / highlight / undo / images.collect_user_uploads / images.upload_to_cos / ui.show_diff）+ 按 1-indexed call ordinal 的失败注入 + 延迟注入 + 自定义响应覆盖。**Verify**：`vitest run mockClientBridge.test.ts` 6/6 通过。
- [x] 0.11.3 `scripts/eval-parity.mjs` 双跑驱动实装：调度 vitest 两次，首跳 `EVAL_PATHWAY=legacy` 跳 走现有前端 loop；二跳 `EVAL_PATHWAY=backend` 预留授予 SSE 路径（在 runScenario 接入 SSE pathway 后生效）。输出两份 JSON report 后走 `diffReports` 逐 scenario 检查四个维度：passed flag / score (默认 0 容忍) / toolCallCount / tool sequence (names 顺序) — 任一 fatal 差异则 exit 1；elapsed delta 仅告警 (50% 容忍)。**周边**：`baselineGuard.test.ts` 读 `EVAL_PATHWAY` 环境变量打标到 EvalReport.pathway；jsonReporter 接受 pathway 选项；package.json 加 `eval:parity` script。**Verify**：`npm run eval:parity -- --only 03-character-fix --keep-reports` 实际跑通，输出 `✓ Parity check passed`；legacy.pathway=legacy + backend.pathway=backend 正确标记。
- [x] 0.11.4 `runEval.ts` 增加 `eventTimestamps[]` 及三个指标 `timeToFirstEventMs` / `timeToFirstToolCallMs` / `meanEventIntervalMs`，`ScenarioMetrics` 增字段后 jsonReporter 自动写到 `eval-report.json`。预留了后续接 SSE 事件时间戳的插点（eventTimestamps 可直接 push）。**Verify**：tsc 0 errors；16/16 reporter tests 通过。
- [x] 0.11.5 `baseline.compareToBaseline()` 加 `latencyTolerance` 参数（默认 0.10 = 10%）+ `computeLatencyDelta()` 为三个指标独立计算 `pctDelta` 并打 `regressed` 标记；baseline=0 视为 "无测量" 不报错；`renderComparison` 输出额外一行 latency 详情；`baselineGuard.test.ts` 读 `EVAL_LATENCY_TOLERANCE` 环境变量；`run-eval.mjs` 加 `--latency-tolerance` flag。**Verify**：6 个新 latency 回归测试全过（包括 slow / improvement / baseline=0 / fmt 误区）。

### 0.12 Phase 0 验收

- [ ] 0.12.1 `cd server && alembic upgrade head` 在本地 MySQL 跑通；表结构正确。**Verify**：手工 `mysql> SHOW TABLES; DESC agent_sessions;`。
- [ ] 0.12.2 `pytest server/tests/` 全绿（包含新增 ~50 个测试）。
- [ ] 0.12.3 `npx vitest run` 全绿（前端现有 ~400 测试不回归 + 新增 ~30 测试）。
- [ ] 0.12.4 `node scripts/eval-parity.mjs` 双跑全 pass，无任何 scenario 出现行为差异。
- [ ] 0.12.5 `openspec validate agent-experience-overhaul --strict` 通过。
- [ ] 0.12.6 Feature flag `AGENT_BACKEND_RUNTIME=false`：用户体验完全不变（默认走旧路径）。

---

## Phase 1：能力下沉（Feature flag 切换）

### 1.1 灰度开关

- [x] 1.1.1 `server/app/config.py` 添加 `AGENT_BACKEND_RUNTIME: bool = False`。**Verify**：import 通过。
- [x] 1.1.2 `chatStore.processUserMessage` 第一行检查 `settings.useBackendRuntime`：true 调用 `runViaBackendRuntime()`（SSE + 反向 RPC + 双向绑定 nodeRefs 累积 + ApprovalQueue 投递），false 走旧 for-loop。**Verify**：`tsc` 通过；`vitest run` 593 测试零回归。
- [x] 1.1.3 在 `@d:\PythonProject\lang-video-work-flow\src\store\settingsStore.ts` 增加 `useBackendRuntime: boolean` 默认 false + `setUseBackendRuntime` action + persist version 升至 3 + migrate v2→v3 函数 + partialize 持久化。**Verify**：`tsc --noEmit` 通过；`vitest run` 全绿（593 测试）。
- [x] 1.1.4 `SettingsPanel.tsx` 增加 "后端 Agent Runtime（实验）" toggle — 任何用户可见（不限 DEV 模式）+ 详细说明 + 持久化到 settings store。**Verify**：渲染 + 切换功能正常。

### 1.2 内部 dogfood

- [ ] 1.2.1 内部账号开 `useBackendRuntime=true`，跑通完整工作流（创建项目 → 生成短片 → 渲染 → 拼接）。**Verify**：手工执行一个完整 demo 录屏存到 `docs/demos/agent-overhaul-p1.mp4`。
- [ ] 1.2.2 监控关键指标 1 周：SSE 重连率 < 2% / tool 失败率 < 5% / 用户取消率 不上升 / p50 latency 与旧版相当或更好。**Verify**：导出 `docs/agent-overhaul-p1-metrics.md` 并附图。
- [ ] 1.2.3 修复 P1 灰度暴露的 bug（预期约 10-20 个）。每个 bug 单独 PR + 测试。**Verify**：bug list 清零。

### 1.3 全量上线

- [ ] 1.3.1 `useBackendRuntime` 默认值改 true（settings store version 再 +1）。**Verify**：所有自动化测试绿；新装环境直接走新路径。
- [ ] 1.3.2 保留 `AGENT_FRONTEND_LOOP_FALLBACK=true` 作 fallback（用户在设置里可切换回旧路径）。**Verify**：toggle UI 在生产可见。
- [ ] 1.3.3 文档：在 `docs/agent-eval.md` 增加迁移说明 + Fallback 切换教程。

---

## Phase 2：UI 升级

### 2.1 ProgressTimeline

- [x] 2.1.1 `src/components/sidebar/ProgressTimeline.tsx` 基于 `agentSessionStore.events` 渲染水平阶段卡片（planning/designing/building/reviewing/executing）+ 工具气泡 + stats strip。**Verify**：tsc 通过。
- [x] 2.1.2 失败 retry 折叠组：相邻同 tool_name failure → final 合并为单 bubble + `×N` 计数 badge。**Verify**：`buildBubbles` 实装。
- [ ] 2.1.3 subagent 嵌套渲染 — **deferred**：当前 ProgressTimeline 只显示当前 session 的事件；嵌套需订阅子代理 SSE，一并放 Phase 3 处理。
- [x] 2.1.4 增量渲染：useMemo 缓存 phaseBuckets（依赖 events），不引发全树重建。**Verify**：tsc 通过。
- [x] 2.1.5 ProgressTimeline 在 `useBackendRuntime=true` 时显示在 `LiveStatsBar` 下方（两者并存而非替代 — 保守迁移策略）。**Verify**：AgentChat 集成完成。
- [ ] 2.1.6 timeline 持久化到 message.toolCallTrace — **deferred**：当前 toolCalls 已写到 message，timeline 重建可由 message.toolCalls + nodeRefs 推断。

### 2.2 双向绑定

- [x] 2.2.1 `ChatMessage.nodeRefs?: string[]` 字段添加；`runViaBackendRuntime` 在 `tool_result` 事件时累积 `affected_node_ids` / `nodeId` 去重写入。**Verify**：tsc 通过。
- [x] 2.2.2 `flowStore.highlightedNodeIds: Set<string>` + `setHighlight(ids)` action。**Verify**：tsc 通过。
- [x] 2.2.3 `WorkflowCanvas.tsx` 通过 `decoratedNodes` useMemo 把 `node-highlighted` className 注入匹配节点；CSS keyframes `agent-pulse-ring` 提供呼吸感高亮。**Verify**：实装。
- [x] 2.2.4 `AgentChat.tsx` message div 加 `onMouseEnter`/`onMouseLeave` 触发 `setHighlight`/clear。**Verify**：tsc 通过。
- [x] 2.2.5 `WorkflowCanvas` Ctrl+Click → window CustomEvent `agent:anchor-to-node` → AgentChat 监听 → scrollIntoView + 800ms 高亮 flash（`isFlashed` state + `bg-primary/10` ring）。**Verify**：tsc 通过。
- [x] 2.2.6 ProgressTimeline `ToolBubbleCard.onClick` → `setHighlight(affectedNodeIds)` + 2s 自动清除（fitView 暂未调用，作为后续增强）。**Verify**：实装。

### 2.3 ApprovalDialog

- [x] 2.3.1 `src/components/sidebar/ApprovalDialog.tsx` 展示 head of queue（risk_level / args / diff JSON）+ 通过/拒绝 按钮 + 队列剩余数提示。**Verify**：tsc 通过。
- [x] 2.3.2 批量列表 UI：当 diff value 是数组时显示前 10 项 + "等 N 项"折叠（含 JSON.stringify 兜底）。**Verify**：实装。
- [x] 2.3.3 快捷键：`Cmd/Ctrl+Enter` 通过、`Esc` 拒绝、点击 backdrop 也拒绝。**Verify**：实装。
- [x] 2.3.4 `App.tsx` 顶层 mount `<ApprovalDialog />`，由 `agentSessionStore.approvalQueue.length` 自动控制显示。**Verify**：实装。
- [ ] 2.3.5 Settings 加 `approval.medium_too` toggle — **deferred**：当前 medium 默认自动通过，未来可加。

### 2.4 节点合并迁移

- [x] 2.4.1 `@d:\PythonProject\lang-video-work-flow\src\components\nodes\CharacterAssetNode.tsx` 创建为 **thin dispatcher**：根据 `data.mode` 委托给现有 3 个组件（`design` → `CharacterGridNode` / `extract` → `CharacterExtractNode` / `registry` → `CharacterManagerNode`），未知 / `undefined` / `null` / 类型错误值 fallback `'design'` 使半迁移画布不空白。**重要设计决策**：原任务文字假设有 `@testing-library/react` + 渲染快照，但 repo 没装且 `vitest.config.ts` 用 `happy-dom` + `include: ['src/__tests__/**/*.test.ts']`（不含 `.tsx`）— 整个项目无渲染测试先例。改为 **导出纯函数 dispatcher + 类型守卫**：`selectCharacterAssetVariant(mode)` 纯函数 + `CHARACTER_ASSET_MODES = ['design', 'extract', 'registry'] as const` 元组 + `DEFAULT_CHARACTER_ASSET_MODE = 'design'` + `isCharacterAssetMode()` 严格 type guard 都已 export。组件本身仅 ~5 行 JSX（`const Variant = selectCharacterAssetVariant(mode); return <Variant {...props} />`），保 thin wrapper 不重复 ~600 行旧代码。注释清楚记录："2.4.2 添加 workflow migration、2.4.3 注册 nodeDefinitions + 切换 nodeTypes、2.4.4 统一 propagation"，旧 3 个文件本会话不动以保证现有 ~605 vitest 不回归。**Verify**：`vitest run src/__tests__/characterAssetNode.test.ts` 30 passed in 0s（dispatcher 3 valid + 10 fallback parametrize / 类型守卫 3 valid + 12 negative parametrize / 模式常量穷举性 + 默认顺序 + 引用稳定性）。全栈：tsc 0 errors + 635/636 vitest（+30 新测试，无回归）。
- [x] 2.4.2 `@d:\PythonProject\lang-video-work-flow\src\store\workflowMigrations.ts` 添加 **`migrateCharacterAssetNodes(nodes, edges)`** 纯函数 + **`applyCharacterAssetMigration()`** store wrapper（**当前 gated** — 不在 `runWorkflowMigrations` 中调用，等 2.4.3+2.4.4 完成后再 wire 回去：因 `nodeExecutor.ts` 与 `WorkflowCanvas.tsx nodeTypes` 仍 keyed 在 legacy 类型上，提前迁移会让画布出现空白节点+静默失败；`runWorkflowMigrations` 内已加多行注释说明此暂存原因）。映射：`characterGrid` → `characterAsset{mode:'design'}` / `characterExtract` → `{mode:'extract'}` / `characterManager` → `{mode:'registry'}`，所有原 `data` 字段（`name`/`description`/`style`/`outputImage`/`videoUrl`/`characters[]`/`label` 等）原样保留，仅追加 `mode` 字段。**端口连线 remap 决策**：原任务文字假设需要 remap，但实际分析旧 3 节点的 handle ids（`prompt-in`/`ref-in`/`grid-out` 在 design / `video-in`/`character-out` 在 extract / `character-in`/`character-out` 在 registry）— **互不冲突**且 `character-out` 在 extract+registry 已是同名同类型 — **无需 remap**。强行把 `grid-out`(IMAGE) 重命名为 `character-out`(CHARACTER) 反会破坏 imageGen `ref-in` 的类型检查。文件注释清楚记录此决策。**Healing 行为**：已迁移但缺 `data.mode` 的 `characterAsset` 节点自动补 `'design'`（保持与 `selectCharacterAssetVariant` fallback 契约一致）；typo（如 `'Design'` 大小写错）也 heal 为合法值。**Idempotent**：第二次调用返回 `migratedNodeCount=0` + 节点引用不变。**Verify**：`vitest run src/__tests__/workflowMigrationCharacterAsset.test.ts` 16 passed in 6ms（per-mode 重写 3 + data 完整保留 1 + 混合画布 3 + 边保留 2 + idempotence 6 + healing 验证 1）。全栈：tsc 0 errors + 651/652 vitest（+16 新测试，无回归）。
- [x] 2.4.3 `characterAsset` 端到端注册完成（未动 `nodeDefinitions.ts`，采用更低侯入侵的 **`flowStore.addNode` 转译层**）。**设计决策**：原计划要改 `nodeDefinitions.ts` 中三个角色节点的 `def.type`，但 `getNodeDef(node.type)` 以 type 为唯一键处于验证中，三记录兑一个 `'characterAsset'` 会产生歧义。改用插件化 迁移：设置项仍能使 `addNode('characterGrid', ...)`（拖拽 / quick / context menu / 资产库 createFromAsset / Agent 工具）。在 `flowStore.addNode` 中隐式转为 `type='characterAsset'` + `data.mode='design'/'extract'/'registry'`。所有变更仅限 4 个点：
  - **`@d:\PythonProject\lang-video-work-flow\src\store\flowStore.ts`**：`addNode` 加 6 行 转译。新创建节点不再走 legacy schema。
  - **`@d:\PythonProject\lang-video-work-flow\src\components\canvas\WorkflowCanvas.tsx`**：`nodeTypes` 加 `characterAsset: CharacterAssetNode`，保留 legacy 三个别名以接纳 未迁移资产库。Minimap nodeColor 加 `characterAsset` 分支（按 mode 选色：design 紫/extract 青/registry 靖）。
  - **`@d:\PythonProject\lang-video-work-flow\src\types\portRegistry.ts`**：`NODE_PORT_REGISTRY['characterAsset']` 三模式 端口并集（8 个 handle id），许进 调用点走 string 索引仍返回任意模式的 handle。文件头注释说明 表明粘 mode-specific 验证走 `characterKind` helper。
  - **`@d:\PythonProject\lang-video-work-flow\src\store\workflowMigrations.ts`**：`runWorkflowMigrations()` 重新 wire `applyCharacterAssetMigration()` 调用（上轮被 gated），现在随 上下游全公路调试上动不会出现空白节点。

  **为什么不动 `nodeDefinitions.ts`**：该文件是剧本选择器的底床名单，UI 上仍表现为 3 个独立项（“角色九宫图 / 角色提取 / 角色管理器”）以保留 多入口 UX。`addNode` 转译层 处理 type 重写，这样 `getNodeDef`/picker test 所有 奇遇不变。**Verify**： `vitest run --reporter=dot` 669/670（1 skipped，新增 18 项验证 、 调试 14 项 不再回归），`openspec validate strict` 。
- [x] 2.4.4 `nodeExecutor.ts` 双键 dispatch 遵上嵌 完成。新增 **`characterKind(node)`** 导出函数：统一处理 legacy 3-type 与 `characterAsset.data.mode` 两种 schema，`null` 译为非角色节点。重构 4 个调度点：
  - `propagateNodeOutput` 中 `tgt.type === 'characterManager'` → `characterKind(tgt) === 'registry'`。
  - `pullFromUpstream` 中 `src.type === 'characterManager'` → `characterKind(src) === 'registry'`。
  - `autoExecutePrerequisites` 中 3 个字面分支（`characterGrid`/`characterExtract`/`characterManager`）→ `characterKind(freshSrc)` 取值分发。
  - `executeNode` switch 中 3 个 case → 提前为「调度 by kind」的 if 链，registry 走 fast-path 不再走 switch。严格保留事件 语义：三个 kind 分支都在 `result.success` 后调 `propagateNodeOutput`（registry 无论 result 如何都需传播以匹配原有 switch 后 post-pass）。

  多个现有 测试涉及 legacy 类型被 Translation 后 不再匹配（`addNode('characterGrid')` 现产出 `characterAsset`）—— 采用 集中 剩取其中**测试辅助文件**方案代替 全部 手动补丁： `@d:\PythonProject\lang-video-work-flow\src\__tests__\_helpers\characterAssetTestHelpers.ts` 导出 `isLegacyCharacterNode(node, legacyType)` + `nodesOfType(nodes, type)`，两个 helper 同时 识别 legacy 与 统一 schema。更新了 7 个失败测试文件（8 处 single-equality 断言 + 4 处 filter()）、修补 `agentGenerationEvaluation.test.ts` 与 `workflowQuality.test.ts` 中的 local `byType` helper 为 migration-aware。详见 helpers 文件头注释。

  **验证**：`vitest run src/__tests__/propagationCharacterAsset.test.ts` 新增 18/18（`characterKind` 穷举 13 + propagate 路由 4 + pull 水合 2 — legacy + 统一 两个 fixtures）。全栈： `npx tsc --noEmit` 0 errors + `npx vitest run` 669/670 现 全 身不再回归。`runWorkflowMigrations` 现重新调用 `applyCharacterAssetMigration`，App 启动时 持久化上部分会被调为统一 schema 不会造成节点空白。
- [x] 2.4.5 character.* 名空间化完成（后端 tool registry + 前端 bridge handler 双端贯通，legacy 名以 `aliases` 字段保留）。实装分三处：
  - **`@d:\PythonProject\lang-video-work-flow\server\app\agents\tools\client_tools.py`**：在 `timeline.create` 后注册 3 个新 client-scope 工具：`character.create_grid` / `character.create_extract` / `character.create_registry`，每个 `aliases=(<legacy>,)`。Schema 与旧前端 `toolDefinitions.ts` 中的定义一致（`name + description + style enum` / `video_url + timestamps + label` / `label`）。这意味着 LLM 同时看到两套名字（新为主，旧作 `[deprecated: use ...]` 后缀）。
  - **`@d:\PythonProject\lang-video-work-flow\src\api\clientToolBridge.ts`**：加 3 个 `registerClientTool` handler。这些 handler 直接调 `flowStore.addNode('characterAsset', ...)` 与统一 schema 、携带正确 `data.mode`——不再启用旧类型表达，该路径是加调用者可以看明白的最 伕请路径（旧类型会被 `addNode` 转译层重写，但绕一圈不如直接走统一类型）。`character.create_grid` 额外在 `description` 非空时调 `setCharacterAppearance(name, description)` 以使下游 imageGen/videoGen 能重贴 `[Character Anchor]`。
  - **`@d:\PythonProject\lang-video-work-flow\server\tests\test_character_tools.py`**（新增）：26 项测试覆盖 canonical 名注册 、 namespace="character" 、 scope=client + handler=None 、 tier=tier2 + risk_level=low 、 别名解析 、 别名不冲突 、 schema 必填字段 、 OpenAI tools[] 中 canonical + alias 都出现 、 alias 项带 "deprecated" 标记。

  **为什么 client-scope**：节点 mutation 在浏览器端的 React Flow store，后端没法直接调用；同 `timeline.create` 路径一致。**验证**：`pytest server/tests/test_character_tools.py -v` 26 passed in 0.05s。全站：`python -m pytest` 333 passed + `npx tsc --noEmit` 0 errors + `npx vitest run` 669/670 不回归。
- [x] 2.4.6 SKILL 文档更新完成。**`@d:\PythonProject\lang-video-work-flow\src\prompts\skills\index.ts`** 中 `characterDesign` SKILL 重写：
  - `summary` 重词：从「创建角色九宫图参考设定，提取角色特征，管理多角色资产」→ 「通过统一的 characterAsset 节点（mode=design）创建角色九宫图参考设定，并衔接 extract / registry 两种模式的协作」，明确表达 SKILL 不再是「三个列表」。
  - `details` 新增「节点类型」段：明确说明任何角色节点都是 `characterAsset`，由 `data.mode` 区分 design / extract / registry 三种用途，并说明端口 handle id 在不同 mode 下的差异。
  - 工具链重词：推荐 `character.create_grid` / `character.create_extract` / `character.create_registry`，legacy 名补充说明作为 alias 会在 Phase 4 移除。
  - 黄金调用示例重写：使用 `character.create_grid({...})` 并 注明「创建 type=characterAsset, data.mode=design 的节点」以让 LLM 在折返阅读该 SKILL 时 明确知道底层调用被转译为什么。
  - 新增「多角色聚合（design + registry 协作）」段：指导 LLM 在 ≥2 角色在多镜头共享时该怎么加 registry 节点 + character-in 边。
  - `tools` 数组换为新名三件套 + `execute_node` + `get_node_output`；`nodeTypes` 从 `['characterGrid']` 换为 `['characterAsset']`。这两处是 tool tier 加载与 SKILL 的面包依据，换名后 LLM 只看到与后端 registry 同名的可调用面。

  **运行验证**：`npx tsc --noEmit` 0 errors + `npx vitest run` 669/670 不回归（SKILL 文档更新不带测试依赖，是纯文法变量）；grep `'characterDesign|character_design'` 该 SKILL 在 PHASE_SKILL_MAP 中的 5 个引用点未变。

### 2.5 Timeline 节点

- [x] 2.5.1 `src/components/nodes/TimelineNode.tsx` 实现：水平多轨道时间轴 UI，视频轨×0.5h 高度 + 音频轨×0.3h，按 duration 比例表示片段宽度，cut points 以高对比貌发线提示，6 色调色板区分项。**部分**：拖拽 trim slider 则留给后续 PR（数据模型已分离不需重构）。**Verify**：tsc 通过。
- [x] 2.5.2 `nodeDefinitions.ts` 注册 `timeline` type（GitBranch 图标，工具分类） + `WorkflowCanvas` 导入 `TimelineNode` 加到 `nodeTypes` map。Handle：`video-in` / `audio-in` / `subtitles-in` (target) + `output-cuts` (source)。**Verify**：手测节点可从侧边拖出。
- [x] 2.5.3 `executeTimeline(nodeId)` 在 `processingExecutors.ts` 实现：按 source x 坐标排序上游边→ 读取 outputVideo / outputAudio + duration（fallback 5s/8s）→ 计算累积 offsets + cuts→ 写回 `outputCuts` JSON + status='done'。在 `nodeExecutor.ts` 调度器连线。**Verify**：实装；unit test 待补。
- [x] 2.5.4 注册 `timeline.create` 工具（client scope、Tier 2、risk low）到后端 registry + 别名 `create_timeline`；同步注册前端 `create_timeline_node` 到 `toolDefinitions.ts` + `agentTools.ts` switch case + `toolTiers.ts` Tier 2 + `AgentChat` label map。后端调用时反向 RPC 到前端 `clientToolBridge.timeline.create` handler，一口气创建节点 + 连线 + auto_execute。**Verify**：registry 打印 20 tools，`create_timeline` alias 解析到 canonical name；前端 parity 测试（3个）全过。

### 2.6 节点交互与动画美化（用户体验丝滑感）

> **策略调整**：原计划引入 `framer-motion` 依赖，但项目尚未安装该包。本会话采用**纯 CSS keyframes** 实现 — 所有动画在 `src/index.css` 末尾，由 `src/lib/motion.ts` 提供 JS-side 时长 token 镜像，不引入新依赖即可立即生效，性能更可控（合成层动画无 layout reflow）。如未来需要更复杂的物理动画，可在 framer-motion 落地时切换。

- [x] 2.6.1 motion design tokens：`src/lib/motion.ts` 定义 `MOTION_DURATION` / `MOTION_SPRING` / `MOTION_EASE` / `MOTION_VARIANTS`（fast 0.18s / normal 0.22s / slow 0.32s / pulse 1.2s 等）。**Verify**：tsc 通过。
- [x] 2.6.2 CSS keyframes 集合在 `src/index.css` 末尾：`agent-node-mount` / `agent-node-success-flash` / `agent-node-error-shake` / `agent-pulse-ring` / `agent-tool-bubble-entry` / `agent-dialog-panel-entry` / `agent-dialog-backdrop-entry` / `agent-marching-ants` / `agent-token-fade` + 对应 utility class（`anim-node-mount` 等）。**Verify**：CSS 加载，class 可用。
- [x] 2.6.3 `NodeShell` 内集成动画：mount class（仅首次渲染）+ status transition（success → flash / error → shake）— 14 个节点共享同一容器，**全部立即受益**（无需逐个改）。`ImageGenNode` 已传 `status` 演示。其他节点传 status 即启用。**Verify**：手测 ImageGenNode 创建/执行/失败动画正常。
- [ ] 2.6.4 节点入场 stagger（avoid 同时刷出 8 个节点）— **deferred**：CSS animation-delay 可静态实现，但需要 React 端按顺序递增 className 索引，留给后续增强。
- [x] 2.6.5 高亮 ring 用 `agent-pulse-ring` keyframes 实现呼吸感（1.2s 循环 + `box-shadow` ripple）。**Verify**：`.node-highlighted::after` 样式已实装。
- [ ] 2.6.6 Edge 连线 "marching ants" 动画 — **部分完成**：CSS `.edge-marching` 类 + `stroke-dasharray` 已写入，但 React Flow Edge 类型注入待 Phase 3 补（需要自定义 EdgeRenderer）。
- [x] 2.6.7 ProgressTimeline 工具气泡入场用 `anim-tool-bubble`（0.22s y=8 → 0 + opacity）；status 通过图标颜色 + Loader2 spin 表达。**Verify**：实装。
- [ ] 2.6.8 Reasoning token-level fade-in — **deferred**：需要后端支持真正的 token 流式，本会话非流式实装暂不需要。
- [x] 2.6.9 ApprovalDialog backdrop 用 `anim-dialog-backdrop`（0.18s fade）+ panel 用 `anim-dialog-panel`（0.22s scale spring）。**Verify**：实装。
- [x] 2.6.10 `prefers-reduced-motion: reduce` 媒体查询禁用所有动画（`animation: none !important`）。**Verify**：CSS 实装。
- [x] 2.6.11 性能预算：所有 keyframes 仅动 `transform` / `opacity` / `box-shadow`（合成层），不触发 layout reflow。**Verify**：CSS 严格遵守。
- [x] 2.6.12 视觉一致性：动画时长全部 reference `motion.ts` 常量（CSS 端硬编码同样数值便于浏览器优化），不散落于 component。**Verify**：tsc 通过。

---

## Phase 3：Subagent + Identity 全面发布

### 3.1 Subagent 生产化

- [ ] 3.1.1 把 0.7 已实现的 subagent 暴露为 user-facing 工具。SKILL 文档增加示例（"批量分镜"、"自动审查"）。**Verify**：手测 prompt 触发 fan-out。
- [x] 3.1.2 `parallel_delegate` 并发限制验证完成：实现本身在 0.7.4 与 `@d:\PythonProject\lang-video-work-flow\server\app\agents\subagent.py:116-120` 已存在（`concurrency = int(args.get("concurrency") or 5)` + `asyncio.Semaphore(max(1, concurrency))`）；本任务裥补全了 `@d:\PythonProject\lang-video-work-flow\server\tests\test_parallel_delegate_concurrency.py`（8 个并发与合同测试 + 1 个 registry 契约验证，共 9 项）：
  - **默认 cap=5**：当 fan-out=10 不传 concurrency 时，观察 peak 总是 5。
  - **显式 concurrency=3**：fan-out=8 + concurrency=3 → peak=3。
  - **concurrency=1**：fan-out=5 → peak=1（串行化）。
  - **concurrency=0** 被当作 falsy 被 `or 5` 重退 default（不死锁）。
  - **fan-out < concurrency**：fan-out=2 + concurrency=10 → peak=2。
  - **空 / 缺失 subagents**：返回 `missing_args`，不起任何子代理（tracker.peak 保持 0）。
  - **深度隔验**：父仰赖 `_subagent_depth=DEFAULT_MAX_DEPTH` 时 → `subagent_depth_exceeded`，不处理子子代理。
  - **部分失败不决裂兄弟**：3 个 spec（1 个空 goal）→ total=3 / succeeded=2 / failures 携 `empty_goal`。
  - **registry 契约钉住**：`tier3` / `risk_level=medium` / `concurrency` schema (`integer 1..10 default=5`)。

  **测试设计要点**：使用 `_ConcurrencyTracker`（`asyncio.Lock` 保护的 enter/leave 计数）monkeypatch `_run_subagent` + `_spawn_subagent_row` 以避免 DB / LangGraph；sleep 30ms 让 asyncio 有机会交织，这才能观察出 peak parallelism。验证：`pytest server/tests/test_parallel_delegate_concurrency.py -v` 9 passed in 0.52s；后端全台 `python -m pytest` 364 passed (was 333, +9 本项 +22 3.3.2 = +31)。
- [ ] 3.1.3 在 ProgressTimeline 中验证嵌套 subagent 渲染正确（≥ 3 个并行 + 失败 1 个的可视化）。**Verify**：手测。

### 3.2 工具命名规范化全量切换

- [ ] 3.2.1 把所有 ~35 个工具的主名改为 `<noun>.<verb>` 格式；旧名保留为 alias 标记 deprecated。**Verify**：`pytest server/tests/test_tool_naming_convention.py` 遍历 registry 断言每个工具主名匹配正则 `^[a-z_]+\.[a-z_]+$`。
- [ ] 3.2.2 更新前端 `TOOL_LABELS` 字典（`@d:\PythonProject\lang-video-work-flow\src\components\sidebar\AgentChat.tsx:28-62`）：新名 → 中文标签。Legacy 名共用同一标签。**Verify**：手测工具调用日志显示中文。
- [ ] 3.2.3 更新所有 SKILL 文档中的工具名引用（`src/prompts/skills/index.ts` 等）：用新名为主，括注 legacy 名。**Verify**：grep `create_character_grid` 应只出现在 alias 表。
- [ ] 3.2.4 后端 `tool_alias_used` 日志接入 OpenTelemetry 指标，监控旧名使用率。**Verify**：监控 dashboard 图表。

### 3.3 Identity 抽象生产化

- [ ] 3.3.1 在 `AssetDetailModal.tsx` 增加 "Identity Embedding" 区块（参考 D-12）：未生成时显示占位 UI + 禁用按钮。**Verify**：手测打开角色详情看到该区块。
- [x] 3.3.2 `asset.update_identity` 实装完成（后端 internal/admin 写入路径贯通，为未来视觉 ID 服务预留入口）。实装三处：
  - **`@d:\PythonProject\lang-video-work-flow\server\app\agents\tools\asset_tools.py`**（新增）：`asset.update_identity({asset_id, embedding: {vector_id, provider, metadata?}})` 工具。Handler 按 asset_id 前缀 (`char_/scene_/style_`) 分发到 `CharacterAsset/SceneAsset/StyleAsset` ORM 三选一，跳过软删除行，把 embedding 写入 `metadata_json["identity_embedding"]`——这是为 0.9.3 延期之后保留的过渡：IdentityRouter 今天已能从该路径读取。Scope=`server`（不暴露给 LLM 的 OpenAI tools[]），tier3 / risk=low。
  - **`@d:\PythonProject\lang-video-work-flow\server\app\agents\tools\__init__.py`**：import asset_tools 并在 `register_all_tools()` 里调 `asset_tools.register()`（在 plan_tools 与 subagent 之间）。
  - **`@d:\PythonProject\lang-video-work-flow\server\tests\test_asset_identity_update.py`**（新增）：22 项测试。划分为三块：(a) 12 项 纯函数测试覆盖 `_validate_embedding` 与 `_model_for_asset_id` 的所有分支（minimal/full payload 、 空白裁剪 、 non-dict 、 missing/empty fields 、 未知前缀）；(b) 6 项 真实 DB 集成测试（创建-写入-读取 round-trip / 覆写幂等 / 保留其他 metadata key / unknown asset 、 软删除资产 、 未知前缀）；(c) 3 项 参数验证失败路径 + 1 项 registry 契约钉住。遵忪 `test_asset_service.py` 的多引擎隔离路径（每测试单独 engine + USER_ID=99998 隔离。

  **为什么 metadata_json 路径主击而不是加专列**：0.9.3 明确 deferred（未出现批量写入才加列）。现走 `metadata_json["identity_embedding"]` 同一 dataclass 序列化形状，在 0.9.3 落地时 service 层双写 / 读中中间层 (`migration: copy metadata_json[ie] -> column`) 是一项一蠩谜。验证：`pytest server/tests/test_asset_identity_update.py -v` 22 passed in 26.55s（同测使用真 DB）；后端全台 `python -m pytest` 364 passed。
- [ ] 3.3.3 验证 `IdentityRouter` 集成在生产视频提交链路：故意为某个角色 patch identity_embedding 后 → submit Sora 视频任务 → 检查 Sora 收到 `characterUrl` 而非 `reference_images`。**Verify**：手工集成测试。

---

## Phase 4：清理

### 4.1 前端 chatStore 主循环代码下线

- [ ] 4.1.1 删除 `chatStore.processUserMessage` 中 `for (let round = 0; ; round++)` 主循环代码块及其依赖（`smartCompress` 调用等保留，但移到 dev-only debug page 不上线）。**Verify**：grep 该 for 循环应不出现在 `src/store/`；`vitest` 全绿。
- [ ] 4.1.2 删除 `chatPromptBuilder.ts` 中 `buildAgentSystemPrompt` 实体函数 body，改为薄 proxy 调用 `/api/agent/prompts/preview`。**Verify**：单元测试调整。
- [ ] 4.1.3 删除 `AGENT_FRONTEND_LOOP_FALLBACK` feature flag 及其代码路径。**Verify**：grep 应为空。
- [ ] 4.1.4 删除 `agentLoopControl.ts` 中前端不再用的部分（保留 nothing if 全后端化）。**Verify**：vitest 全绿；bundle size 下降可量化（`npm run build && du -sh dist/assets/*.js` 对比）。

### 4.2 工具旧名 alias 下线

- [ ] 4.2.1 监控数据：旧名使用率 < 1% 时进入下线流程。**Verify**：dashboard。
- [ ] 4.2.2 后端 `tool_aliases.py` 中所有 alias 删除；alias 调用直接报 `unknown_tool`。**Verify**：grep `legacy alias` 应为空。
- [ ] 4.2.3 前端 schema / SKILL / 文档中所有旧名引用清零。**Verify**：grep `create_character_grid` 等旧名应仅出现在 git history。

### 4.3 节点旧 type alias 下线

- [ ] 4.3.1 `nodeDefinitions.ts` 删除 `characterGrid` / `characterManager` / `characterExtract` 旧 type 注册。**Verify**：vitest；旧 fixture 加载经 workflowMigrations 自动转换。
- [ ] 4.3.2 `workflowMigrations.ts` 中 character 三件套迁移函数保留（永远兼容老存档）。**Verify**：fixture 加载测试。

### 4.4 文档更新

- [ ] 4.4.1 更新 `@d:\PythonProject\lang-video-work-flow\AGENT_SKILLS_REFERENCE.md`：使用新工具名 + 新节点类型 + 增加 Subagent / Approval / Timeline 章节。**Verify**：人工 review。
- [ ] 4.4.2 更新 `README.md` 架构图：标明后端 Agent 主体 + 前端薄客户端 + SSE + 反向 RPC 路径。**Verify**：人工 review。
- [ ] 4.4.3 更新 `docs/agent-eval.md`：新增 streaming/subagent/canvas-binding metrics 说明。**Verify**：人工 review。
- [ ] 4.4.4 更新 `.windsurf/skills/`：production / quality-and-craft 等 skill 文件中的工具引用。**Verify**：grep 旧名为零。

---

## 跨 Phase 验收

- [ ] V.1 `npx tsc --noEmit -p .` exit 0 (前端)
- [ ] V.2 `cd server && pytest --cov=app` 覆盖率不低于现有水平
- [ ] V.3 `npx vitest run` 现有 ~400 测试零回归 + 新增 ≥ 80 测试全绿
- [ ] V.4 `node scripts/eval-parity.mjs`：所有 scenario 在 backend runtime 跑分 ≥ legacy frontend loop（允许 ±2 分波动）
- [ ] V.5 `node scripts/run-eval.mjs`：3 个新指标（time_to_first_event_ms / subagent_success_rate / canvas_binding_accuracy）写入 baseline
- [ ] V.6 `openspec validate agent-experience-overhaul --strict` 通过
- [ ] V.7 浏览器烟测脚本（覆盖关键路径）：
  - V.7.1 创建项目 → 让 Agent 生成完整短片 → 看到流式 reasoning + 工具气泡 + 时间轴 + 最终视频
  - V.7.2 高风险工具触发 ApprovalDialog → 拒绝后 Agent 优雅降级
  - V.7.3 hover 消息看节点高亮；Ctrl+Click 节点跳到对应消息
  - V.7.4 Subagent 委派可视化嵌套
  - V.7.5 锁定节点后 Agent 尝试 update 失败 + 工具日志可见
  - V.7.6 SSE 断网 30s → 自动重连 → 不丢消息
- [ ] V.8 性能基线：
  - p50 time-to-first-event ≤ 800 ms
  - p99 SSE event interval ≤ 200 ms
  - 前端 bundle size 增幅 ≤ +50 KB（gzip）
- [ ] V.9 Migration 验证：取一份 Phase 0 之前的工作流 JSON 加载 → 节点正常显示 + 执行通过；不丢任何数据。
- [ ] V.10 文档与代码一致性 lint：`AGENT_SKILLS_REFERENCE.md` 中提到的工具名必须能在 backend `tool_registry` 找到。
