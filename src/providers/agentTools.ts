/**
 * Agent Tool Executor — 入口文件
 *
 * 职责：
 *  1. 重导出 AGENT_TOOLS（定义在 toolDefinitions.ts）
 *  2. 节点创建 (create_*) + connect_nodes
 *  3. generate_workflow 委派给 workflowBuilders.ts
 *  4. 其余工具委派给 toolHandlers.ts
 */

import { useFlowStore } from '@/store/flowStore'
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, DEFAULT_LLM_MODEL, DEFAULT_AUDIO_MODEL } from '@/providers/modelDefaults'
import {
  type ToolCallResult,
  getSmartPosition,
  resolveSourceHandle,
  resolveTargetHandle,
} from './toolHelpers'
import { buildWorkflow } from './workflowBuilders'
import { AGENT_TOOLS } from './toolDefinitions'
import { TIER_1_CORE, TIER_2_CREATION, TIER_3_ADVANCED, tierOf } from './toolTiers'
import { _classifierAdapter, type IntentHint } from './imageClassifier'
import { useChatStore } from '@/store/chatStore'
import { withResponseBudget, getBudgetOpts } from './toolBudget'
import {
  handlePlanTask,
  handleUpdatePlanStep,
  handleVerifyTask,
  handleSetPhase,
  handleSaveMemory,
  handleRecallMemory,
  handleForgetMemory,
  handleUpdateNode,
  handleDeleteNode,
  handleExecuteNode,
  handleRetryNode,
  handleBatchExecute,
  handleParallelExecute,
  handleGetNodeOutput,
  handleGetCanvasState,
  handleInjectUserImages,
  handleListModels,
  handleReviewContent,
  handleOptimizePrompt,
  handleDetectScenario,
  handleClassifyImage,
  handleGetModelParams,
  handleListAssets,
  handleCreateAsset,
  handleUpdateAsset,
  handleLinkAssetToNode,
  handleResolvePromptRefs,
  handleReviewGeneratedImage,
} from './toolHandlers'
import { handleVerifyImageSemantic } from './toolVisionVerify'

// Re-export tool definitions so existing imports still work
export { AGENT_TOOLS, getAgentTools } from './toolDefinitions'
export type { ToolCallResult } from './toolHelpers'

// ============================================================
// Session tools ref (for discover_tools dynamic schema)
// ============================================================
// chatStore calls `setSessionTools(agentTools)` right before dispatching
// tool calls so `discover_tools` can return the SAME schema the LLM received
// (important for create_{video,image,audio}_node which get dynamic enums
// built from the backend model registry).
let _sessionTools: typeof AGENT_TOOLS | null = null

export function setSessionTools(tools: typeof AGENT_TOOLS): void {
  _sessionTools = tools
}

export function clearSessionTools(): void {
  _sessionTools = null
}

// ============================================================
// Tool-call observer hook (eval / debug)
// ============================================================
// Single global observer invoked after every executeToolCall returns. Used by
// the eval harness to record (tool, args, result) tuples without having to
// monkey-patch the frozen ESM export. Set to null in production.
export type ToolCallObserver = (
  tool: string,
  args: Record<string, unknown>,
  result: ToolCallResult,
  elapsedMs: number,
) => void

let _toolCallObserver: ToolCallObserver | null = null

export function setToolCallObserver(observer: ToolCallObserver | null): void {
  _toolCallObserver = observer
}

// ============================================================
// Budgeted query handlers (Anthropic tool-response-budget pattern)
// ============================================================
// Wrap the 7 query tools once at module load so each tool_result block
// stays under the configured token ceiling and — by default — returns only
// decision-relevant fields. The LLM can opt into full payloads by passing
// `response_format: 'detailed'`. See src/providers/toolBudget.ts.

