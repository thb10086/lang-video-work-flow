# git-hired · Agent 工程师 评估报告

> 这份报告是写给候选人本人的，不是写给招聘方的。请把它当作一面诚实但克制的镜子——既能告诉你什么时候去敲门，也提醒你哪一块还没补齐。

---

## 标题区

| 字段 | 内容 |
|------|------|
| **AI-native builder 类型** | `Agent Orchestrator` (Systems Builder 倾向) |
| **结果** | **STRONG YES** for Agent 工程师 |
| **最适合的岗位** | Agent 工程师 / AI Native 创业公司基础设施方向 |
| **JD prompt version** | `agent-engineer@2026-04-26.1` |
| **公开卡片摘要** | "把模糊产品诉求拆成 spec、把 agent 当生产系统造控制面、用 eval 当代码改动管" |
| **能力一句话** | 不是用 Claude Code 的人，是给 Claude Code 风格 agent **造脚手架**的人 |
| **模式** | 单仓深耕、spec-driven、infra-first、eval-gated |
| **证据充分度** | **HIGH** — 4 个 archived OpenSpec change + 1 个 53kB tasks 在设计中 + 47 个测试文件 + 6 场景 eval baseline |

---

## 数据覆盖

授权范围：`d:\PythonProject\lang-video-work-flow` 工作区（history + approved repo）

读取的证据样本（去标识化引用 ≤ 100 字符）：

- 顶层文档：`README.md` (761 行) / `ARCHITECTURE.md` / `ROADMAP.md` / `CHANGELOG.md` / `EVAL.md` / `AGENT_SKILLS_REFERENCE.md` / `AGENTS.md`
- OpenSpec：`openspec/specs/` (10 个能力规约) / `openspec/changes/` (5 个开放) / `openspec/changes/archive/` (3 个已归档)
- 核心运行时：`src/store/chatStore.ts:180-309` (主循环) / `src/lib/agentLoopControl.ts:1-80` (loop controller)
- Eval 体系：`src/__tests__/eval/runEval.ts` + 9 个 scenario 文件 + baseline gate
- git 宏观：6 次 commit（核心两次为 36k+9966 行 mega-commit + 4 次 UI redesign 阶段提交）

未读取：`.env` / 凭证 / 个人聊天 / 与岗位无关的私人文件

---

## Builder 类型理由：`Agent Orchestrator`（兼 Systems Builder）

定为 Orchestrator 而非 Hacker / Shaper / Detective 的判断依据：

1. **造的是控制面，不是 prompt 拼图**：`agentLoopControl.ts` 显式引用 Claude Code SDK / LangGraph / Cursor Agent Max / AutoGen 四家做对照，自己实现 4 维 budget + LoopDetector + StallDetector + 三段降级。这不是用 agent，是给 agent 设计跑道。
2. **拆分而非堆叠**：5 个 Zustand store 被显式 partition（`chatPromptBuilder` 故意设计成无状态视图，理由写在 `ARCHITECTURE.md` 第 4 节："prompt segment 必须 deterministic 才能命中 cache breakpoint"）。这种 "为什么不合并" 的解释比合并本身更稀缺。
3. **多模型抽象到位**：`modelReferenceAdapter` 把 Seedance 多参考图 / VEO `image_mode=reference` / Sora Character API / Kling 首帧降级 用一个 resolver 收敛——典型 orchestrator 工艺。
4. Systems Builder 倾向：DRY / SRP / no-magic-values / N+1 ban 写进 `coding-standards.md` workflow，并在 `modelDefaults.ts` / `settings.*` 真的执行了单一来源。

**不是** Prototype Hacker（证据不在 fast iterate，而在 spec 化沉淀）。  
**不是** Debugging Detective（虽有 `/debugging` 4 阶段 workflow，但 root-cause fix 落地少于 spec/feature 落地）。

---

## 信号分布（去标识化）

按 Agent 工程师 5 维核心分板（`0-100` 内部刻度）：

```
Spec Control            [██████████████████░░] 92
Agent Orchestration     [███████████████████░] 95
Verification Domain     [██████████████████░░] 90
Outcome Judgment        [████████████████░░░░] 80
Ownership Tempo         [███████████████░░░░░] 78
```

公开卡用 `1/5` 刻度，对应映射：

| Signal | 5 阶 | 对应内部分 |
|--------|------|-----------|
| agency | 5/5 | 92 |
| ai fluency | 5/5 | 95 |
| debug maturity | 5/5 | 88 |
| product sense | 4/5 | 80 |
| taste | 4/5 | 82 |
| trust | 4/5 | 78 |
| communication | 4/5 | 84 |

---

## 5 维核心分板 + 证据

