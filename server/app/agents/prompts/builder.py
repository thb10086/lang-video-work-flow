"""Layered system-prompt builder — Python parity of `buildAgentSystemPromptSegments`.

The Python builder is *pure*: it takes a `BuildOptions` instance with all
external context already resolved (role text, skills text, canvas
snapshot, memory recall string, image count, default video model) and
emits an ordered `list[PromptSegment]`.

Segment ordering — must match `chatPromptBuilder.ts` byte-for-byte:

    1. core           (stable)        ← mission / loop / errors / output / constraints
    2. role           (semi-stable)   ← role-specific preamble, injected verbatim
    3. skills:<phase> (semi-stable)   ← phase-scoped SKILLS, elided if empty
    4. image_hint     (dynamic)       ← only present when image_count > 0
    5. memory         (dynamic)       ← only present when memory_context truthy
    6. canvas_state   (dynamic)       ← always present, always last

The `core` segment text is hand-translated from the TS literal; the
sole interpolated value is `{default_video_model}` so the runtime can
swap defaults per-deploy without touching the prompt copy.

If the upstream TS source changes, mirror it here AND update the
fixtures in `server/tests/test_prompt_builder.py` so parity is provable.
"""

from __future__ import annotations

from .types import BuildOptions, PromptSegment, SystemContentBlock, CacheControl


# ============================================================
# Static prompt copy
# ============================================================
#
# Task 0.2.6 background:
#   The original TS `chatPromptBuilder.ts` core text was ~420 tokens
#   (chars/3.5 heuristic). Spec mandates the core segment stay below
#   400 tokens so it fits comfortably in Anthropic's prompt-cache hot
#   region without crowding out role/skills text. The slim copy below
#   keeps every load-bearing structural anchor (mission heading, exec
#   loop, HALT clause, model-params, output-spec, constraints, no-emoji)
#   but compacts the verbose tables/examples to single-line summaries.
#
# Where did the removed detail go?
#   The error-protocol table, output-format examples, and 5 constraint
#   lines are preserved verbatim in `ESSENTIALS_TEXT` below so a future
#   `agent_essentials` SKILL module can ship them as a phase-scoped
#   skill segment. Until that SKILL is wired up the runtime can still
#   inject `ESSENTIALS_TEXT` directly via `BuildOptions.skills_prompt`
#   if a particular session needs the full reference.
#
# Token budget proof:
#   `pytest server/tests/test_core_token_budget.py` asserts
#   `estimate_tokens(core.text) <= 400` and ships a small margin (a few
#   tokens) so future copy edits don't immediately blow the limit.
#
# {default_video_model} is filled per-call from settings.
CORE_TEMPLATE = """## 使命

通过工具调用完整驱动 AI 视频制片流程——从世界观搭建、角色设计、分镜拆解，到关键帧生成、视频合成、音频配音。**交付可用的视频素材，而非仅提供方案建议。**

## 执行循环

每轮 **分析 → 规划 → 行动 → 验证**：读画布 → 复杂任务先 `plan_task`（意图明确可跳过）→ 无依赖节点优先 `parallel_execute` 并发 → `get_node_output` 确认输出后推进。

**HALT 条件**（停止执行、向用户报告）：API Key/COS 未配置 ｜ 同一步骤连续失败 ≥3 次 ｜ 需用户决策（创意方向 / 角色选型）。

## 模型参数

节点 schema 随模型自动切换（`create_video_node`/`create_image_node`/`create_audio_node`），描述中 `[仅适用于 <ids>]` 标注非通用字段。需精确参数时走 `list_models` / `get_model_params(model_id)`；默认视频模型 `DEFAULT_VIDEO_MODEL` 当前为 {default_video_model}；不支持的字段提交时被自动过滤（前端 sanitizer + 后端 422 双保险）。

## 错误处理协议

按类分流：**暂时性**（负载/超时）→ 先跳无依赖步骤后重试；**逻辑**（参数无效/模型未注册）→ 改参或换方案；**连续失败 ≥3**→ `update_plan_step` 标 failed 后跳过；**API 过载**（429/503）→ 逐个重试不批量。

## 输出规范

执行后简短回复（3-5 句、不冗余）：成功项 → 产出 → 下一步建议；失败项 → 原因 → 处置方案；HALT → 原因 → 请用户提供。先执行后报告，不预输计划列表。

## 约束

内容专业充实（角色/场景/镜头各有层次）；每个图片/视频节点执行后必 `get_node_output` 验证；提示词英文、解释/对话/报告中文；不暴露节点 ID/坐标/实现细节；全程禁用 emoji。"""


