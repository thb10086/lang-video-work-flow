/**
 * Node Executor Service — 入口文件 + 调度器
 *
 * 职责：
 *  1. 共享辅助函数: tryUploadToCOS, propagateNodeOutput, pullFromUpstream
 *  2. 主调度: executeNode (按 node.type 分派到子执行器)
 *  3. 批量执行: executeNodesBatch
 *  4. 节点查找: findNodeByLabel, findNodesByLabel, findNodeById
 *
 * 子执行器拆分到:
 *  - executors/generationExecutors.ts (characterGrid/sceneGrid/imageGen/videoGen)
 *  - executors/processingExecutors.ts (storyboard/styleLock/llmChat/imageEdit/continuityCheck/videoStitch/audioNode)
 */

import { useFlowStore } from '@/store/flowStore'
import { backendApi } from '@/api/backend'

// ── Lazy imports to avoid circular deps (executors import from this file) ──
async function getGenerationExecutors() {
  return import('./executors/generationExecutors')
}
async function getProcessingExecutors() {
  return import('./executors/processingExecutors')
}

// ── Shared types ──

export interface ExecutionResult {
  success: boolean
  message: string
  output?: string // URL or data URL of generated content
}

// ── Shared helpers (exported for use by executor modules) ──

/**
 * Upload base64 image to COS in background, return COS URL.
 * Non-blocking: if COS not configured or upload fails, returns null.
 */
export async function tryUploadToCOS(dataUrl: string): Promise<string | null> {
  try {
    const res = await backendApi.uploadImage(dataUrl)
    return res.url
  } catch (err) {
    console.warn('[nodeExecutor] Backend COS upload failed:', err)
    return null
  }
}

/**
 * 数据传播引擎 — 节点执行完成后，按边将输出自动写入下游节点对应字段
 *
 * 这是解决人物一致性的核心机制：
 *   characterGrid → imageGen.referenceImages (ref-in 直连，无需裁切)
 *   sceneGrid     → styleLock.referenceImage (ref-in)
 *   imageGen      → videoGen.firstFrameImage (first-frame)
 *   styleLock     → imageGen.stylePrompt (style-in)
 *   imageGen      → continuityCheck.imageA/imageB
 */
export function propagateNodeOutput(nodeId: string): void {
  const store = useFlowStore.getState()
  const node = store.nodes.find(n => n.id === nodeId)
  if (!node) return

  const d = node.data as Record<string, unknown>

  // 最佳图片：优先 COS URL，次选 base64
  const bestImage = (
    (d.outputImageUrl as string | null) ||
    (d.croppedImageUrl as string | null) ||
    (d.croppedImage as string | null) ||
    (d.outputImage as string | null)
  )
  const cosUrl = ((d.outputImageUrl || d.croppedImageUrl) as string | null)

  const outEdges = store.edges.filter(e => e.source === nodeId)

  for (const edge of outEdges) {
    const tgt = store.nodes.find(n => n.id === edge.target)
    if (!tgt) continue

    const tgtHandle = edge.targetHandle
    const update: Record<string, unknown> = {}

    if (tgtHandle === 'grid-in' && bestImage) update.inputImage = bestImage
    else if (tgtHandle === 'first-frame' && bestImage) {
      update.firstFrameImage = bestImage
      if (cosUrl) update.firstFrameImageUrl = cosUrl
    }
    else if (tgtHandle === 'last-frame' && bestImage) {
      update.lastFrameImage = bestImage
      if (cosUrl) update.lastFrameImageUrl = cosUrl
    }
    else if (tgtHandle === 'ref-in' && bestImage) {
      update.referenceImage = bestImage
      // 多角色：追加到 referenceImages 数组
      const existing = (tgt.data?.referenceImages as string[]) || []
      const imgPrefix = bestImage.slice(0, 80)
      if (!existing.some(r => r.slice(0, 80) === imgPrefix)) {
        update.referenceImages = [...existing, bestImage]
      }
    }
    else if (tgtHandle === 'image-in' && bestImage) update.inputImage = bestImage
    else if (tgtHandle === 'style-in') {
      const style = d.extractedStyle as string | null
      if (style) update.stylePrompt = style
    }
    else if (tgtHandle === 'image-a' && bestImage) update.imageA = bestImage
    else if (tgtHandle === 'image-b' && bestImage) update.imageB = bestImage
    else if (tgtHandle === 'script-in') {
      const content = (d.content || d.response) as string | null
      if (content) update.script = content
    }
    else if (tgtHandle === 'text-in') {
      const content = (d.content || d.response) as string | null
      if (content) update.text = content
    } else if (tgtHandle === 'prompt-in') {
      const content = (d.content || d.response) as string | null
      if (content) update.prompt = content
    }

    if (Object.keys(update).length > 0) {
      store.updateNodeData(edge.target, update)
      const srcLabel = String(d.label || nodeId)
      const tgtLabel = String(tgt.data?.label || edge.target)
      console.log(`[propagate] ${srcLabel} → ${tgtLabel}: ${Object.keys(update).join(', ')}`)
    }
  }
}