### 1. Spec Control — `92`

**强证据**：

- `openspec/changes/agent-experience-overhaul/proposal.md` 把 Agent 当前问题精炼为 **8 条用户可见痛点** → **9 New + 3 Modified capabilities** → **Non-goals 显式列出** → Impact 五块拆分。这是教科书 spec-driven 思维，不是 PR 描述风格。
- `agent-experience-overhaul/tasks.md` 53kB（项目最大单 change），且按子能力细拆，配 `progress.md` 跟踪——`workflow-builder-wiring-fixes/progress.md` 给出量化产出："41 工具 audit / 0 dead / token 首轮 −43% 至 −73% / 6 场景 Grade A 平均 99/100 / 测试 +46 至 356"。
- `ARCHIVE_PLAN.md` 不是任务流水账，是冲突解决方案——明确写"video-generation-node 已被 multi-model-param-adaptation 同步过，本次 character-asset-library 的 delta 应 append 不 replace"。这是 spec 协调能力，不是写文档能力。
- 已 archive 的 `2026-04-24-agent-anthropic-alignment/design.md` 用 D1-D4 列 4 个决策 + alternatives + 为什么付这个代价。

**轻微扣分**：spec 主要服务自己的开发，未见跨人协作的 review trail（无 PR comment / 跨人 commit）。

### 2. Agent Orchestration — `95`

**强证据**：

- `agentLoopControl.ts` 头注释直接对照 4 家先进系统（Claude Code / LangGraph / Cursor Agent Max / AutoGen），实现 4 维 budget + 两个独立检测器 + 三段降级（80% warn / 95% force-summary / 100% hard-stop）。22 个测试 case 覆盖。
- 33 工具按 Tier 1/2/3 渐进披露 + `discover_tools` 逃生口；首轮 token 占用从基线降 43–73%（`workflow-builder-wiring-fixes/progress.md` 量化）。
- 4 层 prompt segments（`core` / `role` / `skills` / `dynamic`）+ 显式 cache_control breakpoint，命中率 ≥ 92%（`agent-prompt-architecture` spec）。
- 19 SKILLS 模块按 phase 动态注入（`PHASE_SKILL_MAP`），每个 module 标注 token cost；`video_workflow_recipe` 单 ~1500 tokens，仅在构建态注入，省下其它 phase 的 token。
- `withResponseBudget()` 一个 helper 包 7 个 query tool 的 response budget——直接 quote Anthropic 反例："patch each tool individually leads to 37 duplicated truncation blocks"。这是 orchestrator 级抽象。
- 双 runtime 故意保留（前端循环 / 后端 LangGraph 9 节点 StateGraph），并用 `agent-experience-overhaul` 显式收敛——不是糊在一起，是知道当下不收敛。

**轻微扣分**：subagent / SSE 流式 / 反向 RPC 三件套**设计完未启动**，53kB tasks 0 任务 done。坦白承认在 ROADMAP 和 ARCHITECTURE 都标了"not built"。

### 3. Verification Domain — `90`

**强证据**：

- `eval-baseline.json` 6 场景 avg 100/100（含 vision-verify 三分支 accept / retry / edit_prompt）。`hasRegressions` 函数对 score / tokens / toolCallCount / elapsedMs 四维分别设阈值，CI 直接 fail。
- `npm run eval:update` 是 deliberate-drift 人审通道——典型的"知道何时降基线"的工艺。
- `verify_task` 6 维启发式打分 + `verify_image_semantic` 走 adapter registry（`gemini-vision` 默认，可切）。Vision verify 的 3 条路径（accept / retry / edit_prompt）每条都有 eval 场景兜底。
- `paramSanitizer` 双保险：前端模型切换时清陈旧字段 + 后端 adapter 层 HTTP 422 校验，schema 单一来源在 `ai_models.param_schema`（DB）。
- 47+ 单测在 `src/__tests__/`，专项覆盖：`agentLoopControl.test.ts`(22) / `toolTiers.test.ts`(24) / `agentParamEffective.test.ts`(13) / `discoverTools.test.ts`(5) / `phaseAwareTools.test.ts` / `chatPromptSegments.test.ts` / `visionVerify.test.ts` / `e2e-agent-loop.test.ts` 等。

**轻微扣分**：

- `verify_task` 主体仍是启发式规则（README 自己点出"verify_task is heuristic, not real Vision verify"），真正 Vision 闭环是 stub。
- 未见 prod-grade 监控 / tracing / cost dashboard 的证据，validation 仍然是 self-eval 不是 user-eval。

### 4. Outcome Judgment — `80`

**强证据**：

