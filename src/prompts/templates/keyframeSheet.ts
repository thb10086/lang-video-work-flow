/**
 * keyframeSheet.ts — 镜头级"分镜拼贴图"提示词模板（v0.2）
 *
 * 核心思想：一次调用 image model 出 **一张包含 N 帧布局的拼贴图**，
 * 而非 N 次独立调用。沿用 sceneSheetTemplate 同款 "single composite
 * image with N panels arranged in R x C grid layout" 范式。
 *
 * 业界对标 — v0.2 关键升级方向（从 v0.1 学到的教训）：
 *   - Higgsfield Shots：每 panel **显式标注机位 / pose / 表情**（"Panel 1: …"）
 *   - LibTV `/storyboard`：numbered 列表 + 每 panel 单独一行 cue
 *   - Midjourney `--panels 4` + `--cref`：1 张参考 + 每格独立 description
 *   - Sora storyboard mode：Scene 1 → Scene 2 → … 时间轴 cue
 *   - Stable Diffusion comic creator：`Panel A | Panel B | Panel C` 强分隔
 *
 * v0.1 实测问题（toapis + gpt-image-2 真实生图证据见
 *   reports/luckin-poc-test/images/）：
 *   - 抽象指令（"narrative progression"）→ 模型安全输出 → 4-9 个 panel 几乎一样
 *   - "frame-by-frame animation reference" → 模型理解成"重复同一 pose"
 *   - "different camera angles" 没有具体机位 → 4 个 panel 全是正面 eye-level
 *
 * v0.2 修复策略：
 *   1. **显式 PANEL N: blueprint**：每 panel 一行具体 cue，根据 layout.n 派生
 *   2. **DIFFERENCE ENFORCEMENT** 段：硬约束「不准重复」，列出"failure mode"
 *   3. **可选 panelDescriptions**：Agent / 上游可显式覆盖每格内容（精控路径）
 *
 * 与 sceneSheet 的差异：
 *   sceneSheet 锚定 **同一地点的不同维度变化**（机位/时段/天气）
 *   keyframeSheet 锚定 **同一镜头的不同时间切片/动作分解/剧情演进**
 */
import type { PromptTemplate } from '../promptEngine'

export type KeyframeSubType =
  | 'time-progression' // 剧情推演（同机位、时间向前）
  | 'scene-evolution'  // 画面演进（状态/氛围渐变）
  | 'action-breakdown' // 动作分解（连续动作的关键 pose）
  | 'multi-camera'     // 多机位（同一时刻不同机位）

export type KeyframeLayout = '2x2' | '2x3' | '3x3'

export interface LayoutSpec {
  rows: number
  cols: number
  n: number
  zhLabel: string
}

/** 三种布局的尺寸参数。N 越大越烧 token / 越易出现单格画质降级。 */
export const KEYFRAME_LAYOUTS: Record<KeyframeLayout, LayoutSpec> = {
  '2x2': { rows: 2, cols: 2, n: 4, zhLabel: '四宫格' },
  '2x3': { rows: 2, cols: 3, n: 6, zhLabel: '六宫格' },
  '3x3': { rows: 3, cols: 3, n: 9, zhLabel: '九宫格' },
}

/** 子类型 → 中文展示标签 */
export const SUBTYPE_LABELS: Record<KeyframeSubType, string> = {
  'time-progression': '剧情推演',
  'scene-evolution': '画面演进',
  'action-breakdown': '动作分解',
  'multi-camera': '多机位',
}

const COMMON_HEADER = `Storyboard sheet for shot "{{shot_name}}", displayed as a single composite image with {{n}} panels arranged in a {{rows}}x{{cols}} grid layout. Thin light-gray dividing lines separate each panel. Each panel is numbered top-left to bottom-right.

SHOT: {{shot_description}}
STYLE: {{style}}
MOOD: {{mood}}
`