const getCanvasStateBudgeted = withResponseBudget(
  // handleGetCanvasState takes no args (only response_format arg is injected by schema);
  // accept but ignore args so the budgeted signature matches other wrappers.
  async (_args: Record<string, unknown>) => handleGetCanvasState(),
  getBudgetOpts('get_canvas_state')!,
)
const getNodeOutputBudgeted = withResponseBudget(
  async (args: Record<string, unknown>) => handleGetNodeOutput(args),
  getBudgetOpts('get_node_output')!,
)
const listModelsBudgeted = withResponseBudget(
  async (args: Record<string, unknown>) => handleListModels(args),
  getBudgetOpts('list_models')!,
)
const getModelParamsBudgeted = withResponseBudget(
  async (args: Record<string, unknown>) => handleGetModelParams(args),
  getBudgetOpts('get_model_params')!,
)
const listAssetsBudgeted = withResponseBudget(
  async (args: Record<string, unknown>) => handleListAssets(args),
  getBudgetOpts('list_assets')!,
)
const recallMemoryBudgeted = withResponseBudget(
  async (args: Record<string, unknown>) => handleRecallMemory(args),
  getBudgetOpts('recall_memory')!,
)
const discoverToolsBudgeted = withResponseBudget(
  async (args: Record<string, unknown>) => handleDiscoverTools(args),
  getBudgetOpts('discover_tools')!,
)

// ============================================================
// Tool Executor
// ============================================================

export async function executeToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<ToolCallResult> {
  const observer = _toolCallObserver
  if (!observer) return _executeToolCallImpl(name, args)
  // Timed path: record elapsed ms for eval metrics without paying the cost
  // in production (observer === null short-circuits above).
  const t0 = Date.now()
  const result = await _executeToolCallImpl(name, args)
  try {
    observer(name, args, result, Date.now() - t0)
  } catch (obsErr) {
    // Observer must never break tool execution
    console.warn('[agentTools] tool-call observer threw:', obsErr)
  }
  return result
}

