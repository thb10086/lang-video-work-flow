/**
 * Workflow Builders — 按场景类型生成不同的 Pipeline 结构
 *
 * 6 种场景：
 *   comic_drama   — 漫剧/动漫短剧（角色一致性优先）
 *   product_ad    — 产品广告/电商（产品展示 + 品牌风格）
 *   store_tour    — 探店/Vlog（多场景 + 运镜丰富）
 *   tutorial      — 教程/解说（脚本驱动 + 配音同步）
 *   short_drama   — 真人短剧（默认，完整 Pipeline）
 *   music_video   — MV/混剪（风格统一 + 快节奏）
 */

import { useFlowStore } from '@/store/flowStore'
import { useAssetStore } from '@/store/assetStore'
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, DEFAULT_LLM_MODEL, DEFAULT_VIDEO_SIZE, DEFAULT_VIDEO_DURATION, DEFAULT_VIDEO_RESOLUTION } from '@/providers/modelDefaults'
import { triggerFitView } from './toolHelpers'
import type { ToolCallResult } from './toolHelpers'
import type { ScenarioId } from './toolScenario'

// ── Shared types ──

export interface WorkflowArgs {
  title: string
  description: string
  scenario: ScenarioId
  characterNames: string[]
  characterDescriptions: string[]
  sceneNames: string[]
  sceneDescriptions: string[]
  shotCount: number
  shotPrompts: string[]
  videoPrompts: string[]
  styleDescription: string
  narrationText: string
  /**
   * Product anchor image (URL or data-url) propagated to every imageGen /
   * videoGen as `referenceImage` so the brand asset stays visually identical
   * across all shots. Used by `product_ad` scenario; ignored elsewhere.
   */
  productImage?: string
  /**
   * 1-based shot indices that must NOT carry character refs (i.e. shots that
   * are product-only). Default: all shots carry every character. This lets
   * an Agent build sequences like "shot 1-2 are product hero, shot 3+ adds
   * the model" without writing custom builder code.
   */
  productOnlyShots?: number[]
  /**
   * Whether the canvas should be cleared before generating the new workflow.
   *
   * Default: `true` (replace). When the Agent re-runs `generate_workflow` with
   * an updated prompt set, the previous workflow is discarded so `verify_task`
   * scores the new canvas only and the runtime executor never wires across
   * stale islands.
   *
   * Pass `false` to keep the existing canvas and append the new workflow on
   * top — useful for assembling multi-scene drops where each call adds one
   * scene to a shared timeline.
   */
  replaceCanvas?: boolean
}

// ── Layout constants ──

const COL = { prep: 50, ref: 450, keyframe: 850, video: 1250, output: 1650 }
const ROW_H = 260
const ROW_START = 60

// ── Prompt normalization ──

/**
 * Strip a leading character-appearance paragraph from a video prompt so the
 * Camera/Action directives reach the i2v model with full weight.
 *
 * Why: i2v models (Sora 2, VEO, Seedance) bind identity from the first-frame
 * image, and `buildCharacterAnchorPrefix` auto-prepends a `[Character Anchor]`
 * line at execution time. Repeating a 150–250 token appearance paragraph at
 * the *front* of the video prompt has two harmful effects:
 *
 *   1. The model's attention budget is dominated by static identity tokens
 *      instead of action verbs — producing visually static "talking head"
 *      clips with minimal movement.
 *   2. Combined with "Keep identity / Avoid frame stutter" trailing clauses,
 *      the cumulative bias forces the model toward stillness.
 *
 * Heuristic: if the prompt has a `Camera:` or `Action:` directive *not* at
 * the start, and the lead-in before that directive is substantial (≥ 60 chars),
 * we slice the lead-in away. Short context preambles are preserved so users
 * who intentionally write "Continuing from the previous shot, ..." aren't
 * truncated.
 *
 * @internal Exported only for tests.
 */
export function normalizeVideoPrompt(prompt: string): string {
  if (!prompt) return prompt
  const trimmed = prompt.trim()

  // Already action-first — no-op.
  if (/^(Camera|Action):/i.test(trimmed)) return trimmed

  // Find first Camera:/Action: directive marker.
  const directiveMatch = /\b(Camera|Action):/i.exec(trimmed)
  if (!directiveMatch || directiveMatch.index === undefined) return trimmed

  // Preserve short lead-ins (≤ 60 chars) as intentional context.
  if (directiveMatch.index < 60) return trimmed

  return trimmed.slice(directiveMatch.index).trim()
}

