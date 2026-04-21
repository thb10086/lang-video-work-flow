/**
 * 工作流模板系统
 * 
 * 内置多种行业模板，用户可一键加载完整工作流到画布
 */

import type { Node, Edge } from '@xyflow/react'
import { DEFAULT_IMAGE_MODEL, DEFAULT_LLM_MODEL, DEFAULT_VIDEO_MODEL, DEFAULT_VIDEO_SIZE, DEFAULT_VIDEO_DURATION } from '@/providers/modelDefaults'

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  category: 'short_film' | 'comic_drama' | 'ad' | 'animation' | 'tutorial' | 'music_video' | 'store_tour'
  icon: string
  tags: string[]
  nodes: Node[]
  edges: Edge[]
}

const CATEGORY_LABELS: Record<string, string> = {
  short_film: '短剧',
  comic_drama: '漫剧',
  ad: '广告',
  animation: '动画',
  tutorial: '教程',
  music_video: 'MV',
  store_tour: '探店',
}

export { CATEGORY_LABELS }

// ============================================================
// 内置模板
// ============================================================

export const BUILTIN_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'short-film-basic',
    name: '短剧基础流程',
    description: '角色设计 → 分镜脚本 → 关键帧（角色参考直连）→ 视频生成，适合 30-60 秒短剧',
    category: 'short_film',
    icon: '🎬',
    tags: ['短剧', '角色一致性', '分镜'],
    nodes: [
      { id: 'char1', type: 'characterGrid', position: { x: 50, y: 50 }, data: { label: '主角设计', name: '主角', description: '', style: 'anime', outputImage: null, status: 'idle' } },
      { id: 'scene1', type: 'sceneGrid', position: { x: 50, y: 400 }, data: { label: '主场景', name: '场景', description: '', style: 'cinematic', mood: 'dramatic', outputImage: null, status: 'idle' } },
      { id: 'script', type: 'textNode', position: { x: 50, y: 750 }, data: { label: '剧本', content: '', role: 'script' } },
      { id: 'storyboard', type: 'storyboard', position: { x: 450, y: 750 }, data: { label: '分镜脚本', script: '', shots: [], status: 'idle' } },
      { id: 'img1', type: 'imageGen', position: { x: 450, y: 50 }, data: { label: ' 镜头1 关键帧', model: DEFAULT_IMAGE_MODEL, prompt: '', aspectRatio: '16:9', outputImage: null, status: 'idle' } },
      { id: 'vid1', type: 'videoGen', position: { x: 850, y: 50 }, data: { label: ' 镜头1 视频', model: DEFAULT_VIDEO_MODEL, prompt: '', size: DEFAULT_VIDEO_SIZE, duration: DEFAULT_VIDEO_DURATION, outputVideo: null, status: 'idle' } },
      { id: 'img2', type: 'imageGen', position: { x: 450, y: 350 }, data: { label: ' 镜头2 关键帧', model: DEFAULT_IMAGE_MODEL, prompt: '', aspectRatio: '16:9', outputImage: null, status: 'idle' } },
      { id: 'vid2', type: 'videoGen', position: { x: 850, y: 350 }, data: { label: ' 镜头2 视频', model: DEFAULT_VIDEO_MODEL, prompt: '', size: DEFAULT_VIDEO_SIZE, duration: DEFAULT_VIDEO_DURATION, outputVideo: null, status: 'idle' } },
      { id: 'stitch', type: 'videoStitch', position: { x: 1650, y: 200 }, data: { label: '最终拼接', clips: [], outputUrl: null } },
      { id: 'style', type: 'styleLock', position: { x: 450, y: 400 }, data: { label: '风格锁定', referenceImage: null, styleDescription: '', extractedStyle: '', status: 'idle' } },
    ],
    edges: [
      { id: 'e-char-img1', source: 'char1', target: 'img1', sourceHandle: 'grid-out', targetHandle: 'ref-in', animated: true },
      { id: 'e-char-img2', source: 'char1', target: 'img2', sourceHandle: 'grid-out', targetHandle: 'ref-in', animated: true },
      { id: 'e-img1-vid1', source: 'img1', target: 'vid1', sourceHandle: 'image-out', targetHandle: 'first-frame', animated: true },
      { id: 'e-img2-vid2', source: 'img2', target: 'vid2', sourceHandle: 'image-out', targetHandle: 'first-frame', animated: true },
      { id: 'e-script-sb', source: 'script', target: 'storyboard', sourceHandle: 'text-out', targetHandle: 'script-in', animated: true },
      { id: 'e-scene-style', source: 'scene1', target: 'style', sourceHandle: 'grid-out', targetHandle: 'ref-in', animated: true },
      { id: 'e-style-img1', source: 'style', target: 'img1', sourceHandle: 'style-out', targetHandle: 'style-in', animated: true },
      { id: 'e-style-img2', source: 'style', target: 'img2', sourceHandle: 'style-out', targetHandle: 'style-in', animated: true },
    ],
  },
  {
    id: 'ad-product',
    name: '产品广告 15 秒',
    description: '产品展示 → 场景切换 → 品牌 Logo，适合电商/社交媒体投放',
    category: 'ad',
    icon: '📺',
    tags: ['广告', '产品', '短视频'],
    nodes: [
      { id: 'product-img', type: 'imageGen', position: { x: 50, y: 50 }, data: { label: '产品图', model: DEFAULT_IMAGE_MODEL, prompt: '', aspectRatio: '1:1', outputImage: null, status: 'idle' } },
      { id: 'scene-img', type: 'imageGen', position: { x: 50, y: 350 }, data: { label: '使用场景', model: DEFAULT_IMAGE_MODEL, prompt: '', aspectRatio: '16:9', outputImage: null, status: 'idle' } },
      { id: 'vid-intro', type: 'videoGen', position: { x: 450, y: 50 }, data: { label: '产品展示 5s', model: DEFAULT_VIDEO_MODEL, prompt: '', size: DEFAULT_VIDEO_SIZE, duration: DEFAULT_VIDEO_DURATION, outputVideo: null, status: 'idle' } },
      { id: 'vid-scene', type: 'videoGen', position: { x: 450, y: 350 }, data: { label: '场景切换 5s', model: DEFAULT_VIDEO_MODEL, prompt: '', size: DEFAULT_VIDEO_SIZE, duration: DEFAULT_VIDEO_DURATION, outputVideo: null, status: 'idle' } },
      { id: 'vid-logo', type: 'videoGen', position: { x: 450, y: 650 }, data: { label: 'Logo 5s', model: DEFAULT_VIDEO_MODEL, prompt: 'Brand logo reveal with elegant animation', size: DEFAULT_VIDEO_SIZE, duration: DEFAULT_VIDEO_DURATION, outputVideo: null, status: 'idle' } },
      { id: 'stitch', type: 'videoStitch', position: { x: 850, y: 350 }, data: { label: '最终合成', clips: [], outputUrl: null } },
      { id: 'style', type: 'styleLock', position: { x: 50, y: 650 }, data: { label: '品牌风格', referenceImage: null, styleDescription: '', extractedStyle: '', status: 'idle' } },
    ],
    edges: [
      { id: 'e-prod-vid', source: 'product-img', target: 'vid-intro', sourceHandle: 'image-out', targetHandle: 'first-frame', animated: true },
      { id: 'e-scene-vid', source: 'scene-img', target: 'vid-scene', sourceHandle: 'image-out', targetHandle: 'first-frame', animated: true },
    ],
  },
  {
    id: 'animation-character',
    name: '角色动画短片',
    description: '角色九宫图 → 动画视频（角色图直接作为首帧参考），强调角色一致性',
    category: 'animation',
    icon: '🎨',
    tags: ['动画', '角色一致性', 'Character'],
    nodes: [
      { id: 'char', type: 'characterGrid', position: { x: 50, y: 100 }, data: { label: '角色设计', name: '', description: '', style: 'anime', outputImage: null, status: 'idle' } },
      { id: 'img1', type: 'imageGen', position: { x: 450, y: 50 }, data: { label: '镇夶1 关键帧', model: DEFAULT_IMAGE_MODEL, prompt: '', aspectRatio: '16:9', outputImage: null, status: 'idle' } },
      { id: 'img2', type: 'imageGen', position: { x: 450, y: 300 }, data: { label: '镇夶2 关键帧', model: DEFAULT_IMAGE_MODEL, prompt: '', aspectRatio: '16:9', outputImage: null, status: 'idle' } },
      { id: 'vid1', type: 'videoGen', position: { x: 850, y: 50 }, data: { label: '镇夶1 视频', model: DEFAULT_VIDEO_MODEL, prompt: '', size: DEFAULT_VIDEO_SIZE, duration: DEFAULT_VIDEO_DURATION, outputVideo: null, status: 'idle' } },
      { id: 'vid2', type: 'videoGen', position: { x: 850, y: 300 }, data: { label: '镇夶2 视频', model: DEFAULT_VIDEO_MODEL, prompt: '', size: DEFAULT_VIDEO_SIZE, duration: DEFAULT_VIDEO_DURATION, outputVideo: null, status: 'idle' } },
      { id: 'extract', type: 'characterExtract', position: { x: 1250, y: 50 }, data: { label: '提取角色', videoUrl: null, taskId: null, timestamps: '1,3', characterId: null, characterUrl: null, status: 'idle' } },
      { id: 'manager', type: 'characterManager', position: { x: 1250, y: 350 }, data: { label: '角色库', characters: [] } },
      { id: 'check', type: 'continuityCheck', position: { x: 850, y: 550 }, data: { label: '一致性检查', imageA: null, imageB: null, results: [], status: 'idle' } },
    ],
    edges: [
      { id: 'e-char-img1', source: 'char', target: 'img1', sourceHandle: 'grid-out', targetHandle: 'ref-in', animated: true },
      { id: 'e-char-img2', source: 'char', target: 'img2', sourceHandle: 'grid-out', targetHandle: 'ref-in', animated: true },
      { id: 'e-img1-vid1', source: 'img1', target: 'vid1', sourceHandle: 'image-out', targetHandle: 'first-frame', animated: true },
      { id: 'e-img2-vid2', source: 'img2', target: 'vid2', sourceHandle: 'image-out', targetHandle: 'first-frame', animated: true },
      { id: 'e-vid1-extract', source: 'vid1', target: 'extract', sourceHandle: 'video-out', targetHandle: 'video-in', animated: true },
      { id: 'e-extract-mgr', source: 'extract', target: 'manager', sourceHandle: 'character-out', targetHandle: 'character-in', animated: true },
    ],
  },
  {
    id: 'tutorial-basic',
    name: '教程/解说视频',
    description: 'LLM 编写脚本 → 图片说明 → 配音 → 视频，适合知识类内容',
    category: 'tutorial',
    icon: '📚',
    tags: ['教程', '解说', '知识'],
    nodes: [
      { id: 'llm', type: 'llmChat', position: { x: 50, y: 100 }, data: { label: '脚本生成', model: DEFAULT_LLM_MODEL, systemPrompt: '你是专业的教程脚本撰写师。', userInput: '', response: '', status: 'idle' } },
      { id: 'text', type: 'textNode', position: { x: 450, y: 100 }, data: { label: '脚本编辑', content: '', role: 'script' } },
      { id: 'img1', type: 'imageGen', position: { x: 450, y: 400 }, data: { label: '说明图1', model: DEFAULT_IMAGE_MODEL, prompt: '', aspectRatio: '16:9', outputImage: null, status: 'idle' } },
      { id: 'img2', type: 'imageGen', position: { x: 450, y: 700 }, data: { label: '说明图2', model: DEFAULT_IMAGE_MODEL, prompt: '', aspectRatio: '16:9', outputImage: null, status: 'idle' } },
      { id: 'vid1', type: 'videoGen', position: { x: 850, y: 400 }, data: { label: '片段1', model: DEFAULT_VIDEO_MODEL, prompt: '', size: DEFAULT_VIDEO_SIZE, duration: 15, outputVideo: null, status: 'idle' } },
      { id: 'vid2', type: 'videoGen', position: { x: 850, y: 700 }, data: { label: '片段2', model: DEFAULT_VIDEO_MODEL, prompt: '', size: DEFAULT_VIDEO_SIZE, duration: 15, outputVideo: null, status: 'idle' } },
      { id: 'audio', type: 'audioNode', position: { x: 850, y: 100 }, data: { label: '配音', model: 'elevenlabs', text: '', voice: 'default', outputAudio: null, status: 'idle' } },
      { id: 'stitch', type: 'videoStitch', position: { x: 1250, y: 550 }, data: { label: '最终合成', clips: [], outputUrl: null } },
    ],
    edges: [
      { id: 'e-llm-text', source: 'llm', target: 'text', sourceHandle: 'text-out', targetHandle: 'text-in', animated: true },
      { id: 'e-img1-vid1', source: 'img1', target: 'vid1', sourceHandle: 'image-out', targetHandle: 'first-frame', animated: true },
      { id: 'e-img2-vid2', source: 'img2', target: 'vid2', sourceHandle: 'image-out', targetHandle: 'first-frame', animated: true },
      { id: 'e-text-audio', source: 'text', target: 'audio', sourceHandle: 'text-out', targetHandle: 'text-in', animated: true },
    ],
  },

  // ── 漫剧/动漫短剧 ──
  {
    id: 'comic-drama-basic',
    name: '漫剧/动漫短剧',
    description: '多角色九宫图 → 风格锁定(anime) → 分镜脚本 → 关键帧(角色参考直连) → 视频 → 配音 → 合成，强调角色一致性',
    category: 'comic_drama',
    icon: '🎌',
    tags: ['漫剧', '动漫', '角色一致性', 'anime'],
    nodes: [
      { id: 'char1', type: 'characterGrid', position: { x: 50, y: 50 }, data: { label: '主角设计', name: '主角', description: '', style: 'anime', outputImage: null, status: 'idle' } },
      { id: 'char2', type: 'characterGrid', position: { x: 50, y: 350 }, data: { label: '配角设计', name: '配角', description: '', style: 'anime', outputImage: null, status: 'idle' } },
      { id: 'style', type: 'styleLock', position: { x: 450, y: 350 }, data: { label: '风格锁定', referenceImage: null, styleDescription: 'anime style, vibrant colors, clean line art, dynamic composition', extractedStyle: 'anime', status: 'idle' } },
      { id: 'script', type: 'textNode', position: { x: 50, y: 650 }, data: { label: '剧本', content: '', role: 'script' } },
      { id: 'sb', type: 'storyboard', position: { x: 450, y: 650 }, data: { label: '分镜脚本', script: '', shots: [], status: 'idle' } },
      { id: 'img1', type: 'imageGen', position: { x: 850, y: 50 }, data: { label: '镜头1 关键帧', model: DEFAULT_IMAGE_MODEL, prompt: '', aspectRatio: '16:9', imageSize: '2k', outputImage: null, status: 'idle' } },
      { id: 'img2', type: 'imageGen', position: { x: 850, y: 350 }, data: { label: '镜头2 关键帧', model: DEFAULT_IMAGE_MODEL, prompt: '', aspectRatio: '16:9', imageSize: '2k', outputImage: null, status: 'idle' } },
      { id: 'img3', type: 'imageGen', position: { x: 850, y: 650 }, data: { label: '镜头3 关键帧', model: DEFAULT_IMAGE_MODEL, prompt: '', aspectRatio: '16:9', imageSize: '2k', outputImage: null, status: 'idle' } },
      { id: 'vid1', type: 'videoGen', position: { x: 1250, y: 50 }, data: { label: '镜头1 视频', model: DEFAULT_VIDEO_MODEL, prompt: '', size: DEFAULT_VIDEO_SIZE, duration: DEFAULT_VIDEO_DURATION, outputVideo: null, status: 'idle' } },
      { id: 'vid2', type: 'videoGen', position: { x: 1250, y: 350 }, data: { label: '镜头2 视频', model: DEFAULT_VIDEO_MODEL, prompt: '', size: DEFAULT_VIDEO_SIZE, duration: DEFAULT_VIDEO_DURATION, outputVideo: null, status: 'idle' } },
      { id: 'vid3', type: 'videoGen', position: { x: 1250, y: 650 }, data: { label: '镜头3 视频', model: DEFAULT_VIDEO_MODEL, prompt: '', size: DEFAULT_VIDEO_SIZE, duration: DEFAULT_VIDEO_DURATION, outputVideo: null, status: 'idle' } },
      { id: 'audio', type: 'audioNode', position: { x: 1250, y: 900 }, data: { label: '角色配音', model: 'elevenlabs', text: '', voice: 'default', outputAudio: null, status: 'idle' } },
      { id: 'stitch', type: 'videoStitch', position: { x: 1650, y: 350 }, data: { label: '最终合成', clips: [], outputUrl: null } },
    ],
    edges: [
      // 角色→所有关键帧 (角色一致性核心)
      { id: 'e-c1-i1', source: 'char1', target: 'img1', sourceHandle: 'grid-out', targetHandle: 'ref-in', animated: true },
      { id: 'e-c1-i2', source: 'char1', target: 'img2', sourceHandle: 'grid-out', targetHandle: 'ref-in', animated: true },
      { id: 'e-c1-i3', source: 'char1', target: 'img3', sourceHandle: 'grid-out', targetHandle: 'ref-in', animated: true },
      { id: 'e-c2-i1', source: 'char2', target: 'img1', sourceHandle: 'grid-out', targetHandle: 'ref-in', animated: true },
      { id: 'e-c2-i2', source: 'char2', target: 'img2', sourceHandle: 'grid-out', targetHandle: 'ref-in', animated: true },
      { id: 'e-c2-i3', source: 'char2', target: 'img3', sourceHandle: 'grid-out', targetHandle: 'ref-in', animated: true },
      // 风格→所有关键帧
      { id: 'e-s-i1', source: 'style', target: 'img1', sourceHandle: 'style-out', targetHandle: 'style-in', animated: true },
      { id: 'e-s-i2', source: 'style', target: 'img2', sourceHandle: 'style-out', targetHandle: 'style-in', animated: true },
      { id: 'e-s-i3', source: 'style', target: 'img3', sourceHandle: 'style-out', targetHandle: 'style-in', animated: true },
      // 关键帧→视频首帧
      { id: 'e-i1-v1', source: 'img1', target: 'vid1', sourceHandle: 'image-out', targetHandle: 'first-frame', animated: true },
      { id: 'e-i2-v2', source: 'img2', target: 'vid2', sourceHandle: 'image-out', targetHandle: 'first-frame', animated: true },
      { id: 'e-i3-v3', source: 'img3', target: 'vid3', sourceHandle: 'image-out', targetHandle: 'first-frame', animated: true },
      // 剧本→分镜
      { id: 'e-sc-sb', source: 'script', target: 'sb', sourceHandle: 'text-out', targetHandle: 'script-in', animated: true },
      // 剧本→配音
      { id: 'e-sc-au', source: 'script', target: 'audio', sourceHandle: 'text-out', targetHandle: 'text-in', animated: true },
    ],
  },

  // ── 探店/Vlog ──
  {
    id: 'store-tour-vlog',
    name: '探店/Vlog',
    description: '多场景九宫图 → 风格锁定(写实) → 关键帧(多样运镜) → 视频 → 旁白配音 → 合成，强调场景多样性',
    category: 'store_tour',
    icon: '📍',
    tags: ['探店', 'Vlog', '美食', '旅行'],
    nodes: [
      { id: 'scene1', type: 'sceneGrid', position: { x: 50, y: 50 }, data: { label: '门店外观', name: '门店外观', description: '', style: 'realistic', mood: 'dramatic', outputImage: null, status: 'idle' } },
      { id: 'scene2', type: 'sceneGrid', position: { x: 50, y: 350 }, data: { label: '店内环境', name: '店内环境', description: '', style: 'realistic', mood: 'peaceful', outputImage: null, status: 'idle' } },
      { id: 'scene3', type: 'sceneGrid', position: { x: 50, y: 650 }, data: { label: '特色美食/产品', name: '特色展示', description: '', style: 'realistic', mood: 'dramatic', outputImage: null, status: 'idle' } },
      { id: 'style', type: 'styleLock', position: { x: 450, y: 350 }, data: { label: '风格锁定', referenceImage: null, styleDescription: 'vlog style, warm tones, natural lighting, handheld feel', extractedStyle: '', status: 'idle' } },
      { id: 'img1', type: 'imageGen', position: { x: 850, y: 50 }, data: { label: '外景关键帧', model: DEFAULT_IMAGE_MODEL, prompt: '', aspectRatio: '16:9', imageSize: '2k', outputImage: null, status: 'idle' } },
      { id: 'img2', type: 'imageGen', position: { x: 850, y: 350 }, data: { label: '内景关键帧', model: DEFAULT_IMAGE_MODEL, prompt: '', aspectRatio: '16:9', imageSize: '2k', outputImage: null, status: 'idle' } },
      { id: 'img3', type: 'imageGen', position: { x: 850, y: 650 }, data: { label: '特写关键帧', model: DEFAULT_IMAGE_MODEL, prompt: '', aspectRatio: '16:9', imageSize: '2k', outputImage: null, status: 'idle' } },
      { id: 'vid1', type: 'videoGen', position: { x: 1250, y: 50 }, data: { label: '外景 dolly', model: DEFAULT_VIDEO_MODEL, prompt: '', size: DEFAULT_VIDEO_SIZE, duration: DEFAULT_VIDEO_DURATION, outputVideo: null, status: 'idle' } },
      { id: 'vid2', type: 'videoGen', position: { x: 1250, y: 350 }, data: { label: '内景 tracking', model: DEFAULT_VIDEO_MODEL, prompt: '', size: DEFAULT_VIDEO_SIZE, duration: DEFAULT_VIDEO_DURATION, outputVideo: null, status: 'idle' } },
      { id: 'vid3', type: 'videoGen', position: { x: 1250, y: 650 }, data: { label: '特写 push-in', model: DEFAULT_VIDEO_MODEL, prompt: '', size: DEFAULT_VIDEO_SIZE, duration: DEFAULT_VIDEO_DURATION, outputVideo: null, status: 'idle' } },
      { id: 'audio', type: 'audioNode', position: { x: 1250, y: 900 }, data: { label: '旁白/BGM', model: 'elevenlabs', text: '', voice: 'default', outputAudio: null, status: 'idle' } },
      { id: 'stitch', type: 'videoStitch', position: { x: 1650, y: 350 }, data: { label: '最终合成', clips: [], outputUrl: null } },
    ],
    edges: [
      // 场景→风格锁定
      { id: 'e-s1-st', source: 'scene1', target: 'style', sourceHandle: 'grid-out', targetHandle: 'ref-in', animated: true },
      { id: 'e-s2-st', source: 'scene2', target: 'style', sourceHandle: 'grid-out', targetHandle: 'ref-in', animated: true },
      { id: 'e-s3-st', source: 'scene3', target: 'style', sourceHandle: 'grid-out', targetHandle: 'ref-in', animated: true },
      // 风格→所有关键帧
      { id: 'e-st-i1', source: 'style', target: 'img1', sourceHandle: 'style-out', targetHandle: 'style-in', animated: true },
      { id: 'e-st-i2', source: 'style', target: 'img2', sourceHandle: 'style-out', targetHandle: 'style-in', animated: true },
      { id: 'e-st-i3', source: 'style', target: 'img3', sourceHandle: 'style-out', targetHandle: 'style-in', animated: true },
      // 关键帧→视频首帧
      { id: 'e-i1-v1', source: 'img1', target: 'vid1', sourceHandle: 'image-out', targetHandle: 'first-frame', animated: true },
      { id: 'e-i2-v2', source: 'img2', target: 'vid2', sourceHandle: 'image-out', targetHandle: 'first-frame', animated: true },
      { id: 'e-i3-v3', source: 'img3', target: 'vid3', sourceHandle: 'image-out', targetHandle: 'first-frame', animated: true },
    ],
  },

  // ── MV/混剪 ──
  {
    id: 'music-video-montage',
    name: 'MV/混剪',
    description: '风格锁定(核心) → 高密度分镜 → 快切关键帧 → 短时长视频(4-6s) → 合成，强调节奏感与视觉统一',
    category: 'music_video',
    icon: '🎵',
    tags: ['MV', '混剪', '音乐', '节奏'],
    nodes: [
      { id: 'style', type: 'styleLock', position: { x: 50, y: 50 }, data: { label: '视觉风格', referenceImage: null, styleDescription: 'music video aesthetic, high contrast, vivid colors, cinematic grain', extractedStyle: '', status: 'idle' } },
      { id: 'char', type: 'characterGrid', position: { x: 50, y: 350 }, data: { label: '主角/歌手', name: '主角', description: '', style: 'realistic', outputImage: null, status: 'idle' } },
      { id: 'sb', type: 'storyboard', position: { x: 450, y: 50 }, data: { label: '节奏分镜', script: '', shots: [], status: 'idle' } },
      { id: 'img1', type: 'imageGen', position: { x: 450, y: 350 }, data: { label: 'Beat1 关键帧', model: DEFAULT_IMAGE_MODEL, prompt: '', aspectRatio: '16:9', imageSize: '2k', outputImage: null, status: 'idle' } },
      { id: 'img2', type: 'imageGen', position: { x: 450, y: 600 }, data: { label: 'Beat2 关键帧', model: DEFAULT_IMAGE_MODEL, prompt: '', aspectRatio: '16:9', imageSize: '2k', outputImage: null, status: 'idle' } },
      { id: 'img3', type: 'imageGen', position: { x: 450, y: 850 }, data: { label: 'Beat3 关键帧', model: DEFAULT_IMAGE_MODEL, prompt: '', aspectRatio: '16:9', imageSize: '2k', outputImage: null, status: 'idle' } },
      { id: 'img4', type: 'imageGen', position: { x: 450, y: 1100 }, data: { label: 'Beat4 关键帧', model: DEFAULT_IMAGE_MODEL, prompt: '', aspectRatio: '16:9', imageSize: '2k', outputImage: null, status: 'idle' } },
      { id: 'vid1', type: 'videoGen', position: { x: 850, y: 350 }, data: { label: 'Beat1 视频', model: DEFAULT_VIDEO_MODEL, prompt: '', size: DEFAULT_VIDEO_SIZE, duration: 4, outputVideo: null, status: 'idle' } },
      { id: 'vid2', type: 'videoGen', position: { x: 850, y: 600 }, data: { label: 'Beat2 视频', model: DEFAULT_VIDEO_MODEL, prompt: '', size: DEFAULT_VIDEO_SIZE, duration: 4, outputVideo: null, status: 'idle' } },
      { id: 'vid3', type: 'videoGen', position: { x: 850, y: 850 }, data: { label: 'Beat3 视频', model: DEFAULT_VIDEO_MODEL, prompt: '', size: DEFAULT_VIDEO_SIZE, duration: 4, outputVideo: null, status: 'idle' } },
      { id: 'vid4', type: 'videoGen', position: { x: 850, y: 1100 }, data: { label: 'Beat4 视频', model: DEFAULT_VIDEO_MODEL, prompt: '', size: DEFAULT_VIDEO_SIZE, duration: 4, outputVideo: null, status: 'idle' } },
      { id: 'audio', type: 'audioNode', position: { x: 850, y: 50 }, data: { label: '音乐/BGM', model: 'elevenlabs', text: '', voice: 'default', outputAudio: null, status: 'idle' } },
      { id: 'stitch', type: 'videoStitch', position: { x: 1250, y: 600 }, data: { label: '最终合成', clips: [], outputUrl: null } },
    ],
    edges: [
      // 角色→所有关键帧 (一致性)
      { id: 'e-c-i1', source: 'char', target: 'img1', sourceHandle: 'grid-out', targetHandle: 'ref-in', animated: true },
      { id: 'e-c-i2', source: 'char', target: 'img2', sourceHandle: 'grid-out', targetHandle: 'ref-in', animated: true },
      { id: 'e-c-i3', source: 'char', target: 'img3', sourceHandle: 'grid-out', targetHandle: 'ref-in', animated: true },
      { id: 'e-c-i4', source: 'char', target: 'img4', sourceHandle: 'grid-out', targetHandle: 'ref-in', animated: true },
      // 风格→所有关键帧
      { id: 'e-s-i1', source: 'style', target: 'img1', sourceHandle: 'style-out', targetHandle: 'style-in', animated: true },
      { id: 'e-s-i2', source: 'style', target: 'img2', sourceHandle: 'style-out', targetHandle: 'style-in', animated: true },
      { id: 'e-s-i3', source: 'style', target: 'img3', sourceHandle: 'style-out', targetHandle: 'style-in', animated: true },
      { id: 'e-s-i4', source: 'style', target: 'img4', sourceHandle: 'style-out', targetHandle: 'style-in', animated: true },
      // 关键帧→视频首帧
      { id: 'e-i1-v1', source: 'img1', target: 'vid1', sourceHandle: 'image-out', targetHandle: 'first-frame', animated: true },
      { id: 'e-i2-v2', source: 'img2', target: 'vid2', sourceHandle: 'image-out', targetHandle: 'first-frame', animated: true },
      { id: 'e-i3-v3', source: 'img3', target: 'vid3', sourceHandle: 'image-out', targetHandle: 'first-frame', animated: true },
      { id: 'e-i4-v4', source: 'img4', target: 'vid4', sourceHandle: 'image-out', targetHandle: 'first-frame', animated: true },
    ],
  },

  // ── 产品广告 30 秒 ──
  {
    id: 'ad-product-30s',
    name: '产品广告 30 秒',
    description: '品牌风格锁定 → 产品展示+使用场景+用户证言+Logo → 合成，适合完整品牌宣传',
    category: 'ad',
    icon: '📺',
    tags: ['广告', '品牌', '30秒', '电商'],
    nodes: [
      { id: 'style', type: 'styleLock', position: { x: 50, y: 50 }, data: { label: '品牌风格', referenceImage: null, styleDescription: 'commercial, clean, professional, brand-consistent', extractedStyle: '', status: 'idle' } },
      { id: 'prod-img', type: 'imageGen', position: { x: 450, y: 50 }, data: { label: '产品特写', model: DEFAULT_IMAGE_MODEL, prompt: '', aspectRatio: '1:1', imageSize: '2k', outputImage: null, status: 'idle' } },
      { id: 'scene-img', type: 'imageGen', position: { x: 450, y: 300 }, data: { label: '使用场景', model: DEFAULT_IMAGE_MODEL, prompt: '', aspectRatio: '16:9', imageSize: '2k', outputImage: null, status: 'idle' } },
      { id: 'test-img', type: 'imageGen', position: { x: 450, y: 550 }, data: { label: '用户证言', model: DEFAULT_IMAGE_MODEL, prompt: '', aspectRatio: '16:9', imageSize: '2k', outputImage: null, status: 'idle' } },
      { id: 'vid-prod', type: 'videoGen', position: { x: 850, y: 50 }, data: { label: '产品展示 8s', model: DEFAULT_VIDEO_MODEL, prompt: '', size: DEFAULT_VIDEO_SIZE, duration: 8, outputVideo: null, status: 'idle' } },
      { id: 'vid-scene', type: 'videoGen', position: { x: 850, y: 300 }, data: { label: '场景切换 8s', model: DEFAULT_VIDEO_MODEL, prompt: '', size: DEFAULT_VIDEO_SIZE, duration: 8, outputVideo: null, status: 'idle' } },
      { id: 'vid-test', type: 'videoGen', position: { x: 850, y: 550 }, data: { label: '用户证言 8s', model: DEFAULT_VIDEO_MODEL, prompt: '', size: DEFAULT_VIDEO_SIZE, duration: 8, outputVideo: null, status: 'idle' } },
      { id: 'vid-logo', type: 'videoGen', position: { x: 850, y: 800 }, data: { label: 'Logo 结尾 6s', model: DEFAULT_VIDEO_MODEL, prompt: 'Brand logo reveal with elegant animation, clean white background, professional', size: DEFAULT_VIDEO_SIZE, duration: 6, outputVideo: null, status: 'idle' } },
      { id: 'stitch', type: 'videoStitch', position: { x: 1250, y: 400 }, data: { label: '最终合成', clips: [], outputUrl: null } },
    ],
    edges: [
      // 风格→所有产品图
      { id: 'e-s-pi', source: 'style', target: 'prod-img', sourceHandle: 'style-out', targetHandle: 'style-in', animated: true },
      { id: 'e-s-si', source: 'style', target: 'scene-img', sourceHandle: 'style-out', targetHandle: 'style-in', animated: true },
      { id: 'e-s-ti', source: 'style', target: 'test-img', sourceHandle: 'style-out', targetHandle: 'style-in', animated: true },
      // 关键帧→视频首帧
      { id: 'e-pi-vp', source: 'prod-img', target: 'vid-prod', sourceHandle: 'image-out', targetHandle: 'first-frame', animated: true },
      { id: 'e-si-vs', source: 'scene-img', target: 'vid-scene', sourceHandle: 'image-out', targetHandle: 'first-frame', animated: true },
      { id: 'e-ti-vt', source: 'test-img', target: 'vid-test', sourceHandle: 'image-out', targetHandle: 'first-frame', animated: true },
    ],
  },
]