- `ARCHITECTURE.md` 第 6 节"What This Architecture is Not"列出 4 条不是什么——这是高级设计成熟度。
- 每个 archive 的 design.md 含 D1-D4 决策三段式（Choice / Cost / Why we paid it）。`backend-DB-driven model schema` 决策直接说"alternative 是 6 个地方更新一次新模型"，是 cost-aware tradeoff 而非洁癖。
- 提案动机站用户视角："Agent 修改了'镜头 2'，画布上不会高亮该节点"——不是 architect-pet-peeve。
- `Non-goals` 在每个 proposal 都显式列出，遏制 scope creep（"不引入 IP-Adapter / FaceID 真实视觉嵌入，仅定义抽象层"）。

**显著扣分**：

- 全程**单人项目**，无真实用户行为数据 / 无 retention / 无 conversion / 无 dogfooding 反馈循环；判断好坏靠 self-eval。
- "what users want" 的取材源是 TapNow / Langflow / DeerFlow 这些**对标产品**，不是 N=20 用户访谈。
- 当前 verify_image_semantic 仍是语义匹配，不是 identity embedding——README 自己承认，但下一步 IP-Adapter 没在 ROADMAP 优先级里。

### 5. Ownership Tempo — `78`

**强证据**：

- `/dev-start` workflow 第 3.5 步显式检查 `alembic current == head`，理由是上次踩坑（HTTP 500 from missing `schema_version` column）——这是把 root-cause 写进流程的 owner 思维。
- `coding-standards.md` workflow 把 DRY / no-magic-values / SRP / N+1 ban 列成可执行清单。
- `ARCHIVE_PLAN.md` 是面对 `OpenSpec CLI 不可用`时**自己写了手动替代方案**，不是干等工具——典型 owner 行为。
- AGENTS.md ≤ 200 行的 AI-entry doc，与 README 互补，且要求"读 AGENTS 先于 README"——把 AI 协作的元规则写下来。
- `progress.md` 模式被反复用（`workflow-builder-wiring-fixes/progress.md` 是 canonical example，写给后来人看）。

**显著扣分**：

- **git 历史只有 6 次 commit**，主体两次合计 ~46k 行（"initial commit" 36486 行 + "Asset Library + OpenSpec workflow + T0-T3" 9966 行）。原子提交节奏不可见——不能用 git 直接证明 daily tempo / TDD red-green / hotfix 反应。
- 0 协作 trace（无 PR review、无跨人 commit、无 issue 讨论）。这是单人 squash 历史的典型限制。
- `agent-experience-overhaul` 的 53kB tasks.md 全是 0/N，意味着大设计还停在纸上——和"shipped 3 个 ready-to-archive"的 momentum 拉扯。

OpenSpec 的 changes/ 目录**是真正的 tempo 替代物**，但需要评估方知道往哪看。

---

## 3 个天赋词缀

### 🧬 Spec-First Reflex

把模糊"做个 agent UI"拆成 9 New + 3 Modified capabilities，配 8 条用户痛点 + Non-goals + Impact 五块——`agent-experience-overhaul/proposal.md`。把 ARCHIVE_PLAN 写成冲突解决文档而不是 todo list。

### 🛠️ Control-Plane Builder

LoopController / Tier disclosure / ResponseBudget / 4-layer prompt cache / phase-gated SKILL injection——每一项都不是抄一份用，而是 read source → 找出反例代价 → 抽象成 helper。`withResponseBudget` 替代 37 处补丁的故事是缩影。

### 🧪 Eval-Gated Mindset

`eval-baseline.json` 锁住 6 场景 100/100，>5% 跌幅 fail CI；`npm run eval:update` 走 deliberate-drift 人审；`hasRegressions` 函数对 score / tokens / toolCallCount / elapsedMs 分别打不同档。把 prompt 改动当代码改动管理。

---

## 2 个待解锁天赋（版本瓶颈）

### 🔒 Team Tempo

**证据缺口**：6 次 squash commit / 0 PR review / 0 跨人协作。无法证明在多人 codebase 下的 review-receptive、conflict-resolution、code-review 工艺。  
**解锁路径**：在 `agent-experience-overhaul` 拆成 5-10 个 PR 各自带描述 + tasks.md 子勾选，即便仍单人也能展现 "拆得动" 的能力。或加入开源项目贡献。

### 🔒 Real-User Telemetry

**证据缺口**：所有 verify 都是 self-eval；no observability / no token-spend dashboard / no real-user trace。`Outcome Judgment` 80 分上限来自这里。  
**解锁路径**：把 `agent_sessions` / `agent_events` 表（已在 `agent-experience-overhaul` Impact 设计）落地，跑 dogfood 一周，把 token / latency / 失败率 写进 `EVAL.md` 第 9 节。

