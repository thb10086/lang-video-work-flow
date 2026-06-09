## Context

`@d:\PythonProject\lang-video-work-flow\.windsurf\workflows\add-model-adapter.md` 规定模型接入只走「DB seed + toolDefinitions enum + modelDefaults」三步。
`@d:\PythonProject\lang-video-work-flow\server\app\services\adapters\toapis_adapter.py:266-322` 已经统一处理 toapis 的视频提交，新模型通常零代码即可上车。

但 grok-video-3 有两处与现有视频模型不同的字段命名（来自 toapis docs：[Grok Video 生成](https://docs.toapis.com/docs/cn/api-reference/videos/grok-video/generation)）：

| 字段 | 现有视频模型 | grok-video-3 | 影响 |
|---|---|---|---|
| 时长 | `duration` (int, 4–15) | `seconds` (str, "6"/"10"/.../."30") | toapis_adapter 白名单缺 `seconds` |
| 输入图 | `image_urls` (toapis_adapter 内部命名) | `images` (grok 文档显式) | 字段名不兼容 |

参考图必须是公开 URL（1–3 张），与现有 `media_url_normalizer` 体系一致，不需要新增上传链路。

## Goals / Non-Goals

**Goals:**
- 按项目模型接入工作流接入 `grok-video-3`：DB seed + 必要的 adapter 字段映射 + 前端 enum + 视频节点参数适配
- 用 grok-video-3 替代 sora-2-vvip 跑完整 Agent 工作流（5 镜头瑞幸广告，每镜头 6–10 秒），快速暴露 Agent 决策层缺陷
- 通过 MCP puppeteer 工具自动化 8 大类测试场景，全程截图录证
- 输出可执行的 `agent-reflection-report-luckin.md`（BUG / 设计问题 / 可优化点 三栏，每条带证据 + 修复路径）

**Non-Goals:**
- 不改 LangGraph 后端编排、不动 specialist agents
- 不重写 toapis_adapter — 只做最小字段映射补丁
- 不真等所有视频跑完 — 单次 6 秒 grok 视频跑通即视为模型链路通过；其余只验证提交成功 + 任务 ID 返回
- 不改默认模型 — 默认仍是 sora；grok 只通过 `update_node` 切换或在生成工作流时显式指定

## Decisions

### D1：`seconds` 字段加进 toapis_adapter 透传白名单
位置：`@d:\PythonProject\lang-video-work-flow\server\app\services\adapters\toapis_adapter.py:273-280`
做法：在 snake_case 直传 tuple 里追加 `"seconds"`。其他模型不传 `seconds` 字段就不受影响 — 完全向后兼容。

### D2：toapis_adapter 同时写 `images` 与 `image_urls`
位置：`@d:\PythonProject\lang-video-work-flow\server\app\services\adapters\toapis_adapter.py:307-315`
做法：当 `urls` 非空时，body 里**同时**写入 `images: urls` 和 `image_urls: urls`。toapis 网关层对各模型按需读取，多余字段网关丢弃。这避免给每个模型分支 `if/elif`（DRY + SRP — 字段映射就是 adapter 一处的责任）。

### D3：DB seed 加入 `grok-video-3` 全字段 schema
位置：`@d:\PythonProject\lang-video-work-flow\server\app\db\seed.py` MODELS_SEED
关键 schema：
- `seconds`：select 类型，options=["6","10","15","20","25","30"]，default="10"，**值必须是字符串**（前端 UI 引擎 ParamField 已支持 `string` value）
- `aspect_ratio`：select，options=["16:9","9:16","3:2","2:3","1:1"]，default="16:9"
- `images`：reference 字段，由 modelReferenceAdapter 注入（不在 schema 里展示）

### D4：modelReferenceAdapter 加 grok 分支
位置：`@d:\PythonProject\lang-video-work-flow\src\providers\modelReferenceAdapter.ts`
做法：grok-video-3 与 doubao-seedance-2-0 走同一 i2v 多图分支 — 把 `firstFrameUrl + characterUrls + styleUrls` 合并成 1–3 张 `images` 数组（截断到 3）。

### D5：前端 toolDefinitions.ts model enum 与 modelDefaults
位置：`@d:\PythonProject\lang-video-work-flow\src\providers\toolDefinitions.ts` create_video_node + generate_workflow
做法：在 video model enum 里追加 `"grok-video-3"`；`modelDefaults.ts` 不改默认值。

### D6：测试驱动 — 用 MCP puppeteer，不引入 npm playwright
理由：
- 项目还没装 `@playwright/test`（验证：`@d:\PythonProject\lang-video-work-flow\package.json` 无 playwright deps）
- Cascade 已有 puppeteer MCP 工具（`mcp4_puppeteer_*`），能执行 navigate / click / fill / screenshot / evaluate，足以覆盖 UI 交互链路
- "playwright-cli" 在用户语境下指代「浏览器自动化能力」，puppeteer 等价覆盖

### D7：8 大测试场景（按 Agent 能力维度切分）
1. **模型接入冒烟**：刷新页面 → VideoGenNode 模型下拉里有 grok-video-3 + 选中后 schema 字段渲染（seconds / aspect_ratio）
2. **基础对话**：Agent 接收一句话能调用 generate_workflow 一次性出 13 节点广告工作流
3. **角色一致性**：CharacterAsset → 5 个 imageGen 共享同一 characterUrl ref-in 端口
4. **品牌锚点**：每个 imageGen 的 prompt 含「Luckin/logo readable」+ ref-in 接 product styleLock
5. **视频参数适配**：5 个 videoGen 切换 model 到 grok-video-3 后，duration 自动转换成 seconds 字符串、aspect_ratio 保留
6. **真实生成（最小验证）**：触发任意 1 个 grok videoGen 节点执行，6 秒视频 60s 内出来即合格
7. **Agent 自我反思**：在所有节点检视完成后，让 Agent 调用 `recall_memory` + 看节点状态，输出「我做对了什么 / 我做错了什么 / 我可以怎么做更好」
8. **回归保障**：8 个场景结束后跑 `npx vitest run` 确保前端单测全绿

### D8：反思报告生成方式
位置：`@d:\PythonProject\lang-video-work-flow\reports\agent-reflection-report-luckin.md`（新目录）
内容三栏：
| 类型 | 证据（截图/日志/节点 ID） | 修复路径 |
|---|---|---|
| BUG-001 | screenshot-xxx.png + console err | 文件:行 + 一句话改法 |
| DESIGN-001 | 节点状态 + Agent 思考 | 影响范围 + 是否进 backlog |
| OPT-001 | 性能或 UX 数据 | 评估投入产出 |

每个 BUG/DESIGN/OPT 必须有可观察证据，不接受「应该可以更好」这种主观判断。

## Risks / Trade-offs

### R1：toapis 网关对 `images` 与 `image_urls` 双写的容忍度未知
缓解：先用 grok-video-3 单镜头跑通；若 toapis 报字段冲突，回退到「按 model 前缀 if 分支」的写法。代价多写 5 行代码，仍在 adapter 一个文件内闭环。

### R2：grok-video-3 在 toapis 网关上的真实可用性
缓解：在跑 8 大场景前，task1 用一次 `curl POST /v1/videos/generations` 探测，失败即停止并通知用户切换备选模型。

### R3：MCP puppeteer 单 session 只有一个浏览器
缓解：8 大场景串行跑，每场景结束 `evaluate` 清除 chatStore + 截图，不并行。耗时换稳定性。

### R4：反思报告由 Agent 自己写可能漏掉关键 BUG（自盲点）
缓解：反思报告由 **Cascade**（即我，外部观察者）整理写，Agent 仅产出「自评摘要」作为输入之一；Cascade 综合 puppeteer 截图 + 控制台日志 + 节点状态做最终判断。
