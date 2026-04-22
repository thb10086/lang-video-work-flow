/**
 * modelReferenceAdapter — route a capability-agnostic asset reference payload
 * (reference images / Sora character URLs / timestamps) into the correct
 * model-specific fields for submission.
 *
 * Why: every video model accepts "reference" in a different shape:
 *   - Seedance natively consumes multiple reference images via `images[]`
 *   - VEO has `image_mode` switch and max 2 frames
 *   - Sora uses Character API (characterUrl + timestamps), does NOT use images
 *   - Kling accepts at most first + last frame
 *
 * The adapter is pure functions — takes existing node-set frames plus resolver
 * output and returns the fields to merge into the backend submission. No
 * networking, no state.
 *
 * Rule of thumb for strategies: ONLY emit fields declared in the model's
 * `param_schema` OR top-level body fields (`images` for video / `reference_images`
 * for image). Anything else is dropped by the sanitizer / backend validator.
 */

import type { ParamField } from '@/providers/types'

// ── Public types ──

export interface InjectionPayload {
  /** Reference images resolved from @assetRefs (order: asset-1-refs, asset-2-refs, ...). */
  referenceImages: string[]
  /** Sora character URLs picked from asset metadata. */
  characterUrls: string[]
  /** Sora timestamps (e.g. "1,3"). */
  timestamps: string | null
  /** First/last frame the user explicitly set on the node BEFORE resolution. */
  existingImages: string[]
}

export interface InjectionResult {
  /** Final images[] for submitVideo (or reference_images[] for generateImage). */
  images: string[]
  /** Extra params to merge into `params` (respect schema). */
  params: Record<string, unknown>
  /** User-facing notes for chip hover / status line. */
  notes: string[]
}

export type VideoStrategyId = 'seedance' | 'veo' | 'sora' | 'kling' | 'fallback'

export type Strategy = (payload: InjectionPayload, schema: ParamField[]) => InjectionResult


// ── Utility ──

/** Return value if key exists in schema; else undefined. */
function schemaHas(schema: ParamField[], key: string): boolean {
  return Array.isArray(schema) && schema.some(f => f.key === key)
}

function uniq(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)))
}


// ── Strategies ──

/**
 * Seedance 2.0 / fast: native multi-reference support via the `images` list.
 * No extra params required. Merges existing frames + reference images.
 */
export const seedanceStrategy: Strategy = (payload, _schema) => {
  const images = uniq([...payload.existingImages, ...payload.referenceImages])
  const notes: string[] = []
  if (payload.characterUrls.length > 0) {
    notes.push(`Seedance 忽略 ${payload.characterUrls.length} 个 Sora 专用 character URL`)
  }
  return { images, params: {}, notes }
}

/**
 * VEO 3.1 / fast: has `image_mode` select and max 2 frames (first + last).
 *
 *  - If reference images are available → set `image_mode: 'reference'` and
 *    pass up to 2 reference images as the image list.
 *  - Otherwise fall back to existing first/last frames (truncated to 2).
 */
export const veoStrategy: Strategy = (payload, schema) => {
  const notes: string[] = []
  const params: Record<string, unknown> = {}

  let images: string[]
  if (payload.referenceImages.length > 0) {
    images = uniq([...payload.referenceImages, ...payload.existingImages]).slice(0, 2)
    if (schemaHas(schema, 'image_mode')) {
      params.image_mode = 'reference'
    }
  } else {
    images = uniq(payload.existingImages).slice(0, 2)
    if (schemaHas(schema, 'image_mode') && images.length > 0) {
      params.image_mode = 'frame'
    }
  }

  const combinedCount = payload.referenceImages.length + payload.existingImages.length
  if (combinedCount > 2) {
    notes.push(`VEO 仅接受 2 帧，已截断 ${combinedCount - 2} 张图`)
  }
  if (payload.characterUrls.length > 0) {
    notes.push(`VEO 不支持 Sora Character URL，已忽略 ${payload.characterUrls.length} 个`)
  }
  return { images, params, notes }
}

