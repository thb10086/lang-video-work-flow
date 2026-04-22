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
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from '@/providers/modelDefaults'
import {
  type ToolCallResult,
  getSmartPosition,
  resolveSourceHandle,
  resolveTargetHandle,
} from './toolHelpers'
import { buildWorkflow } from './workflowBuilders'
import {
  handlePlanTask,
  handleUpdatePlanStep,
  handleVerifyTask,
  handleSaveMemory,
  handleRecallMemory,
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
} from './toolHandlers'

// Re-export tool definitions so existing imports still work
export { AGENT_TOOLS, getAgentTools } from './toolDefinitions'
export type { ToolCallResult } from './toolHelpers'

// ============================================================
// Tool Executor
// ============================================================

export async function executeToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<ToolCallResult> {
  const store = useFlowStore.getState()

  switch (name) {
    // ── Node Creation Tools ──

    case 'create_character_grid': {
      const charName = String(args.name || '新角色')
      const charDesc = String(args.description || '')
      const id = store.addNode('characterGrid', getSmartPosition(), {
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
      const id = store.addNode('sceneGrid', getSmartPosition(), {
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
      const id = store.addNode('imageGen', getSmartPosition(), nodeData)
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
      const id = store.addNode('videoGen', getSmartPosition(), nodeData)
      return { success: true, message: `已创建视频生成节点 (${videoModel})`, nodeIds: [id] }
    }

    case 'create_llm_node': {
      const id = store.addNode('llmChat', getSmartPosition(), {
        label: 'LLM 对话',
        model: 'gemini-3.1-pro-preview',
        systemPrompt: String(args.systemPrompt || ''),
        userInput: String(args.userInput || ''),
        response: '',
        status: 'idle',
      })
      return { success: true, message: '已创建LLM对话节点', nodeIds: [id] }
    }

    case 'create_text_node': {
      const id = store.addNode('textNode', getSmartPosition(), {
        label: String(args.label || '文本/脚本'),
        content: String(args.content || ''),
        role: 'script',
      })
      return { success: true, message: '已创建文本节点', nodeIds: [id] }
    }

    case 'create_audio_node': {
      const id = store.addNode('audioNode', getSmartPosition(), {
        label: '音频生成',
        model: String(args.model || 'elevenlabs'),
        text: String(args.text || ''),
        voice: String(args.voice || 'default'),
        outputAudio: null,
        status: 'idle',
      })
      return { success: true, message: '已创建音频生成节点', nodeIds: [id] }
    }

    case 'create_storyboard_node': {
      const id = store.addNode('storyboard', getSmartPosition(), {
        label: '分镜脚本',
        script: String(args.script || ''),
        shots: [],
        status: 'idle',
      })
      return { success: true, message: '已创建分镜脚本节点', nodeIds: [id] }
    }

    case 'create_style_lock_node': {
      const id = store.addNode('styleLock', getSmartPosition(), {
        label: '风格锁定',
        referenceImage: null,
        styleDescription: String(args.styleDescription || ''),
        extractedStyle: '',
        status: 'idle',
      })
      return { success: true, message: '已创建风格锁定节点', nodeIds: [id] }
    }

    case 'create_image_edit_node': {
      const id = store.addNode('imageEdit', getSmartPosition(), {
        label: '图片编辑',
        editInstruction: String(args.editInstruction || ''),
        inputImage: null,
        outputImage: null,
        status: 'idle',
      })
      return { success: true, message: '已创建图片编辑节点', nodeIds: [id] }
    }

    case 'create_video_stitch_node': {
      const id = store.addNode('videoStitch', getSmartPosition(), {
        label: String(args.label || '最终合成'),
        clips: [],
        outputUrl: null,
        status: 'idle',
      })
      return { success: true, message: '已创建视频拼接节点', nodeIds: [id] }
    }

    case 'create_continuity_check_node': {
      const id = store.addNode('continuityCheck', getSmartPosition(), {
        label: String(args.label || '连续性检查'),
        imageA: null,
        imageB: null,
        results: [],
        status: 'idle',
      })
      return { success: true, message: '已创建连续性检查节点', nodeIds: [id] }
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
      })
    }

    // ── Delegate to handlers ──

    case 'plan_task':          return handlePlanTask(args)
    case 'update_plan_step':   return handleUpdatePlanStep(args)
    case 'verify_task':        return handleVerifyTask(args)
    case 'save_memory':        return handleSaveMemory(args)
    case 'recall_memory':      return handleRecallMemory(args)
    case 'update_node':        return handleUpdateNode(args)
    case 'delete_node':        return handleDeleteNode(args)
    case 'execute_node':       return handleExecuteNode(args)
    case 'retry_node':         return handleRetryNode(args)
    case 'batch_execute':      return handleBatchExecute(args)
    case 'parallel_execute':   return handleParallelExecute(args)
    case 'get_node_output':    return handleGetNodeOutput(args)
    case 'get_canvas_state':   return handleGetCanvasState()
    case 'inject_user_images': return handleInjectUserImages(args)
    case 'list_models':        return handleListModels(args)
    case 'review_content':     return handleReviewContent(args)
    case 'optimize_prompt':    return handleOptimizePrompt(args)
    case 'detect_scenario':    return handleDetectScenario(args)
    case 'classify_image':     return handleClassifyImage(args)
    case 'get_model_params':   return handleGetModelParams(args)
    case 'list_assets':        return handleListAssets(args)
    case 'create_asset':       return handleCreateAsset(args)
    case 'update_asset':       return handleUpdateAsset(args)
    case 'link_asset_to_node': return handleLinkAssetToNode(args)
    case 'resolve_prompt_refs': return handleResolvePromptRefs(args)

    default:
      return { success: false, message: `未知工具: ${name}` }
  }
}