async function _executeToolCallImpl(
  name: string,
  args: Record<string, unknown>
): Promise<ToolCallResult> {
  const store = useFlowStore.getState()

  switch (name) {
    // ── Node Creation Tools ──

    case 'create_character_grid': {
      const charName = String(args.name || '新角色')
      const charDesc = String(args.description || '')
      const id = store.addNode('characterGrid', getSmartPosition('characterGrid'), {
        label: `角色: ${charName}`,
        name: charName,
        description: charDesc,
        style: String(args.style || 'anime'),
        outputImage: null,
        status: 'idle',
      })
      // 注册角色外貌到全局注册表（后续 imageGen/videoGen 自动注入）
      if (charDesc) store.setCharacterAppearance(charName, charDesc)
      return { success: true, message: `已创建角色九宫图「${charName}」`, nodeIds: [id] }
    }

    case 'create_scene_grid': {
      const sceneName = String(args.name || '新场景')
      const id = store.addNode('sceneGrid', getSmartPosition('sceneGrid'), {
        label: `场景: ${sceneName}`,
        name: sceneName,
        description: String(args.description || ''),
        style: String(args.style || 'cinematic'),
        mood: String(args.mood || 'dramatic'),
        outputImage: null,
        status: 'idle',
      })
      return { success: true, message: `已创建场景九宫图「${sceneName}」`, nodeIds: [id] }
    }

    case 'create_keyframe_grid': {
      const shotName = String(args.shotName || '未命名镜头')
      const shotDescription = String(args.shotDescription || '')
      const allowedSubTypes = ['time-progression', 'scene-evolution', 'action-breakdown', 'multi-camera']
      const allowedLayouts = ['2x2', '2x3', '3x3']
      const rawSubType = String(args.subType || 'time-progression')
      const rawLayout = String(args.layout || '2x3')
      // Sanitize：Agent 偶尔会传不在 enum 内的值，强制 fallback 到默认
      const subType = allowedSubTypes.includes(rawSubType) ? rawSubType : 'time-progression'
      const layout = allowedLayouts.includes(rawLayout) ? rawLayout : '2x3'
      const id = store.addNode('keyframeGrid', getSmartPosition('keyframeGrid'), {
        label: `分镜: ${shotName}`,
        shotName,
        shotDescription,
        subType,
        layout,
        style: String(args.style || 'cinematic'),
        mood: String(args.mood || 'dramatic'),
        outputImage: null,
        status: 'idle',
      })
      const n = layout === '2x2' ? 4 : layout === '2x3' ? 6 : 9
      return {
        success: true,
        message: `已创建分镜拼贴图「${shotName}」（${n}格 · ${subType}）`,
        nodeIds: [id],
      }
    }

    case 'create_image_node': {
      const imgModel = String(args.model || DEFAULT_IMAGE_MODEL)
      const nodeData: Record<string, unknown> = {
        label: '图片生成',
        model: imgModel,
        prompt: String(args.prompt || ''),
        referenceImage: null,
        outputImage: null,
        status: 'idle',
      }
      // Pass-through any other args (schema-declared params). Sanitizer at execute time
      // will drop unsupported fields for the chosen model.
      for (const [k, v] of Object.entries(args)) {
        if (['model', 'prompt'].includes(k)) continue
        if (v === undefined || v === null) continue
        nodeData[k] = v
      }
      const id = store.addNode('imageGen', getSmartPosition('imageGen'), nodeData)
      return { success: true, message: `已创建图片生成节点 (${imgModel})`, nodeIds: [id] }
    }

    case 'create_video_node': {
      const videoModel = String(args.model || DEFAULT_VIDEO_MODEL)
      const nodeData: Record<string, unknown> = {
        label: '视频生成',
        model: videoModel,
        prompt: String(args.prompt || ''),
        outputVideo: null,
        status: 'idle',
      }
      // Pass-through any other args (schema-declared params). Sanitizer at execute time
      // will drop unsupported fields for the chosen model; backend validator 422s illegal values.
      for (const [k, v] of Object.entries(args)) {
        if (['model', 'prompt'].includes(k)) continue
        if (v === undefined || v === null) continue
        nodeData[k] = v
      }
      const id = store.addNode('videoGen', getSmartPosition('videoGen'), nodeData)
      return { success: true, message: `已创建视频生成节点 (${videoModel})`, nodeIds: [id] }
    }

    case 'create_llm_node': {
      const id = store.addNode('llmChat', getSmartPosition('llmChat'), {
        label: 'LLM 对话',
        model: DEFAULT_LLM_MODEL,
        systemPrompt: String(args.systemPrompt || ''),
        userInput: String(args.userInput || ''),
        response: '',
        status: 'idle',
      })
      return { success: true, message: '已创建LLM对话节点', nodeIds: [id] }
    }

    case 'create_text_node': {
      const id = store.addNode('textNode', getSmartPosition('textNode'), {
        label: String(args.label || '文本/脚本'),
        content: String(args.content || ''),
        role: 'script',
      })
      return { success: true, message: '已创建文本节点', nodeIds: [id] }
    }

    case 'create_audio_node': {
      const id = store.addNode('audioNode', getSmartPosition('audioNode'), {
        label: '音频生成',
        model: String(args.model || DEFAULT_AUDIO_MODEL),
        text: String(args.text || ''),
        voice: String(args.voice || 'default'),
        outputAudio: null,
        status: 'idle',
      })
      return { success: true, message: '已创建音频生成节点', nodeIds: [id] }
    }

    case 'create_storyboard_node': {
      const id = store.addNode('storyboard', getSmartPosition('storyboard'), {
        label: '分镜脚本',
        script: String(args.script || ''),
        shots: [],
        status: 'idle',
      })
      return { success: true, message: '已创建分镜脚本节点', nodeIds: [id] }
    }

    case 'create_character_extract_node': {
      const id = store.addNode('characterExtract', getSmartPosition('characterExtract'), {
        label: String(args.label || '角色提取'),
        videoUrl: args.videoUrl ? String(args.videoUrl) : null,
        taskId: null,
        timestamps: String(args.timestamps || '1,3'),
        characterId: null,
        characterUrl: null,
        status: 'idle',
      })
      return { success: true, message: '已创建角色提取节点', nodeIds: [id] }
    }

    case 'create_character_manager_node': {
      const id = store.addNode('characterManager', getSmartPosition('characterManager'), {
        label: String(args.label || '角色管理器'),
        characters: [],
      })
      return { success: true, message: '已创建角色管理器节点', nodeIds: [id] }
    }

    case 'create_style_lock_node': {
      const id = store.addNode('styleLock', getSmartPosition('styleLock'), {
        label: '风格锁定',
        referenceImage: null,
        styleDescription: String(args.styleDescription || ''),
        extractedStyle: '',
        status: 'idle',
      })
      return { success: true, message: '已创建风格锁定节点', nodeIds: [id] }
    }

    case 'create_image_edit_node': {
      const id = store.addNode('imageEdit', getSmartPosition('imageEdit'), {
        label: '图片编辑',
        editInstruction: String(args.editInstruction || ''),
        inputImage: null,
        outputImage: null,
        status: 'idle',
      })
      return { success: true, message: '已创建图片编辑节点', nodeIds: [id] }
    }

    case 'create_from_images': {
      return handleCreateFromImages(args)
    }

    case 'create_video_stitch_node': {
      const id = store.addNode('videoStitch', getSmartPosition('videoStitch'), {
        label: String(args.label || '最终合成'),
        clips: [],
        outputUrl: null,
        status: 'idle',
      })
      return { success: true, message: '已创建视频拼接节点', nodeIds: [id] }
    }

    case 'create_continuity_check_node': {
      const id = store.addNode('continuityCheck', getSmartPosition('continuityCheck'), {
        label: String(args.label || '连续性检查'),
        imageA: null,
        imageB: null,
        results: [],
        status: 'idle',
      })
      return { success: true, message: '已创建连续性检查节点', nodeIds: [id] }
    }

    case 'create_timeline_node': {
      const id = store.addNode('timeline', getSmartPosition('timeline'), {
        label: String(args.label || '时间轴'),
        videoClips: [],
        audioClips: [],
        outputCuts: null,
        status: 'idle',
      })
      return { success: true, message: '已创建时间轴节点', nodeIds: [id] }
    }

    // ── Connect Nodes ──

    case 'connect_nodes': {
      const nodes = store.nodes
      const sourceLabel = String(args.sourceNodeLabel || '')
      const targetLabel = String(args.targetNodeLabel || '')
      const sourceNode = nodes.find(n => String(n.data?.label || '').includes(sourceLabel))
      const targetNode = nodes.find(n => String(n.data?.label || '').includes(targetLabel))
      if (!sourceNode || !targetNode) {
        return { success: false, message: `未找到节点: ${!sourceNode ? sourceLabel : targetLabel}` }
      }
      const sourceHandle = resolveSourceHandle(String(sourceNode.type))
      let targetHandle = resolveTargetHandle(String(targetNode.type), String(sourceNode.type))

      // continuityCheck 动态路由：检查 image-a 是否已有入边，有则用 image-b
      if (targetNode.type === 'continuityCheck') {
        const existingEdges = store.edges.filter(e => e.target === targetNode.id)
        const hasImageA = existingEdges.some(e => e.targetHandle === 'image-a')
        targetHandle = hasImageA ? 'image-b' : 'image-a'
      }

      store.onConnect({
        source: sourceNode.id,
        target: targetNode.id,
        sourceHandle,
        targetHandle,
      })
      return { success: true, message: `已连接「${sourceLabel}」→「${targetLabel}」(${sourceHandle || 'default'} → ${targetHandle || 'default'})` }
    }

    // ── Generate Workflow (one-click full pipeline) ──

    case 'generate_workflow': {
      const productImageArg = typeof args.productImage === 'string' && args.productImage.trim() ? args.productImage.trim() : undefined
      const productOnlyShotsArg = Array.isArray(args.productOnlyShots)
        ? (args.productOnlyShots as unknown[])
            .map(n => Number(n))
            .filter(n => Number.isInteger(n) && n > 0)
        : undefined
      const replaceCanvasArg = typeof args.replaceCanvas === 'boolean' ? args.replaceCanvas : undefined
      return buildWorkflow({
        title: String(args.title || '新项目'),
        description: String(args.description || args.title || '新项目'),
        scenario: (String(args.scenario || 'short_drama')) as import('./toolScenario').ScenarioId,
        characterNames: (args.characterNames as string[]) || ['主角'],
        characterDescriptions: (args.characterDescriptions as string[]) || [],
        sceneNames: (args.sceneNames as string[]) || ['场景1'],
        sceneDescriptions: (args.sceneDescriptions as string[]) || [],
        shotCount: Number(args.shotCount || 4),
        shotPrompts: (args.shotPrompts as string[]) || [],
        videoPrompts: (args.videoPrompts as string[]) || [],
        styleDescription: String(args.styleDescription || ''),
        narrationText: String(args.narrationText || ''),
        ...(productImageArg ? { productImage: productImageArg } : {}),
        ...(productOnlyShotsArg && productOnlyShotsArg.length > 0 ? { productOnlyShots: productOnlyShotsArg } : {}),
        ...(replaceCanvasArg !== undefined ? { replaceCanvas: replaceCanvasArg } : {}),
      })
    }

    // ── Delegate to handlers ──

    case 'plan_task':          return handlePlanTask(args)
    case 'update_plan_step':   return handleUpdatePlanStep(args)
    case 'verify_task':        return handleVerifyTask(args)
    case 'set_phase':          return handleSetPhase(args)
    case 'save_memory':        return handleSaveMemory(args)
    case 'recall_memory':      return recallMemoryBudgeted(args)
    case 'forget_memory':      return handleForgetMemory(args)
    case 'update_node':        return handleUpdateNode(args)
    case 'delete_node':        return handleDeleteNode(args)
    case 'execute_node':       return handleExecuteNode(args)
    case 'retry_node':         return handleRetryNode(args)
    case 'batch_execute':      return handleBatchExecute(args)
    case 'parallel_execute':   return handleParallelExecute(args)
    case 'get_node_output':    return getNodeOutputBudgeted(args)
    case 'get_canvas_state':   return getCanvasStateBudgeted(args)
    case 'inject_user_images': return handleInjectUserImages(args)
    case 'list_models':        return listModelsBudgeted(args)
    case 'review_content':     return handleReviewContent(args)
    case 'review_generated_image': return handleReviewGeneratedImage(args)
    case 'verify_image_semantic': return handleVerifyImageSemantic(args)
    case 'optimize_prompt':    return handleOptimizePrompt(args)
    case 'detect_scenario':    return handleDetectScenario(args)
    case 'classify_image':     return handleClassifyImage(args)
    case 'get_model_params':   return getModelParamsBudgeted(args)
    case 'list_assets':        return listAssetsBudgeted(args)
    case 'create_asset':       return handleCreateAsset(args)
    case 'update_asset':       return handleUpdateAsset(args)
    case 'link_asset_to_node': return handleLinkAssetToNode(args)
    case 'resolve_prompt_refs': return handleResolvePromptRefs(args)

    case 'discover_tools':     return discoverToolsBudgeted(args)

    default:
      return { success: false, message: `未知工具: ${name}` }
  }
}

