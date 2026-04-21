/**
 * Agent Tool Handlers — 基础设施工具 + 节点 CRUD + 查询工具的执行逻辑
 *
 * 从 agentTools.ts 拆分出来，处理以下工具：
 * - plan_task, update_plan_step, verify_task
 * - save_memory, recall_memory
 * - update_node, delete_node, execute_node, retry_node
 * - batch_execute, parallel_execute
 * - get_node_output, get_canvas_state
 * - inject_user_images, list_models
 */

import { useFlowStore } from '@/store/flowStore'
import { useAgentMemoryStore, type MemoryEntry } from '@/store/agentMemoryStore'
import { useChatStore } from '@/store/chatStore'
import { executeNode, executeNodesBatch, findNodeByLabel } from '@/providers/nodeExecutor'
import { resolveNode, resolveNodeNotFound, type ToolCallResult } from './toolHelpers'

// ── Agent Infrastructure Tools ──

export function handlePlanTask(args: Record<string, unknown>): ToolCallResult {
  const memStore = useAgentMemoryStore.getState()
  const goal = String(args.goal || '')
  const steps = (args.steps as string[]) || []
  memStore.createPlan(goal, steps)
  return {
    success: true,
    message: `已创建任务计划「${goal}」，共 ${steps.length} 步:\n${steps.map((s, i) => `  ${i}. ${s}`).join('\n')}`,
  }
}

export function handleUpdatePlanStep(args: Record<string, unknown>): ToolCallResult {
  const memStore = useAgentMemoryStore.getState()
  const plan = memStore.currentPlan
  if (!plan) {
    return { success: false, message: '当前没有活跃的任务计划，请先调用 plan_task 创建' }
  }
  const stepIndex = Number(args.stepIndex ?? -1)
  const status = String(args.status || 'done') as 'pending' | 'in_progress' | 'done' | 'failed'
  const result = String(args.result || '')
  if (stepIndex < 0 || stepIndex >= plan.steps.length) {
    return { success: false, message: `步骤索引 ${stepIndex} 超出范围 (0-${plan.steps.length - 1})` }
  }
  const stepId = plan.steps[stepIndex].id
  memStore.updateStepStatus(stepId, status, result)
  // Read fresh state after mutation to get accurate count
  const freshPlan = useAgentMemoryStore.getState().currentPlan
  const done = freshPlan ? freshPlan.steps.filter(s => s.status === 'done').length : 0
  return {
    success: true,
    message: `步骤 ${stepIndex} 已更新为 [${status}]${result ? ': ' + result : ''} (${done}/${plan.steps.length} 完成)`,
  }
}

// Re-export verify task from dedicated module
export { handleVerifyTask } from './toolVerify'

export function handleSaveMemory(args: Record<string, unknown>): ToolCallResult {
  const memStore = useAgentMemoryStore.getState()
  const memId = memStore.saveMemory({
    type: (args.type as MemoryEntry['type']) || 'project_preference',
    title: String(args.title || ''),
    content: String(args.content || ''),
    tags: (args.tags as string[]) || [],
  })
  return { success: true, message: `已保存记忆「${args.title}」(${memId})` }
}

export function handleRecallMemory(args: Record<string, unknown>): ToolCallResult {
  const memStore = useAgentMemoryStore.getState()
  const query = String(args.query || '')
  const limit = Number(args.limit || 5)
  const results = memStore.recallMemories(query, limit)
  if (results.length === 0) {
    return { success: true, message: `未找到与「${query}」相关的记忆` }
  }
  const lines = results.map((m: MemoryEntry) => `- [${m.type}] ${m.title}: ${m.content.slice(0, 100)}`)
  return { success: true, message: `找到 ${results.length} 条相关记忆:\n${lines.join('\n')}` }
}

// ── Node CRUD + Execution Tools ──

