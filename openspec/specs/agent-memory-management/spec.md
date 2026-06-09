# agent-memory-management Specification

## Purpose

让 Agent 的长期记忆从扁平 localStorage 升级为 **scoped + relevance + auto-compact** 的三段管理模式 — 借鉴 Claude Code 的 hierarchical `CLAUDE.md` / `/memory` 设计。每条记忆带 `scope: 'session' | 'project' | 'global'`，`project` 域以 `projectId` 锚定到画布；`session` 在 reload 后清除，`project` 在不同画布间隔离，`global` 全用户域常驻。每轮 Agent 调用前按 tag-overlap + pinned 优先级**自动注入** top-K (默认 5) 相关记忆到 system prompt，总长度 cap 在 800 字符；新工具 `forget_memory({ id?, tag?, scope?, olderThan? })` 提供精准遗忘，零 filter 调用直接 reject；`session` 域条数 > 20 时旧 10 条自动 collapse 成 "会话上下文摘要 (10 条)" rollup 条目，body cap 600 字符，`project` / `global` 不受影响。这套机制让 Agent 在长会话或跨项目协作里既"记得住关键设定"又"不会被旧噪声淹没"。

## Requirements

### Requirement: Memory Entries Carry Scope and Project Binding

Every memory entry SHALL have a `scope: 'session' | 'project' | 'global'`
field and, when `scope === 'project'`, a `projectId` that ties it to a
specific canvas. The `save_memory` tool gains an optional `scope`
parameter (default `'session'`).

#### Scenario: Session-scoped memory stays within current tab session

- **WHEN** the Agent calls `save_memory({content: "user prefers 4:3
  aspect ratio", scope: "session"})`
- **THEN** the entry is pushed to `memories[]` with `scope: 'session'`
  and is NOT returned by `recall_memory` after the page reloads

#### Scenario: Project-scoped memory only loads for matching project

- **WHEN** a memory is saved with `scope: 'project'` while the user is on
  canvas project-A, and the user later switches to project-B
- **THEN** `recall_memory()` on project-B does not surface that entry
- **AND** when the user returns to project-A, the entry is available again

#### Scenario: Global memory persists across projects

- **WHEN** a memory is saved with `scope: 'global'` (e.g. "user signs off
  as Alice in every video")
- **THEN** it is available via `recall_memory` on every project

#### Scenario: Backward-compat — legacy entries default to global

- **WHEN** the persisted store is loaded and an entry lacks a `scope`
  field
- **THEN** the migration pass assigns `scope = 'global'`

### Requirement: Relevant Memories Are Auto-Injected into System Prompt

On every Agent round, the system prompt SHALL include up to K=5 memories
chosen by tag-overlap with the current user message plus `pinned: true`
entries. Total injected memory block is capped at 800 characters.

#### Scenario: Tag overlap ranking picks relevant entries

- **WHEN** the user message is `"给 Alice 加一个新造型"` and memories
  include one tagged `["character","Alice"]` and one tagged `["model",
  "seedance"]`
- **THEN** the Alice entry is ranked higher and included first

#### Scenario: Pinned entries always included

- **WHEN** a memory has `pinned: true`
- **THEN** it is always among the top-K injected memories even if its
  tags don't overlap the current message

#### Scenario: 800-char cap truncates tail

- **WHEN** ranked memories total > 800 chars
- **THEN** the injection stops at the last entry that fits, with a
  `...(剩余 N 条见 recall_memory)` footer

### Requirement: `forget_memory` Tool Removes Entries

A new Tier 3 tool `forget_memory({ id?, tag?, scope?, olderThan? })` SHALL remove memory entries matching any provided filter, rejecting calls with zero filter parameters.

#### Scenario: Forget by id

- **WHEN** the Agent calls `forget_memory({id: "mem-123"})`
- **THEN** the entry with that id is removed from `memories[]`

#### Scenario: Forget by tag

- **WHEN** the Agent calls `forget_memory({tag: "obsolete"})`
- **THEN** every entry whose `tags` array includes "obsolete" is removed

#### Scenario: Forget by age

- **WHEN** the Agent calls `forget_memory({olderThan: 604800000})` (7 days)
- **THEN** entries with `timestamp < Date.now() - 604800000` are removed

#### Scenario: Missing filter rejects

- **WHEN** `forget_memory({})` is called with no filters
- **THEN** the tool returns `success: false` with a usage hint

### Requirement: Session-Scope Memories Auto-Summarise When Exceeding Cap

When the count of `scope === 'session'` memories exceeds 20 after a `save_memory` call, the oldest 10 session-scoped entries SHALL be collapsed into a single rollup entry titled `会话上下文摘要 (10 条)` with body capped at 600 characters.

#### Scenario: Auto-compaction triggers

- **WHEN** 21 session memories exist after a save
- **THEN** the 10 oldest are removed and 1 new rollup is inserted at their
  chronological position, preserving total "information" while cutting the
  list length by 9

#### Scenario: Project / global scoped memories untouched

- **WHEN** auto-compaction triggers
- **THEN** only `scope === 'session'` entries are affected; project and
  global scoped entries are left alone regardless of count