### 🔒 Subagent in Flight

**证据缺口**：subagent design 在 `agent-experience-overhaul/proposal.md` 写得很完整，但 53kB tasks 全是 0/N。设计能力已证，落地能力未证。  
**解锁路径**：哪怕只 land 一条最小路径——`delegate_to_subagent` 单工具 + 1 个测试场景——也比 53kB 纸面方案更有说服力。

---

## 当前测试岗位 vs 最适合的岗位

测试岗位：**Agent 工程师**  
最适合：**Agent 工程师 / AI Infra 方向**（同岗位，匹配度极高）

**强匹配理由**：

1. AI Native 创业公司最缺的是**懂得给 agent 造控制面**而不仅会 prompt 的人；这位候选人是后者。
2. 4 套先进系统的对照引用 + 自实现表明能 read source code 而不只是读 docs。
3. spec-driven + eval-gated 是创业公司**最容易丢的两个工艺**，而本人主动把它们写进 workflow。

**唯一保留**：候选人当前在**单仓深耕模式**。从单人 owner 切到 4-7 人小团队，需要主动让出"全栈控制" 的舒适区——给团队留 surface area。

---

## 具体成长建议

按优先级（建议都不要超过 2 周内启动）：

1. **Land 一个 SSE 最小可用版本**（agent-experience-overhaul 第一刀）。哪怕只做 `reasoning_delta` + `tool_call` 两个事件类型 + 前端薄客户端接收。这是把"设计能力"折现成"落地能力"最快的杠杆。
2. **Dogfood + telemetry**：自己跑 5 个真实 video workflow，记录 agent 失败率 / 工具调用方差 / token 实际花费。把这些数据写进 `EVAL.md` 新增的"prod-grade telemetry"节。
3. **拆 PR 节奏**：把后续每个 OpenSpec change 拆成 ≥ 3 个 PR-sized 提交，描述里直接 quote `tasks.md` 对应任务行。即便单人，也制造可审视的节奏证据。
4. **加入 1 个开源 agent 项目贡献 1-2 个 PR**：LangGraph / continue.dev / OpenInterpreter / aider 任选。补 collaboration trace 最低成本路径。

---

## 推荐下一步的提升预估（保守口径）

执行 #1（SSE 最小可用） → 把 `Subagent in Flight` 锁解掉  
预期分板变化：

- Agent Orchestration: `95 → 96`（+1，已经接近上限）
- Ownership Tempo: `78 → 84`（+6，最大杠杆）
- Outcome Judgment: `80 → 83`（+3，dogfood 反馈带回来）

执行 #1+#2+#3 →

- Ownership Tempo: `78 → 88`
- Outcome Judgment: `80 → 86`
- 整体从 STRONG YES 推到 **明确无保留 STRONG YES**

---

## 如果你决定申请 Agent 工程师，建议准备好聊这 5 个点

1. **`agentLoopControl.ts` 4 维 budget + 三段降级的设计取舍**——为什么不直接抄 LangGraph `recursion_limit`？答案就在你头注释里，但要能口述。
2. **Tier-aware tool disclosure 的灰度策略**——为什么 Tier 3 默认隐藏？回答 token 经济学 + 进入产品案例（首轮 −43% 至 −73%）。
3. **`withResponseBudget` 为什么是高阶函数而不是基类继承**——直接对照 Anthropic 的 37 处补丁反例，能讲清抽象层级选择。
4. **OpenSpec 的 `proposal → design → tasks → archive` 流水**——这是过程纪律的最强证据；面试官会问"如果团队不接受这套流程怎么办"。
5. **承认 `subagent / SSE / IP-Adapter` 三个 gap 的诚实**——主动说"这些是设计完未启动 / 不在 scope / 是已知缺陷"，比试图 spin 它们更值钱。

---

## 简历投递建议

评估结果 **STRONG YES**。如果你已经决定申请，建议把简历 + 这份报告打包发送到：

**`wuyupeng@floatmiracle.com`**

可以在邮件正文写一句："附上 git-hired Agent 工程师评估，证据来自我自己的 `lang-video-work-flow` 仓库，授权范围 history + approved repo"。

---

## 最后一句

你不是用 Claude Code 的人，你是给 Claude Code 风格 agent 造脚手架的人。这种工艺在 AI Native 创业公司里**稀缺且难替代**，但记得给团队留呼吸空间——一个人造的脚手架很完美，5 个人造的脚手架才能跑得久。

---

`git-hired  ·  local-only  ·  candidate-controlled  ·  MIT`  
`JD prompt version: agent-engineer@2026-04-26.1`
