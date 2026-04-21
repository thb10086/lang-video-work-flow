/**
 * Port Registry — 每种节点类型的端口定义
 * 
 * 用于：
 * 1. 渲染类型化 Handle
 * 2. 连接验证（只允许兼容类型连接）
 * 3. 数据流传递
 */

import { PortDataType, type NodePort } from '@/providers/types'

/** 端口颜色映射 */
export const PORT_COLORS: Record<PortDataType, string> = {
  [PortDataType.TEXT]: '#f59e0b',
  [PortDataType.IMAGE]: '#3b82f6',
  [PortDataType.IMAGE_SET]: '#8b5cf6',
  [PortDataType.VIDEO]: '#f43f5e',
  [PortDataType.AUDIO]: '#f97316',
  [PortDataType.CHARACTER]: '#06b6d4',
  [PortDataType.PROMPT]: '#10b981',
  [PortDataType.STORYBOARD]: '#a855f7',
}

/** 节点类型 → 端口列表 */
export const NODE_PORT_REGISTRY: Record<string, NodePort[]> = {
  characterGrid: [
    { id: 'prompt-in', label: '提示词', dataType: PortDataType.TEXT, direction: 'input', required: false, multi: false },
    { id: 'ref-in', label: '参考图', dataType: PortDataType.IMAGE, direction: 'input', required: false, multi: false },
    { id: 'grid-out', label: '九宫图', dataType: PortDataType.IMAGE, direction: 'output', required: false, multi: true },
    { id: 'views-out', label: '视角集', dataType: PortDataType.IMAGE_SET, direction: 'output', required: false, multi: true },
  ],
  sceneGrid: [
    { id: 'prompt-in', label: '提示词', dataType: PortDataType.TEXT, direction: 'input', required: false, multi: false },
    { id: 'ref-in', label: '参考图', dataType: PortDataType.IMAGE, direction: 'input', required: false, multi: false },
    { id: 'grid-out', label: '九宫图', dataType: PortDataType.IMAGE, direction: 'output', required: false, multi: true },
    { id: 'views-out', label: '视角集', dataType: PortDataType.IMAGE_SET, direction: 'output', required: false, multi: true },
  ],
  imageGen: [
    { id: 'prompt-in', label: '提示词', dataType: PortDataType.TEXT, direction: 'input', required: false, multi: false },
    { id: 'ref-in', label: '参考图', dataType: PortDataType.IMAGE, direction: 'input', required: false, multi: false },
    { id: 'image-out', label: '输出图', dataType: PortDataType.IMAGE, direction: 'output', required: false, multi: true },
  ],
  videoGen: [
    { id: 'prompt-in', label: '提示词', dataType: PortDataType.TEXT, direction: 'input', required: false, multi: false },
    { id: 'first-frame', label: '首帧', dataType: PortDataType.IMAGE, direction: 'input', required: false, multi: false },
    { id: 'last-frame', label: '尾帧', dataType: PortDataType.IMAGE, direction: 'input', required: false, multi: false },
    { id: 'character-in', label: '角色', dataType: PortDataType.CHARACTER, direction: 'input', required: false, multi: false },
    { id: 'video-out', label: '视频', dataType: PortDataType.VIDEO, direction: 'output', required: false, multi: true },
  ],
  textNode: [
    { id: 'text-out', label: '文本', dataType: PortDataType.TEXT, direction: 'output', required: false, multi: true },
  ],
  audioNode: [
    { id: 'text-in', label: '文本', dataType: PortDataType.TEXT, direction: 'input', required: false, multi: false },
    { id: 'audio-out', label: '音频', dataType: PortDataType.AUDIO, direction: 'output', required: false, multi: true },
  ],
  llmChat: [
    { id: 'system-in', label: '系统提示', dataType: PortDataType.TEXT, direction: 'input', required: false, multi: false },
    { id: 'user-in', label: '用户输入', dataType: PortDataType.TEXT, direction: 'input', required: false, multi: false },
    { id: 'text-out', label: '回复', dataType: PortDataType.TEXT, direction: 'output', required: false, multi: true },
  ],
  promptNode: [
    { id: 'vars-in', label: '变量', dataType: PortDataType.TEXT, direction: 'input', required: false, multi: true },
    { id: 'prompt-out', label: '提示词', dataType: PortDataType.PROMPT, direction: 'output', required: false, multi: true },
  ],
  imageCrop: [
    { id: 'grid-in', label: '九宫图', dataType: PortDataType.IMAGE, direction: 'input', required: true, multi: false },
    { id: 'image-out', label: '裁切图', dataType: PortDataType.IMAGE, direction: 'output', required: false, multi: true },
  ],
  characterExtract: [
    { id: 'video-in', label: '视频', dataType: PortDataType.VIDEO, direction: 'input', required: true, multi: false },
    { id: 'character-out', label: '角色', dataType: PortDataType.CHARACTER, direction: 'output', required: false, multi: true },
  ],
  storyboard: [
    { id: 'script-in', label: '剧本', dataType: PortDataType.TEXT, direction: 'input', required: true, multi: false },
    { id: 'scenes-out', label: '分镜', dataType: PortDataType.STORYBOARD, direction: 'output', required: false, multi: true },
  ],
  characterManager: [
    { id: 'character-in', label: '角色输入', dataType: PortDataType.CHARACTER, direction: 'input', required: false, multi: true },
    { id: 'character-out', label: '角色输出', dataType: PortDataType.CHARACTER, direction: 'output', required: false, multi: true },
  ],
  styleLock: [
    { id: 'ref-in', label: '参考图', dataType: PortDataType.IMAGE, direction: 'input', required: false, multi: false },
    { id: 'style-in', label: '风格描述', dataType: PortDataType.TEXT, direction: 'input', required: false, multi: false },
    { id: 'style-out', label: '锁定风格', dataType: PortDataType.PROMPT, direction: 'output', required: false, multi: true },
  ],
  continuityCheck: [
    { id: 'image-a', label: '镜头A', dataType: PortDataType.IMAGE, direction: 'input', required: false, multi: false },
    { id: 'image-b', label: '镜头B', dataType: PortDataType.IMAGE, direction: 'input', required: false, multi: false },
    { id: 'report-out', label: '检查报告', dataType: PortDataType.TEXT, direction: 'output', required: false, multi: true },
  ],
  videoStitch: [
    { id: 'video-in', label: '视频输入', dataType: PortDataType.VIDEO, direction: 'input', required: false, multi: true },
    { id: 'video-out', label: '拼接输出', dataType: PortDataType.VIDEO, direction: 'output', required: false, multi: true },
  ],
  imageEdit: [
    { id: 'image-in', label: '原图', dataType: PortDataType.IMAGE, direction: 'input', required: true, multi: false },
    { id: 'image-out', label: '编辑后', dataType: PortDataType.IMAGE, direction: 'output', required: false, multi: true },
  ],
}

