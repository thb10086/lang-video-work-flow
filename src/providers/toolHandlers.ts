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
import { useAgentMemoryStore, type MemoryEntry, type MemoryScope, type PhaseId } from '@/store/agentMemoryStore'
import { useChatStore } from '@/store/chatStore'
import { executeNode, executeNodesBatch, findNodeByLabel } from '@/providers/nodeExecutor'
import { resolveNode, resolveNodeNotFound, type ToolCallResult } from './toolHelpers'
import { sanitizeOnModelSwitch } from '@/providers/paramSanitizer'
import type { ParamField } from '@/providers/types'
import type { AiModelResponse } from '@/api/backend'
import { _reviewAdapter } from './reviewAdapter'

// ── Model schema cache (populated by handleGetModelParams + handleListModels) ──
// Allows handleUpdateNode to perform sanitization on model switch without async fetch.
const _modelCache: {
  video: AiModelResponse[] | null
  image: AiModelResponse[] | null
  audio: AiModelResponse[] | null
} = { video: null, image: null, audio: null }

export function primeModelCache(capability: 'video' | 'image' | 'audio', models: AiModelResponse[]): void {
  _modelCache[capability] = models
}

// ── Agent Infrastructure Tools ──

const VALID_PHASES: readonly PhaseId[] = ['idle', 'planning', 'designing', 'building', 'reviewing', 'executing']

export function handleSetPhase(args: Record<string, unknown>): ToolCallResult {
  const phase = String(args.phase || '') as PhaseId
  const reason = typeof args.reason === 'string' ? args.reason : ''
  if (!VALID_PHASES.includes(phase)) {
    return {
      success: false,
      message: `无效阶段「${phase}」。合法值：${VALID_PHASES.join(' | ')}`,
    }
  }
  useAgentMemoryStore.getState().setPhase(phase, reason)
  return {
    success: true,
    message: `阶段已切换至「${phase}」${reason ? `（${reason}）` : ''}。后续工具可用范围会按新阶段收窄。`,
  }
}

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
  const scope = (args.scope as MemoryScope) || 'session'
  const pinned = args.pinned === true
  // Auto-bind project-scoped memories to the active canvas so they only
  // surface when that project is re-opened (Claude Code CLAUDE.md pattern).
  const projectId = scope === 'project'
    ? (typeof args.projectId === 'number' ? (args.projectId as number) : useFlowStore.getState().projectId ?? undefined)
    : undefined
  const memId = memStore.saveMemory({
    type: (args.type as MemoryEntry['type']) || 'project_preference',
    title: String(args.title || ''),
    content: String(args.content || ''),
    tags: (args.tags as string[]) || [],
    scope,
    projectId,
    pinned,
  })
  const scopeLabel = scope === 'project' ? `project#${projectId ?? 'untagged'}` : scope
  return { success: true, message: `已保存记忆「${args.title}」(${memId}, scope=${scopeLabel}${pinned ? ', pinned' : ''})` }
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

export function handleForgetMemory(args: Record<string, unknown>): ToolCallResult {
  const id = typeof args.id === 'string' && args.id ? args.id : undefined
  const tag = typeof args.tag === 'string' && args.tag ? args.tag : undefined
  const scope = typeof args.scope === 'string' ? (args.scope as MemoryScope) : undefined
  const olderThan = typeof args.olderThan === 'number' ? args.olderThan : undefined

  if (!id && !tag && !scope && olderThan === undefined) {
    return {
      success: false,
      message: '至少提供一个过滤条件：id / tag / scope / olderThan。留空不会批量删除所有记忆（安全起见）。',
    }
  }

  const removed = useAgentMemoryStore.getState().forgetMemory({ id, tag, scope, olderThan })
  const filters: string[] = []
  if (id) filters.push(`id=${id}`)
  if (tag) filters.push(`tag=${tag}`)
  if (scope) filters.push(`scope=${scope}`)
  if (olderThan !== undefined) filters.push(`olderThan=${olderThan}ms`)
  return { success: true, message: `已删除 ${removed} 条记忆 (${filters.join(', ')})` }
}

// ── Node CRUD + Execution Tools ──