/**
 * 执行前从上游节点拉取最新数据（确保有最新 COS URL）
 * 遍历入边，把上游已完成节点的输出写入当前节点的对应字段
 */
function pullFromUpstream(nodeId: string): void {
  const store = useFlowStore.getState()
  const inEdges = store.edges.filter(e => e.target === nodeId)

  // 收集所有 ref-in 参考图（支持多角色，f2 fix）
  const refImagesAcc: string[] = []

  for (const edge of inEdges) {
    const src = store.nodes.find(n => n.id === edge.source)
    if (!src) continue

    const sd = src.data as Record<string, unknown>
    const bestImage = (
      (sd.outputImageUrl as string | null) ||
      (sd.croppedImageUrl as string | null) ||
      (sd.croppedImage as string | null) ||
      (sd.outputImage as string | null)
    )
    const cosUrl = ((sd.outputImageUrl || sd.croppedImageUrl) as string | null)

    const update: Record<string, unknown> = {}
    const tgtHandle = edge.targetHandle

    if (tgtHandle === 'grid-in' && bestImage) update.inputImage = bestImage
    else if (tgtHandle === 'first-frame' && bestImage) {
      update.firstFrameImage = bestImage
      if (cosUrl) update.firstFrameImageUrl = cosUrl
    }
    else if (tgtHandle === 'last-frame' && bestImage) {
      update.lastFrameImage = bestImage
      if (cosUrl) update.lastFrameImageUrl = cosUrl
    }
    else if (tgtHandle === 'ref-in') {
      const imgForRef = (
        (sd.outputImage as string | null) ||
        (sd.outputImageUrl as string | null) ||
        (sd.croppedImage as string | null) ||
        (sd.croppedImageUrl as string | null) ||
        (sd.inputImage as string | null)
      )
      if (imgForRef) {
        const imgPrefix = imgForRef.slice(0, 80)
        if (!refImagesAcc.some(r => r.slice(0, 80) === imgPrefix)) {
          refImagesAcc.push(imgForRef)
        }
        update.referenceImage = imgForRef
      }
    }
    else if (tgtHandle === 'image-in' && bestImage) update.inputImage = bestImage
    else if (tgtHandle === 'style-in') {
      const style = sd.extractedStyle as string | null
      if (style) update.stylePrompt = style
    }
    else if (tgtHandle === 'image-a' && bestImage) update.imageA = bestImage
    else if (tgtHandle === 'image-b' && bestImage) update.imageB = bestImage
    else if (tgtHandle === 'script-in') {
      const content = (sd.content || sd.response) as string | null
      if (content) update.script = content
    }
    else if (tgtHandle === 'text-in') {
      const content = (sd.content || sd.response) as string | null
      if (content) update.text = content
    }
    else if (tgtHandle === 'prompt-in') {
      const content = (sd.content || sd.response) as string | null
      if (content) update.prompt = content
    }

    if (Object.keys(update).length > 0) {
      store.updateNodeData(nodeId, update)
    }
  }

  // f2 fix: 写入所有参考图数组
  if (refImagesAcc.length > 0) {
    store.updateNodeData(nodeId, { referenceImages: refImagesAcc })
  }
}

// ── Auto-execute prerequisite upstream nodes before imageGen / videoGen ──
async function autoExecutePrerequisites(nodeId: string, visited = new Set<string>()): Promise<void> {
  if (visited.has(nodeId)) return
  visited.add(nodeId)

  const inEdges = useFlowStore.getState().edges.filter(e => e.target === nodeId)

  for (const edge of inEdges) {
    const srcId = edge.source
    await autoExecutePrerequisites(srcId, visited)

    const freshSrc = useFlowStore.getState().nodes.find(n => n.id === srcId)
    if (!freshSrc) continue

    const d = freshSrc.data as Record<string, unknown>
    const srcType = String(freshSrc.type || '')
    const label = String(d.label || srcId)

    const hasOutput = !!(d.outputImage || d.outputImageUrl)
    if (hasOutput) continue

    try {
      const gen = await getGenerationExecutors()
      if (srcType === 'characterGrid') {
        console.log(`[autoExec] Auto-running prerequisite: "${label}" (characterGrid)`)
        pullFromUpstream(srcId)
        const r = await gen.executeCharacterGrid(srcId)
        if (r.success) propagateNodeOutput(srcId)
      } else if (srcType === 'sceneGrid') {
        console.log(`[autoExec] Auto-running prerequisite: "${label}" (sceneGrid)`)
        pullFromUpstream(srcId)
        const r = await gen.executeSceneGrid(srcId)
        if (r.success) propagateNodeOutput(srcId)
      } else if (srcType === 'imageGen' && edge.targetHandle === 'first-frame') {
        console.log(`[autoExec] Auto-running prerequisite: "${label}" (imageGen for first-frame)`)
        pullFromUpstream(srcId)
        const r = await gen.executeImageGen(srcId)
        if (r.success) propagateNodeOutput(srcId)
      }
    } catch (err) {
      console.warn(`[autoExec] Prerequisite "${label}" failed (proceeding without it):`, err)
    }
  }
}

