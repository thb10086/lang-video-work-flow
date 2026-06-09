## ADDED Requirements

### Requirement: Agent E2E 测试运行后产出可审查的反思报告
系统 SHALL 在 8 大类测试场景执行完毕后产出 `reports/agent-reflection-report-luckin.md`，按「BUG / 设计问题 / 可优化点」三栏结构组织，每条目均包含可观察证据（截图路径 / 控制台日志片段 / 节点 ID / 工具调用记录）与一句话修复路径。

#### Scenario: 报告含三栏且每条目带证据
- **WHEN** 8 大场景全部跑完
- **THEN** `@d:\PythonProject\lang-video-work-flow\reports\agent-reflection-report-luckin.md` 存在
- **AND** 文件含三个二级标题：`## BUG`、`## 设计问题`、`## 可优化点`
- **AND** 每个条目至少含 4 个字段：`证据`（路径或代码块）、`影响范围`（具体节点/工具/文件）、`严重性`（high/medium/low）、`修复路径`（文件:行 + 一句话改法）
- **AND** 不存在没证据的条目（任何「应该」「可能」类陈述必须降级为「待验证」段落或删除）

#### Scenario: 报告所有截图与日志可追溯
- **WHEN** 报告引用截图
- **THEN** 截图文件存在于 `reports/screenshots/luckin-NNN-<场景名>.png`，由 puppeteer `mcp4_puppeteer_screenshot` 直接产出
- **WHEN** 报告引用控制台日志
- **THEN** 日志片段在文档中以 `\`\`\`` 代码块包裹，含时间戳前缀（来自浏览器 console 时间戳）

#### Scenario: BUG 条目附带最小复现路径
- **WHEN** 报告中存在 BUG 条目
- **THEN** 该条目含「最小复现」段落，4 步以内可在干净环境复现，每步是用户可执行操作或 puppeteer 调用

### Requirement: Agent 的工作流执行包含自评摘要作为反思报告输入
系统 SHALL 让 Agent 在 8 大场景中第 7 类（自我反思）阶段调用 `recall_memory` + 看节点状态，输出 3 段自评：「我做对了什么 / 我做错了什么 / 我可以怎么做更好」。

#### Scenario: Agent 调用工具收集自评素材
- **WHEN** Cascade 在 chat 中要求 Agent 「回顾本次广告生成的每一步决策」
- **THEN** Agent 至少调用 1 次 `recall_memory({scope: "workflow"})` 与 1 次以上 `read_node_state` / 节点检视类工具
- **AND** Agent 输出含 3 段：「✓ 做对了」、「✗ 做错了」、「→ 改进点」，每段至少 3 条具体陈述（含节点 ID 或工具名）

#### Scenario: 自评摘要不替代外部观察者判断
- **WHEN** Agent 的自评中标记「我做对了 X」
- **AND** Cascade 通过 puppeteer / 节点状态检查发现 X 实际未达成（如 prompt 缺品牌锚点）
- **THEN** Cascade 在反思报告中将该项归到「设计问题」而非「Agent 做对」，并在条目中显式标记「与 Agent 自评冲突，证据：xxx」

### Requirement: 反思报告内容指向具体可执行的下一步
系统 SHALL 保证反思报告对每个条目提供下一步路径，不允许出现仅描述现象不指向行动的条目。

#### Scenario: 修复路径必须指向文件行号
- **WHEN** 报告 BUG 条目
- **THEN** 修复路径含至少一个 `@<absolute_path>:<line_range>` 引用，指向问题代码或修复点

#### Scenario: 设计问题指向 openspec change 或 backlog
- **WHEN** 报告设计问题条目
- **THEN** 该条目含「建议动作」字段，可选值之一：「立即开 openspec change」/「加入 ROADMAP backlog」/「下次会话讨论」

#### Scenario: 可优化点带量化指标
- **WHEN** 报告可优化点条目
- **THEN** 该条目含「当前」与「目标」两个数值或可观察状态（例如：当前生成 5 镜头平均 30 分钟 / 目标 3 分钟；当前 prompt 命中率 60% / 目标 90%）
