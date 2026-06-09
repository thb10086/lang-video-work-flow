# agent-prompt-architecture Specification

## Purpose

把 Agent System Prompt 从单体字符串重构为**带稳定性标签的 4 段结构**（`core` / `role` / `skills` / `dynamic`），让 Anthropic Prompt Caching 的 `cache_control: { type: 'ephemeral' }` breakpoint 能精准放在 `stable` + `semi-stable` 段的边界 — 验证目标是把缓存命中率从约 0 提升到 90%+ 区间，同步压低成本。`buildAgentSystemPrompt()` 返回 `PromptSegment[]`，调用方根据 `settings.enablePromptCaching` 决定走数组形态（带 cache_control）还是字符串形态（兼容老路径），上游 provider 不支持 caching 时后端透明剥离 `cache_control` 字段不抛错。同步把原本硬编码在 `chatPromptBuilder.ts:540-569` 的"制片 Pipeline 指令"和"用户图片处理协议"迁移为按需加载的 SKILL 模块 `video_workflow_recipe`（仅 planning/building/executing phase 加载）和 `multimodal_input`（仅 `imageCount > 0` 加载），使 `core` 段稳定 ≤ 800 tokens、无图查询场景 system prompt 体积下降 ≥ 15%。

## Requirements
### Requirement: Four-Layer Prompt Segments

`buildAgentSystemPrompt()` SHALL 返回结构化的 `PromptSegment[]`，每段携带稳定性等级，不再返回单体字符串。

`PromptSegment` MUST：

- `id`：`'core' | 'role' | 'skills' | 'dynamic'`
- `text`：纯文本内容
- `stability`：`'stable' | 'semi-stable' | 'dynamic'`，其中 `core` 固定 `stable`、`role` 固定 `semi-stable`、`skills` 固定 `semi-stable`、`dynamic` 固定 `dynamic`
- `cacheable`：stable/semi-stable 为 true，dynamic 为 false

段落内容约束：

- `core`：使命、执行循环、HALT 条件、错误处理、输出规范、约束（≤ 700 tokens，所有会话恒定）
- `role`：roleId 对应的 role prompt（仅随 `activeRole` 变）
- `skills`：`buildSkillsPromptByPhase(phase)` 的输出（仅随 phase 变）
- `dynamic`：画布状态、imageHint、memoryContext（每轮都变）

#### Scenario: 返回 4 段且标签正确

- **WHEN** 调用 `buildAgentSystemPrompt('assistant', { userMessage: 'test' })`
- **THEN** 返回数组 length ≥ 4，包含 id = `'core'/'role'/'skills'/'dynamic'` 的段，且 `core.stability === 'stable'`

#### Scenario: 同一 role + phase 下 core 与 role 字节完全相同

- **WHEN** 两次调用都为 `'assistant'` 且画布 phase 同为 `'planning'`，但画布节点不同
- **THEN** 两次结果的 `core.text` 和 `role.text` 完全相等（便于缓存）

#### Scenario: 切换 phase 时 core 不变、skills 变

- **WHEN** phase 从 `'planning'` 切到 `'building'`
- **THEN** `core.text` 不变，`skills.text` 变化（加载了 building phase 的 SKILLS）

### Requirement: Conditional Cache Control Injection

Chat 请求构建 SHALL 根据 `settings.enablePromptCaching` 决定是否注入 `cache_control` 字段，未启用时退化为普通字符串 system prompt。

行为要求：

- 启用时：`system` 字段为数组形式 `[{ type: 'text', text: combinedStable, cache_control: { type: 'ephemeral' } }, { type: 'text', text: dynamicText }]`
- 未启用时：`system` 字段为字符串 `stable + semi + skills + dynamic`（与旧行为 byte-for-byte 一致）
- Feature flag 切换不需重启，下一次 Agent 调用立即生效

#### Scenario: 启用 caching 时请求体含 cache_control

- **WHEN** `settings.enablePromptCaching = true` 且发起 Agent 调用
- **THEN** backend agent_chat 请求 payload 的 `messages[0]` 或 system 字段里至少 1 处出现 `cache_control: { type: 'ephemeral' }`

#### Scenario: 未启用 caching 时回到旧字符串格式

- **WHEN** `settings.enablePromptCaching = false`
- **THEN** 请求 payload 的 system 字段为单一字符串，无 `cache_control` 字段

#### Scenario: 上游 provider 不支持 caching 时也不抛错

- **WHEN** backend 收到带 `cache_control` 的 payload 但 model 为 `gpt-5.4`（不支持 caching）
- **THEN** backend 剥离 `cache_control` 后转发，请求正常完成，不抛错

### Requirement: Pipeline Instructions Extracted to SKILL Modules

`buildAgentSystemPrompt` 中 `stablePrefix` 的"制片 Pipeline"（路径 A/B/执行序列/依赖链）SHALL 迁移到新 SKILL 模块 `video_workflow_recipe`，仅在 `planning`/`building`/`executing` phase 按需加载。

迁移要求：

- 新 SKILL 必须与现有 SKILL 结构一致（`SkillDefinition` 类型，`PHASE_SKILL_MAP` 中列出）
- 迁移后 `stablePrefix` token 数 MUST 下降 ≥ 40%（目标 ~600 tokens）
- 核心执行循环 / HALT 条件 / 输出规范 / 约束保留在 core（这些是 role/phase 无关的全局规范）
- 旧单体 prompt 中的内容 100% 覆盖，不丢失任何指令

#### Scenario: core prompt 体积符合预算

- **WHEN** `buildAgentSystemPrompt('assistant')` 且 phase = `'planning'`
- **THEN** `core.text` 的 `estimateTokens()` ≤ 800

#### Scenario: building phase 加载了 workflow recipe

- **WHEN** phase = `'building'` 调用 `buildSkillsPromptByPhase('building')`
- **THEN** 返回文本含 `video_workflow_recipe` SKILL 的 Path A/Path B 指令

#### Scenario: 简单查询 phase 不加载 workflow recipe

- **WHEN** phase = `'idle'` 且用户消息是 `'画布当前什么状态'`
- **THEN** 返回的 `skills.text` 不含 Path A/Path B 细节，仅含 canvas 查询相关技能

### Requirement: Multimodal Input SKILL on Demand

用户图片处理协议（原 `chatPromptBuilder.ts:540-569`）SHALL 迁移为新 SKILL 模块 `multimodal_input`，仅在当前请求 `imageCount > 0` 时加载。

要求：

- SKILL 注册在现有 SKILL 注册表，但 `buildSkillsPromptByPhase` 增加一个"触发器"参数 `{ hasImages?: boolean }`
- `hasImages: false` 时该 SKILL 不进 prompt
- 无图查询场景下的 system prompt 体积 MUST 比旧版下降 ≥ 15%

#### Scenario: 无图查询不加载 multimodal SKILL

- **WHEN** 用户消息不含图片
- **THEN** system prompt 不含 `inject_user_images` / `classify_image` 的协议说明

#### Scenario: 带图查询加载 multimodal SKILL

- **WHEN** 用户消息含 ≥ 1 张图片
- **THEN** system prompt 含路由规则表 + 典型场景指引

#### Scenario: 切换有无图不影响 core 段

- **WHEN** 同一会话先无图提问，再附图提问
- **THEN** 两次 `core.text` 完全一致（不破坏缓存）

