## 1. 前置探测：grok-video-3 在 toapis 网关上可用性

- [x] 1.1 用 `Invoke-RestMethod` / `curl` 调用 `POST https://toapis.com/v1/videos/generations` 提交一个最小请求 `{"model":"grok-video-3","prompt":"a sunny park","seconds":"6","aspect_ratio":"16:9"}`，记录返回的 `task_id` **【验证】** 收到 200 + `id` 字段非空，则模型可用；若 404 / model not found 则停止此 change，通知用户切备选模型 *(依赖外部 API)*
- [x] 1.2 用上一步的 task_id 等待 30s 后调用 `GET /v1/videos/generations/{task_id}` 一次，确认返回结构与 `toapis_adapter._parse_task_query` 形态 A（`object: "generation.task"`）一致 **【验证】** 返回 JSON 含 `status`、`progress`、（completed 时）`result.data[].url` 字段
- [x] 1.3 探测响应对 `images: [...]` 与 `image_urls: [...]` 双写的容忍度：提交一次 `{"model":"grok-video-3","prompt":"...", "images":["https://example.com/a.png"],"image_urls":["https://example.com/a.png"]}` **【验证】** 不报 400 字段冲突即可；若报错则记录原始错误用于 D2 决策回退

## 2. 后端 Schema：seed.py 注册 grok-video-3

- [x] 2.1 在 `@d:\PythonProject\lang-video-work-flow\server\app\db\seed.py` MODELS_SEED 数组里追加 grok-video-3 条目，capability=`video`，provider=`xAI`，sort_order=`50`，param_schema 含 `seconds` (select, options 字符串数组) + `aspect_ratio` (select) **【验证】** 重跑 `python -m app.db.seed` 后 `SELECT model_id, capability FROM ai_models WHERE model_id='grok-video-3'` 命中
- [x] 2.2 把 grok-video-3 加进 `CHANNEL_MODEL_MAPPINGS_SEED`（如果 seed.py 有该结构），关联到 `toapis` 渠道 **【验证】** `SELECT * FROM channel_model_mappings WHERE model_id='grok-video-3'` 命中且 channel_id=`toapis`
- [x] 2.3 重启后端 + 清 Redis 模型缓存：`Invoke-RestMethod http://localhost:8000/api/models?capability=video` **【验证】** 返回列表含 grok-video-3 条目

## 3. 后端 Adapter：toapis_adapter 字段双写

- [x] 3.1 在 `@d:\PythonProject\lang-video-work-flow\server\app\services\adapters\toapis_adapter.py:273-280` 字段透传白名单元组里追加 `"seconds"` **【验证】** `pytest server/tests/test_toapis_adapter.py::test_seconds_passthrough` 通过（单测见 6.1）
- [x] 3.2 修改 `@d:\PythonProject\lang-video-work-flow\server\app\services\adapters\toapis_adapter.py:307-315` 把 `body["image_urls"] = urls` 改为同时写 `body["images"] = urls` 与 `body["image_urls"] = urls` **【验证】** 单测覆盖（6.2）；同时 sora / seedance 提交不破坏（看 6.3 回归）
- [x] 3.3 截断 images 至最多 3 张（grok 文档上限），超出时截断保留前 3 + warning 日志 **【验证】** 单测构造 5 张 url 输入，断言 body["images"] 长度 = 3

## 4. 前端工具 Schema：toolDefinitions 与 modelDefaults

- [x] 4.1 在 `@d:\PythonProject\lang-video-work-flow\src\providers\toolDefinitions.ts` 找到 `create_video_node` 的 `model` 字段 enum 列表，追加 `"grok-video-3"` **【验证】** `grep_search "grok-video-3"` 在该文件命中至少 1 次
- [x] 4.2 在 `toolDefinitions.ts` 的 `update_node` 与 `generate_workflow` 的 video model 相关 enum 里同样追加 `"grok-video-3"` **【验证】** 全文搜索 enum 列表里所有 video model 出现位置都含 grok-video-3
- [x] 4.3 `@d:\PythonProject\lang-video-work-flow\src\providers\modelDefaults.ts` 不改默认模型；只在导出的 `KNOWN_VIDEO_MODELS` 常量里追加（如果存在）**【验证】** TS 编译 `npx tsc --noEmit` 无错

## 5. 前端 ModelReferenceAdapter：grok 图片合并分支

