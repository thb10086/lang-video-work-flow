## Why

用户已经验证了 sora-2-vvip 能生成视频，但 sora 单镜头排队 6+ 分钟导致整条 Agent 链路实际不可观察 — 跑一次完整工作流要 30 分钟以上，无法快速发现 Agent **决策层** 的缺陷（运镜/景别/角色一致性/品牌锚点是否真的进入了 prompt 与上游模型）。

用户基于瑞幸咖啡图 `@d:\PythonProject\lang-video-work-flow\image\1778657723_f411dd72.png` 已经反复测试，但每次都被等待视频耗尽耐心。需要：

1. 把 LLM 测试模型切换到 **Grok**（推理快、tool-calling 强、计费低），用它驱动 Agent 全流程
2. 用 Playwright-CLI 端到端跑一次 5 镜头 60s 中国美女代言瑞幸广告，**仅观察决策与产物**，不依赖 sora 真出图
3. 输出一份带证据的「Agent 自我反思报告」：哪些行为是 BUG、哪些是设计问题、哪些可优化

## What Changes

- 新增 Grok 模型注册到 `@d:\PythonProject\lang-video-work-flow\server\app\db\seed.py` 的 `MODELS_SEED`（capability=text，走 `yunwu-llm` 渠道）
- 不动现有 LLM 路由代码 — Grok 是 OpenAI 兼容接口，复用现有 `apimart_adapter` 即可
- 用 Playwright-CLI 自动化执行**8 大类测试场景**（详见 `tasks.md`）：登录 → 上传图 → Agent 对话生成工作流 → 节点参数检视 → 执行可视节点 → Agent 反思总结
- 测试结束输出**反思报告** `agent-reflection-report-luckin.md`，按「BUG / 设计问题 / 可优化点」三栏列证据 + 截图 + 修复建议

## Capabilities

### New Capabilities
- `agent-grok-driver`: Grok 作为 Agent 主驱动模型的注册与端到端验证基线
- `agent-self-reflection`: Agent 在工作流执行后对自身决策、参数注入、prompt 质量的复盘机制

### Modified Capabilities
- 无（仅扩展模型清单与新增测试驱动；不改 spec 行为）

## Impact

- 数据：`ai_models` 表新增 1 条 `grok-x-x` 记录，需重跑 `python -m app.db.seed`
- 前端：模型下拉里出现 Grok，无代码改动
- 测试：新增 `tests/playwright/agent-grok-luckin.spec.ts` E2E 用例 + 反思报告生成器
- 文档：`agent-reflection-report-luckin.md` 进 git，作为后续优化的输入清单
- 风险：Grok 在 yunwu 网关上的实际可用模型 ID 未知，需先用 `curl` 探测一次 `/v1/models`