/**
 * 端口类型兼容性矩阵
 * source type → 允许连接的 target types
 */
export const PORT_COMPATIBILITY: Record<PortDataType, PortDataType[]> = {
  [PortDataType.TEXT]: [PortDataType.TEXT, PortDataType.PROMPT],
  [PortDataType.IMAGE]: [PortDataType.IMAGE],
  [PortDataType.IMAGE_SET]: [PortDataType.IMAGE_SET, PortDataType.IMAGE],
  [PortDataType.VIDEO]: [PortDataType.VIDEO],
  [PortDataType.AUDIO]: [PortDataType.AUDIO],
  [PortDataType.CHARACTER]: [PortDataType.CHARACTER],
  [PortDataType.PROMPT]: [PortDataType.PROMPT, PortDataType.TEXT],
  [PortDataType.STORYBOARD]: [PortDataType.STORYBOARD],
}

/**
 * 检查两个端口是否可以连接
 */
export function canConnect(
  sourceNodeType: string,
  sourceHandleId: string,
  targetNodeType: string,
  targetHandleId: string
): boolean {
  const sourcePorts = NODE_PORT_REGISTRY[sourceNodeType]
  const targetPorts = NODE_PORT_REGISTRY[targetNodeType]
  if (!sourcePorts || !targetPorts) return true // 未注册的节点允许自由连接

  const sourcePort = sourcePorts.find(p => p.id === sourceHandleId && p.direction === 'output')
  const targetPort = targetPorts.find(p => p.id === targetHandleId && p.direction === 'input')
  if (!sourcePort || !targetPort) return true // 未找到端口定义时允许连接

  const compatible = PORT_COMPATIBILITY[sourcePort.dataType]
  return compatible?.includes(targetPort.dataType) ?? false
}

/**
 * 获取端口的数据类型
 */
export function getPortDataType(nodeType: string, handleId: string): PortDataType | null {
  const ports = NODE_PORT_REGISTRY[nodeType]
  if (!ports) return null
  const port = ports.find(p => p.id === handleId)
  return port?.dataType ?? null
}
