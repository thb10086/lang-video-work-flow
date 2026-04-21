/**
 * Agent Tool Helpers — 工具执行器共享的辅助函数和类型
 *
 * 被 agentTools.ts 和 toolHandlers.ts 共同使用
 */

import { useFlowStore } from '@/store/flowStore'
import { findNodeByLabel, findNodeById, findNodesByLabel } from '@/providers/nodeExecutor'

export interface ToolCallResult {
  success: boolean
  message: string
  nodeIds?: string[]
}

// ── Shared node lookup helpers (support nodeId + label + disambiguation) ──

/** Resolve node by nodeId (precise) or nodeLabel (fuzzy). Returns null if not found. */
export function resolveNode(args: Record<string, unknown>): { id: string; type: string; label: string } | null {
  const nodeId = String(args.nodeId || '')
  const nodeLabel = String(args.nodeLabel || '')
  if (nodeId) return findNodeById(nodeId)
  if (nodeLabel) return findNodeByLabel(nodeLabel)
  return null
}

/** Produce a helpful not-found message, listing candidates when multiple nodes share a label. */
export function resolveNodeNotFound(args: Record<string, unknown>): ToolCallResult {
  const nodeId = String(args.nodeId || '')
  const nodeLabel = String(args.nodeLabel || '')
  if (nodeId) return { success: false, message: `未找到 ID 为 "${nodeId}" 的节点` }
  if (!nodeLabel) return { success: false, message: '需要提供 nodeLabel 或 nodeId 参数' }
  const candidates = findNodesByLabel(nodeLabel)
  if (candidates.length === 0) {
    return { success: false, message: `未找到标签包含「${nodeLabel}」的节点` }
  }
  const list = candidates.map(n => `  - "${n.label}" (ID: ${n.id}, type: ${n.type})`).join('\n')
  return {
    success: false,
    message: `找到 ${candidates.length} 个同名节点，请用 nodeId 精确指定:\n${list}`,
  }
}

export function getSmartPosition() {
  const store = useFlowStore.getState()
  const nodes = store.nodes
  if (nodes.length === 0) return { x: 100, y: 100 }
  // Find bounding box of existing nodes, place new node below-right
  let maxX = 0
  let maxY = 0
  for (const n of nodes) {
    if (n.position.x + 300 > maxX) maxX = n.position.x + 300
    if (n.position.y + 200 > maxY) maxY = n.position.y + 200
  }
  // Place in a new row below existing nodes, with some offset
  const col = nodes.length % 4
  return {
    x: 100 + col * 380,
    y: maxY + 60,
  }
}

// Smart handle resolution based on node types
export function resolveSourceHandle(sourceType: string): string | null {
  switch (sourceType) {
    case 'characterGrid': case 'sceneGrid': return 'grid-out'
    case 'imageGen': case 'imageEdit': return 'image-out'
    case 'videoGen': return 'video-out'
    case 'textNode': return 'text-out'
    case 'audioNode': return 'audio-out'
    case 'styleLock': return 'style-out'
    case 'storyboard': return 'shots-out'
    default: return null
  }
}

export function resolveTargetHandle(targetType: string, sourceType: string): string | null {
  switch (targetType) {
    case 'styleLock': return 'ref-in'
    case 'storyboard': return 'script-in'
    case 'videoStitch':
      return sourceType === 'audioNode' ? 'audio-in' : 'video-in'
    case 'imageGen':
      if (sourceType === 'styleLock') return 'style-in'
      return 'ref-in'
    case 'imageEdit': return 'image-in'
    case 'videoGen':
      if (sourceType === 'imageGen' || sourceType === 'imageEdit') return 'first-frame'
      return null
    case 'audioNode': return 'text-in'
    case 'continuityCheck': return 'image-a'  // default; connect_nodes will check for image-b
    case 'llmChat': return null  // LLM nodes don't have standard inputs
    default: return null
  }
}

// Trigger fitView on the ReactFlow instance after node creation
export function triggerFitView() {
  // Dispatch a custom event that WorkflowCanvas listens to
  window.dispatchEvent(new CustomEvent('agent-fitview'))
}