// ── Shared builder helpers ──

class WB {
  nodeIds: string[] = []
  edgeCount = 0
  assetCount = 0
  private store = useFlowStore.getState()
  private assetStore = useAssetStore.getState()

  add(type: string, pos: { x: number; y: number }, data: Record<string, unknown>): string {
    const id = this.store.addNode(type, pos, data)
    this.nodeIds.push(id)
    return id
  }

  connect(src: string, tgt: string, srcH?: string, tgtH?: string) {
    this.store.onConnect({ source: src, target: tgt, sourceHandle: srcH || null, targetHandle: tgtH || null })
    this.edgeCount++
  }

  registerChar(name: string, desc: string) {
    this.store.setCharacterAppearance(name, desc)
  }

  /**
   * Seed a character into the Asset Library (sync, local). Legacy
   * `characterAppearances` is mirrored too so older executors keep working.
   */
  seedCharacter(name: string, appearance: string): string {
    const asset = this.assetStore.seedLocal({ kind: 'character', name, appearance })
    this.assetCount++
    this.registerChar(name, appearance)
    return asset.asset_id
  }

  seedScene(name: string, environment: string): string {
    const asset = this.assetStore.seedLocal({ kind: 'scene', name, environment })
    this.assetCount++
    return asset.asset_id
  }

  summary(title: string, extra: string): ToolCallResult {
    setTimeout(() => triggerFitView(), 300)
    const assetPart = this.assetCount > 0 ? `${this.assetCount} 个素材入库, ` : ''
    return {
      success: true,
      message: `已生成「${title}」工作流：${extra}${assetPart}共 ${this.nodeIds.length} 个节点, ${this.edgeCount} 条连线。`,
      nodeIds: this.nodeIds,
    }
  }
}

// ── Shared: create character grids ──

interface AssetBoundIds {
  nodeIds: string[]
  assetIds: string[]
}

function addCharacters(wb: WB, args: WorkflowArgs, style: string, startRow: number): AssetBoundIds {
  const nodeIds: string[] = []
  const assetIds: string[] = []
  args.characterNames.forEach((name, i) => {
    const desc = args.characterDescriptions[i] || `${name}, a character in "${args.title}". Distinctive appearance with consistent clothing and recognizable features.`
    const assetId = wb.seedCharacter(name, desc)
    const id = wb.add('characterGrid', { x: COL.prep, y: ROW_START + (startRow + i) * ROW_H }, {
      label: `角色: ${name}`, name, description: desc, style, outputImage: null, status: 'idle',
      assetId,
    })
    nodeIds.push(id)
    assetIds.push(assetId)
  })
  return { nodeIds, assetIds }
}

// ── Shared: create scene grids ──

function addScenes(wb: WB, args: WorkflowArgs, startRow: number): AssetBoundIds {
  const nodeIds: string[] = []
  const assetIds: string[] = []
  args.sceneNames.forEach((name, i) => {
    const desc = args.sceneDescriptions[i] || `${name} in "${args.title}". Detailed environment with cinematic lighting.`
    const assetId = wb.seedScene(name, desc)
    const id = wb.add('sceneGrid', { x: COL.prep, y: ROW_START + (startRow + i) * ROW_H }, {
      label: `场景: ${name}`, name, description: desc, style: 'cinematic', mood: 'dramatic', outputImage: null, status: 'idle',
      assetId,
    })
    nodeIds.push(id)
    assetIds.push(assetId)
  })
  return { nodeIds, assetIds }
}

// ── Shared: create shot pairs (keyframe + video) ──

interface ShotAssetContext {
  /** Asset IDs of characters appearing in these shots (bound to every imageGen/videoGen). */
  charAssetIds?: string[]
  /** Asset IDs of scenes. Attached as refs so the adapter can pull scene reference images. */
  sceneAssetIds?: string[]
}

/** Wire every sceneGrid into every imageGen via ref-in so scene anchors reach generation. */
function linkScenesToImages(wb: WB, sceneNodeIds: string[], imgIds: string[]) {
  sceneNodeIds.forEach(sid => imgIds.forEach(iid => wb.connect(sid, iid, 'grid-out', 'ref-in')))
}