const COMMON_FOOTER = `
PANEL-LEVEL CHECKLIST (each panel MUST satisfy its own description; every panel exists for a reason and is NOT a duplicate of any other panel):
{{panel_blueprint}}

DIFFERENCE ENFORCEMENT:
- Each of the {{n}} panels MUST be visually and compositionally distinct from every other panel along the panel's stated difference axis (time / action phase / camera angle / world state).
- Apply the SHOT description above to every panel; vary only the per-panel difference factor stated in the checklist.
- Forbidden failure modes: copy-paste between panels; near-identical poses; near-identical camera angles when the panels are supposed to differ; identical framing when motion is supposed to advance.
- A panel that looks at-a-glance interchangeable with another panel is a defect — never produce two panels that a viewer would mistake for the same frame.

TECHNICAL: Cinematic composition per panel, professional color grading, consistent character identity / outfit / proportions across panels (only the per-panel difference factor varies), no text or numbers overlaid on the image, no captions, no on-image labels, no watermarks. Output a single high-resolution composite image.`

/** 4 个子类型的 panel 布局说明（核心差异 + 一致性约束） */
const PANEL_INSTRUCTIONS: Record<KeyframeSubType, string> = {
  'time-progression': `
PANEL LAYOUT — TIME PROGRESSION:
Read panels left-to-right, top-to-bottom as **time advances**. Each panel is a keyframe of the SAME shot from the SAME camera angle, captured at successive moments along a clear narrative arc — opening beat → rising action → climax → resolution. Earlier panels MUST feel "before"; later panels MUST feel "after".
CONSISTENCY RULES:
- All panels share identical location, lighting key, and framing
- Same character identity, outfit, and proportions across panels
- Only the moment-in-time, character pose/expression, and on-screen state of objects change`,

  'scene-evolution': `
PANEL LAYOUT — SCENE EVOLUTION:
Each panel shows the SAME scene transitioning through stages of physical / atmospheric / emotional change (e.g. clear → storm, day → night, empty → full, calm → chaotic, before → after). Read panels as the world evolving while the camera stays still. Adjacent panels MUST show clearly advanced state, not minor variation.
CONSISTENCY RULES:
- Identical architecture, spatial layout, and key landmarks across panels
- Foreground / midground / background elements preserve their geometry
- Only weather / lighting / state / atmosphere / fill-level / population changes between panels
- If characters appear, their identity remains consistent`,

  'action-breakdown': `
PANEL LAYOUT — ACTION BREAKDOWN:
Break a single complex action (turn, jump, swing, pour, latte-art draw, dance step, transformation) into sequential motion phases. Each panel is one distinct key pose along the motion arc — like a frame-by-frame animation reference where every key pose is visibly different. Use slight motion-blur on limbs / cloth / fluid where appropriate to suggest movement direction. The N panels together MUST read as a smooth continuous motion that a human animator could in-between.
CONSISTENCY RULES:
- Same character identity, outfit, and body proportions in every panel
- Same camera angle and framing throughout the action
- Background remains identical; only character / object pose and motion state change
- Adjacent panels MUST show meaningfully advanced body / object state — no two panels are the same pose`,

  'multi-camera': `
PANEL LAYOUT — MULTI-CAMERA COVERAGE:
All panels capture the SAME frozen moment in time from categorically different camera angles. The action, lighting key, and character / object poses are identical across all panels — only the camera viewpoint, focal length, and framing change. Panels MUST sample categorically distinct angles (e.g. overhead vs eye-level vs profile vs over-the-shoulder are different categories; two slight rotations of the same front view are NOT acceptable).
CONSISTENCY RULES:
- All panels share identical lighting, time-of-day, subject pose, and expression
- Same subject(s) in the same position in 3D space across all angles
- Only the camera viewpoint, focal length, and lens distortion change between panels`,
}

/**
 * Per-subtype × per-layout default panel blueprint.
 * Each entry is exactly N strings (matching KEYFRAME_LAYOUTS[layout].n).
 * Each string describes ONE panel's distinguishing feature; the model still
 * combines it with the SHOT description from the header.
 *
 * Design principles:
 *   - Each string is a noun phrase, not a full sentence, to keep the prompt
 *     compact (sub-30 tokens per panel) while remaining concrete.
 *   - Vocabulary is intentionally categorical (not gradient): different
 *     panels use distinct nouns (top-down vs profile vs close-up) rather
 *     than slight modifiers (slightly above vs slightly higher).
 *   - Story-arc subtypes (time-progression, scene-evolution,
 *     action-breakdown) scale the arc to fit N. multi-camera maps to
 *     N categorically distinct camera vocabularies.
 */
export const DEFAULT_BLUEPRINTS: Record<
  KeyframeSubType,
  Record<KeyframeLayout, string[]>
