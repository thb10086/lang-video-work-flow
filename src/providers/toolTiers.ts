/**
 * toolTiers.ts — Agent 工具的渐进式披露（progressive disclosure）分层
 *
 * 灵感来自 Claude Code 的 skill-based 按需加载：一次对话里 LLM 看到的工具越少，
 * 模型越不容易乱用、token 也更省。
 *
 * 工具被分为 3 档：
 *   Tier 1 (Core, ~8):     导航 + 验证 + 元操作。**永远加载**。
 *   Tier 2 (Creation, 14): 节点创建。命中创建意图时加载（默认首轮）。
 *   Tier 3 (Advanced, 18): 规划/记忆/优化/资产库。关键词命中或 discover_tools 拉取。
 *
 * `selectTier(message, ctx)` 是轻量启发式分类器，不调用 LLM。
 * `getAgentTools()` 依据结果过滤 AGENT_TOOLS。
 */

export type TierId = 'tier1' | 'tier2' | 'tier3'

// ── Tier 1: 永远加载 ──
// 导航 / 验证 / 一键生成：让 Agent 能诊断画布、启动工作流、自检。
export const TIER_1_CORE: readonly string[] = [
  'detect_scenario',
  'generate_workflow',
  'get_canvas_state',
  'execute_node',
  'parallel_execute',
  'verify_task',
  'connect_nodes',
  'update_node',
  'set_phase',       // 自我声明工作阶段，解锁 phase-aware 工具
  'discover_tools',  // meta-tool：让 LLM 按需索取 Tier 2/3 的工具
]

// ── Tier 2: 节点创建类工具 ──
// 命中"生成/创建/画 …"意图或画布为空时加载。
export const TIER_2_CREATION: readonly string[] = [
  'create_character_grid',
  'create_scene_grid',
  'create_keyframe_grid',
  'create_image_node',
  'create_video_node',
  'create_audio_node',
  'create_llm_node',
  'create_text_node',
  'create_storyboard_node',
  'create_character_extract_node',
  'create_character_manager_node',
  'create_style_lock_node',
  'create_image_edit_node',
  'create_video_stitch_node',
  'create_continuity_check_node',
  'create_timeline_node',
  'create_from_images',
  'delete_node',
]

// ── Tier 3: 高级 / 长尾 ──
// 按关键词或显式 discover_tools 才加载。
export const TIER_3_ADVANCED: readonly string[] = [
  'plan_task',
  'update_plan_step',
  'save_memory',
  'recall_memory',
  'forget_memory',
  'optimize_prompt',
  'review_content',
  'inject_user_images',
  'list_assets',
  'create_asset',
  'update_asset',
  'link_asset_to_node',
  'resolve_prompt_refs',
  'classify_image',
  'list_models',
  'get_model_params',
  'retry_node',
  'batch_execute',
  'get_node_output',
  'review_generated_image',
  // Vision-based semantic QC — more expensive than review_generated_image
  // because it hits a real Vision model. Gated behind review intent and
  // reviewing phase so it doesn't pollute every turn.
  'verify_image_semantic',
]

// ── 反向索引：工具名 → tier ──
export function tierOf(toolName: string): TierId | null {
  if (TIER_1_CORE.includes(toolName)) return 'tier1'
  if (TIER_2_CREATION.includes(toolName)) return 'tier2'
  if (TIER_3_ADVANCED.includes(toolName)) return 'tier3'
  return null
}