function addShots(wb: WB, args: WorkflowArgs, startRow: number, assets?: ShotAssetContext): { imgIds: string[]; vidIds: string[] } {
  const imgIds: string[] = []
  const vidIds: string[] = []
  const refBag = [...(assets?.charAssetIds || []), ...(assets?.sceneAssetIds || [])]
  for (let i = 0; i < args.shotCount; i++) {
    const y = ROW_START + (startRow + i) * ROW_H
    const imgPrompt = args.shotPrompts[i] || `Shot ${i + 1} of "${args.title}": cinematic keyframe, detailed scene`
    // i2v-friendly fallback (Sora 2 / VEO / Seedance): action-led, concrete negatives.
    // See buildProductAd for the rationale; same pattern applies to drama/vlog/mv shots.
    const vidPromptRaw = args.videoPrompts[i] || `Camera: slow dolly forward, smooth steady motion. Action: ${imgPrompt}. Keep characters, props and environment consistent throughout. Soft ambient motion welcomed; large object displacement is not. Avoid: warped fingers, extra hands, face distortion, identity change, frame stutter, color shift.`
    const vidPrompt = normalizeVideoPrompt(vidPromptRaw)
    const imgId = wb.add('imageGen', { x: COL.keyframe, y }, {
      label: `镜头${i + 1} 关键帧`, model: DEFAULT_IMAGE_MODEL, prompt: imgPrompt,
      aspectRatio: '16:9', imageSize: '2k', referenceImage: null, outputImage: null, status: 'idle',
      ...(refBag.length > 0 ? { assetRefs: [...refBag] } : {}),
    })
    const vidId = wb.add('videoGen', { x: COL.video, y }, {
      label: `镜头${i + 1} 视频`, model: DEFAULT_VIDEO_MODEL, prompt: vidPrompt,
      // 同时写 size + aspect_ratio：兼容 seedance (size) 和 sora/wan/veo (aspect_ratio)
      size: DEFAULT_VIDEO_SIZE, aspect_ratio: DEFAULT_VIDEO_SIZE,
      duration: DEFAULT_VIDEO_DURATION, resolution: DEFAULT_VIDEO_RESOLUTION,
      generate_audio: false, outputVideo: null, status: 'idle',
      ...(refBag.length > 0 ? { assetRefs: [...refBag] } : {}),
    })
    imgIds.push(imgId)
    vidIds.push(vidId)
    wb.connect(imgId, vidId, 'image-out', 'first-frame')
  }
  return { imgIds, vidIds }
}

// ── Shared: create stitch node ──

function addStitch(wb: WB, vidIds: string[], audioId: string | null, y: number): string {
  const id = wb.add('videoStitch', { x: COL.output, y }, { label: '最终合成', clips: [], outputUrl: null })
  vidIds.forEach(vid => wb.connect(vid, id, 'video-out', 'video-in'))
  if (audioId) wb.connect(audioId, id, 'audio-out', 'audio-in')
  return id
}

// ════════════════════════════════════════════════════════════
// Scenario Builders
// ════════════════════════════════════════════════════════════