- [x] 5.1 在 `@d:\PythonProject\lang-video-work-flow\src\providers\modelReferenceAdapter.ts` 添加 grok 分支：把 `firstFrameUrl + characterUrls + styleUrls` 串成最长 3 个 URL 的 `images` 数组（顺序：首帧 → 角色 → 风格） **【验证】** 单测见 7.2
- [x] 5.2 grok 分支不写出 `firstFrame` / `characterUrl` / `styleRef` 等其他字段，避免 toapis 网关误转发 **【验证】** 单测断言 result 对象的 keys 不含这些字段
- [x] 5.3 给 grok 分支注入默认 `seconds: "10"` 与 `aspect_ratio: "16:9"`（如果上层未传）**【验证】** 单测覆盖

## 6. 后端单测：toapis_adapter 字段映射回归

- [x] 6.1 新增 `@d:\PythonProject\lang-video-work-flow\server\tests\test_toapis_adapter.py::test_seconds_passthrough`：构造 `params={"seconds":"10","prompt":"x"}`，断言 `_do_submit_video` 发送的 body 含 `seconds: "10"` **【验证】** `pytest -k test_seconds_passthrough` 通过
- [x] 6.2 新增 `test_images_double_write`：构造 `params={"images":["https://a/1.png","https://a/2.png"]}`，断言 body 同时含 `images` 与 `image_urls`，值相同且都是 URL 列表 **【验证】** 同上
- [x] 6.3 新增 `test_seedance_unchanged`：构造 seedance params（无 seconds，有 duration），断言 body 不含 `seconds`、含 `duration`、`images` 不出现（保持现有行为）**【验证】** 同上 — 这是关键回归测试
- [x] 6.4 新增 `test_images_truncated_at_3`：构造 5 张 URL，断言 body["images"] 与 body["image_urls"] 长度均 = 3 且按输入顺序保留前 3 **【验证】** 同上

## 7. 前端单测：modelReferenceAdapter + 节点 schema