// ── Main dispatcher ──
export async function executeNode(nodeId: string): Promise<ExecutionResult> {
  const store = useFlowStore.getState()
  const node = store.nodes.find(n => n.id === nodeId)
  if (!node) {
    return { success: false, message: `未找到节点 ID: ${nodeId}` }
  }

  // 对 imageGen / videoGen：先自动执行未完成的上游前置节点（角色一致性保障）
  if (node.type === 'imageGen' || node.type === 'videoGen') {
    await autoExecutePrerequisites(nodeId)
  }

  // 执行前：从上游拉取最新数据（确保 referenceImage / firstFrameImage 最新）
  pullFromUpstream(nodeId)

  let result: ExecutionResult
  const gen = await getGenerationExecutors()
  const proc = await getProcessingExecutors()

  switch (node.type) {
    case 'characterGrid':
      result = await gen.executeCharacterGrid(nodeId); break
    case 'sceneGrid':
      result = await gen.executeSceneGrid(nodeId); break
    case 'imageGen':
      result = await gen.executeImageGen(nodeId); break
    case 'videoGen':
      result = await gen.executeVideoGen(nodeId); break
    case 'storyboard':
      result = await proc.executeStoryboard(nodeId); break
    case 'styleLock':
      result = await proc.executeStyleLock(nodeId); break
    case 'llmChat':
      result = await proc.executeLLMChat(nodeId); break
    case 'imageEdit':
      result = await proc.executeImageEdit(nodeId); break
    case 'continuityCheck':
      result = await proc.executeContinuityCheck(nodeId); break
    case 'videoStitch':
      result = await proc.executeVideoStitch(nodeId); break
    case 'audioNode':
      result = await proc.executeAudioNode(nodeId); break
    case 'textNode':
      result = { success: true, message: `文本节点「${node.data?.label}」无需执行` }; break
    default:
      result = { success: false, message: `节点类型 ${node.type} 不支持自动执行` }
  }

  // 执行成功后：向下游传播输出
  if (result.success) propagateNodeOutput(nodeId)

  return result
}

/**
 * 并行批量执行节点（有并发上限）
 */
export async function executeNodesBatch(
  nodeIds: string[],
  concurrency = 4
): Promise<{ nodeId: string; result: ExecutionResult }[]> {
  const results: { nodeId: string; result: ExecutionResult }[] = []

  for (let i = 0; i < nodeIds.length; i += concurrency) {
    const batch = nodeIds.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map(async nodeId => ({ nodeId, result: await executeNode(nodeId) }))
    )
    results.push(...batchResults)
  }
  return results
}

// ── Find node by label (exact match first, then fuzzy) ──
export function findNodeByLabel(label: string): { id: string; type: string; label: string } | null {
  const store = useFlowStore.getState()
  const exact = store.nodes.find(n => String(n.data?.label || '') === label)
  const node = exact || store.nodes.find(n => String(n.data?.label || '').includes(label))
  if (!node) return null
  return { id: node.id, type: String(node.type || 'unknown'), label: String(node.data?.label || node.id) }
}

// ── Find all nodes matching label (for disambiguation) ──
export function findNodesByLabel(label: string): { id: string; type: string; label: string }[] {
  const store = useFlowStore.getState()
  return store.nodes
    .filter(n => {
      const nodeLabel = String(n.data?.label || '')
      return nodeLabel === label || nodeLabel.includes(label)
    })
    .map(n => ({ id: n.id, type: String(n.type || 'unknown'), label: String(n.data?.label || n.id) }))
}

// ── Test-only exports (do NOT import these outside of test files) ──
export { propagateNodeOutput as _testPropagateNodeOutput, pullFromUpstream as _testPullFromUpstream }

// ── Find node by exact ID ──
export function findNodeById(id: string): { id: string; type: string; label: string } | null {
  const store = useFlowStore.getState()
  const node = store.nodes.find(n => n.id === id)
  if (!node) return null
  return { id: node.id, type: String(node.type || 'unknown'), label: String(node.data?.label || node.id) }
}