function buildShortDrama(wb: WB, args: WorkflowArgs): ToolCallResult {
  // Script + Storyboard
  const scriptId = wb.add('textNode', { x: COL.prep, y: ROW_START }, { label: `${args.title} - 剧本`, content: args.description, role: 'script' })
  const sbId = wb.add('storyboard', { x: COL.ref, y: ROW_START }, { label: '分镜脚本', script: args.description, shots: [], status: 'idle' })
  wb.connect(scriptId, sbId, 'text-out', 'script-in')

  // Style Lock (FIRST — all visual elements inherit this style)
  const styleId = wb.add('styleLock', { x: COL.ref, y: ROW_START + ROW_H }, {
    label: '风格锁定', referenceImage: null, styleDescription: args.styleDescription || `${args.title}的视觉风格`, extractedStyle: args.styleDescription, status: args.styleDescription ? 'done' : 'idle',
  })

  // Characters (realistic) — after style lock
  const chars = addCharacters(wb, args, 'realistic', 2)

  // Character Manager — canvas-level registry so every imageGen/videoGen can
  // reference characters via @角色名. Every characterGrid flows in via grid-out → character-in.
  const mgrId = wb.add('characterManager', { x: COL.ref, y: ROW_START + (2 + chars.nodeIds.length) * ROW_H }, {
    label: '角色库', characters: [],
  })
  chars.nodeIds.forEach(cid => wb.connect(cid, mgrId, 'grid-out', 'character-in'))

  // Scenes — after style lock
  const scenes = addScenes(wb, args, 3 + args.characterNames.length)

  // Shots — bind character & scene asset refs so every imageGen/videoGen carries the identity contract
  const { imgIds, vidIds } = addShots(wb, args, 2, { charAssetIds: chars.assetIds, sceneAssetIds: scenes.assetIds })
  chars.nodeIds.forEach(cid => imgIds.forEach(iid => wb.connect(cid, iid, 'grid-out', 'ref-in')))
  linkScenesToImages(wb, scenes.nodeIds, imgIds)
  imgIds.forEach(iid => wb.connect(styleId, iid, 'style-out', 'style-in'))

  // Stitch (no audio — audio is optional, can be added later)
  addStitch(wb, vidIds, null, ROW_START + Math.floor((args.shotCount + 2) / 2) * ROW_H)

  return wb.summary(args.title, `${chars.nodeIds.length} 角色(写实)+角色库, ${scenes.nodeIds.length} 场景, ${args.shotCount} 镜头, 风格锁定→角色→角色库→场景→分镜→合成。`)
}

function buildComicDrama(wb: WB, args: WorkflowArgs): ToolCallResult {
  // Script + Storyboard
  const scriptId = wb.add('textNode', { x: COL.prep, y: ROW_START }, { label: `${args.title} - 剧本`, content: args.description, role: 'script' })
  const sbId = wb.add('storyboard', { x: COL.ref, y: ROW_START }, { label: '分镜脚本', script: args.description, shots: [], status: 'idle' })
  wb.connect(scriptId, sbId, 'text-out', 'script-in')

  // Style Lock (FIRST — anime style, all elements inherit)
  const styleId = wb.add('styleLock', { x: COL.ref, y: ROW_START + ROW_H }, {
    label: '风格锁定', referenceImage: null,
    styleDescription: args.styleDescription || 'anime style, vibrant colors, clean line art, dynamic composition',
    extractedStyle: args.styleDescription || 'anime', status: args.styleDescription ? 'done' : 'idle',
  })

  // Characters (anime) — after style lock
  const chars = addCharacters(wb, args, 'anime', 2)

  // Character Manager — LibTV-style registry; drives @角色名 references from shot prompts
  const mgrId = wb.add('characterManager', { x: COL.ref, y: ROW_START + (2 + chars.nodeIds.length) * ROW_H }, {
    label: '角色库', characters: [],
  })
  chars.nodeIds.forEach(cid => wb.connect(cid, mgrId, 'grid-out', 'character-in'))

  // Shots — bind character asset refs
  const { imgIds, vidIds } = addShots(wb, args, 2, { charAssetIds: chars.assetIds })
  chars.nodeIds.forEach(cid => imgIds.forEach(iid => wb.connect(cid, iid, 'grid-out', 'ref-in')))
  imgIds.forEach(iid => wb.connect(styleId, iid, 'style-out', 'style-in'))

  // Stitch (no audio — can be added later)
  addStitch(wb, vidIds, null, ROW_START + Math.floor((args.shotCount + 2) / 2) * ROW_H)

  return wb.summary(args.title, `[漫剧模式] ${chars.nodeIds.length} 角色(anime)+角色库, ${args.shotCount} 镜头, 风格锁定→角色→角色库→分镜→合成。`)
}

