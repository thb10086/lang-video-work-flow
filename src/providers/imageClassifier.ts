/**
 * imageClassifier.ts — 轻量级图片意图分类器
 *
 * 不依赖任何 Vision 模型，仅从 data-URL 大小、MIME、文件名前缀 和 用户意图
 * 关键词做启发式判定。返回 (kind, confidence, reason)，供 `create_from_images`
 * 工具据此路由到正确的节点类型。
 *
 * 后续可以把 `_adapter` 换成真正的 GPT-4V / Gemini 分类器，
 * 保持调用方签名不变。
 */

export type ImageKind = 'character' | 'scene' | 'style' | 'edit_input'

export interface Classification {
  kind: ImageKind
  confidence: number // 0..1
  reason: string
}

/** Global intent hint overrides per-image heuristic. */
export type IntentHint = 'character_refs' | 'scene_refs' | 'style_lock' | 'edit' | 'mixed' | undefined

const STYLE_KEYWORDS = ['style', 'look', 'aesthetic', 'moodboard', '风格', '配色', '美学']
const SCENE_KEYWORDS = ['scene', 'environment', 'location', 'background', 'rooftop', 'street', '场景', '背景', '环境']
const CHAR_KEYWORDS = ['portrait', 'face', 'character', 'headshot', 'avatar', 'selfie', '人物', '角色', '头像']

/**
 * Estimate the decoded byte size of a data URL without actually base64-decoding.
 * data:image/png;base64,XXXX... → roughly (len(XXXX) * 3/4).
 */
function estimateDataUrlBytes(url: string): number {
  const commaIdx = url.indexOf(',')
  if (commaIdx < 0) return url.length
  const payload = url.slice(commaIdx + 1)
  return Math.floor(payload.length * 0.75)
}

/**
 * Rank keyword hits (case-insensitive substring) inside a single hint text.
 */
function countKeywords(text: string, keywords: string[]): number {
  const lower = text.toLowerCase()
  let hits = 0
  for (const k of keywords) if (lower.includes(k.toLowerCase())) hits++
  return hits
}

/**
 * Pure heuristic classifier.
 *
 * Rules (in priority order):
 *   1. If intent === 'style_lock' / 'character_refs' / 'scene_refs' / 'edit' → deterministic.
 *   2. If hintText (user message) mentions style/scene/character keywords → weighted vote.
 *   3. Otherwise: size-based fallback. Very large images (> 1.5 MB) lean 'scene';
 *      moderately sized (0.3 – 1.5 MB) lean 'character'; tiny (< 0.3 MB) lean 'edit_input'.
 */
export function classifyImageHeuristic(
  image: string,
  opts: { intent?: IntentHint; hintText?: string } = {}
): Classification {
  const { intent, hintText = '' } = opts

  // Rule 1 — explicit intent
  switch (intent) {
    case 'style_lock':
      return { kind: 'style', confidence: 1.0, reason: 'intent=style_lock (explicit)' }
    case 'character_refs':
      return { kind: 'character', confidence: 1.0, reason: 'intent=character_refs (explicit)' }
    case 'scene_refs':
      return { kind: 'scene', confidence: 1.0, reason: 'intent=scene_refs (explicit)' }
    case 'edit':
      return { kind: 'edit_input', confidence: 1.0, reason: 'intent=edit (explicit)' }
    // 'mixed' or undefined fall through to rule 2/3
  }

  // Rule 2 — hintText keyword voting
  const styleHits = countKeywords(hintText, STYLE_KEYWORDS)
  const sceneHits = countKeywords(hintText, SCENE_KEYWORDS)
  const charHits = countKeywords(hintText, CHAR_KEYWORDS)
  const maxHits = Math.max(styleHits, sceneHits, charHits)

  if (maxHits > 0) {
    if (styleHits === maxHits) {
      return { kind: 'style', confidence: 0.7, reason: `hintText matched ${styleHits} style keyword(s)` }
    }
    if (sceneHits === maxHits) {
      return { kind: 'scene', confidence: 0.7, reason: `hintText matched ${sceneHits} scene keyword(s)` }
    }
    return { kind: 'character', confidence: 0.7, reason: `hintText matched ${charHits} character keyword(s)` }
  }

  // Rule 3 — size-based fallback
  const bytes = estimateDataUrlBytes(image)
  const mb = bytes / (1024 * 1024)
  if (mb > 1.5) {
    return { kind: 'scene', confidence: 0.55, reason: `size ${mb.toFixed(2)}MB > 1.5MB → likely scene/environment` }
  }
  if (mb >= 0.3) {
    return { kind: 'character', confidence: 0.6, reason: `size ${mb.toFixed(2)}MB mid-range → likely character portrait` }
  }
  return { kind: 'edit_input', confidence: 0.4, reason: `size ${mb.toFixed(2)}MB tiny → fallback to edit_input (low confidence)` }
}

/**
 * Pluggable adapter seam so a real Vision classifier can be swapped in later
 * without touching call sites. For now we alias the heuristic implementation.
 */
export const _classifierAdapter = {
  classify: classifyImageHeuristic,
}