# ESSENTIALS_TEXT — verbatim copy of detail removed from CORE_TEMPLATE in
# task 0.2.6. Future SKILL module `agent_essentials` consumes this so
# planning-phase agents can opt into the full reference. Caller can
# also inject this directly via `BuildOptions.skills_prompt` for
# sessions that need the longer form (e.g. error-recovery loops).
ESSENTIALS_TEXT = """## 执行循环（详细）

每次响应遵循 **分析 → 规划 → 行动 → 验证**：

1. **分析**：读取画布状态，理解任务的依赖链和潜在风险点
2. **规划**：复杂任务先 `plan_task` 制定步骤；意图明确时直接跳至行动
3. **行动**：最小工具集完成当前步骤，无依赖节点优先 `parallel_execute` 并发执行
4. **验证**：`get_node_output` 确认输出存在后方可推进下一步；失败参考错误处理协议

## 错误处理协议（详细）

| 错误类型 | 识别特征 | 应对策略 |
|---------|---------|---------|
| 暂时性错误 | API 负载、网络超时、未返回图片 | 先执行其他无依赖步骤，稍后重试 |
| 逻辑错误 | 参数无效、节点不存在、模型未注册 | 修改参数或更换方案 |
| 连续失败 | 同一操作失败 ≥3 次 | `update_plan_step` 标记 failed，跳过并告知用户 |
| API 过载 | 上游服务 429/503 | 逐个重试，不批量，调用间留间隔 |

## 输出规范（详细）

工具调用完成后，按以下格式回复（3-5 句，不做冗余解释）：

- **全部成功**：「已完成 [操作描述] → 产出 [内容列表] → 下一步：[具体建议]」
- **部分失败**：「[成功项] 完成；[失败项] 因 [原因] 失败 → 建议：[处置方案]」
- **HALT/阻塞**：「遇到阻塞：[原因] → 需要您：[操作指引]」

不在执行前输出计划列表，不做冗长分析，先执行后报告。

## 约束（详细）

1. **内容质量**：节点内容必须专业充实——角色有完整外貌 | 场景有空间层次 | 镜头有运镜方案
2. **验证驱动**：每个图片/视频节点执行后必须 `get_node_output` 确认输出，据此决策下一步
3. **提示词语言**：角色/场景/镜头描述使用英文；解释、对话、报告使用中文
4. **信息隔离**：禁止暴露节点 ID、内部坐标、技术实现细节
5. **无 emoji**：全程禁止使用 emoji 表情符号
"""


# Per-turn image hint string. Mirrors the TS literal exactly.
IMAGE_HINT_TEMPLATE = (
    "### 本轮输入\n\n"
    "用户上传了 {n} 张图像。可用 `create_from_images` 基于它们创建新节点"
    "（角色/场景/风格参考/编辑输入），或用 `inject_user_images` 绑定到已有节点。"
    "先用 `classify_image` 逐张分类再决定路由。"
)


# ============================================================
# Public API
# ============================================================