function buildProductAd(wb: WB, args: WorkflowArgs): ToolCallResult {
  // 产品广告：N 镜头分镜（默认 3：产品展示+使用场景+Logo 结尾；shotCount > 3 时扩展）
  // 镜头时长统一用 DEFAULT_VIDEO_DURATION（与默认视频模型对齐）。
  const styleId = wb.add('styleLock', { x: COL.prep, y: ROW_START }, {
    label: '品牌风格', referenceImage: null,
    styleDescription: args.styleDescription || 'commercial, clean, professional, brand-consistent',
    extractedStyle: args.styleDescription || '', status: args.styleDescription ? 'done' : 'idle',
  })

  // Optional character(s) — beauty / lifestyle product ads often need a model
  const chars = args.characterNames.length > 0 ? addCharacters(wb, args, 'realistic', 1) : { nodeIds: [] as string[], assetIds: [] as string[] }

  // Product anchor: propagate the user-supplied product photo to every shot.
  // We don't model it as an Asset Library entry yet (kind='product' is not in
  // the schema); instead we splice the URL directly into each imageGen's
  // `referenceImages` so existing executors pick it up via the standard
  // referenceImage path. Future work: introduce a 'product' AssetKind and a
  // dedicated productGrid node so the anchor is visible on the canvas.
  const productImage = args.productImage?.trim() || ''
  const productOnlySet = new Set<number>((args.productOnlyShots || []).filter(n => Number.isInteger(n) && n > 0))

  const shotCount = Math.max(3, args.shotCount)
  const vidIds: string[] = []
  // Default labels for the 3-shot product-ad archetype; any extra shot uses a numbered label.
  const defaultLabels = ['产品展示', '使用场景', 'Logo 结尾']
  const defaultPrompts = [
    `Product hero shot of "${args.title}", studio lighting, white background, 8K commercial photography`,
    `Lifestyle scene with "${args.title}" product in use, warm natural lighting, cinematic`,
    `Brand logo reveal, elegant animation, clean composition`,
  ]
  // i2v-friendly fallback prompts. Each: Camera + Action + Keep + Avoid (no bracket tags).
  const defaultVideoPrompts = [
    `Camera: subtle push-in with gentle focus pull, smooth steady motion. Action: product gleams under soft studio light, faint reflections drift across the surface. Keep product label and logo perfectly readable. Avoid: warped surface, label distortion, logo flicker, frame stutter.`,
    `Camera: slow horizontal pan, eye-level. Action: product sits naturally in a lifestyle context, ambient light shifts softly, dust motes drift. Keep product shape and brand details consistent. Avoid: morphing edges, color shift on label, text warping, hand distortion if present.`,
    `Camera: locked-off composition with subtle parallax. Action: brand logo holds steady while a soft light sweep highlights the typography. Keep logo letters crisp and readable. Avoid: flickering, ghosting, edge bleed, frame stutter.`,
  ]

  // i2v-friendly cameras. Sora 2 / VEO / Seedance 在 i2v 模式下首帧已锁定，
  // 360 orbit / tracking 这类大幅运镜成功率 < 50%。改用 push-in / pan / dolly / locked-off
  // 这些小幅度、首帧锁定友好的运镜词，模型执行更稳定。
  const productAdCameras = [
    'subtle push-in with gentle focus pull',
    'slow horizontal pan, eye-level',
    'gentle dolly forward, shallow depth of field',
    'locked-off with subtle parallax',
    'slow zoom-in, smooth handheld feel',
    'static composition with light atmospheric drift',
  ]

  for (let i = 0; i < shotCount; i++) {
    const y = ROW_START + (1 + i) * ROW_H
    const baseLabel = i < defaultLabels.length ? defaultLabels[i] : `镜头${i + 1}`
    const aspect = i === 0 ? '1:1' : '16:9'  // hero product shot is typically square; others widescreen
    const imgPrompt = args.shotPrompts[i] || defaultPrompts[Math.min(i, defaultPrompts.length - 1)]
    // Video prompt fallback for i2v video models (Sora 2 / VEO / Seedance):
    //   - Drop [Subject] reduction: the first-frame image already carries all static info.
    //   - Lead with Action verbs (lifts gaze / stirs / smiles) instead of repeating scenery.
    //   - Use concrete negative tokens (warped fingers, logo flicker) instead of abstract
    //     concepts (morphing, identity drift) — Sora ignores conceptual negatives.
    //   - Anchor product readability so the label/logo doesn't warp mid-shot.
    const vidPromptRaw = args.videoPrompts[i]
      || (args.shotPrompts[i]
          ? `Camera: ${productAdCameras[i % productAdCameras.length]}, smooth and steady motion across the full clip. Action: ${args.shotPrompts[i]}. Keep product label, logo and packaging perfectly readable and consistent throughout. Soft ambient motion (steam, hair sway, light drift) is welcome; large object displacement is not. Avoid: warped fingers, extra hands, face distortion, identity change, logo flicker, text warping, frame stutter, color shift.`
          : defaultVideoPrompts[Math.min(i, defaultVideoPrompts.length - 1)])
    const vidPrompt = normalizeVideoPrompt(vidPromptRaw)

    // Per-shot character gating: shots listed in productOnlyShots (1-based)
    // are product-only and skip every character anchor. All other shots get
    // the full character set as before. When productOnlyShots is empty the
    // legacy behaviour is preserved exactly.
    const isProductOnly = productOnlySet.has(i + 1)
    const shotCharAssetIds = isProductOnly ? [] : chars.assetIds
    const shotCharNodeIds = isProductOnly ? [] : chars.nodeIds

    // referenceImages contract: keep the product photo (if supplied) at index 0
    // so downstream sanitizers / vision-verify can rely on a stable position.
    // Existing single-image referenceImage stays null — propagation already
    // handles the multi-image case via assetRefs + character grid uplinks.
    const refImagesField = productImage ? { referenceImages: [productImage] } : {}

    const assetRefs: string[] = [...shotCharAssetIds]

    const imgId = wb.add('imageGen', { x: COL.keyframe, y }, {
      label: baseLabel, model: DEFAULT_IMAGE_MODEL,
      prompt: imgPrompt,
      aspectRatio: aspect, imageSize: '2k', referenceImage: null, outputImage: null, status: 'idle',
      ...refImagesField,
      ...(assetRefs.length > 0 ? { assetRefs } : {}),
    })
    const vidId = wb.add('videoGen', { x: COL.video, y }, {
      label: `${baseLabel} ${DEFAULT_VIDEO_DURATION}s`, model: DEFAULT_VIDEO_MODEL,
      prompt: vidPrompt,
      // 同时写 size 和 aspect_ratio：seedance schema 用 size，sora/wan/veo 等用 aspect_ratio。
      // 这样任意默认模型下，sanitizeOnModelSwitch 都能保留有效值。
      size: DEFAULT_VIDEO_SIZE, aspect_ratio: DEFAULT_VIDEO_SIZE,
      duration: DEFAULT_VIDEO_DURATION, resolution: DEFAULT_VIDEO_RESOLUTION,
      generate_audio: false, outputVideo: null, status: 'idle',
      ...(assetRefs.length > 0 ? { assetRefs } : {}),
    })
    wb.connect(imgId, vidId, 'image-out', 'first-frame')
    wb.connect(styleId, imgId, 'style-out', 'style-in')
    shotCharNodeIds.forEach(cid => wb.connect(cid, imgId, 'grid-out', 'ref-in'))
    vidIds.push(vidId)
  }

  // Stitch
  addStitch(wb, vidIds, null, ROW_START + Math.floor((shotCount + 1) / 2) * ROW_H)

  const productPart = productImage ? `产品图锚定全部 ${shotCount} 镜头，` : ''
  const productOnlyPart = productOnlySet.size > 0 ? `${productOnlySet.size} 镜头仅产品，` : ''
  return wb.summary(args.title, `[产品广告] ${shotCount} 个镜头 × ${DEFAULT_VIDEO_DURATION}s = ${shotCount * DEFAULT_VIDEO_DURATION}s，${productPart}${productOnlyPart}${chars.nodeIds.length > 0 ? `${chars.nodeIds.length} 角色锚定，` : ''}品牌风格锁定。`)
}