/**
 * Sora 2 VIP: uses the Character API (characterUrl + timestamps). Reference
 * images are NOT consumed — if the user has them but no character URL,
 * we warn and fall back to passing the first reference image as the opening
 * frame so the user gets *some* guidance.
 */
export const soraStrategy: Strategy = (payload, _schema) => {
  const notes: string[] = []
  const params: Record<string, unknown> = {}

  if (payload.characterUrls.length > 0) {
    params.characterUrl = payload.characterUrls[0]
    if (payload.timestamps) params.characterTimestamps = payload.timestamps
    if (payload.characterUrls.length > 1) {
      notes.push(`Sora 目前仅接受 1 个 character URL，已选用第一个，其余 ${payload.characterUrls.length - 1} 个忽略`)
    }
  } else if (payload.referenceImages.length > 0) {
    notes.push(`Sora 未绑定 Character URL，${payload.referenceImages.length} 张参考图无法注入；建议先运行 characterExtract 节点`)
  }

  // Sora still accepts first-frame via images[0]
  const images = uniq(payload.existingImages).slice(0, 1)

  return { images, params, notes }
}

/**
 * Kling v3: accepts first_frame + last_frame only (max 2 images via the
 * images[] list). Reference images beyond the first 2 are dropped.
 */
export const klingStrategy: Strategy = (payload, _schema) => {
  const notes: string[] = []
  const combined = uniq([...payload.existingImages, ...payload.referenceImages])
  const images = combined.slice(0, 2)
  if (combined.length > 2) {
    notes.push(`Kling 仅支持首/末 2 帧，已丢弃 ${combined.length - 2} 张图`)
  }
  if (payload.characterUrls.length > 0) {
    notes.push(`Kling 不支持 Character URL，已忽略 ${payload.characterUrls.length} 个`)
  }
  return { images, params: {}, notes }
}

/**
 * Fallback: model not recognized. Pass through existing frames + up to one
 * reference image. Never fail; the backend validator catches any stray field.
 */
export const fallbackStrategy: Strategy = (payload, _schema) => {
  const notes: string[] = [
    `未知模型，参考注入走降级策略（images=${payload.existingImages.length}+1）`,
  ]
  const slots = 2 - payload.existingImages.length
  const merged = uniq([
    ...payload.existingImages,
    ...payload.referenceImages.slice(0, Math.max(0, slots)),
  ])
  return { images: merged, params: {}, notes }
}


// ── Dispatch ──

function detectVideoStrategy(modelId: string): VideoStrategyId {
  const id = modelId.toLowerCase()
  if (id.startsWith('doubao-seedance')) return 'seedance'
  if (id.startsWith('veo')) return 'veo'
  if (id.startsWith('sora')) return 'sora'
  if (id.startsWith('kling')) return 'kling'
  return 'fallback'
}

const STRATEGY_TABLE: Record<VideoStrategyId, Strategy> = {
  seedance: seedanceStrategy,
  veo: veoStrategy,
  sora: soraStrategy,
  kling: klingStrategy,
  fallback: fallbackStrategy,
}

/**
 * Run the correct strategy for the given video model.
 */
export function injectVideoReferences(
  modelId: string,
  schema: ParamField[],
  payload: InjectionPayload,
): InjectionResult {
  const sid = detectVideoStrategy(modelId)
  const strategy = STRATEGY_TABLE[sid]
  return strategy(payload, schema)
}

/**
 * Image-capability models: simple pass-through. Gemini / Seedream / etc. all
 * accept `reference_images` as a top-level body field, so we just merge
 * existing frames + references, unique.
 */
export function injectImageReferences(
  _modelId: string,
  _schema: ParamField[],
  payload: InjectionPayload,
): InjectionResult {
  const images = uniq([...payload.existingImages, ...payload.referenceImages])
  const notes: string[] = []
  if (payload.characterUrls.length > 0) {
    notes.push(`图片生成不消费 Character URL，已忽略 ${payload.characterUrls.length} 个`)
  }
  return { images, params: {}, notes }
}