export function handleUpdateNode(args: Record<string, unknown>): ToolCallResult {
  const store = useFlowStore.getState()
  const updates = args.updates as Record<string, unknown> | undefined
  if (!updates) return { success: false, message: '需要提供 updates 字段' }
  const found = resolveNode(args)
  if (!found) return resolveNodeNotFound(args)
  store.updateNodeData(found.id, updates)

  // 同步角色外貌注册表（当更新 characterGrid 的 name/description 时）
  if (found.type === 'characterGrid') {
    const fresh = store.nodes.find(n => n.id === found.id)
    if (fresh) {
      const name = String(fresh.data?.name || '')
      const desc = String(fresh.data?.description || '')
      if (name && desc) store.setCharacterAppearance(name, desc)
    }
  }

  const fields = Object.keys(updates).join(', ')
  return { success: true, message: `已更新节点「${found.label}」的字段: ${fields}` }
}

export function handleDeleteNode(args: Record<string, unknown>): ToolCallResult {
  const store = useFlowStore.getState()
  const found = resolveNode(args)
  if (!found) return resolveNodeNotFound(args)
  store.removeNode(found.id)
  return { success: true, message: `已删除节点「${found.label}」及其连线` }
}

export async function handleExecuteNode(args: Record<string, unknown>): Promise<ToolCallResult> {
  const found = resolveNode(args)
  if (!found) return resolveNodeNotFound(args)
  const execResult = await executeNode(found.id)
  return { success: execResult.success, message: execResult.message }
}

export async function handleRetryNode(args: Record<string, unknown>): Promise<ToolCallResult> {
  const store = useFlowStore.getState()
  const found = resolveNode(args)
  if (!found) return resolveNodeNotFound(args)
  // 重置状态，保留数据，重新执行；同时递增重试次数
  const prevCount = Number((store.nodes.find(n => n.id === found.id)?.data?.retryCount) || 0)
  store.updateNodeData(found.id, { status: 'idle', errorMsg: null, progress: 0, retryCount: prevCount + 1 })
  const retryResult = await executeNode(found.id)
  return {
    success: retryResult.success,
    message: `重试节点「${found.label}」: ${retryResult.message}`,
  }
}

export async function handleBatchExecute(args: Record<string, unknown>): Promise<ToolCallResult> {
  const labels = (args.nodeLabels as string[]) || []
  if (labels.length === 0) {
    return { success: false, message: '需要提供 nodeLabels 列表' }
  }
  const batchResults: string[] = []
  let successCount = 0
  for (const lbl of labels) {
    const found = findNodeByLabel(lbl)
    if (!found) {
      batchResults.push(`[skip] 未找到「${lbl}」`)
      continue
    }
    const r = await executeNode(found.id)
    if (r.success) successCount++
    batchResults.push(`${r.success ? '[done]' : '[fail]'} ${r.message}`)
  }
  return {
    success: successCount > 0,
    message: `批量执行完成 (${successCount}/${labels.length} 成功):\n${batchResults.join('\n')}`,
  }
}

export async function handleParallelExecute(args: Record<string, unknown>): Promise<ToolCallResult> {
  const labelList = (args.nodeLabels as string[]) || []
  const idList = (args.nodeIds as string[]) || []
  const concurrency = Number(args.concurrency || 4)

  // Resolve IDs: prefer explicit nodeIds, then resolve from labels
  let resolvedIds: string[] = [...idList]
  const labelSkips: string[] = []
  for (const lbl of labelList) {
    const found = findNodeByLabel(lbl)
    if (found) resolvedIds.push(found.id)
    else labelSkips.push(lbl)
  }
  // Dedup
  resolvedIds = [...new Set(resolvedIds)]

  if (resolvedIds.length === 0) {
    const skipNote = labelSkips.length > 0 ? `，未找到: ${labelSkips.join('、')}` : ''
    return { success: false, message: `没有找到可并行执行的节点${skipNote}` }
  }

  const batchResults = await executeNodesBatch(resolvedIds, concurrency)
  const successCount = batchResults.filter(r => r.result.success).length
  const lines = batchResults.map(r =>
    `${r.result.success ? '[done]' : '[fail]'} ${r.result.message}`
  )
  if (labelSkips.length > 0) lines.push(`[skip] 未找到: ${labelSkips.join('、')}`)

  return {
    success: successCount > 0,
    message: `并行执行完成 (${successCount}/${resolvedIds.length} 成功, 并发=${concurrency}):\n${lines.join('\n')}`,
  }
}