function buildStoreTour(wb: WB, args: WorkflowArgs): ToolCallResult {
  // 探店：风格锁定 → 多场景 → 视频(丰富运镜) → 合成
  const styleId = wb.add('styleLock', { x: COL.prep, y: ROW_START }, {
    label: '风格锁定', referenceImage: null,
    styleDescription: args.styleDescription || 'vlog style, warm tones, natural lighting, handheld feel',
    extractedStyle: args.styleDescription || '', status: args.styleDescription ? 'done' : 'idle',
  })

  // Scenes — after style lock
  const scenes = addScenes(wb, args, 1)

  // Shots with varied camera movements — scene asset refs attached for environment consistency
  const cameras = ['dolly forward', 'tracking left', 'crane up', 'handheld follow', 'slow pan right', 'push in']
  const { imgIds, vidIds } = addShots(wb, {
    ...args,
    videoPrompts: args.videoPrompts.length > 0 ? args.videoPrompts :
      Array.from({ length: args.shotCount }, (_, i) => {
        const cam = cameras[i % cameras.length]
        const subject = args.shotPrompts[i] || `Scene ${i + 1}`
        const env = args.sceneNames[i % args.sceneNames.length] || 'interior'
        return `Camera: ${cam}, smooth steady motion, eye-level. Action: ${subject}; ambient light in the ${env} shifts gently, secondary motion drifts in the background. Keep character appearance and environment details consistent. Avoid: face distortion, warped fingers, color shift, frame stutter.`
      }),
  }, 1, { sceneAssetIds: scenes.assetIds })
  linkScenesToImages(wb, scenes.nodeIds, imgIds)
  imgIds.forEach(iid => wb.connect(styleId, iid, 'style-out', 'style-in'))

  // Stitch (no audio — can be added later)
  addStitch(wb, vidIds, null, ROW_START + Math.floor((args.shotCount + 1) / 2) * ROW_H)

  return wb.summary(args.title, `[探店模式] ${scenes.nodeIds.length} 场景, ${args.shotCount} 镜头(多样运镜), 风格锁定→场景→合成。`)
}

