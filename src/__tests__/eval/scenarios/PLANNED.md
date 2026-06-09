# Planned Scenarios — Baseline Expansion

> Six additional scenarios drafted for the next baseline expansion. Each
> entry has the user prompt, expected tool sequence, mock backend
> overrides, and verifier sketch. Two of these (`04` and `08`) are
> already shipped as `.ts` files; the remaining four are pending
> validation against live tool handlers before promotion.
>
> When promoting a planned scenario:
> 1. Convert this entry to a real `.ts` next to `13-vision-edit-prompt.ts`
> 2. Run `npm run eval -- --only NN-name` and confirm green
> 3. `npm run eval:update` to fold the new metrics into
>    `@d:\PythonProject\lang-video-work-flow\eval-baseline.json`

---

## Why expand?

Current baseline (8 scenarios after 2026-05-10 update) covers
`generate_workflow` happy paths, direct node creation (`04`),
tool discovery (`08`), and the three vision-verify branches. Important
capabilities live in the codebase with no E2E coverage:

- `agent-pro-upgrade`: multimodal first-turn, memory scope, phase state
- `agent-tool-response-budget`: 25k truncation behaviour
- `agentLoopControl`: hard-stop on stall / loop
- `character-asset-library`: `@assetId` resolution at execute time

This file enumerates the gaps with concrete, runnable designs.

---

## 04 · `04-batch-execute` — `[SHIPPED]`

**Intent** — verify the Agent dispatches `batch_execute` instead of
N sequential `execute_node` calls when the user says "执行所有".

**Source** — `@d:\PythonProject\lang-video-work-flow\src\__tests__\eval\scenarios\04-batch-execute.ts`

---

## 05 · `05-memory-recall` — pending

**Intent** — Agent retrieves a previously-saved memory and applies it
without prompting the user again.

**User message** — "继续上次那个赛博朋克角色，做一个新场景"

**Initial canvas** — empty

**Pre-seeded memory** (set via `agentMemoryStore.upsert` in the runner
before the user message):

```ts
{
  id: 'mem_linxia',
  scope: 'project',
  tags: ['character', 'cyberpunk', 'protagonist'],
  content: '林夏：年轻亚裔女性，红发，黑色皮夹克，赛博朋克美学'
}
```

**Expected tool calls** (ordered) — `recall_memory` →
`create_character_grid` → `verify_task`

**mockLLMScript** —

```ts
roundCall('recall_memory', { query: '赛博朋克 角色' })
roundCall('create_character_grid', { name: '林夏', description: '<from recall>', style: 'anime' })
roundCall('verify_task', {})
roundFinish('已根据上次的设定创建林夏的角色九宫图。')
```

**Verifier checks**

- `recall_memory` was called with a non-empty `query`
- New `characterGrid` node exists with `name === '林夏'`
- The new node's `description` contains `cyberpunk` (proves recall fed
  the create call)

**Risk** — depends on `agentMemoryStore` exposing a test-friendly
`upsert` helper; otherwise the runner needs a small helper.

---

## 06 · `06-phase-gating` — pending

**Intent** — verify Tier 3 verify tools are exposed only after
`set_phase('reviewing')`, not before.

**User message** — "我先把这些工作流看一下" → "确认所有镜头都对"

**Two-turn structure**:
- Turn 1: idle phase, expect Tier 1+2 tools available, no
  `verify_image_semantic`
- Turn 2: after `set_phase('reviewing')`, `verify_image_semantic`
  becomes callable

**Expected tool calls** (ordered) —
`set_phase` → `get_canvas_state` → `verify_image_semantic`

**mockLLMScript** —

```ts
roundCall('set_phase', { phase: 'reviewing', reason: '用户要审查' })
roundCall('get_canvas_state', {})
roundCall('verify_image_semantic', { nodeId: 'img_pre_seeded', expectedSubjects: ['character'], threshold: 70 })
roundFinish('reviewing 阶段已开启，画面校验通过。')
```

**Verifier checks**

- `set_phase` succeeded with `phase === 'reviewing'`
- `verify_image_semantic` is the third call (proves it became
  available after the phase change)
- `agentMemoryStore.currentPhase === 'reviewing'` after the run

**Risk** — depends on `agentMemoryStore` snapshot being included in
verifier context. Not currently exposed; needs a thin runner extension.

---

## 07 · `07-budget-truncation` — pending

**Intent** — verify `withResponseBudget` truncates `get_canvas_state`
output on a large canvas and emits the structured `[truncated:` hint.

**Initial canvas** — synthesised 50 nodes (procedurally generated in
the scenario file):