// ── Query / Inspection Tools ──

export function handleGetNodeOutput(args: Record<string, unknown>): ToolCallResult {
  const store = useFlowStore.getState()
  const found = resolveNode(args)
  if (!found) return resolveNodeNotFound(args)
  const node = store.nodes.find(n => n.id === found.id)
  if (!node) {
    return { success: false, message: `节点已不存在` }
  }
  const d = node.data as Record<string, unknown>

  // Build structured output object for LLM to parse programmatically
  const output: Record<string, unknown> = {
    nodeId: found.id,
    label: found.label,
    type: found.type,
    status: String(d.status || 'idle'),
  }
  if (d.errorMsg) output.error = String(d.errorMsg)
  if (d.progress !== undefined && d.progress !== null) output.progress = d.progress
  if (d.outputImage) output.hasOutputImage = true
  if (d.croppedImage) output.hasCroppedImage = true
  if (d.outputVideo) output.outputVideoUrl = String(d.outputVideo).slice(0, 120)
  if (d.outputAudio) output.hasOutputAudio = true
  if (d.response) output.llmResponse = String(d.response).slice(0, 200)
  if (d.taskId) output.taskId = String(d.taskId).slice(0, 16)
  if (d.extractedStyle) output.extractedStyle = String(d.extractedStyle).slice(0, 100)
  if (d.content) output.textContent = String(d.content).slice(0, 200)
  if (d.retryCount) output.retryCount = Number(d.retryCount)

  if (Array.isArray(d.shots) && (d.shots as unknown[]).length > 0) {
    output.shotCount = (d.shots as unknown[]).length
    output.shots = (d.shots as Array<Record<string, unknown>>).map((shot, i) => ({
      index: i,
      characters: Array.isArray(shot.charactersPresent) ? shot.charactersPresent : [],
      prompt: String(shot.imagePrompt || shot.description || shot.scene || '').slice(0, 100),
      dialogue: shot.dialogue ? String(shot.dialogue).slice(0, 50) : undefined,
    }))
  }
  if (Array.isArray(d.clips) && (d.clips as unknown[]).length > 0) {
    output.clipCount = (d.clips as unknown[]).length
    output.clips = (d.clips as Array<Record<string, unknown>>).map((clip, i) => ({
      index: i,
      label: String(clip.label || ''),
      hasUrl: Boolean(clip.url),
    }))
  }
  if (Array.isArray(d.results) && (d.results as unknown[]).length > 0) {
    const results = d.results as Array<Record<string, unknown>>
    output.checkResults = {
      total: results.length,
      passed: results.filter(r => r.status === 'pass').length,
      items: results.map(r => ({ aspect: String(r.aspect), status: String(r.status), detail: String(r.detail || '').slice(0, 80) })),
    }
  }

  return { success: true, message: JSON.stringify(output, null, 2) }
}

export function handleGetCanvasState(): ToolCallResult {
  const store = useFlowStore.getState()
  const nodes = store.nodes
  const edges = store.edges
  if (nodes.length === 0) {
    return { success: true, message: JSON.stringify({ nodeCount: 0, edgeCount: 0, nodes: [], edges: [] }) }
  }

  // Structured output: LLM can parse nodeId, type, status directly
  const structuredNodes = nodes.map(n => {
    const entry: Record<string, unknown> = {
      id: n.id,
      type: String(n.type || 'unknown'),
      label: String(n.data?.label || n.id),
      status: String(n.data?.status || 'idle'),
    }
    if (n.data?.prompt) entry.prompt = String(n.data.prompt).slice(0, 100)
    if (n.data?.description) entry.desc = String(n.data.description).slice(0, 100)
    if (n.data?.content) entry.content = String(n.data.content).slice(0, 100)
    if (n.data?.name) entry.name = String(n.data.name)
    if (n.data?.model) entry.model = String(n.data.model)
    if (n.data?.script) entry.script = String(n.data.script).slice(0, 80)
    if (n.data?.styleDescription) entry.style = String(n.data.styleDescription).slice(0, 80)
    return entry
  })

  const structuredEdges = edges.map(e => {
    const src = nodes.find(n => n.id === e.source)
    const tgt = nodes.find(n => n.id === e.target)
    return {
      source: { id: e.source, label: String(src?.data?.label || e.source) },
      target: { id: e.target, label: String(tgt?.data?.label || e.target) },
      sourceHandle: e.sourceHandle || null,
      targetHandle: e.targetHandle || null,
    }
  })

  const result = {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes: structuredNodes,
    edges: structuredEdges,
  }
  return { success: true, message: JSON.stringify(result, null, 2) }
}

