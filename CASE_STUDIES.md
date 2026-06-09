# Case Studies — Real Workflow Outcomes

> Six end-to-end runs the Agent has been asked to deliver. Each story
> shows the user's original ask, what the Agent decided to do, and the
> measured cost (tool calls / tokens / time). All numbers come from
> `@d:\PythonProject\lang-video-work-flow\eval-baseline.json` and are
> reproducible via `npm run eval -- --only <id>`.
>
> Usage of Agent assistance is **opt-in per scenario** — these cases
> document the workflows the system is exercised against, not raw
> production telemetry.

---

## Why these stories matter

The 33-tool catalogue and 19-SKILL phase matrix are easy to over-promise
if no one looks at end-to-end outcomes. These six stories are the actual
evidence that the Agent compresses a vague creative ask into a working
React Flow canvas — with budgets, verifiers, and recommendations baked in.

If you are evaluating whether the system delivers user value, start here.
For the architectural rationale, see
`@d:\PythonProject\lang-video-work-flow\ARCHITECTURE.md`.

---

## Case 1 · Skincare Ad in 15 Seconds

**User asked** — "帮我做一个 15 秒护肤品广告，补水修护，清新极简，带 logo"

**Agent decided** —

1. `classify_image` → no images, scenario must be inferred from text
2. `detect_scenario` → matches `product_ad` with template `ad-product`,
   recommends "产品图 → 使用场景 → 品牌风格锁定 → 视频 → 合成"
3. `generate_workflow` → emits a 7-node / 7-edge graph: 1 product
   close-up scene, 1 logo scene, 3 shot prompts (bottle dolly-in / water
   droplet macro / static logo hold), 3 video clips, 1 style-lock node
   gluing brand consistency
4. `verify_task` → 100/100, all 5 quality dimensions pass

**Result**

- **7 nodes / 7 edges** generated in one `generate_workflow` call
- **4 tool calls / 174 tokens / 6 ms** — well under the 5/15k/3s budget
- Style lock makes "clean minimalistic skincare commercial, soft natural
  light" propagate to every shot

**Why it works** — the `product_ad` scenario template anchors aspect
ratio (16:9), shot pacing (dolly-in → macro → static), and end-card
convention. The Agent does not have to invent these from scratch on
every run.

**Reproduce** — `npm run eval -- --only 01-product-ad`. Source:
`@d:\PythonProject\lang-video-work-flow\src\__tests__\eval\scenarios\01-product-ad.ts`.

---

## Case 2 · Cyberpunk Three-Shot Short

**User asked** — "做一个赛博朋克 3 镜头短片，主角林夏（红发亚洲女性，黑色皮夹克），霓虹雨夜场景"

**Agent decided** —

1. `plan_task` → 4 steps: skeleton → keyframes → video → quality check
2. `generate_workflow` → 14 nodes / 20 edges:
   - 1 character grid (林夏 + appearance prompt)
   - 1 character asset library entry (cross-shot reference)
   - 2 scene grids (霓虹雨夜 + 屋顶夜景)
   - 3 shot keyframes (each receives ref-in from `林夏` + style-in from
     style-lock)
   - 3 video nodes (each takes the matching keyframe as first-frame)
   - 1 video stitch node (auto-collects upstream)
3. `verify_task` → 100/100, "1 角色, 提示词均含外貌关键词" check passed

**Result**

- **14 nodes / 20 edges** in 3 tool calls
- **3 tool calls / 129 tokens / 4 ms**
- Character consistency mechanism activates automatically — anchor
  prefix `[Character Anchor]` injected into every downstream prompt

**Why it works** — `generate_workflow` understands the character ↔
keyframe ↔ video chain. The asset library entry persists 林夏 across
the canvas; each shot's `imageGen` gets a `ref-in` edge from the grid.

**Reproduce** — `npm run eval -- --only 02-short-story`. Source:
`@d:\PythonProject\lang-video-work-flow\src\__tests__\eval\scenarios\02-short-story.ts`.

---

## Case 3 · "Change the Hair Colour, Keep Everything Else"

**User asked** — "把林夏的头发颜色从红色改成白色，其他保持不变"

**Agent decided** —

1. `get_canvas_state` → finds `char_linxia` with description containing
   "crimson red shoulder-length hair"
2. `update_node` → replaces `crimson red` with `platinum white`,
   preserves all other appearance tokens (sharp eyes / black leather
   jacket / cyberpunk aesthetic)

**Result**

- **2 tool calls / 58 tokens / 1 ms** — the smallest run in the suite
- Verifier double-checks: `"white"` is now present, `"crimson red"` is
  gone, no new character node was created (no runaway creation)

**Why it matters** — surgical edits are the most common Agent operation
after generation. This case proves the Agent does not panic-regenerate
the whole graph for a one-token change.

