/**
 * nodeDefinitions.ts — 节点定义单一数据源 (Single Source of Truth)
 *
 * 所有节点的类型、标签、图标、颜色、默认数据统一在此定义。
 * NodePanel / QuickNodePanel / CanvasContextMenu / SlashMenu 全部消费此数据。
 */

import { createElement } from 'react'
import {
  User, Mountain, ImageIcon, Video, FileText, Music,
  MessageSquare, UserCheck, Film, Users, Palette, ScanEye,
  Clapperboard, Pencil,
} from 'lucide-react'
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, DEFAULT_VIDEO_SIZE, DEFAULT_VIDEO_DURATION, DEFAULT_VIDEO_RESOLUTION } from '@/providers/modelDefaults'

export interface NodeDefinition {
  type: string
  label: string
  description: string
  /** lucide icon component */
  icon: typeof User
  /** Category for filtering in QuickNodePanel */
  category: '生成' | '设计' | '工具'
  /** Tailwind color classes for NodePanel drag cards */
  cardColor: string
  /** Search keywords for QuickNodePanel */
  keywords: string[]
  /** Default node data */
  defaultData: Record<string, unknown>
}

export const NODE_REGISTRY: NodeDefinition[] = [
  {
    type: 'characterGrid', label: '角色九宫图', description: 'Gemini 生成单张角色参考图',
    icon: User, category: '设计', keywords: ['角色', '人物', 'character', 'grid'],
    cardColor: 'text-purple-500 bg-purple-50 border-purple-200 dark:bg-purple-950/40 dark:border-purple-800/50',
    defaultData: { label: '角色九宫图', name: '', description: '', style: 'anime', outputImage: null, status: 'idle' },
  },
  {
    type: 'sceneGrid', label: '场景九宫图', description: 'Gemini 生成单张场景参考图',
    icon: Mountain, category: '设计', keywords: ['场景', '背景', 'scene', 'environment'],
    cardColor: 'text-emerald-500 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800/50',
    defaultData: { label: '场景九宫图', name: '', description: '', style: 'cinematic', mood: 'dramatic', outputImage: null, status: 'idle' },
  },
  {
    type: 'imageGen', label: '图片生成', description: '多模型图片生成',
    icon: ImageIcon, category: '生成', keywords: ['图片', '图像', 'image', 'generate', '生图'],
    cardColor: 'text-blue-500 bg-blue-50 border-blue-200 dark:bg-blue-950/40 dark:border-blue-800/50',
    defaultData: { label: '图片生成', model: DEFAULT_IMAGE_MODEL, prompt: '', aspectRatio: '1:1', outputImage: null, status: 'idle' },
  },
  {
    type: 'videoGen', label: '视频生成', description: '多模型视频生成',
    icon: Video, category: '生成', keywords: ['视频', 'video', 'generate', '生视频'],
    cardColor: 'text-rose-500 bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:border-rose-800/50',
    defaultData: { label: '视频生成', model: DEFAULT_VIDEO_MODEL, prompt: '', size: DEFAULT_VIDEO_SIZE, duration: DEFAULT_VIDEO_DURATION, resolution: DEFAULT_VIDEO_RESOLUTION, outputVideo: null, status: 'idle' },
  },
  {
    type: 'textNode', label: '文本/脚本', description: '脚本 / 对话 / 旁白',
    icon: FileText, category: '工具', keywords: ['文本', '脚本', 'text', 'script', '对话'],
    cardColor: 'text-amber-500 bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-800/50',
    defaultData: { label: '文本/脚本', content: '', role: 'script' },
  },
  {
    type: 'audioNode', label: '音频生成', description: 'TTS 语音合成',
    icon: Music, category: '生成', keywords: ['音频', '音乐', 'audio', 'tts', '语音'],
    cardColor: 'text-orange-500 bg-orange-50 border-orange-200 dark:bg-orange-950/40 dark:border-orange-800/50',
    defaultData: { label: '音频生成', model: 'elevenlabs', text: '', voice: 'default', outputAudio: null, status: 'idle' },
  },
  {
    type: 'llmChat', label: 'LLM 对话', description: '大模型对话推理',
    icon: MessageSquare, category: '工具', keywords: ['llm', '对话', 'chat', 'ai', '大模型'],
    cardColor: 'text-violet-500 bg-violet-50 border-violet-200 dark:bg-violet-950/40 dark:border-violet-800/50',
    defaultData: { label: 'LLM 对话', model: 'gemini-3.1-pro-preview', systemPrompt: '', userInput: '', response: '', status: 'idle' },
  },
  {
    type: 'characterExtract', label: '角色提取', description: '视频中提取角色形象',
    icon: UserCheck, category: '工具', keywords: ['角色', '提取', 'extract', 'character'],
    cardColor: 'text-cyan-500 bg-cyan-50 border-cyan-200 dark:bg-cyan-950/40 dark:border-cyan-800/50',
    defaultData: { label: '角色提取', videoUrl: null, taskId: null, timestamps: '1,3', characterId: null, characterUrl: null, status: 'idle' },
  },
  {
    type: 'storyboard', label: '分镜脚本', description: 'AI 拆解剧本为分镜',
    icon: Film, category: '设计', keywords: ['分镜', '脚本', 'storyboard', '镜头'],
    cardColor: 'text-purple-500 bg-purple-50 border-purple-200 dark:bg-purple-950/40 dark:border-purple-800/50',
    defaultData: { label: '分镜脚本', script: '', shots: [], status: 'idle' },
  },
  {
    type: 'characterManager', label: '角色管理器', description: '统一管理角色形象',
    icon: Users, category: '工具', keywords: ['角色', '管理', 'manager'],
    cardColor: 'text-indigo-500 bg-indigo-50 border-indigo-200 dark:bg-indigo-950/40 dark:border-indigo-800/50',
    defaultData: { label: '角色管理器', characters: [] },
  },
  {
    type: 'styleLock', label: '风格锁定', description: '提取并锁定画面风格',
    icon: Palette, category: '设计', keywords: ['风格', '锁定', 'style', 'lock'],
    cardColor: 'text-pink-500 bg-pink-50 border-pink-200 dark:bg-pink-950/40 dark:border-pink-800/50',
    defaultData: { label: '风格锁定', referenceImage: null, styleDescription: '', extractedStyle: '', status: 'idle' },
  },
  {
    type: 'continuityCheck', label: '连续性检查', description: '检测镜头间一致性',
    icon: ScanEye, category: '工具', keywords: ['连续', '检查', 'continuity', '一致性'],
    cardColor: 'text-teal-500 bg-teal-50 border-teal-200 dark:bg-teal-950/40 dark:border-teal-800/50',
    defaultData: { label: '连续性检查', imageA: null, imageB: null, results: [], status: 'idle' },
  },
  {
    type: 'videoStitch', label: '视频拼接', description: '多段视频合并拼接',
    icon: Clapperboard, category: '工具', keywords: ['拼接', '合并', 'stitch', 'merge'],
    cardColor: 'text-rose-500 bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:border-rose-800/50',
    defaultData: { label: '视频拼接', clips: [], outputUrl: null },
  },
  {
    type: 'imageEdit', label: '图片编辑', description: '编辑 / 换背景 / 局部修改',
    icon: Pencil, category: '工具', keywords: ['编辑', '修改', 'edit', '换背景'],
    cardColor: 'text-orange-500 bg-orange-50 border-orange-200 dark:bg-orange-950/40 dark:border-orange-800/50',
    defaultData: { label: '图片编辑', model: DEFAULT_IMAGE_MODEL, inputImage: null, editPrompt: '', outputImage: null, status: 'idle' },
  },
]

/** Helper: render icon as JSX element with given class */
export function renderNodeIcon(def: NodeDefinition, className = 'w-4 h-4') {
  return createElement(def.icon, { className })
}

/** Helper: get a definition by type */
export function getNodeDef(type: string): NodeDefinition | undefined {
  return NODE_REGISTRY.find((d) => d.type === type)
}

/** Helper: all categories */
export const NODE_CATEGORIES = ['全部', '生成', '设计', '工具'] as const