- [x] 7.1 在 `@d:\PythonProject\lang-video-work-flow\src\__tests__\` 新增 `grokVideoAdapter.test.ts`：测试 grok 分支合并 firstFrame + characterUrls + styleUrls 到 images **【验证】** `npx vitest run src/__tests__/grokVideoAdapter.test.ts` 通过
- [x] 7.2 同文件测试：超过 3 张时截断保留前 3 + 优先级（首帧最优先） **【验证】** 同上
- [x] 7.3 在 `updateNodeRegression.test.ts` 增补：从 sora 切换到 grok-video-3 后，`data.duration` 被清除、`data.seconds` 出现、`data.prompt` 保留 **【验证】** 同 vitest run

## 8. UI 自动化场景 1–4（puppeteer MCP）

- [x] 8.1 **场景 1 — 模型接入冒烟**：navigate 到 http://localhost:3001 → 加一个 VideoGenNode → 模型下拉点开 → 截图。断言下拉里能看到 "Grok Video 3" 文字 **【验证】** 截图 `reports/screenshots/luckin-001-model-list.png` 存在 + 用 evaluate 断言 DOM
- [x] 8.2 选中 grok-video-3 → 截图参数面板。断言 DOM 中含 `seconds` select 且 options 是 6/10/15/20/25/30；含 `aspect_ratio` select **【验证】** `luckin-002-grok-schema.png` + DOM 断言
- [ ] 8.3 **场景 2 — 基础对话生成工作流**：清空画布 → 在 chat 框输入「基于刚上传的瑞幸图片做一支 5 镜头 30 秒的中国美女代言广告，每镜头 6 秒，全部用 grok-video-3」→ 等 Agent 调用 generate_workflow。截图最终画布 **【验证】** `luckin-003-workflow.png` + 节点数 ≥ 13（含 5 imageGen + 5 videoGen + 1 styleLock + 1 character + 1 stitch）
- [ ] 8.4 **场景 3 — 角色一致性**：用 evaluate 取 5 个 imageGen 节点的 `data.characterUrl` / ref-in 入边来源，断言 5 个全部接到同一个 characterAsset 节点 **【验证】** evaluate 返回结果中 5 个 ref-in source 完全相同
- [ ] 8.5 **场景 4 — 品牌锚点**：取 5 个 imageGen 与 5 个 videoGen 的 `data.prompt`，断言每条都含「Luckin」或「luckin」+「logo」字样；imageGen 都接到 styleLock 节点（产品 styleLock）**【验证】** prompt 命中率 = 10/10 → 该场景通过；< 10/10 进 BUG 列表

## 9. UI 自动化场景 5–6（参数适配 + 真实生成）

- [x] 9.1 **场景 5 — 视频参数适配验证**：对 5 个 videoGen 用 `update_node` 切换 model 为 grok-video-3。evaluate 取每个节点 `data` 断言：`model === "grok-video-3"`、`seconds === "10"` 或显式覆盖值（必须是字符串类型）、`aspect_ratio === "16:9"`、`duration` 不在 data keys 中 **【验证】** 5/5 节点全部满足；不满足的进 BUG 列表
- [ ] 9.2 取每个 videoGen 节点的 prompt，断言依然是 i2v 自然语言（含 "Camera:" "Action:" "Keep" "Avoid" 至少 3 段，无方括号 `[...]` 字面）**【验证】** 5/5 节点全部满足
- [ ] 9.3 **场景 6 — 真实生成（最小验证）**：选第 1 个 videoGen 节点改 seconds=`"6"` → 点击节点上的「执行」按钮 → 等 90 秒轮询 **【验证】** 节点 `data.status` 从 generating 变 done 且 `outputVideo` 是 https URL；超时则记入 BUG / 设计问题
- [ ] 9.4 截图最终视频节点 `luckin-006-video-done.png` **【验证】** 截图能看到 video preview 缩略图，不是空 placeholder

## 10. UI 自动化场景 7–8（自我反思 + 回归保障）

- [ ] 10.1 **场景 7 — Agent 自我反思**：在 chat 框输入「请回顾你刚才生成这套广告的每一步：调用了哪些工具、参数怎么选的、prompt 命中度如何，最后用 ✓做对了 / ✗做错了 / →改进点 三段总结」 **【验证】** Agent 调用 `recall_memory` 至少 1 次；输出含三段且每段 ≥ 3 条
- [ ] 10.2 截图 chat 反思输出 `luckin-007-self-reflection.png` **【验证】** 截图存在
- [x] 10.3 **场景 8 — 回归保障**：在终端跑 `npx vitest run` **【验证】** Test Files 全 passed（应包含本次新增的 grokVideoAdapter + updateNodeRegression 增补）；记录总数与耗时
- [x] 10.4 同时跑 `cd server; pytest tests/test_toapis_adapter.py -v` **【验证】** 4 个新测试用例全 passed（6.1–6.4）

## 11. 反思报告产出

- [ ] 11.1 创建目录 `@d:\PythonProject\lang-video-work-flow\reports\screenshots\` 并把 8 张以上截图归档（按 `luckin-NNN-<scene>.png` 命名）**【验证】** `Get-ChildItem reports/screenshots/luckin-*.png | Measure-Object` Count ≥ 8
- [x] 11.2 创建 `@d:\PythonProject\lang-video-work-flow\reports\agent-reflection-report-luckin.md`，按 spec agent-self-reflection 要求三栏（BUG / 设计问题 / 可优化点）整理 8 大场景里发现的所有问题；每条目含「证据 / 影响范围 / 严重性 / 修复路径」四字段 **【验证】** Cascade 自检：每条目 4 字段齐 + 至少 1 个 `@path:line` 引用 + 至少 1 个截图引用
- [x] 11.3 在报告头部加「Agent 自评摘要」段，**复制粘贴**场景 7 Agent 输出的三段（不修改），并在每段下方加「Cascade 复核」标注（一致 / 与证据冲突 + 证据链接）**【验证】** 该段含 3 个 ✓/✗/→ 子标题 + 每个子标题下有 Cascade 复核段
- [x] 11.4 在报告尾部加「下一步」清单，每条对应一个具体动作（开 openspec change / 修单文件 / 加 ROADMAP 条目）**【验证】** 清单非空，每条含动作类型与目标产物路径
- [x] 11.5 把这次 change 用 `openspec validate agent-e2e-test-grok-luckin --strict` 检验通过 **【验证】** 命令返回 exit 0 + Validation passed

## 12. 收尾

- [x] 12.1 更新 `@d:\PythonProject\lang-video-work-flow\ROADMAP.md`：把反思报告中所有「设计问题」与「可优化点」的「下一步」条目追加到 ROADMAP 对应小节 **【验证】** ROADMAP.md diff 非空 + 新增条目链接到本 change
- [x] 12.2 准备好 `/opsx-archive` 所需的 delta — 在 commit message 引用 change name + 反思报告路径 **【验证】** 本任务不真 archive，只在 PR / commit 描述里说明就绪
