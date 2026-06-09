## 1. Eval Harness 基础设施（先行，作为后续回归基线）

- [x] 1.1 新建 `src/__tests__/eval/` 目录；创建 `types.ts` 定义 `Scenario` / `Verifier` / `Metrics` / `MockLLMScript` / `ToolCall` 等类型（验证：`tsc --noEmit` 通过，`Scenario` 类型缺字段时编译报错）
- [x] 1.2 实现 `mockLLM.ts`：按 `mockLLMScript` 确定性返回 tool_calls，支持条件分支与失败注入（验证：单测覆盖 3 个脚本模式）
- [x] 1.3 实现 `mockBackend.ts`：拦截 `backendApi.generateImage` / `generateVideo` / `verifyImage` / `uploadCos`，支持 `{ latencyMs, failFirstNCalls, customResponse }` 配置（验证：单测覆盖延迟与失败注入场景）
- [x] 1.4 实现 `runEval.ts`：自动扫描 `scenarios/` 下 `.ts` 文件并加载；为每个 scenario 启动独立 chatStore 实例，驱动 Mock LLM 跑完，收集指标（验证：新增空 scenario 文件后自动被发现，无需改执行器）
- [x] 1.5 实现 `reporters/jsonReporter.ts` 和 `consoleReporter.ts`：输出 `eval-report.json` + 控制台摘要表格（验证：跑任意 scenario 后文件生成，内容含完整 metrics）
- [x] 1.6 实现 baseline 对比：存在 `eval-baseline.json` 时对比每个 scenario 的 score，回归 > 5% 进程非零退出；`--update-baseline` flag 更新基线（验证：人为降 score 触发回归报错，加 flag 后刷新基线）
- [x] 1.7 编写 scenario `01-product-ad.ts`：产品广告生成全链路，期望 `classify_image → detect_scenario → generate_workflow → parallel_execute`，verifier 检查 stitch 节点存在且全部执行成功（验证：`npm run eval -- --only 01-product-ad` 通过）
- [x] 1.8 编写 scenario `02-short-story.ts`：3 镜头短片，期望 `plan_task → generate_workflow → parallel_execute`，verifier 检查 3 个 videoGen 全部 success（验证：单独运行通过）
- [x] 1.9 编写 scenario `03-character-fix.ts`：画布上已有角色，要求修改颜色，期望 `get_canvas_state → update_node → execute_node`，verifier 检查 description 已更新（验证：单独运行通过）
- [x] 1.10 添加 `npm run eval` 脚本到 `package.json`；首次运行生成 `eval-baseline.json`（验证：`npm run eval` 3 scenarios 全绿，baseline 文件存在）

## 2. Tool Response Budget（小改动，独立）

- [x] 2.1 在 `src/providers/toolBudget.ts` 新增常量 `DEFAULT_TOOL_RESPONSE_MAX_TOKENS = 25000`（Anthropic 默认值）；实现 `withResponseBudget(handler, opts)` 高阶函数，含 concise/detailed 分支和硬截断 + hint 后缀（验证：`src/__tests__/toolBudget.test.ts` 共 23 个用例，覆盖 passthrough / concise / detailed / 硬截断 / 元数据等）
- [x] 2.2 在 `settingsStore.ts` 添加 `enableResponseBudget: boolean`（默认 `true`）；在 `withResponseBudget` 内读取该开关，关闭时透传（验证：`passes through untouched when enableResponseBudget=false` 单测通过）
- [x] 2.3 在 `agentTools.ts` 的 handler 注册表对 7 个查询类工具应用 `withResponseBudget`：`get_canvas_state`/`get_node_output`/`list_models`/`get_model_params`/`list_assets`/`recall_memory`/`discover_tools`（验证：runtime 包装器携带 `__isBudgeted=true` 元数据，7 个 dispatch 分支均已切换到 budgeted 版本）
- [x] 2.4 为每个被包装工具写 `conciseFormatter`：剃除低频字段（如 `metadata.createdAt` / 全量 `description` / 内部 UUID），仅保留 Agent 决策所需字段（验证：`toolBudgetIntegration.test.ts` 在 20 节点画布下 concise 输出 < detailed 的 70%，limit 抽样 30% 以上节省）
- [x] 2.5 在 `toolDefinitions.ts getAgentTools()` 通过 `applyBudgetToSchema` 统一注入 `response_format: 'concise'|'detailed'` 枚举参数到返回的 7 个 budgeted tools（验证：`adds response_format enum param for budgeted tools` 和幂等性用例均通过）
- [x] 2.6 跑 `npm run eval`，确认 3 个 baseline scenarios 全部 passed（当前 score=100/100/100 无回归）；`toolResponseTokens` 新增为独立指标，让后续 scenario 能量化比较前后变化（验证：`toolBudgetIntegration.test.ts` 在大画布下确认 concise 模式 tokens 下降＞30%）