export function handleInjectUserImages(args: Record<string, unknown>): ToolCallResult {
  const store = useFlowStore.getState()
  const targets = (args.targets as Array<Record<string, unknown>>) || []
  if (targets.length === 0) return { success: false, message: '需要提供 targets 列表' }

  // Collect all user-uploaded images from recent chat messages (newest first)
  const chatMessages = useChatStore.getState().messages
  const allUserImages: string[] = []
  for (let i = chatMessages.length - 1; i >= 0; i--) {
    const m = chatMessages[i]
    if (m.role === 'user' && m.images && m.images.length > 0) {
      allUserImages.push(...m.images)
      break // Only use images from the most recent user message with images
    }
  }

  if (allUserImages.length === 0) {
    return { success: false, message: '当前对话中未找到用户上传的图片。请让用户先上传图片再调用此工具。' }
  }

  const results: string[] = []
  const affectedIds: string[] = []

  for (const target of targets) {
    const found = resolveNode(target)
    if (!found) {
      const notFound = resolveNodeNotFound(target)
      results.push(`[skip] ${notFound.message}`)
      continue
    }

    const field = String(target.field || 'referenceImages')
    const indices = (target.imageIndices as number[]) || undefined
    const selectedImages = indices
      ? indices.filter(i => i >= 0 && i < allUserImages.length).map(i => allUserImages[i])
      : allUserImages

    if (selectedImages.length === 0) {
      results.push(`[skip] 节点「${found.label}」: 指定的图片索引无效`)
      continue
    }

    const node = store.nodes.find(n => n.id === found.id)
    if (!node) {
      results.push(`[skip] 节点「${found.label}」已不存在`)
      continue
    }

    const update: Record<string, unknown> = {}
    if (field === 'referenceImages') {
      const existing = (node.data?.referenceImages as string[]) || []
      update.referenceImages = [...existing, ...selectedImages]
    } else {
      // Single-image fields: use the first selected image
      update[field] = selectedImages[0]
    }

    store.updateNodeData(found.id, update)
    affectedIds.push(found.id)
    results.push(`[done] 节点「${found.label}」.${field} ← ${selectedImages.length} 张图片`)
  }

  return {
    success: affectedIds.length > 0,
    message: `图片注入完成 (${affectedIds.length}/${targets.length} 成功, 可用图片 ${allUserImages.length} 张):\n${results.join('\n')}`,
    nodeIds: affectedIds,
  }
}

export async function handleListModels(args: Record<string, unknown>): Promise<ToolCallResult> {
  const { backendApi } = await import('@/api/backend')
  const cap = String(args.capability || 'all').toLowerCase()
  try {
    const capFilter = cap === 'all' ? undefined : (cap === 'llm' ? 'text' : cap)
    const res = await backendApi.listModels(capFilter)
    if (res.items.length === 0) {
      return { success: true, message: `没有已注册的${cap === 'all' ? '' : ` ${cap}`}模型。` }
    }
    const lines = res.items.map(m =>
      `- [${m.capability}] ${m.model_id} (${m.provider})${m.description ? ': ' + m.description : ''}`
    )
    return { success: true, message: `已注册模型 (${res.items.length}):\n${lines.join('\n')}` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '获取模型列表失败'
    return { success: false, message: msg }
  }
}

// Re-export quality tools from dedicated module
export { handleReviewContent, handleOptimizePrompt } from './toolQuality'

// Re-export scenario detection from dedicated module
export { handleDetectScenario } from './toolScenario'

// Re-export image classification from dedicated module
export { handleClassifyImage } from './toolClassify'
