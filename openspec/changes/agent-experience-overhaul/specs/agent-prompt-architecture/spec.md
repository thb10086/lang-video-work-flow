## ADDED Requirements

### Requirement: Backend Hosts Prompt Construction

The Agent system prompt SHALL be constructed on the backend (`server/app/agents/prompts/`). The frontend `chatPromptBuilder.ts` MAY remain temporarily as a thin proxy wrapper, but its body SHALL be reduced to a stub that delegates to a backend `GET /api/agent/prompts/preview` endpoint (used only by tests / debug UI), and SHALL be deleted after Phase 4.

The backend prompt construction MUST produce identical `PromptSegment[]` shape and ordering to the legacy frontend implementation, validated by side-by-side fixture diff tests during Phase 0.

#### Scenario: Backend produces equivalent segments

- **WHEN** running the same `(role, phase, imageCount, projectId)` fixture through legacy frontend builder vs new backend builder
- **THEN** both return arrays with identical `id`, `stability`, and byte-equal `text` fields

#### Scenario: Frontend proxy maintains compatibility

- **WHEN** existing test files import `buildAgentSystemPrompt` from `chatPromptBuilder`
- **THEN** the import resolves to a thin proxy that fetches from backend; tests pass without modification

### Requirement: Few-Shot Examples SKILL

A new SKILL module `agent-examples` SHALL be added that injects 1-2 golden trajectory examples per `(role × phase)` combination. Each example MUST contain:

- A representative user message
- The expected tool-call sequence (using new `<noun>.<verb>` names)
- The expected final assistant text

Examples MUST be selected based on the current `role` and `phase` to keep token budget under +200 tokens vs the no-examples baseline.

#### Scenario: cinematographer×production loads cinematographer-specific example

- **WHEN** the prompt is built with `role='cinematographer'` and `phase='production'`
- **THEN** the SKILL section includes a 5-段式 video prompt example, not a director-style example

#### Scenario: Token budget check

- **WHEN** the prompt with `agent-examples` SKILL is generated for any (role, phase)
- **THEN** the SKILL adds ≤ 200 tokens to the prompt total (verified by unit test)

### Requirement: Role × Phase Matrix Selection

The backend prompt builder SHALL implement an explicit `(role, phase) → SKILL set` matrix that supersedes the current `PHASE_SKILL_MAP`. Cells in the matrix MAY override default phase mapping with role-specific SKILL boost (e.g., `cinematographer × production` adds `cinematography_vocabulary` SKILL).

The matrix MUST be exported as a constant for inspection and tested against a fixture covering all 5 roles × 6 phases = 30 cells.

#### Scenario: Director planning gets storyboard structure SKILL

- **WHEN** building prompt with `role='director', phase='planning'`
- **THEN** the loaded SKILLS include `storyboard_structure_best_practices` (a new SKILL)

#### Scenario: All matrix cells produce non-empty SKILL set

- **WHEN** iterating all 30 cells of the matrix
- **THEN** every cell yields ≥ 1 SKILL; no empty result

## MODIFIED Requirements

### Requirement: Four-Layer Prompt Segments

`buildAgentSystemPrompt()` SHALL 返回结构化的 `PromptSegment[]`，每段携带稳定性等级，不再返回单体字符串。

`PromptSegment` MUST：

- `id`：`'core' | 'role' | 'skills' | 'examples' | 'memory' | 'image_hint' | 'canvas_state' | 'dynamic'`（新增 `examples` / `memory` / `image_hint` / `canvas_state` 段，承接当前散落字段）
- `text`：纯文本内容
- `stability`：`'stable' | 'semi-stable' | 'dynamic'`，其中 `core` 固定 `stable`、`role` 固定 `semi-stable`、`skills` 固定 `semi-stable`、`examples` 固定 `semi-stable`、`memory`/`image_hint`/`canvas_state` 固定 `dynamic`
- `cacheable`：stable/semi-stable 为 true，dynamic 为 false

段落内容约束：

- `core`：使命、执行循环、HALT 条件、输出规范（**≤ 400 tokens**，所有会话恒定 — 比旧版减半）
- `role`：roleId 对应的 role prompt
- `skills`：`buildSkillsPromptByPhase(phase)` 输出（仅随 phase × role 变）
- `examples`：从 `agent-examples` SKILL 选出的 1-2 个 golden trajectory（按 role × phase）
- `memory`：top-K 相关记忆（≤ 800 chars）
- `image_hint`：`imageCount > 0` 时的多模态注入 hint
- `canvas_state`：当前画布状态快照（每轮都变）

#### Scenario: 返回 ≥ 4 段且标签正确

- **WHEN** 调用 `buildAgentSystemPrompt('assistant', { userMessage: 'test' })`
- **THEN** 返回数组 length ≥ 4，包含 id = `'core'/'role'/'skills'/'canvas_state'` 的段；当 phase 非 idle 时还包含 `examples`；当用户附图时还包含 `image_hint`；当有相关记忆时还包含 `memory`

#### Scenario: 同一 role + phase 下 core 与 role 字节完全相同

- **WHEN** 两次调用都为 `'assistant'` 且画布 phase 同为 `'planning'`，但画布节点不同
- **THEN** 两次结果的 `core.text` 和 `role.text` 完全相等（便于缓存）

#### Scenario: 切换 phase 时 core 不变、skills/examples 变

- **WHEN** phase 从 `'planning'` 切到 `'building'`
- **THEN** `core.text` 不变，`skills.text` 与 `examples.text` 变化（加载了 building phase 的 SKILLS 与 golden trajectory）

#### Scenario: core 段 token 预算严格

- **WHEN** 估算 `core.text` 的 token 数
- **THEN** ≤ 400 tokens（旧版 ~700 tokens）；超过即 CI 失败

### Requirement: Pipeline Instructions Extracted to SKILL Modules

`buildAgentSystemPrompt` 中 `core`（旧 `stablePrefix`）的"制片 Pipeline"SHALL 已迁移到 SKILL `video_workflow_recipe`，仅在 `planning`/`building`/`executing` phase 按需加载。本变更进一步将"执行循环 4 步详细解释 / 错误处理协议表 / 约束 5 条 / PromptCraft Quick Ref"也下沉到 SKILL `agent_essentials`，按 phase 加载。

迁移要求：

- 新 SKILL `agent_essentials` 必须与现有 SKILL 结构一致（`SkillDefinition` 类型，`PHASE_SKILL_MAP` 中列出）
- 迁移后 `core.text` token 数 MUST 下降到 ≤ 400（约旧版 700 的一半）
- 核心使命 / HALT 条件 / 输出规范保留在 `core`（这些是 role/phase 无关的全局规范）
- 旧单体 prompt 中的内容 100% 覆盖，不丢失任何指令

#### Scenario: core prompt 体积符合新预算

- **WHEN** `buildAgentSystemPrompt('assistant')` 且 phase = `'planning'`
- **THEN** `core.text` 的 `estimateTokens()` ≤ 400

#### Scenario: building phase 加载了 workflow recipe + essentials

- **WHEN** phase = `'building'` 调用 `buildSkillsPromptByPhase('building')`
- **THEN** 返回文本含 `video_workflow_recipe` 与 `agent_essentials` 两个 SKILL 的内容

#### Scenario: 简单查询 phase 不加载 recipe

- **WHEN** phase = `'idle'` 且用户消息是 `'画布当前什么状态'`
- **THEN** 返回的 `skills.text` 不含 Path A/Path B 细节，仅含 canvas 查询相关技能；core 段保持 ≤ 400 tokens