function buildTutorial(wb: WB, args: WorkflowArgs): ToolCallResult {
  // 教程：LLM脚本 → 文本 → 分镜 → 说明图 → 视频 → 合成
  // NOTE: textNode 没有 text-in 端口（见 portRegistry），所以 llm 生成的脚本在
  // 执行 llmChat 时由其 executor 直接写回给 textNode.data.content，而非拉一条
  // 不合法的边。这里只建立 textNode → storyboard 的合法连线。
  const llmId = wb.add('llmChat', { x: COL.prep, y: ROW_START }, {
    label: '脚本生成', model: DEFAULT_LLM_MODEL,
    systemPrompt: `你是专业的教程脚本撰写师。请为「${args.title}」编写清晰、分段的教程脚本。每段包含：标题、讲解文本、配图描述。`,
    userInput: args.description, response: '', status: 'idle',
  })
  const textId = wb.add('textNode', { x: COL.ref, y: ROW_START }, { label: '脚本编辑', content: args.description, role: 'script' })
  // Tag so executor/propagation can wire the llm output back into textNode.
  useFlowStore.getState().updateNodeData(llmId, { downstreamTextNodeId: textId })

  const sbId = wb.add('storyboard', { x: COL.ref, y: ROW_START + ROW_H }, { label: '分镜脚本', script: args.description, shots: [], status: 'idle' })
  wb.connect(textId, sbId, 'text-out', 'script-in')

  // Educational style lock — keeps infographics/diagrams visually consistent across steps.
  const styleId = wb.add('styleLock', { x: COL.prep, y: ROW_START + ROW_H }, {
    label: '讲解风格', referenceImage: null,
    styleDescription: args.styleDescription || 'educational infographic, clean minimal layout, clear typography, consistent color palette',
    extractedStyle: args.styleDescription || '', status: args.styleDescription ? 'done' : 'idle',
  })

  // Explanation images → longer videos
  const { imgIds, vidIds } = addShots(wb, {
    ...args,
    shotPrompts: args.shotPrompts.length > 0 ? args.shotPrompts :
      Array.from({ length: args.shotCount }, (_, i) => `Step ${i + 1} illustration for "${args.title}": clean infographic, minimal style, clear text labels, educational`),
  }, 1)
  imgIds.forEach(iid => wb.connect(styleId, iid, 'style-out', 'style-in'))

  // Stitch (no audio — can be added later)
  addStitch(wb, vidIds, null, ROW_START + Math.floor((args.shotCount + 2) / 2) * ROW_H)

  return wb.summary(args.title, `[教程模式] LLM脚本生成 → 分镜 → ${args.shotCount} 说明图 → 合成。`)
}

