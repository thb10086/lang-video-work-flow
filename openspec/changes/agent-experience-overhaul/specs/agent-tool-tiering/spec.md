## ADDED Requirements

### Requirement: Tools Are Categorized into Three Tiers

The Agent tool registry SHALL classify every tool into exactly one of three tiers:

- **Tier 1 (Core, ~10)**: Always loaded. Navigation, verification, meta-tools (`canvas.get_state`, `node.execute`, `node.execute_parallel`, `verify_task`, `canvas.connect`, `canvas.update_node`, `phase.set`, `discover_tools`, `agent.delegate`, `canvas.undo`).
- **Tier 2 (Creation, ~16)**: Loaded when user intent matches creation keywords or canvas is empty. All `create_*_node` family + `canvas.add_node` + `canvas.dry_run`.
- **Tier 3 (Advanced, ~22)**: Loaded on demand via keyword match or `discover_tools`. Memory ops, planning, optimization, asset library, semantic verification, bulk ops.

The tier mapping MUST be a single source of truth in `tool_registry.py`; tier membership in tests SHALL be validated against this registry, not hardcoded.

#### Scenario: Tier1 tools always included

- **WHEN** `getAgentTools(...)` is called with any input
- **THEN** the returned tool list contains every Tier 1 tool (10 names)

#### Scenario: Empty canvas triggers Tier 2

- **WHEN** the canvas has 0 nodes
- **THEN** the returned tool list includes Tier 2 creation tools regardless of message content

#### Scenario: Memory keywords trigger Tier 3 memory tools

- **WHEN** the user message contains "记住" / "remember" / "保存"
- **THEN** the returned tool list includes `memory.save` / `memory.recall`

### Requirement: Phase-Based Tool Whitelisting

When `phase != 'idle'`, the tool selector SHALL apply a phase-specific allow/deny overlay on top of tier filtering:

| Phase | Extra allow | Extra deny |
|-------|-------------|-----------|
| idle | — (tier heuristic only) | — |
| planning | `plan.create`, `memory.save`, `memory.recall` | most `*.create_node` (allow exploration only) |
| designing | `character.create_grid`, `scene.create_grid`, `style.create_lock` | `node.execute`, `node.retry` |
| building | all `*.create_node`, `canvas.connect` | — |
| reviewing | `quality.review_*`, `verify_task` | `*.create_node`, `canvas.delete_node` |
| executing | `node.execute*`, `node.retry`, `node.batch_execute`, `node.get_output` | `*.create_node` |

If `phase=idle`, no overlay applies and tier heuristic alone determines the tool list.

#### Scenario: planning phase denies create_video_node

- **WHEN** phase=`planning` and `getAgentTools()` runs
- **THEN** the returned list does NOT contain `node.create_video` / `create_video_node`; it does contain `plan.create`

#### Scenario: reviewing phase denies destructive tools

- **WHEN** phase=`reviewing`
- **THEN** the returned list excludes `canvas.delete_node` and `canvas.add_node` (any creation); it includes `quality.review_image`

#### Scenario: idle phase preserves legacy behavior

- **WHEN** phase=`idle`
- **THEN** the returned list matches the pre-phase-overlay tier-only result; existing 356 tests pass without changes

### Requirement: Discover Tools Meta-Tool Always Available

`discover_tools` SHALL be in Tier 1 (always loaded) so the LLM can escape any tier/phase restriction by explicitly asking for additional tools. The result MUST include each tool's `tier`, `risk_level`, and one-line `description`, sized to fit ≤ 25K tokens (budgeted via `withResponseBudget`).

#### Scenario: discover_tools returns full registry on empty query

- **WHEN** the agent calls `discover_tools({})`
- **THEN** the response lists every registered tool with name/tier/risk/description; total ≤ 25K tokens (truncated with hint if exceeded)

#### Scenario: discover_tools filters by namespace

- **WHEN** the agent calls `discover_tools({ namespace: 'memory' })`
- **THEN** only tools matching `memory.*` (and legacy aliases like `save_memory`) are returned

### Requirement: Tier Selection Inputs Are Pure Functions

`selectTier(message, ctx)` SHALL be a pure function with deterministic output for given input. The function MUST be exported and unit-testable without instantiating the runtime.

`ctx` MUST include:
- `canvasEmpty: boolean`
- `phase: PhaseId`
- `forceTier?: TierId[]` (caller override)
- `historyHints?: { recentToolCalls: string[] }` (lightweight signal for tier-3 add-ons)

#### Scenario: Same input yields same tier set

- **WHEN** `selectTier('帮我做赛博短片', { canvasEmpty: true, phase: 'idle' })` runs twice
- **THEN** both invocations return identical `{ tiers, addOns }` with no side effects
