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
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, DEFAULT_VIDEO_SIZE, DEFAULT_VIDEO_DURATION, DEFAULT_VIDEO_RESOLUTION } from '@/providers/modelDefaults'
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
}

// ── Layout constants ──

const COL = { prep: 50, ref: 450, keyframe: 850, video: 1250, output: 1650 }
const ROW_H = 260
const ROW_START = 60

// ── Shared builder helpers ──

class WB {
  nodeIds: string[] = []
  edgeCount = 0
  private store = useFlowStore.getState()

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

  summary(title: string, extra: string): ToolCallResult {
    setTimeout(() => triggerFitView(), 300)
    return {
      success: true,
      message: `已生成「${title}」工作流：${extra}共 ${this.nodeIds.length} 个节点, ${this.edgeCount} 条连线。`,
      nodeIds: this.nodeIds,
    }
  }
}

// ── Shared: create character grids ──

function addCharacters(wb: WB, args: WorkflowArgs, style: string, startRow: number): string[] {
  const ids: string[] = []
  args.characterNames.forEach((name, i) => {
    const desc = args.characterDescriptions[i] || `${name}, a character in "${args.title}". Distinctive appearance with consistent clothing and recognizable features.`
    const id = wb.add('characterGrid', { x: COL.prep, y: ROW_START + (startRow + i) * ROW_H }, {
      label: `角色: ${name}`, name, description: desc, style, outputImage: null, status: 'idle',
    })
    ids.push(id)
    wb.registerChar(name, desc)
  })
  return ids
}

// ── Shared: create scene grids ──

function addScenes(wb: WB, args: WorkflowArgs, startRow: number): string[] {
  const ids: string[] = []
  args.sceneNames.forEach((name, i) => {
    const desc = args.sceneDescriptions[i] || `${name} in "${args.title}". Detailed environment with cinematic lighting.`
    const id = wb.add('sceneGrid', { x: COL.prep, y: ROW_START + (startRow + i) * ROW_H }, {
      label: `场景: ${name}`, name, description: desc, style: 'cinematic', mood: 'dramatic', outputImage: null, status: 'idle',
    })
    ids.push(id)
  })
  return ids
}

// ── Shared: create shot pairs (keyframe + video) ──