// ── Heuristic signals for selectTier ──
// 每个 signal 检查 user message，返回一个"需要哪些 tier 或具名工具"的建议。
// 不调用 LLM，纯子串 / 正则匹配。NOTE: \b 不匹配中文字符边界，所以中文词直接子串匹配，
// 英文词用 \b 防止 `scream` 匹配 `cream`。
// 避免单字"画/拍"误判 "画布" / "拍子" 等名词，改用多字短语或 make/create 等动词。
const CREATION_RE = /生成|创建|帮我做|做一个|做个|拍一个|拍个|画一张|画一个|视频|广告|漫剧|短剧|教程|vlog|\b(make|generate|create|build|draft|produce)\b/i
const OPTIMIZE_RE = /优化|改写|重写|提示词|润色|\b(optimize|improve|refine|rewrite)\b/i
// Covers Chinese QC phrases users actually type in chat:
//   评审/审查/质量 — formal review language
//   检查/确认/对不对/看一下 — casual "can you check this" phrasings
//   校验 — technical "validate"
// English keywords are \b-bounded to avoid false positives like "scream"→"cream".
const REVIEW_RE = /评审|审查|质量|检查|确认|校验|对不对|看一下|\b(review|quality|audit|verify|check|validate)\b/i
const ASSET_RE = /素材|资产|\b(asset|library)\b/i
const MEMORY_RE = /记住|回忆|记忆|\b(memory|remember|recall)\b/i
const PLAN_RE = /计划|规划|步骤|\b(plan|roadmap|step)\b/i
const MODEL_RE = /模型|\b(model|list_models)\b/i
const UPLOAD_RE = /上传|\b(image|inject|upload)\b/i

export interface SelectTierContext {
  canvasEmpty?: boolean
  /** Caller-provided override, skips heuristics. */
  forceTier?: TierId[]
}

/**
 * Pick the tier set to expose based on the user's latest message.
 *
 * Default behaviour:
 *   - Empty canvas OR creation keyword → Tier 1 + Tier 2
 *   - Pure navigation (none of below match) → Tier 1 only
 *   - Specific intents → Tier 1 + the specific Tier 3 tools
 *
 * Return is always a `TierId[]` (possibly `['tier1', 'tier2']` etc.).
 * `addOns` carries specific Tier 3 tool names to merge in.
 */
export interface TierSelection {
  tiers: TierId[]
  /** Additional Tier 3 tool names to include even if tier3 is not in `tiers`. */
  addOns: string[]
}

export function selectTier(
  message: string,
  ctx: SelectTierContext = {},
): TierSelection {
  if (ctx.forceTier && ctx.forceTier.length > 0) {
    return { tiers: ctx.forceTier, addOns: [] }
  }

  const m = message || ''
  const tiers = new Set<TierId>(['tier1'])
  const addOns = new Set<string>()

  // Creation intent OR empty canvas → bring tier2.
  if (ctx.canvasEmpty || CREATION_RE.test(m)) {
    tiers.add('tier2')
  }

  // Tier 3 is opt-in per capability.
  if (OPTIMIZE_RE.test(m)) { addOns.add('optimize_prompt'); addOns.add('review_content') }
  if (REVIEW_RE.test(m)) {
    addOns.add('review_content')
    addOns.add('review_generated_image')
    addOns.add('verify_image_semantic')
  }
  if (ASSET_RE.test(m)) {
    ;['list_assets', 'create_asset', 'update_asset', 'link_asset_to_node', 'resolve_prompt_refs']
      .forEach(t => addOns.add(t))
  }
  if (MEMORY_RE.test(m)) { addOns.add('save_memory'); addOns.add('recall_memory') }
  if (PLAN_RE.test(m)) { addOns.add('plan_task'); addOns.add('update_plan_step') }
  if (MODEL_RE.test(m)) { addOns.add('list_models'); addOns.add('get_model_params') }
  if (UPLOAD_RE.test(m)) { addOns.add('inject_user_images'); addOns.add('classify_image') }

  return { tiers: Array.from(tiers), addOns: Array.from(addOns) }
}

/**
 * Flatten a tier selection to a Set of tool names (for O(1) lookups).
 */
export function expandTierSelection(sel: TierSelection): Set<string> {
  const set = new Set<string>(TIER_1_CORE)
  if (sel.tiers.includes('tier2')) TIER_2_CREATION.forEach(t => set.add(t))
  if (sel.tiers.includes('tier3')) TIER_3_ADVANCED.forEach(t => set.add(t))
  sel.addOns.forEach(t => set.add(t))
  return set
}

/** All tool names across all tiers. Used for `includeAll` / parity tests. */
export function allTierToolNames(): Set<string> {
  return new Set<string>([...TIER_1_CORE, ...TIER_2_CREATION, ...TIER_3_ADVANCED])
}