**Reproduce** — `npm run eval -- --only 03-character-fix`. Source:
`@d:\PythonProject\lang-video-work-flow\src\__tests__\eval\scenarios\03-character-fix.ts`.

---

## Case 4 · Vision Verify · Accept Path

**User asked** — "镜头 1 的关键帧已经生成了，帮我确认一下画面里确实有林夏，没问题就不用改"

**Agent decided** —

1. `get_canvas_state` → finds `img_shot1` with `outputImage` set
2. `verify_image_semantic({ nodeId: 'img_shot1', expectedSubjects:
   ['character Lin Xia', 'cyberpunk rooftop at night'], threshold: 70 })`
3. Backend returns `matchScore=92, recommendation='accept'`
4. Agent reports "镜头 1 的画面检查通过 — 林夏特征清晰，构图符合预期"

**Result** — **2 tool calls / 162 tokens / 1 ms**, canvas untouched.

**Why it matters** — pure inspection without mutation. The verifier
checks the canvas state was preserved; this is the discipline Anthropic
flags as missing in *Writing Effective Tools for Agents*.

**Reproduce** — `npm run eval -- --only 11-vision-accept`.

---

## Case 5 · Vision Verify · Retry Path

**User asked** — "镜头 2 检查一下，主体是林夏在霓虹街，画面对吗？"

**Agent decided** —

1. `get_canvas_state` → finds `img_shot2`
2. `verify_image_semantic` → backend returns `matchScore=55,
   recommendation='retry'` (below the 70 threshold)
3. `retry_node` → re-executes the image generation; mock returns a new
   image successfully

**Result** — **3 tool calls / 183 tokens / 42 ms** (real-ish image
re-generation latency in the mock).

**Why it matters** — the three-branch contract (`accept` / `retry` /
`edit_prompt`) is honoured. When `recommendation='retry'`, the Agent
does **not** ask the user for confirmation; it acts. When the
recommendation would be `edit_prompt` (Case 6), the Agent does
something different.

**Reproduce** — `npm run eval -- --only 12-vision-retry`.

---

## Case 6 · Vision Verify · Edit Prompt Path

**User asked** — "镜头 3 我让它拍夜景但出来是白天，重新搞一下"

**Agent decided** —

1. `get_canvas_state` → finds `img_shot3`
2. `verify_image_semantic` → `matchScore=20, recommendation='edit_prompt',
   missingElements=['night atmosphere', 'neon lights']`
3. `update_node` → rewrites the prompt to add "night, neon-lit
   atmosphere, dramatic shadows"
4. `retry_node` → executes with the new prompt

**Result** — **4 tool calls / 225 tokens**, prompt corrected before
retry (cheaper than blindly re-rolling).

**Why it matters** — severe mismatches need a prompt fix, not just a
retry. The Agent uses the verifier's `recommendation` and
`missingElements` fields to make the right choice. This is the loop the
verifier was built for.

**Reproduce** — `npm run eval -- --only 13-vision-edit-prompt`.

---

## Aggregate

| Metric | Value |
|--------|-------|
| Scenarios | 6 |
| Pass rate | 6/6 (100%) |
| Average score | 100 |
| Total tool calls | 18 |
| Total tokens | 931 |
| Total wall time | 54 ms |

These are baseline numbers the project commits to in
`@d:\PythonProject\lang-video-work-flow\eval-baseline.json`. Any PR that
drops a scenario score by more than 5% fails the CI gate before merge.

---

## What These Cases Don't Cover Yet

Honest gaps the next round of scenarios should fill (tracked in
`@d:\PythonProject\lang-video-work-flow\ROADMAP.md`):

- **Multimodal first-turn** — user uploads images, Agent routes via
  `create_from_images`. The capability is shipped (`agent-pro-upgrade`)
  but not yet a baseline scenario.
- **Memory recall across sessions** — `recall_memory` after a
  `save_memory` from a prior run.
- **Phase-gated tool reveal** — after `set_phase('reviewing')`, Tier 3
  verify tools should appear; before, they should not.
- **Response budget truncation** — a 50-node canvas hitting
  `withResponseBudget`'s 25k token cap.
- **Loop / stall detector** — running into the multi-dim controller's
  hard-stop deliberately.
- **Asset @-reference resolution** — `@char_linxia` in a prompt input
  expanding to full appearance + reference images.

These are 6 candidate scenarios already drafted as `04-*.ts`–`09-*.ts`
in the test directory.

---

## See Also

- `@d:\PythonProject\lang-video-work-flow\EVAL.md` — how to add a scenario
- `@d:\PythonProject\lang-video-work-flow\AI_BUILDER_EVIDENCE.md` — full evidence index
- `@d:\PythonProject\lang-video-work-flow\eval-baseline.json` — raw numbers