function addShots(wb: WB, args: WorkflowArgs, startRow: number): { imgIds: string[]; vidIds: string[] } {
  const imgIds: string[] = []
  const vidIds: string[] = []
  for (let i = 0; i < args.shotCount; i++) {
    const y = ROW_START + (startRow + i) * ROW_H
    const imgPrompt = args.shotPrompts[i] || `Shot ${i + 1} of "${args.title}": cinematic keyframe, detailed scene`
    const vidPrompt = args.videoPrompts[i] || `[Camera]: slow dolly forward. [Subject]: ${imgPrompt}. [Quality]: Cinematic 4K. [Negative]: No morphing, no identity drift.`
    const imgId = wb.add('imageGen', { x: COL.keyframe, y }, {
      label: `镜头${i + 1} 关键帧`, model: DEFAULT_IMAGE_MODEL, prompt: imgPrompt,
      aspectRatio: '16:9', imageSize: '2k', referenceImage: null, outputImage: null, status: 'idle',
    })
    const vidId = wb.add('videoGen', { x: COL.video, y }, {
      label: `镜头${i + 1} 视频`, model: DEFAULT_VIDEO_MODEL, prompt: vidPrompt,
      size: DEFAULT_VIDEO_SIZE, duration: DEFAULT_VIDEO_DURATION, resolution: DEFAULT_VIDEO_RESOLUTION,
      generate_audio: false, outputVideo: null, status: 'idle',
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
  const charIds = addCharacters(wb, args, 'realistic', 2)

  // Scenes — after style lock
  const sceneIds = addScenes(wb, args, 2 + args.characterNames.length)

  // Shots
  const { imgIds, vidIds } = addShots(wb, args, 2)
  charIds.forEach(cid => imgIds.forEach(iid => wb.connect(cid, iid, 'grid-out', 'ref-in')))
  imgIds.forEach(iid => wb.connect(styleId, iid, 'style-out', 'style-in'))

  // Stitch (no audio — audio is optional, can be added later)
  addStitch(wb, vidIds, null, ROW_START + Math.floor((args.shotCount + 2) / 2) * ROW_H)

  return wb.summary(args.title, `${charIds.length} 角色(写实), ${sceneIds.length} 场景, ${args.shotCount} 镜头, 风格锁定→角色→场景→分镜→合成。`)
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
  const charIds = addCharacters(wb, args, 'anime', 2)

  // Shots
  const { imgIds, vidIds } = addShots(wb, args, 2)
  charIds.forEach(cid => imgIds.forEach(iid => wb.connect(cid, iid, 'grid-out', 'ref-in')))
  imgIds.forEach(iid => wb.connect(styleId, iid, 'style-out', 'style-in'))

  // Stitch (no audio — can be added later)
  addStitch(wb, vidIds, null, ROW_START + Math.floor((args.shotCount + 2) / 2) * ROW_H)

  return wb.summary(args.title, `[漫剧模式] ${charIds.length} 角色(anime), ${args.shotCount} 镜头, 风格锁定→角色→分镜→合成。`)
}

function buildProductAd(wb: WB, args: WorkflowArgs): ToolCallResult {
  // 产品广告：产品图→展示视频 + 场景图→场景视频 + Logo→品牌视频 → 合成
  const styleId = wb.add('styleLock', { x: COL.prep, y: ROW_START }, {
    label: '品牌风格', referenceImage: null,
    styleDescription: args.styleDescription || 'commercial, clean, professional, brand-consistent',
    extractedStyle: args.styleDescription || '', status: args.styleDescription ? 'done' : 'idle',
  })

  // Product shots (imageGen → videoGen pairs)
  const productY = ROW_START + ROW_H
  const prodImgId = wb.add('imageGen', { x: COL.keyframe, y: productY }, {
    label: '产品展示', model: DEFAULT_IMAGE_MODEL,
    prompt: args.shotPrompts[0] || `Product hero shot of "${args.title}", studio lighting, white background, 8K commercial photography`,
    aspectRatio: '1:1', imageSize: '2k', referenceImage: null, outputImage: null, status: 'idle',
  })
  const prodVidId = wb.add('videoGen', { x: COL.video, y: productY }, {
    label: '产品展示 5s', model: DEFAULT_VIDEO_MODEL,
    prompt: args.videoPrompts[0] || `[Camera]: Slow 360 orbit. [Subject]: Product rotating on pedestal. [Quality]: Commercial 4K. [Negative]: No morphing.`,
    size: DEFAULT_VIDEO_SIZE, duration: 5, resolution: DEFAULT_VIDEO_RESOLUTION, generate_audio: false, outputVideo: null, status: 'idle',
  })
  wb.connect(prodImgId, prodVidId, 'image-out', 'first-frame')
  wb.connect(styleId, prodImgId, 'style-out', 'style-in')

  // Scene shots
  const sceneY = ROW_START + 2 * ROW_H
  const sceneImgId = wb.add('imageGen', { x: COL.keyframe, y: sceneY }, {
    label: '使用场景', model: DEFAULT_IMAGE_MODEL,
    prompt: args.shotPrompts[1] || `Lifestyle scene with "${args.title}" product in use, warm natural lighting, cinematic`,
    aspectRatio: '16:9', imageSize: '2k', referenceImage: null, outputImage: null, status: 'idle',
  })
  const sceneVidId = wb.add('videoGen', { x: COL.video, y: sceneY }, {
    label: '场景切换 5s', model: DEFAULT_VIDEO_MODEL,
    prompt: args.videoPrompts[1] || `[Camera]: Tracking shot. [Subject]: Product in lifestyle context. [Quality]: Cinematic 4K. [Negative]: No morphing.`,
    size: DEFAULT_VIDEO_SIZE, duration: 5, resolution: DEFAULT_VIDEO_RESOLUTION, generate_audio: false, outputVideo: null, status: 'idle',
  })
  wb.connect(sceneImgId, sceneVidId, 'image-out', 'first-frame')
  wb.connect(styleId, sceneImgId, 'style-out', 'style-in')

  // Logo/Brand ending
  const logoY = ROW_START + 3 * ROW_H
  const logoVidId = wb.add('videoGen', { x: COL.video, y: logoY }, {
    label: 'Logo 结尾 5s', model: DEFAULT_VIDEO_MODEL,
    prompt: args.videoPrompts[2] || `[Camera]: Static. [Subject]: Brand logo reveal, elegant animation. [Quality]: 4K clean. [Negative]: No flickering.`,
    size: DEFAULT_VIDEO_SIZE, duration: 5, resolution: DEFAULT_VIDEO_RESOLUTION, generate_audio: false, outputVideo: null, status: 'idle',
  })

  // Stitch
  addStitch(wb, [prodVidId, sceneVidId, logoVidId], null, ROW_START + 2 * ROW_H)

  return wb.summary(args.title, `[产品广告模式] 产品展示+使用场景+Logo结尾, 品牌风格锁定。`)
}

function buildStoreTour(wb: WB, args: WorkflowArgs): ToolCallResult {
  // 探店：风格锁定 → 多场景 → 视频(丰富运镜) → 合成
  const styleId = wb.add('styleLock', { x: COL.prep, y: ROW_START }, {
    label: '风格锁定', referenceImage: null,
    styleDescription: args.styleDescription || 'vlog style, warm tones, natural lighting, handheld feel',
    extractedStyle: args.styleDescription || '', status: args.styleDescription ? 'done' : 'idle',
  })

  // Scenes — after style lock
  const sceneIds = addScenes(wb, args, 1)

  // Shots with varied camera movements
  const cameras = ['dolly forward', 'tracking left', 'crane up', 'handheld follow', 'slow pan right', 'push in']
  const { imgIds, vidIds } = addShots(wb, {
    ...args,
    videoPrompts: args.videoPrompts.length > 0 ? args.videoPrompts :
      Array.from({ length: args.shotCount }, (_, i) => {
        const cam = cameras[i % cameras.length]
        return `[Camera]: ${cam}. [Subject]: ${args.shotPrompts[i] || `Scene ${i + 1}`}. [Environment]: ${args.sceneNames[i % args.sceneNames.length] || 'interior'}. [Quality]: Vlog 4K, warm grade. [Negative]: No morphing.`
      }),
  }, 1)
  imgIds.forEach(iid => wb.connect(styleId, iid, 'style-out', 'style-in'))

  // Stitch (no audio — can be added later)
  addStitch(wb, vidIds, null, ROW_START + Math.floor((args.shotCount + 1) / 2) * ROW_H)

  return wb.summary(args.title, `[探店模式] ${sceneIds.length} 场景, ${args.shotCount} 镜头(多样运镜), 风格锁定→场景→合成。`)
}

function buildTutorial(wb: WB, args: WorkflowArgs): ToolCallResult {
  // 教程：LLM脚本 → 文本 → 分镜 → 说明图 → 视频 → 合成
  const llmId = wb.add('llmChat', { x: COL.prep, y: ROW_START }, {
    label: '脚本生成', model: 'gemini-3.1-pro-preview',
    systemPrompt: `你是专业的教程脚本撰写师。请为「${args.title}」编写清晰、分段的教程脚本。每段包含：标题、讲解文本、配图描述。`,
    userInput: args.description, response: '', status: 'idle',
  })
  const textId = wb.add('textNode', { x: COL.ref, y: ROW_START }, { label: '脚本编辑', content: args.description, role: 'script' })
  wb.connect(llmId, textId, 'text-out', 'text-in')

  const sbId = wb.add('storyboard', { x: COL.ref, y: ROW_START + ROW_H }, { label: '分镜脚本', script: args.description, shots: [], status: 'idle' })
  wb.connect(textId, sbId, 'text-out', 'script-in')

  // Explanation images → longer videos
  const { imgIds, vidIds } = addShots(wb, {
    ...args,
    shotPrompts: args.shotPrompts.length > 0 ? args.shotPrompts :
      Array.from({ length: args.shotCount }, (_, i) => `Step ${i + 1} illustration for "${args.title}": clean infographic, minimal style, clear text labels, educational`),
  }, 1)

  // Stitch (no audio — can be added later)
  addStitch(wb, vidIds, null, ROW_START + Math.floor((args.shotCount + 2) / 2) * ROW_H)

  return wb.summary(args.title, `[教程模式] LLM脚本生成 → 分镜 → ${args.shotCount} 说明图 → 合成。`)
}

function buildMusicVideo(wb: WB, args: WorkflowArgs): ToolCallResult {
  // MV：风格锁定(核心) → 分镜(按节奏) → 关键帧(高密度) → 短视频(快切) → 合成
  const styleId = wb.add('styleLock', { x: COL.prep, y: ROW_START }, {
    label: '视觉风格', referenceImage: null,
    styleDescription: args.styleDescription || 'music video aesthetic, high contrast, vivid colors, cinematic grain',
    extractedStyle: args.styleDescription || '', status: args.styleDescription ? 'done' : 'idle',
  })

  const sbId = wb.add('storyboard', { x: COL.ref, y: ROW_START }, {
    label: '节奏分镜', script: args.description, shots: [], status: 'idle',
  })

  // Characters (if any)
  const charIds = args.characterNames.length > 0 ? addCharacters(wb, args, 'realistic', 1) : []

  // Shorter duration, more shots for MV rhythm
  const mvShotCount = Math.max(args.shotCount, 6)
  const { imgIds, vidIds } = addShots(wb, {
    ...args, shotCount: mvShotCount,
    videoPrompts: args.videoPrompts.length > 0 ? args.videoPrompts :
      Array.from({ length: mvShotCount }, (_, i) => {
        const cams = ['whip pan', 'fast dolly', 'dutch angle push', 'crane down', 'tracking orbit', 'snap zoom']
        return `[Camera]: ${cams[i % cams.length]}. [Subject]: ${args.shotPrompts[i] || `Beat ${i + 1}`}. [Quality]: Music video 4K, high contrast. [Negative]: No morphing, no flickering.`
      }),
  }, 1)

  charIds.forEach(cid => imgIds.forEach(iid => wb.connect(cid, iid, 'grid-out', 'ref-in')))
  imgIds.forEach(iid => wb.connect(styleId, iid, 'style-out', 'style-in'))

  // Stitch (no audio — can be added later)
  addStitch(wb, vidIds, null, ROW_START + Math.floor((mvShotCount + 1) / 2) * ROW_H)

  return wb.summary(args.title, `[MV模式] 风格锁定 + ${mvShotCount} 镜头(快节奏), ${charIds.length} 角色, 合成。`)
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
  const builder = BUILDERS[args.scenario] || buildShortDrama
  const wb = new WB()
  return builder(wb, args)
}