## 3. Prompt Architecture 重构（依赖 #1 的 eval 把关）

- [x] 3.1 在 `chatPromptBuilder.ts` 定义 `PromptSegment` 类型（id/text/stability）；新增 `buildAgentSystemPromptSegments(roleId, opts): PromptSegment[]` API，原 `buildAgentSystemPrompt` 委派到它再拼接字符串以保持向后兼容（验证：`tsc --noEmit` 通过，`legacy buildAgentSystemPrompt matches segment join` 单测通过）
- [x] 3.2 把当前 monolithic `stablePrefix` 拆为 `core` 段（使命/执行循环/HALT/模型参数/错误处理/输出规范/约束/quickref）+ `role` 段（semi-stable）+ `skills` 段（semi-stable）+ `image_hint`/`memory`/`canvas_state`（dynamic）（验证：`core segment fits the ~800 token budget` 单测通过）
- [x] 3.3 提取制片 Pipeline（Path A/B、执行序列、依赖链约束）到新 SKILL 模块 `src/prompts/skills/videoWorkflowRecipe.ts`；在 `ALL_SKILLS` 注册，`PHASE_SKILL_MAP` 中 `planning`/`pre_production`/`production`/`building`/`executing` 引入（验证：`loads video_workflow_recipe skill in building phase` / `…in production phase` / `does not embed the pipeline block in the core segment` 三个单测通过）
- [x] 3.4 提取多模态处理协议到新 SKILL `src/prompts/skills/multimodalInput.ts`；`buildSkillsPromptByPhase` 变签名为 `(phase, { hasImages })` 并在 `hasImages=true` 时才加载该模块（验证：`does NOT load multimodal_input skill body when imageCount=0` + `loads multimodal_input skill body when imageCount>0` 用例通过）
- [x] 3.5 `chatStore.ts` 调用方采用 `buildAgentSystemPromptSegments()` + 条件性调用 `buildSystemContentBlocks()`：未启 caching 时用字符串回退（兼容），启用后送 结构化 content 数组（验证：eval 3 scenarios 通过且无回归）
- [x] 3.6 在 `settingsStore.ts` 添加 `enablePromptCaching: boolean`（默认 `false`）+ `setEnablePromptCaching` setter + partialize 持久化；新增 `buildSystemContentBlocks(segments)` 将 stable/semi-stable 段包装为 text block，最后一个 cacheable 段携带 `cache_control: {type: 'ephemeral'}`（验证：6 个 `buildSystemContentBlocks` 单测覆盖段数/缓存位置/底线等场景）
- [x] 3.7 后端 `server/app/routers/agent_chat.py` 新增 `adapt_messages_for_provider()` + `_flatten_system_blocks()`：Anthropic-native 模型透传结构化 content，OpenAI-compatible 模型扁平为字符串并剥离 `cache_control`（当前网关均走后者路径）；应用在 `/chat` 和 `/chat/stream` 两个 endpoints（验证：`test_agent_prompt_cache.py` 10 个用例覆盖扁平/混合内容/非 system 消息不受影响/不变原输入 等等）
- [x] 3.8 跑 `npm run eval` + `npm test`：eval 3 scenarios score=100/100/100 无回归；前端单测 562 个 passed + 20 个新增提示词架构用例；后端 19 个 agent+prompt-cache 用例全绿（验证：eval-report.json 与 baseline 比较 delta=0）