> = {
  'time-progression': {
    '2x2': [
      'Opening beat — neutral pre-event state, subject introduced, no action yet',
      'Inciting moment — first significant interaction, attention captured',
      'Climax — peak emotional or physical moment, strongest expression',
      'Resolution — aftermath, final reaction, scene settles',
    ],
    '2x3': [
      'Opening beat — neutral pre-event state, subject introduced',
      'Inciting moment — first significant interaction triggers the arc',
      'Rising action — attention intensifies, expression shifts',
      'Climax / turning point — peak emotional or physical moment',
      'Immediate reaction — first response right after the climax',
      'Resolution — aftermath, lingering atmosphere, scene settles',
    ],
    '3x3': [
      'Opening beat — neutral pre-event state, subject introduced',
      'Awareness — subject notices the trigger or stimulus',
      'Inciting moment — first significant interaction begins',
      'Rising action — engagement deepens, body leaning in',
      'Mid-arc complication — small obstacle or hesitation',
      'Climax / turning point — peak emotional or physical moment',
      'Immediate reaction — first response right after the climax',
      'Falling action — tension releasing, energy dissipating',
      'Resolution / outcome — aftermath, final settled state',
    ],
  },
  'scene-evolution': {
    '2x2': [
      'Initial state — baseline scene, untouched, pre-event equilibrium',
      'Emerging change — first visible signs of transition, subtle but unmistakable',
      'Peak transformation — most dramatic climactic mid-state, maximum contrast vs baseline',
      'Final state — fully transformed, settled into new equilibrium',
    ],
    '2x3': [
      'Initial state — baseline scene, untouched pre-event equilibrium',
      'Emerging change — first visible signs of transition',
      'Developing — change spreading, mid-transition',
      'Peak / climactic state — maximum contrast vs baseline',
      'Settling — change consolidates, energy releasing',
      'Final state — fully transformed, new equilibrium settled',
    ],
    '3x3': [
      'Initial state — baseline scene, pre-event equilibrium',
      'First trace — earliest hint of change',
      'Emerging — change visibly underway, ~25% transformed',
      'Developing — ~50% transformed, mid-transition',
      'Accelerating — ~70% transformed, momentum building',
      'Peak / climactic state — maximum contrast vs baseline',
      'Receding — peak fading, change consolidating',
      'Settling — energy releasing, ~90% in new state',
      'Final state — fully transformed, new equilibrium settled',
    ],
  },
  'action-breakdown': {
    '2x2': [
      'Preparation pose — windup, weight loading, anticipation, energy stored',
      'Initiation pose — motion just started, limbs leaving rest, intent visible',
      'Peak / apex pose — maximum extension or contact, energy at peak, motion blur on fastest parts',
      'Follow-through pose — completion, weight settling, recoil, exhale',
    ],
    '2x3': [
      'Preparation pose — windup, weight loading, anticipation',
      'Initiation pose — motion just started, leading limb extending',
      'Mid-motion A — accelerating phase, body committed',
      'Peak / apex pose — maximum extension or contact, peak energy',
      'Mid-motion B — decelerating phase, momentum carrying through',
      'Follow-through pose — completion, weight settling, recoil',
    ],
    '3x3': [
      'Anticipation — windup, body coiling, energy stored',
      'Initiation — motion starts, leading limb moves first',
      'Acceleration — body committed, weight transferring',
      'Mid-motion arc — fastest phase, strong motion blur on limbs / cloth / fluid',
      'Peak / apex — maximum extension or contact, energy at peak',
      'Impact / climax frame — moment of greatest visual interest',
      'Deceleration — momentum dissipating, limbs slowing',
      'Settle — body absorbs the action, weight redistributing',
      'Resolution — final pose, breath out, action complete',
    ],
  },
  'multi-camera': {
    '2x2': [
      'OVERHEAD shot — 90° straight-down top-down, flat-lay composition, subject centered',
      'EYE-LEVEL front view — 50mm lens equivalent, frontal, neutral horizon',
      '3/4 HERO angle — 45° above and to the side, slight tilt, dramatic depth',
      'EXTREME CLOSE-UP — macro lens, texture / material / detail focus on the most expressive part',
    ],
    '2x3': [
      'OVERHEAD top-down — 90° from above, flat-lay composition',
      'EYE-LEVEL front view — 50mm lens, frontal centered',
      '3/4 HERO angle — 45° above and side, dramatic depth',
      'PROFILE side view — 90° rotation, full silhouette',
      'OVER-THE-SHOULDER — from just behind subject, foreground occluder',
      'EXTREME CLOSE-UP — macro lens, texture and material detail',
    ],
    '3x3': [
      'OVERHEAD top-down — 90° from above, flat-lay',
      'HIGH ANGLE — 60° above, subject smaller in frame, vulnerable feel',
      'EYE-LEVEL front view — 50mm lens, frontal centered',
      '3/4 HERO angle — 45° above and side, dramatic depth',
      'PROFILE side view — 90° rotation, full silhouette',
      'OVER-THE-SHOULDER — from just behind subject, foreground occluder',
      'LOW ANGLE — 30° below, subject looming, heroic feel',
      'DUTCH TILT — eye-level with camera rotated 15-20°, off-balance tension',
      'EXTREME CLOSE-UP — macro lens, texture and material detail',
    ],
  },
}