// ============================================================
// create_from_images — classify uploaded images and build nodes
// ============================================================

const MAX_IMAGES_PER_CALL = 10

/** Pull all images from the most-recent user chat message carrying images. */
function collectLatestUserImages(): string[] {
  const msgs = useChatStore.getState().messages
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.role === 'user' && m.images && m.images.length > 0) return [...m.images]
  }
  return []
}

function handleCreateFromImages(args: Record<string, unknown>): ToolCallResult {
  // Resolve image list: explicit args take precedence, else grab from chat.
  let images = Array.isArray(args.images) ? (args.images as unknown[]).filter(x => typeof x === 'string') as string[] : []
  if (images.length === 0) images = collectLatestUserImages()

  if (images.length === 0) {
    return { success: false, message: '没有可用图片。请让用户先上传图片，或在 args.images 中显式传入 data-URL 数组。' }
  }
  if (images.length > MAX_IMAGES_PER_CALL) {
    return { success: false, message: `最多 ${MAX_IMAGES_PER_CALL} 张，当前 ${images.length} 张。请分批调用或先 delete_node 清理再继续。` }
  }

  const intent = typeof args.intent === 'string' ? (args.intent as IntentHint) : undefined
  const names = Array.isArray(args.names) ? (args.names as unknown[]).map(String) : []
  const hintText = String(args.hintText || '')

  // Give the intent-only classification path ('character_refs' | 'scene_refs'
  // | 'style_lock' | 'edit') a fast path. 'mixed' / undefined → per-image heuristic.
  const perImageIntent: IntentHint = intent && intent !== 'mixed' ? intent : undefined

  const store = useFlowStore.getState()
  const createdNodeIds: string[] = []
  const classifications: Array<{ kind: string; confidence: number; reason: string; nodeId: string }> = []

  for (let i = 0; i < images.length; i++) {
    const image = images[i]
    const name = names[i] || `素材${i + 1}`
    let c = _classifierAdapter.classify(image, { intent: perImageIntent, hintText })

    // Low-confidence fallback: default to imageEdit so we never pick a
    // destructive wrong kind (creating 5 spurious characterGrids would be
    // worse than a single edit node the user can retarget).
    if (c.confidence < 0.5) {
      c = { kind: 'edit_input', confidence: c.confidence, reason: `${c.reason}; confidence too low, defaulted to imageEdit` }
    }

    let nodeId: string
    switch (c.kind) {
      case 'character': {
        nodeId = store.addNode('characterGrid', getSmartPosition('characterGrid'), {
          label: `角色: ${name}`,
          name,
          description: '',
          style: 'realistic',
          referenceImage: image,
          outputImage: null,
          status: 'idle',
        })
        break
      }
      case 'scene': {
        nodeId = store.addNode('sceneGrid', getSmartPosition('sceneGrid'), {
          label: `场景: ${name}`,
          name,
          description: '',
          style: 'cinematic',
          mood: 'neutral',
          referenceImage: image,
          outputImage: null,
          status: 'idle',
        })
        break
      }
      case 'style': {
        nodeId = store.addNode('styleLock', getSmartPosition('styleLock'), {
          label: names[i] || '风格锁定',
          referenceImage: image,
          styleDescription: '',
          extractedStyle: '',
          status: 'idle',
        })
        break
      }
      case 'edit_input':
      default: {
        nodeId = store.addNode('imageEdit', getSmartPosition('imageEdit'), {
          label: names[i] || '图片编辑',
          editInstruction: '',
          inputImage: image,
          outputImage: null,
          status: 'idle',
        })
        break
      }
    }
    createdNodeIds.push(nodeId)
    classifications.push({ kind: c.kind, confidence: c.confidence, reason: c.reason, nodeId })
  }

  const summary = classifications.map((c, i) =>
    `#${i + 1} ${c.kind} (conf=${c.confidence.toFixed(2)}): ${c.reason}`
  ).join('\n')

  return {
    success: true,
    message: `已按 ${images.length} 张图创建 ${createdNodeIds.length} 个节点：\n${summary}`,
    nodeIds: createdNodeIds,
  }
}