export function handleUpdateNode(args: Record<string, unknown>): ToolCallResult {
  const store = useFlowStore.getState()

  // Auto-recovery: LLM 经常把字段扁平传递而不包裹在 updates 中，
  // 例如 {nodeLabel, model, prompt} 而非 {nodeLabel, updates: {model, prompt}}。
  // 策略：
  //   1) args.updates 不存在/非对象 → 提取所有非路由字段作为 updates
  //   2) args.updates 存在 → 仍检查顶层是否有泄漏字段，合并进 updates（防止混合传参丢字段）
  const ROUTING_KEYS = new Set(['nodeLabel', 'nodeId', 'updates'])
  let updates = (args.updates && typeof args.updates === 'object')
    ? { ...(args.updates as Record<string, unknown>) }
    : undefined

  // 提取顶层泄漏的非路由字段
  const leaked: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) {
    if (!ROUTING_KEYS.has(k)) leaked[k] = v
  }
  const hasLeaked = Object.keys(leaked).length > 0

  if (updates) {
    // 混合传参：顶层泄漏字段补入 updates（updates 内的同名字段优先）
    if (hasLeaked) updates = { ...leaked, ...updates }
  } else if (hasLeaked) {
    updates = leaked
  }
  if (!updates) return { success: false, message: '需要提供 updates 字段（或直接传入要更新的字段）' }
  const found = resolveNode(args)
  if (!found) return resolveNodeNotFound(args)

  // ── Model switch detection for schema-aware node types ──
  // When Agent changes `model` on videoGen/imageGen/audioNode, we need to:
  //   1. Cache-lookup schema for the new model (if known)
  //   2. Merge updates into current data
  //   3. Run sanitizeOnModelSwitch to drop stale fields
  let droppedInfo = ''
  const schemaAware = ['videoGen', 'imageGen', 'audioNode'].includes(found.type)
  // 关键：只有 model 字段值"真的发生变化"时才触发 schema sanitize。
  // 旧实现只看 `'model' in updates` —— 当 Agent 重新发送相同 model 时也会触发
  // sanitize，进而（若 _modelCache 未加载）用空 schema 把节点所有参数 nullify，
  // 导致 duration/aspect_ratio/resolution 等字段全部丢失。
  const currentNodeData = (store.nodes.find(n => n.id === found.id)?.data || {}) as Record<string, unknown>
  const incomingModel = 'model' in updates ? updates.model : undefined
  const modelChanging =
    schemaAware &&
    incomingModel !== undefined &&
    incomingModel !== null &&
    incomingModel !== currentNodeData.model

  // Special-case: `assetRefs` is union-merge, not replace, so repeated calls
  // accumulate rather than clobber. Pop it out of `updates` before other logic.
  const mergedUpdates: Record<string, unknown> = { ...updates }
  if (Array.isArray(mergedUpdates.assetRefs)) {
    const incomingRefs = (mergedUpdates.assetRefs as unknown[]).filter(x => typeof x === 'string') as string[]
    const currentNode = store.nodes.find(n => n.id === found.id)
    const existingRefs = Array.isArray(currentNode?.data?.assetRefs)
      ? (currentNode!.data.assetRefs as string[])
      : []
    const seen = new Set(existingRefs)
    const combined = [...existingRefs]
    for (const r of incomingRefs) {
      if (!seen.has(r)) { seen.add(r); combined.push(r) }
    }
    mergedUpdates.assetRefs = combined
  }

  if (modelChanging) {
    const capability = found.type === 'videoGen' ? 'video'
      : found.type === 'imageGen' ? 'image'
      : 'audio'
    const newModelId = String(mergedUpdates.model || '')
    const cached = _modelCache[capability]
    const bm = cached?.find(m => m.model_id === newModelId)
    const schema = (bm?.param_schema?.length ? bm.param_schema : []) as ParamField[]

    // 防御性：cache miss（schema 为空）时不要 sanitize —— 否则会把节点所有
    // 参数当作 stale 清掉。直接 merge updates，留待用户手动调整或下次 cache
    // 命中后再清洗。
    if (schema.length === 0) {
      console.warn('[handleUpdateNode] model cache miss for %s, skipping sanitize', newModelId)
      store.updateNodeData(found.id, mergedUpdates)
      droppedInfo = ` (注：模型 schema 缓存未加载，本次未清洗字段)`
    } else {
      const merged = { ...currentNodeData, ...mergedUpdates }
      const { clean, removed } = sanitizeOnModelSwitch(merged, schema)

      // Explicitly null out removed keys so Zustand shallow-merge drops them
      const nullify: Record<string, unknown> = {}
      for (const k of removed) nullify[k] = undefined
      store.updateNodeData(found.id, { ...nullify, ...clean })
      if (removed.length > 0) {
        droppedInfo = ` (已清理不兼容字段: ${removed.join(', ')})`
      }
    }
  } else {
    store.updateNodeData(found.id, mergedUpdates)
  }

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
  return { success: true, message: `已更新节点「${found.label}」的字段: ${fields}${droppedInfo}` }
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

  const autoDistribute = args.autoDistribute === true
  const results: string[] = []
  const affectedIds: string[] = []

  let targetIdx = -1
  for (const target of targets) {
    targetIdx++
    const found = resolveNode(target)
    if (!found) {
      const notFound = resolveNodeNotFound(target)
      results.push(`[skip] ${notFound.message}`)
      continue
    }

    const field = String(target.field || 'referenceImages')
    const indices = (target.imageIndices as number[]) || undefined
    let selectedImages: string[]
    if (autoDistribute) {
      // Round-robin: target[i] receives image[i % allUserImages.length].
      // imageIndices is ignored when autoDistribute is on (takes precedence
      // as a simpler, Agent-friendly mode).
      selectedImages = [allUserImages[targetIdx % allUserImages.length]]
    } else if (indices) {
      selectedImages = indices.filter(i => i >= 0 && i < allUserImages.length).map(i => allUserImages[i])
    } else {
      selectedImages = allUserImages
    }

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
    // Prime cache so handleUpdateNode can sanitize without extra fetch
    if (capFilter === 'video' || capFilter === 'image' || capFilter === 'audio') {
      _modelCache[capFilter] = res.items
    } else if (!capFilter) {
      // full list — bucket by capability
      const buckets: Record<string, AiModelResponse[]> = { video: [], image: [], audio: [] }
      for (const m of res.items) {
        if (m.capability in buckets) buckets[m.capability].push(m)
      }
      if (buckets.video.length) _modelCache.video = buckets.video
      if (buckets.image.length) _modelCache.image = buckets.image
      if (buckets.audio.length) _modelCache.audio = buckets.audio
    }
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

export async function handleGetModelParams(args: Record<string, unknown>): Promise<ToolCallResult> {
  const modelId = String(args.model_id || '').trim()
  if (!modelId) return { success: false, message: '需要提供 model_id' }
  const { backendApi } = await import('@/api/backend')
  try {
    const res = await backendApi.getModelParams(modelId)
    // Prime cache if we can infer capability (fetch full model for capability)
    try {
      const full = await backendApi.getModel(modelId)
      const cap = full.capability as 'video' | 'image' | 'audio'
      if (cap === 'video' || cap === 'image' || cap === 'audio') {
        const cached = _modelCache[cap] || []
        const idx = cached.findIndex(m => m.model_id === modelId)
        if (idx >= 0) cached[idx] = full
        else cached.push(full)
        _modelCache[cap] = cached
      }
    } catch { /* capability lookup optional */ }

    return {
      success: true,
      message: JSON.stringify({
        model_id: res.model_id,
        schema_version: res.schema_version,
        schema: res.schema,
      }, null, 2),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '获取模型参数失败'
    return { success: false, message: `获取 ${modelId} 的参数失败: ${msg}` }
  }
}

// Re-export quality tools from dedicated module
export { handleReviewContent, handleOptimizePrompt } from './toolQuality'

// Re-export scenario detection from dedicated module
export { handleDetectScenario } from './toolScenario'

// Re-export image classification from dedicated module
export { handleClassifyImage } from './toolClassify'

// ── Asset Library Tools ──

export async function handleListAssets(args: Record<string, unknown>): Promise<ToolCallResult> {
  const { useAssetStore } = await import('@/store/assetStore')
  const kind = (args.kind as 'character' | 'scene' | 'style' | undefined) || undefined
  const search = String(args.search || '').trim()
  const limit = Math.max(1, Math.min(50, Number(args.limit || 20)))

  const store = useAssetStore.getState()

  // Track offline/refresh outcome so the Agent knows whether the list it
  // receives is authoritative or a local-only snapshot. This prevents the
  // common failure mode where backend is down → handler returns "素材库为空"
  // → Agent creates duplicate assets.
  let fetchNote: string | null = null
  if (!store.lastFetchedAt) {
    try {
      await store.fetchAll()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      fetchNote = `[离线] 素材库后端不可达 (${msg.slice(0, 120)})，下列结果仅来自本地缓存/seedLocal`
    }
  }

  // Re-read after fetch attempt
  const postFetch = useAssetStore.getState()
  if (!fetchNote && postFetch.error) {
    fetchNote = `[部分降级] 后端最近一次同步报错: ${postFetch.error.slice(0, 120)}；下列结果可能未包含服务器新条目`
  }

  const all = kind
    ? Object.values(
        kind === 'character' ? postFetch.characters
          : kind === 'scene' ? postFetch.scenes
          : postFetch.styles,
      )
    : postFetch.all()
  const filtered = search ? postFetch.search(search, kind, limit) : all.slice(0, limit)

  const items = filtered.map(a => ({
    asset_id: a.asset_id,
    kind: a.kind,
    name: a.name,
    name_en: a.name_en,
    appearance: a.appearance || a.environment || a.guide || '',
    reference_images: a.reference_images?.slice(0, 3) || [],
    variation_count: a.variations?.length || 0,
    // Flag client-minted (seedLocal) entries so Agent knows they haven't
    // been persisted to the backend yet and are workspace-local.
    local_only: a.id < 0,
  }))

  const lines: string[] = []
  if (fetchNote) lines.push(fetchNote)
  if (items.length === 0) {
    lines.push(fetchNote ? '本地缓存为空' : '素材库为空')
  } else {
    lines.push(`找到 ${items.length} 个素材${fetchNote ? '（本地快照）' : ''}:`)
    lines.push(JSON.stringify(items, null, 2))
  }

  return { success: true, message: lines.join('\n') }
}

export async function handleCreateAsset(args: Record<string, unknown>): Promise<ToolCallResult> {
  const { useAssetStore } = await import('@/store/assetStore')
  const kind = String(args.kind || '') as 'character' | 'scene' | 'style'
  const name = String(args.name || '').trim()
  if (!kind || !name) return { success: false, message: '需要 kind + name' }
  if (!['character', 'scene', 'style'].includes(kind)) {
    return { success: false, message: `无效的 kind: ${kind}` }
  }

  const body = {
    kind,
    name,
    name_en: args.name_en ? String(args.name_en) : undefined,
    appearance: args.appearance ? String(args.appearance) : undefined,
    environment: args.environment ? String(args.environment) : undefined,
    guide: args.guide ? String(args.guide) : undefined,
    reference_images: Array.isArray(args.reference_images)
      ? (args.reference_images as unknown[]).filter(x => typeof x === 'string') as string[]
      : undefined,
  }

  const store = useAssetStore.getState()
  try {
    const created = await store.create(body)
    return {
      success: true,
      message: `已创建素材「${created.name}」(${created.asset_id}), 可在 prompt 中用 @${created.asset_id} 引用`,
    }
  } catch (err) {
    // Backend unreachable → fall back to a local seed so the Agent can keep
    // planning. User will see a "local_only" flag in subsequent list_assets.
    const msg = err instanceof Error ? err.message : String(err)
    const seeded = store.seedLocal(body)
    return {
      success: true,
      message: `[离线创建] 素材「${seeded.name}」(${seeded.asset_id}) 已加入本地缓存，未持久化到后端 (${msg.slice(0, 120)})`,
    }
  }
}

export async function handleUpdateAsset(args: Record<string, unknown>): Promise<ToolCallResult> {
  const { useAssetStore } = await import('@/store/assetStore')
  const assetId = String(args.asset_id || '').trim()
  if (!assetId) return { success: false, message: '需要 asset_id' }

  const patch: Record<string, unknown> = {}
  for (const key of ['name', 'name_en', 'appearance', 'environment', 'guide']) {
    if (args[key] !== undefined) patch[key] = args[key]
  }
  if (Array.isArray(args.reference_images)) {
    patch.reference_images = (args.reference_images as unknown[]).filter(x => typeof x === 'string')
  }

  if (Object.keys(patch).length === 0) {
    return { success: false, message: '未提供任何更新字段' }
  }

  try {
    const updated = await useAssetStore.getState().update(assetId, patch)
    return {
      success: true,
      message: `已更新素材「${updated.name}」(${updated.asset_id}), 字段: ${Object.keys(patch).join(', ')}`,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '更新失败'
    return { success: false, message: `更新失败: ${msg}` }
  }
}

export async function handleLinkAssetToNode(args: Record<string, unknown>): Promise<ToolCallResult> {
  const { useAssetStore } = await import('@/store/assetStore')
  const nodeId = String(args.node_id || '').trim()
  const assetId = String(args.asset_id || '').trim()
  if (!nodeId || !assetId) return { success: false, message: '需要 node_id + asset_id' }

  const store = useFlowStore.getState()
  const node = store.nodes.find(n => n.id === nodeId)
  if (!node) return { success: false, message: `未找到节点: ${nodeId}` }

  const resolved = useAssetStore.getState().resolve(assetId)
  if (!resolved) return { success: false, message: `未找到素材: ${assetId}` }

  const existing = Array.isArray(node.data?.assetRefs) ? (node.data.assetRefs as string[]) : []
  if (existing.includes(assetId)) {
    return { success: true, message: `素材 ${assetId} 已在节点「${node.data?.label || nodeId}」的 assetRefs 中` }
  }
  store.updateNodeData(nodeId, { assetRefs: [...existing, assetId] })
  return {
    success: true,
    message: `已把素材「${resolved.asset.name}」(${assetId}) 链接到节点「${node.data?.label || nodeId}」`,
  }
}

export function handleReviewGeneratedImage(args: Record<string, unknown>): ToolCallResult {
  const resolved = resolveNode(args)
  if (!resolved) return resolveNodeNotFound(args)

  const store = useFlowStore.getState()
  const node = store.nodes.find(n => n.id === resolved.id)
  if (!node) return { success: false, message: `未找到节点: ${resolved.id}` }

  const threshold = typeof args.threshold === 'number' ? args.threshold : undefined
  const aspects = Array.isArray(args.aspects) ? (args.aspects as string[]) : undefined

  const result = _reviewAdapter.review(
    (node.data || {}) as Record<string, unknown>,
    { threshold, aspects },
  )

  const label = resolved.label
  const verdict = result.pass ? '✅ 通过' : '❌ 未通过'
  const body = {
    node: label,
    score: result.score,
    pass: result.pass,
    issues: result.issues,
    suggestions: result.suggestions,
  }

  return {
    success: true,
    message: `${verdict}（${result.score}/100）— 节点「${label}」\n\n${JSON.stringify(body, null, 2)}`,
  }
}

export async function handleResolvePromptRefs(args: Record<string, unknown>): Promise<ToolCallResult> {
  const { useAssetStore } = await import('@/store/assetStore')
  const { resolvePromptRefs } = await import('@/providers/assetReferenceResolver')
  const prompt = String(args.prompt || '')
  if (!prompt) return { success: false, message: '需要 prompt' }
  const extraRefs = Array.isArray(args.extra_refs)
    ? (args.extra_refs as unknown[]).filter(x => typeof x === 'string') as string[]
    : []

  const resolved = resolvePromptRefs(prompt, useAssetStore.getState(), extraRefs)
  return {
    success: true,
    message: JSON.stringify({
      expandedPrompt: resolved.expandedPrompt,
      referenceImages: resolved.referenceImages,
      characterUrls: resolved.characterUrls,
      timestamps: resolved.timestamps,
      unresolved: resolved.unresolved,
    }, null, 2),
  }
}
