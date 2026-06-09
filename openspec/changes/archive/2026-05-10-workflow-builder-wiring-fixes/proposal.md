## Why

上一轮 `node-functional-parity-cleanup` 收尾后，新增的 `agentGenerationEvaluation.test.ts` 给 6 个 scenario 打了 0-100 分。`short_drama=96 / comic_drama=100 / product_ad=96 / store_tour=97 / tutorial=86 / music_video=86`，平均 94/A，但暴露出 **4 个真实的 builder 连线缺陷**，会让用户在用 Agent 一键生成这两种场景时产生"悬空节点"、端口契约违规、角色库断链等肉眼可见的 bug。同时现阶段一次性塞给 LLM 的 40 个 tool 已经显著增加 token 开销，在 Agent 首轮对话里浪费 ≥8k tokens；需要学习 Claude Code 的渐进式披露思路进行瘦身。

## What Changes

### A. 连线缺陷修复（TDD 驱动，修完自动达 A 级）

- **sceneGrid 孤立**：`addScenes()` 的回调未把 `sceneNodeId → imageGen.scene-in` 连起来（@d:\PythonProject\lang-video-work-flow\src\providers\workflowBuilders.ts 的 `buildShortDrama` / `buildStoreTour` 两处）。修复：`sceneIds.forEach(sid => imgIds.forEach(iid => wb.connect(sid, iid, 'grid-out', 'scene-in' or fallback)))`。
- **buildMusicVideo 缺 characterManager**：有 characters 却不走 manager，导致 D6 得 0。复制 short_drama 的插入逻辑。
- **buildMusicVideo storyboard 悬空**：创建后无上下游；要么去掉，要么 `script → storyboard.script-in`。选后者（更尊重"分镜节奏"定位）。
- **buildTutorial text-in 端口违规**：`textNode` 的 portRegistry 没有 `text-in`。选修：把 tutorial 的 `llm → textNode` 改为直写 `textNode.content`（与 textNode 是数据源的设计一致），或给 textNode 加 `text-in` 端口。本次采用前者。

### B. Agent 工具渐进式披露（新能力）

- **Tier 化工具集**：把 40 个 tool 分 3 档，按上下文阶段注入：
  - **Tier 1 核心（~8 tools，始终加载）**：`detect_scenario / generate_workflow / get_canvas_state / execute_node / parallel_execute / verify_task / connect_nodes / update_node`
  - **Tier 2 场景创建（14 tools，命中创建意图才加载）**：所有 `create_*_node` 工具 + `delete_node`
  - **Tier 3 高级（18 tools，按显式关键词加载）**：`plan_task / save_memory / recall_memory / optimize_prompt / review_content / inject_user_images / list_assets / create_asset / update_asset / link_asset_to_node / resolve_prompt_refs / classify_image / list_models / get_model_params / retry_node / batch_execute / get_node_output / update_plan_step`
- **新工具 `discover_tools`**：让 Agent 按需请求额外工具集（类比 Claude Code 的 `skill-name` 搜索）。调用返回当前 Tier 以外的工具名 + 简介，Agent 下一轮要用就能自带。
- **运行时决策器**：`selectAgentToolTier(userMessage, context)` 启发式分类器，决定本次对话用哪 Tier。默认 Tier 1+2。
- **Token 预算 Telemetry**：在 Agent 入口处记录每轮 tool schemas 的 token 估算（粗粒度 1 tool ≈ 200 tokens），暴露到 `agent_metrics` 日志里便于观测。

### C. 参数生效验证

- **新测试 `agentParamEffective.test.ts`**：建节点时传 `aspectRatio='9:16'`、`duration=8`、`generate_audio=true`、`seed=42` 等 tool schema 里声明的参数，断言 `node.data[key]` 一一落地；执行 executor 前 sanitizer 不会错误丢弃。
- **新测试 `nodeAgentToolUtilization.test.ts`**：断言 14 种节点都在至少一个 scenario builder 或者 executor test 里被创建过，无 dead node type。

## Capabilities

### New Capabilities
- `agent-tool-tiering`: 渐进式披露的 Tier 化 Agent 工具集 + `discover_tools` + token 预算

### Modified Capabilities
- `workflow-generation`: 修复 sceneGrid / storyboard / textNode 的 builder 连线；补齐 music_video 的 characterManager
- `agent-tool-schemas`: `getAgentTools` 签名增加 `tier` 参数；新增 `discover_tools` schema

## Impact

- **Frontend**: `@d:\PythonProject\lang-video-work-flow\src\providers\workflowBuilders.ts` (4 处)、`@d:\PythonProject\lang-video-work-flow\src\providers\toolDefinitions.ts` (新增 tiering 辅助 + discover_tools)、`@d:\PythonProject\lang-video-work-flow\src\providers\agentTools.ts` (新增 handleDiscoverTools)
- **Tests**: 2 个新 test 文件、更新 `agentGenerationEvaluation.test.ts` 的 music_video/tutorial 期望阈值
- **Docs**: 更新 `@d:\PythonProject\lang-video-work-flow\README.md` 的工具分层说明
- **非目标**：不重构 tool handler 实现；不改 backend LangGraph；不改动态 schema 生成器（audio 枚举等）