```ts
nodes: Array.from({ length: 50 }, (_, i) => ({
  id: `node_${i}`,
  type: 'imageGen',
  position: { x: i * 60, y: 100 },
  data: { label: `镜头${i}`, prompt: 'lorem ipsum '.repeat(40) },
}))
```

**User message** — "看看画布上现在有什么"

**Expected tool calls** — `get_canvas_state` (concise default)

**mockLLMScript** —

```ts
roundCall('get_canvas_state', {})
roundFinish('画布有 50 个 imageGen 节点。')
```

**Verifier checks**

- `get_canvas_state` returned successfully
- `tool.message.length` <= equivalent of 25k tokens (≈100k chars)
- Either the message contains `[truncated:` (concise truncation) **or**
  message contains all 50 node ids in concise form (no truncation
  needed because concise formatter compressed enough)

**Risk** — verifier needs to compute "equivalent tokens" without
re-implementing the runner's `estimateTokens`; one option is to expose
the budget hint as a structured field rather than parsing the message.

---

## 08 · `08-discover-tools` — `[SHIPPED]`

**Intent** — Agent uses `discover_tools` to surface a Tier 3 tool not
loaded by default in this turn.

**Source** — `@d:\PythonProject\lang-video-work-flow\src\__tests__\eval\scenarios\08-discover-tools.ts`

---

## 09 · `09-asset-resolve` — pending

**Intent** — `@char_linxia` in a prompt input is expanded to full
appearance text + reference image attached at execute time.

**Initial canvas** — 1 imageGen node with prompt `@char_linxia walks
into a dim alley`, plus a pre-seeded asset entry in `assetStore`:

```ts
{
  id: 'char_linxia',
  type: 'character',
  name: '林夏',
  appearance: '红发亚洲女性，黑色皮夹克，赛博朋克',
  referenceImages: ['mock://assets/linxia-ref.png'],
}
```

**User message** — "把镜头 1 跑一下"

**Expected tool calls** — `get_canvas_state` → `resolve_prompt_refs` →
`execute_node`

**Verifier checks**

- `resolve_prompt_refs` returned an `expanded` field that no longer
  contains `@char_linxia`
- The expansion contains both `红发` and `赛博朋克`
- The execution carried `referenceImages: ['mock://assets/linxia-ref.png']`
  to the mock image backend

**Risk** — needs a way to seed `assetStore` from `initialCanvas` (today
`assetStore` is independent of canvas JSON).

---

## 10 · `10-loop-stop` — pending

**Intent** — verify the multi-dim loop controller hard-stops on a
self-loop (same `tool+args` 5 times in a row) instead of running away.

**User message** — "不停地查一下画布"

**mockLLMScript** — 5 identical `get_canvas_state` rounds + nothing
else (no `roundFinish`). The runner is expected to terminate the loop
itself via the controller's hard-stop, not by mock script exhaustion.

**Expected tool calls** — `get_canvas_state` × 5 (then halt)

**Verifier checks**

- `toolLog.length` is exactly 5 (controller stopped on the 5th identical
  call)
- The `finalMessage` contains a structured `StopReason` mention (e.g.
  `[CONTROLLER]` or `loop_detected`)
- The `agentStats.haltedReason` field exposes a machine-readable code

**Risk** — `roundFinish` is currently mandatory at script end (mock
LLM throws on exhaustion). Need an "open-ended" mode for stall/loop
testing, or a workaround where `roundFinish` exists but is unreachable.

---

## Summary of Risk-by-Scenario

| ID | Risk | Effort to ship |
|----|------|----------------|
| 04 | low — uses already-tested tools | shipped |
| 05 | medium — needs memory pre-seeding helper | ~1 h |
| 06 | medium — verifier needs phase snapshot | ~1 h |
| 07 | medium — verifier needs structured budget metadata | ~1.5 h |
| 08 | low — uses `discover_tools` directly | shipped |
| 09 | medium-high — needs `assetStore` test bridge | ~2 h |
| 10 | medium — needs open-ended mock LLM mode | ~1.5 h |

Total estimated effort to fully realise this expansion: **~7 hours**
spread across 4 sittings (per-task TDD, not in one push).

---

## Tracking

This file lives next to the actual scenarios so anyone exploring
`scenarios/` sees both shipped and planned coverage in one glance.
Once a planned entry ships, mark it `[SHIPPED]` and link to the `.ts`.

Status board mirrored in
`@d:\PythonProject\lang-video-work-flow\ROADMAP.md` under the
"Verification expansion" line.