function buildTemplateString(subType: KeyframeSubType): string {
  return `${COMMON_HEADER}${PANEL_INSTRUCTIONS[subType]}${COMMON_FOOTER}`
}

/** 4 个子类型各自一个完整 PromptTemplate，便于 UI / 调试 / 单测引用 */
export const keyframeSheetTemplates: Record<KeyframeSubType, PromptTemplate> = {
  'time-progression': {
    id: 'keyframe-time-progression',
    name: '剧情推演（时间序列）',
    category: 'storyboard',
    description: '同机位 N 帧时间推进，适合事件演化 / 反应 / 转折',
    template: buildTemplateString('time-progression'),
    variables: [],
  },
  'scene-evolution': {
    id: 'keyframe-scene-evolution',
    name: '画面演进（状态变化）',
    category: 'storyboard',
    description: '同场景 N 帧氛围/天气/状态渐变',
    template: buildTemplateString('scene-evolution'),
    variables: [],
  },
  'action-breakdown': {
    id: 'keyframe-action-breakdown',
    name: '动作分解',
    category: 'storyboard',
    description: '复杂动作拆成 N 帧关键 pose',
    template: buildTemplateString('action-breakdown'),
    variables: [],
  },
  'multi-camera': {
    id: 'keyframe-multi-camera',
    name: '多机位覆盖',
    category: 'storyboard',
    description: '同一时刻 N 个机位/角度',
    template: buildTemplateString('multi-camera'),
    variables: [],
  },
}

/** Render the numbered "PANEL 1: ...\nPANEL 2: ..." block from a list of cues. */
function renderBlueprintBlock(cues: string[]): string {
  return cues.map((cue, i) => `PANEL ${i + 1}: ${cue}`).join('\n')
}

/**
 * 构建可直接喂给 image model 的最终 prompt 字符串。
 * 调用方负责保证 shotName / shotDescription 非空。
 *
 * @param args.panelDescriptions Optional caller-supplied per-panel cues.
 *   - When provided AND its length matches KEYFRAME_LAYOUTS[layout].n,
 *     these strings replace the default blueprint (Agent / upstream
 *     precision-control path).
 *   - When omitted or length mismatches, the default blueprint for the
 *     {subType, layout} pair is used.
 */
export function buildKeyframePrompt(args: {
  subType: KeyframeSubType
  layout: KeyframeLayout
  shotName: string
  shotDescription: string
  style?: string
  mood?: string
  panelDescriptions?: string[]
}): string {
  const layout = KEYFRAME_LAYOUTS[args.layout]
  const template = keyframeSheetTemplates[args.subType].template
  const cues =
    args.panelDescriptions && args.panelDescriptions.length === layout.n
      ? args.panelDescriptions
      : DEFAULT_BLUEPRINTS[args.subType][args.layout]
  const blueprintBlock = renderBlueprintBlock(cues)
  return template
    .replace(/\{\{shot_name\}\}/g, args.shotName)
    .replace(/\{\{shot_description\}\}/g, args.shotDescription)
    .replace(/\{\{style\}\}/g, args.style || 'cinematic')
    .replace(/\{\{mood\}\}/g, args.mood || 'dramatic')
    .replace(/\{\{n\}\}/g, String(layout.n))
    .replace(/\{\{rows\}\}/g, String(layout.rows))
    .replace(/\{\{cols\}\}/g, String(layout.cols))
    .replace(/\{\{panel_blueprint\}\}/g, blueprintBlock)
}