## 4. Vision Verify（最大工作量，依赖 #1 eval 验证）

- [x] 4.1 在 `src/providers/visionVerifyAdapter.ts` 定义 `VisionVerifier` 接口与 `VerifyResult` / `VerifyCriteria` / `VerifyRecommendation` 类型；实现 `registerVerifier` / `getActiveVerifier` / `listVerifierIds` / `__resetRegistry` 注册表，`getActiveVerifier()` 在声明的 model id 未注册时回退至第一个 adapter 并 warn（验证：`visionVerify.test.ts` 5 个注册/切换/回退/ID 校验/空注册表报错 用例全绿）
- [x] 4.2 实现 `geminiVisionAdapter.ts`：导入时自注册为 `gemini-vision` adapter，通过 `backendApi.verifyImage` 调后端 + `coerceResult` 容忍 snake_case/camelCase，网络错误降级为 matchScore=0 + recommendation=retry 而不抛异常（验证：3 个 `geminiVisionAdapter` 用例覆盖happy-path/网络失败/缺省 recommendation 派生）
- [x] 4.3 后端新增 Pydantic schema `VerifyImageRequest` / `VerifyImageResponse` / `VerifyCriteria`（`server/app/schemas/verify.py`）： URL 校验拒绝非 http(s)/data: 开头 + threshold range 0-100 + recommendation Literal（验证：`test_verify_api.py` 7 个 schema 用例 全绿）
- [x] 4.4 后端新增 `POST /api/verify/image` endpoint（`server/app/routers/verify.py`）：校验 model 在支持列表内否则 422 + 暴露可用 id、分发给 `VisionVerifyService`、在 main.py + conftest.py 均注册 router（验证：`test_verify_api.py` `TestVerifyRoute` 4 个用例覆盖 unsupported model 422 / malformed URL 422 / happy path 200 / 缓存命中）
- [x] 4.5 后端实现 `VisionVerifyService`（`server/app/services/vision_verify_service.py`）：构造严格 JSON 输出 contract 的 prompt、通过 `LLMService` 调 Gemini、`_parse_llm_reply` 容忍 fenced/前文场景、`_coerce_result` 回退默认值＋推导 recommendation（验证：15 个服务层用例覆盖 JSON 解析、得分抨切、缺省字段推导、reasoning 截断、双 key 兼容）
- [x] 4.6 为 `/api/verify/image` 加 Redis 缓存 300s：key = `prism:verify:image:<sha256(canonical_json)>`，基于 `redis.get/set` + json 序列化 + `exclude_none=True` 构造canonical，缓存命中时 provider 零调用并标记 `cached: true`（验证：`TestVerifyRoute.test_second_identical_request_hits_cache` + 3 个 `TestCacheKey` 用例确认 key 稳定性 / threshold 差异性 / 前缀合理性）
- [x] 4.7 在 `toolDefinitions.ts` 注册 `verify_image_semantic` 工具 schema（nodeId + nodeLabel + expectedSubjects + expectedStyle + threshold）并在 `verify_task` 添加 `useVisionVerify: boolean` 参数；在 `toolTiers.ts` 将 `verify_image_semantic` 加入 Tier 3 + REVIEW 意图 addOn；在 `reviewing` phase 的 allow 列表中注册（验证：`toolTiers.test.ts` 中的 all-tier parity 用例、`phaseAwareTools.test.ts` 的 review 阶段用例 全绿）
- [x] 4.8 新建 `src/providers/toolVisionVerify.ts`实现 `handleVerifyImageSemantic`：利用 `resolveNode()` 支持 nodeId/nodeLabel、 fallback 顺序 outputImage → firstFrameImage → inputImage 用于 imageGen/videoGen首帧/imageEdit、每次调用时动态读 `getActiveVerifier()` 让 `settings.visionVerifyModel` 热切生效、渲染后的 message 含中文 header + 完整 JSON 便于 Agent 解析（验证：5 个 handler 用例覆盖 accept/retry/节点不存在/缺少 outputImage/videoGen 首帧退而求其次）
- [x] 4.9 修改 `handleVerifyTask` 为 `async`，接受 `useVisionVerify: boolean`；开启时运行新增的 `computeVisionDimensionPoints()` 基于 matchScore 均值打分（满分为均值 ≥ 80）；任何节点 Vision 失败 → `visionFallback=true` + `runHeuristic()` + message 附 `[vision fallback]`；统一接受退化机制无 outputImage时跳过不扣分（验证：4 个 `handleVerifyTask` 用例覆盖默认行为 / 两节点 vision 通过 / 全失败fallback / 无 outputImage 跳过）
- [x] 4.10 编写 3 个 vision eval scenarios：`11-vision-accept`（matchScore=92 → accept → 无修改）+ `12-vision-retry`（matchScore=55 → retry → retry_node → retryCount≥1）+ `13-vision-edit-prompt`（matchScore=25 → edit_prompt → update_node 改提示词 + retry_node）；同时扩展 `mockBackend.ts` 支持 `verifyImage` 模拟 + camelCase→snake_case转换 + `install/dispose` 覆盖 verify 方法（验证：`npm run eval` 6/6 通过，3 个新场景 均 score=100，eval-baseline.json 已更新 包含 6 个 scenarios）
- [x] 4.11 在 `settingsStore.ts` 添加 `visionVerifyModel: string`（默认 `'gemini-vision'`）+ `setVisionVerifyModel` setter + partialize 持久化；`getActiveVerifier()` 每次调用重新读 store，保证切换即生效（验证：`visionVerifyAdapter registry` describe 中切换用例确认 active id 随 settings 更新，UI Settings 的选择框后续加 ）

