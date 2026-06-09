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

// ── Layout constants for Agent auto-placement ──
// Waterfall (Pinterest-style) grid: distribute nodes into columns,
// always placing the next node into the shortest column.
const LAYOUT = {
  ORIGIN_X: 100,
  ORIGIN_Y: 100,
  COL_WIDTH: 520,   // widest node (460) + horizontal gap (60)
  ROW_GAP: 80,      // vertical gap between rows
  MAX_COLS: 3,      // number of grid columns
} as const

/** Estimated rendered height per node type (px) — used to compute the
 *  "bottom edge" of each column so subsequent nodes don't overlap. */
const NODE_EST_HEIGHT: Record<string, number> = {
  videoGen: 560,
  imageGen: 530,
  storyboard: 420,
  characterGrid: 400,
  sceneGrid: 400,
  styleLock: 360,
  characterManager: 360,
  characterExtract: 360,
  llmChat: 340,
  videoStitch: 320,
  imageEdit: 320,
  continuityCheck: 320,
  audioNode: 280,
  textNode: 220,
}
const DEFAULT_NODE_HEIGHT = 360

/**
 * Waterfall auto-layout: scan all existing nodes to build per-column
 * bottom-edge heights, then place the new node in the shortest column.
 *
 * @param nodeType - React Flow node type (e.g. 'videoGen'), used to
 *   estimate the height footprint for future placement calculations.
 */
export function getSmartPosition(nodeType?: string) {
  const store = useFlowStore.getState()
  const nodes = store.nodes
  const { ORIGIN_X, ORIGIN_Y, COL_WIDTH, ROW_GAP, MAX_COLS } = LAYOUT

  if (nodes.length === 0) return { x: ORIGIN_X, y: ORIGIN_Y }

  // Per-column "bottom edge" tracker
  const colBottoms = new Array<number>(MAX_COLS).fill(ORIGIN_Y)

  for (const n of nodes) {
    const col = Math.round((n.position.x - ORIGIN_X) / COL_WIDTH)
    if (col < 0 || col >= MAX_COLS) continue  // node outside grid — skip
    const h = NODE_EST_HEIGHT[n.type || ''] || DEFAULT_NODE_HEIGHT
    const bottom = n.position.y + h + ROW_GAP
    if (bottom > colBottoms[col]) colBottoms[col] = bottom
  }

  // Find the shortest column
  let bestCol = 0
  for (let i = 1; i < MAX_COLS; i++) {
    if (colBottoms[i] < colBottoms[bestCol]) bestCol = i
  }

  return {
    x: ORIGIN_X + bestCol * COL_WIDTH,
    y: colBottoms[bestCol],
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