function buildMusicVideo(wb: WB, args: WorkflowArgs): ToolCallResult {
  // MV：剧本文本 → 节奏分镜 → 风格锁定(核心) → 角色(可选)+角色库 → 关键帧(高密度) → 短视频(快切) → 合成
  // Script text node feeds the storyboard so it has a real upstream (fixes former orphan).
  const scriptId = wb.add('textNode', { x: COL.prep, y: ROW_START }, {
    label: `${args.title} - 剧本`, content: args.description, role: 'script',
  })
  const sbId = wb.add('storyboard', { x: COL.ref, y: ROW_START }, {
    label: '节奏分镜', script: args.description, shots: [], status: 'idle',
  })
  wb.connect(scriptId, sbId, 'text-out', 'script-in')

  const styleId = wb.add('styleLock', { x: COL.prep, y: ROW_START + ROW_H }, {
    label: '视觉风格', referenceImage: null,
    styleDescription: args.styleDescription || 'music video aesthetic, high contrast, vivid colors, cinematic grain',
    extractedStyle: args.styleDescription || '', status: args.styleDescription ? 'done' : 'idle',
  })

  // Characters (if any) — still seeded to asset library even for MV to keep cross-cut identity
  const chars: AssetBoundIds = args.characterNames.length > 0
    ? addCharacters(wb, args, 'realistic', 2)
    : { nodeIds: [], assetIds: [] }

  // Character Manager — LibTV-style registry so every cut can @-reference the lead.
  if (chars.nodeIds.length > 0) {
    const mgrId = wb.add('characterManager', { x: COL.ref, y: ROW_START + (2 + chars.nodeIds.length) * ROW_H }, {
      label: '角色库', characters: [],
    })
    chars.nodeIds.forEach(cid => wb.connect(cid, mgrId, 'grid-out', 'character-in'))
  }

  // Shorter duration, more shots for MV rhythm
  const mvShotCount = Math.max(args.shotCount, 6)
  const { imgIds, vidIds } = addShots(wb, {
    ...args, shotCount: mvShotCount,
    videoPrompts: args.videoPrompts.length > 0 ? args.videoPrompts :
      Array.from({ length: mvShotCount }, (_, i) => {
        // MV 偏好稍快节奏，但 i2v 模型对极端运镜（whip pan / crane down）成功率仍 < 50%；
        // 这里改用模型友好的 push / pan / dolly + 鼓点配合的次级运动来传达节奏感。
        const cams = ['quick push-in', 'slow horizontal pan with rhythm', 'gentle dolly forward', 'locked-off with strong parallax', 'subtle zoom-in', 'static high-contrast composition']
        const subject = args.shotPrompts[i] || `Beat ${i + 1}`
        return `Camera: ${cams[i % cams.length]}. Action: ${subject}; high contrast lighting pulses subtly, hair sways, fabric ripples on each beat. Keep character identity and outfit consistent across cuts. Avoid: face distortion, warped fingers, color shift, identity change between shots.`
      }),
  }, 1, { charAssetIds: chars.assetIds })

  chars.nodeIds.forEach(cid => imgIds.forEach(iid => wb.connect(cid, iid, 'grid-out', 'ref-in')))
  imgIds.forEach(iid => wb.connect(styleId, iid, 'style-out', 'style-in'))

  // Stitch (no audio — can be added later)
  addStitch(wb, vidIds, null, ROW_START + Math.floor((mvShotCount + 1) / 2) * ROW_H)

  return wb.summary(args.title, `[MV模式] 风格锁定 + ${mvShotCount} 镜头(快节奏), ${chars.nodeIds.length} 角色, 合成。`)
}

// ════════════════════════════════════════════════════════════
// Entry point
// ════════════════════════════════════════════════════════════

const BUILDERS: Record<string, (wb: WB, args: WorkflowArgs) => ToolCallResult> = {
  short_drama: buildShortDrama,
  comic_drama: buildComicDrama,
  product_ad: buildProductAd,
  store_tour: buildStoreTour,
  tutorial: buildTutorial,
  music_video: buildMusicVideo,
}

export function buildWorkflow(args: WorkflowArgs): ToolCallResult {
  // Default to replace mode so re-runs do not stack stale workflows on the
  // canvas. Opt-in append via `replaceCanvas: false`.
  const replace = args.replaceCanvas !== false
  if (replace) {
    useFlowStore.getState().clearAll()
  }
  const builder = BUILDERS[args.scenario] || buildShortDrama
  const wb = new WB()
  return builder(wb, args)
}