// ============================================================
// discover_tools — progressive disclosure meta-tool
// ============================================================

/**
 * Return a compact index of Agent tools filtered by query / tier.
 * Keeps the response size small — returns name + description + params
 * summary, not the full JSON schema (LLM can re-request with higher detail
 * by passing a specific name in a later round).
 */
function handleDiscoverTools(args: Record<string, unknown>): ToolCallResult {
  const query = String(args.query || '').trim().toLowerCase()
  const tierFilter = typeof args.tier === 'number' ? args.tier : undefined

  type ToolSlim = {
    name: string
    tier: string
    description: string
    parameters: Record<string, unknown>
  }

  // Prefer the session-specific tool list (contains dynamic enums from the
  // backend model registry). Fall back to the static AGENT_TOOLS when no
  // chatStore session is active (e.g. direct vitest invocations).
  const source = _sessionTools ?? AGENT_TOOLS
  const rows: ToolSlim[] = []
  for (const t of source) {
    const name = t.function?.name
    if (!name) continue
    const tierId = tierOf(name)
    if (!tierId) continue
    if (tierFilter !== undefined) {
      const wantTier = `tier${tierFilter}`
      if (tierId !== wantTier) continue
    }
    const description = String(t.function?.description || '')
    if (query && !name.toLowerCase().includes(query) && !description.toLowerCase().includes(query)) {
      continue
    }
    rows.push({
      name,
      tier: tierId,
      description: description.slice(0, 180),
      parameters: (t.function?.parameters as Record<string, unknown>) || {},
    })
  }

  const header = [
    `发现 ${rows.length} 个工具` +
      (query ? `（匹配 "${query}"）` : '') +
      (tierFilter ? `（tier=${tierFilter}）` : ''),
    `总计: Tier1=${TIER_1_CORE.length} Tier2=${TIER_2_CREATION.length} Tier3=${TIER_3_ADVANCED.length}`,
  ].join(' · ')

  if (rows.length === 0) {
    return {
      success: false,
      message: `${header}。未找到匹配的工具，试试更宽的 query 或显式传 tier=1/2/3。`,
    }
  }

  return {
    success: true,
    message: `${header}\n\n${JSON.stringify(rows, null, 2)}`,
  }
}