## 5. 全量验证与收尾

- [x] 5.1 `npx vitest run`：**579 passed | 1 skipped** (包含新增 17 个 `visionVerify.test.ts` 用例，所有 handler / adapter / helper / phase gating / tier parity 全部绿)
- [x] 5.2 `npx tsc --noEmit`：0 errors (所有新增文件 + 类型由添加的 `VerifyImageResponse` 通过严格类型检查)
- [x] 5.3 `npm run eval`：6 scenarios 全通过（score 均 100/100），与更新后的 baseline delta=0 无回归（eval-report.json 已写入）
- [x] 5.4 新建 `AGENT_SKILLS_REFERENCE.md`（workspace 根目录）：完整 SKILL 模块索引表（含阶段映射 + 约算 token 成本）+ `video_workflow_recipe` / `multimodal_input` / `vision_verify` 三个新模块的详细条目 + 扩展新模块的4 步指引
- [x] 5.5 新建 `docs/agent-eval.md`：覆盖 CLI 用法 + scenario 编写模板 + report 读法 + baseline workflow + CI YAML 示例 + 常见问题排查表
- [x] 5.6 `openspec validate agent-anthropic-alignment --strict` 通过 — `Change 'agent-anthropic-alignment' is valid`
- [x] 5.7 代码 review checklist：✓ model id / threshold / endpoint 均进入配置（`VisionVerifyService.SUPPORTED_VISION_MODELS` / `DEFAULT_THRESHOLD` / `CACHE_TTL_SECONDS` / `settings.visionVerifyModel`）；✓ `renderPromptEngineeringQuickRef` 仍被 `core` 段引用，非冗余；✓ 无硬编码 emoji / 节点 ID / 内部坐标
- [ ] 5.8 `openspec archive agent-anthropic-alignment`：归档变更，自动将 4 个新 capability spec 合入 `openspec/specs/`