def build_segments(opts: BuildOptions) -> list[PromptSegment]:
    """Assemble the layered system prompt as `list[PromptSegment]`.

    Ordering (task 0.2.6 split `prompt_craft_ref` out of the core text):
      1. core              (stable)       — slim mission/loop/errors/etc
      2. prompt_craft_ref  (semi-stable)  — only when injected non-empty
      3. role              (semi-stable)
      4. skills            (semi-stable)  — elided if empty
      5. image_hint        (dynamic)      — only when image_count > 0
      6. memory            (dynamic)      — elided if empty
      7. canvas_state      (dynamic)      — always present, always last

    See module docstring for stability semantics.
    """
    segments: list[PromptSegment] = []

    # ── Segment 1: core (stable) — ≤ 400 tokens by design ──
    core_text = CORE_TEMPLATE.format(default_video_model=opts.default_video_model)
    segments.append(PromptSegment(id="core", stability="stable", text=core_text))

    # ── Segment 2: prompt_craft_ref (semi-stable) — elided when empty ──
    # Promoted out of core in 0.2.6 so the slim core stays under 400
    # tokens and the (often large) quick-ref text owns its own cache
    # breakpoint. Skipped entirely when callers pass an empty string.
    if opts.prompt_craft_ref:
        segments.append(PromptSegment(
            id="prompt_craft_ref",
            stability="semi-stable",
            text=opts.prompt_craft_ref,
        ))

    # ── Segment 3: role (semi-stable) ──
    segments.append(PromptSegment(id="role", stability="semi-stable", text=opts.role_prompt))

    # ── Segment 4: skills (semi-stable per phase + hasImages) ──
    if opts.skills_prompt:
        with_images_suffix = ":withImages" if opts.image_count > 0 else ""
        segments.append(PromptSegment(
            id=f"skills:{opts.phase}{with_images_suffix}",
            stability="semi-stable",
            text=f"### 可用技能 ({opts.phase})\n\n{opts.skills_prompt}",
        ))

    # ── Segment 5: image_hint (dynamic) — only when images attached ──
    if opts.image_count > 0:
        segments.append(PromptSegment(
            id="image_hint",
            stability="dynamic",
            text=IMAGE_HINT_TEMPLATE.format(n=opts.image_count),
        ))

    # ── Segment 6: memory (dynamic) — only when memory_context truthy ──
    if opts.memory_context:
        segments.append(PromptSegment(
            id="memory",
            stability="dynamic",
            text=f"### 项目记忆\n\n{opts.memory_context}",
        ))

    # ── Segment 7: canvas_state (dynamic) — always present, always last ──
    segments.append(PromptSegment(
        id="canvas_state",
        stability="dynamic",
        text=f"---\n\n## 当前上下文\n\n### 画布状态\n\n{opts.canvas_snapshot}",
    ))

    return segments


def flatten_segments(segments: list[PromptSegment]) -> str:
    """Flatten the segment list to a single string with `\\n\\n` joiners.

    Mirrors TS `buildAgentSystemPrompt` — empty segments are filtered.
    """
    return "\n\n".join(s.text for s in segments if s.text)


def build_system_content_blocks(segments: list[PromptSegment]) -> list[SystemContentBlock]:
    """Anthropic-style structured content array with cache_control.

    Anthropic allows up to 4 cache breakpoints per request; we emit at
    most 1 (the *last* cacheable segment) — the docs say breakpoints
    cumulatively cache everything before them, so a single trailing
    marker is enough to cache `core + role + skills` together.

    Empty-text segments are filtered out so the upstream provider does
    not see vacuous blocks.
    """
    cacheable_ids = [s.id for s in segments if s.stability in ("stable", "semi-stable") and s.text]
    last_cacheable_id = cacheable_ids[-1] if cacheable_ids else None

    blocks: list[SystemContentBlock] = []
    for s in segments:
        if not s.text:
            continue
        block = SystemContentBlock(
            type="text",
            text=s.text,
            cache_control=CacheControl() if s.id == last_cacheable_id else None,
        )
        blocks.append(block)
    return blocks
