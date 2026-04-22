/**
 * Generation Executors — 图片/视频/角色/场景 生成执行器
 *
 * 从 nodeExecutor.ts 拆分，处理：
 * - executeCharacterGrid
 * - executeSceneGrid
 * - executeImageGen
 * - executeVideoGen
 */

import { useFlowStore } from '@/store/flowStore'
import { useAssetStore } from '@/store/assetStore'
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from '@/providers/modelDefaults'
import { characterSheetTemplate } from '@/prompts/templates/characterSheet'
import { sceneSheetTemplate } from '@/prompts/templates/sceneSheet'
import { renderTemplate } from '@/prompts/promptEngine'
import { backendApi, type AiModelResponse } from '@/api/backend'
import type { ParamField } from '@/providers/types'
import { resolvePromptRefs } from '@/providers/assetReferenceResolver'
import { injectVideoReferences } from '@/providers/modelReferenceAdapter'
import { sanitizeForExecute } from '@/providers/paramSanitizer'
import type { ExecutionResult } from '../nodeExecutor'

// In-memory model cache (populated on first call) so we don't hit the network
// on every executor invocation. Invalidated implicitly on hard reload.
let _cachedVideoModels: AiModelResponse[] | null = null
async function getVideoModel(modelId: string): Promise<AiModelResponse | null> {
  if (!_cachedVideoModels) {
    try {
      const res = await backendApi.listModels('video')
      _cachedVideoModels = res.items
    } catch (err) {
      console.warn('[generationExecutors] listModels failed:', err)
      return null
    }
  }
  return _cachedVideoModels.find(m => m.model_id === modelId) || null
}

// ── Shared: auto-inject character appearance anchors into prompt ──

/**
 * 扫描 prompt 中是否提及已注册的角色名称，若提及但 prompt 未包含外貌描述，
 * 则在 prompt 前端插入角色外貌锚定词。
 * 这是解决“角色外貌漂移”的核心机制。
 */
function buildCharacterAnchorPrefix(prompt: string): string {
  const appearances = useFlowStore.getState().characterAppearances
  const names = Object.keys(appearances)
  if (names.length === 0) return prompt

  const anchors: string[] = []
  const promptLower = prompt.toLowerCase()

  for (const name of names) {
    // 检查 prompt 中是否提及该角色（不区分大小写）
    if (promptLower.includes(name.toLowerCase())) {
      const desc = appearances[name]
      // 只在 prompt 未包含外貌描述的核心片段时才注入（避免重复）
      const descCore = desc.slice(0, 40).toLowerCase()
      if (!promptLower.includes(descCore)) {
        anchors.push(`[Character Anchor - ${name}]: ${desc}`)
      }
    }
  }

  if (anchors.length === 0) return prompt
  return `${anchors.join('\n')}\n\n${prompt}`
}

// ── Character Grid: generate 3x3 reference sheet ──
export async function executeCharacterGrid(nodeId: string): Promise<ExecutionResult> {
  const store = useFlowStore.getState()
  const node = store.nodes.find(n => n.id === nodeId)
  if (!node || node.type !== 'characterGrid') {
    return { success: false, message: `未找到角色九宫图节点 (${nodeId})` }
  }

  const name = String(node.data.name || '新角色')
  const desc = String(node.data.description || 'A character')
  const artStyle = String(node.data.style || 'anime')

  const prompt = renderTemplate(characterSheetTemplate.template, {
    character_name: name,
    character_description: desc,
    art_style: artStyle,
  })

  store.updateNodeData(nodeId, { status: 'generating', errorMsg: null, outputImage: null })

  try {
    const modelId = DEFAULT_IMAGE_MODEL
    let dataUrl: string | null = null

    const res = await backendApi.generateImage({
      model_id: modelId, prompt,
      params: { aspectRatio: '1:1', imageSize: '2k' },
    })
    const img = res.images?.[0]
    if (img) {
      dataUrl = img.url || `data:${img.mime_type};base64,${img.data}`
      if (img.url) store.updateNodeData(nodeId, { outputImageUrl: img.url })
    }

    if (dataUrl) {
      store.updateNodeData(nodeId, { status: 'done', outputImage: dataUrl })
      store.setCharacterAppearance(name, desc)
      return { success: true, message: `角色「${name}」九宫图生成完成（已注册外貌锚定词）`, output: dataUrl }
    }
    store.updateNodeData(nodeId, { status: 'error', errorMsg: '未返回图片 (已重试 3 次)' })
    return { success: false, message: `角色「${name}」生成失败：未返回图片 (已重试)` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '生成失败'
    store.updateNodeData(nodeId, { status: 'error', errorMsg: msg })
    return { success: false, message: `角色「${name}」生成失败：${msg}` }
  }
}

// ── Scene Grid: generate 3x3 scene reference sheet ──
export async function executeSceneGrid(nodeId: string): Promise<ExecutionResult> {
  const store = useFlowStore.getState()
  const node = store.nodes.find(n => n.id === nodeId)
  if (!node || node.type !== 'sceneGrid') {
    return { success: false, message: `未找到场景九宫图节点 (${nodeId})` }
  }

  const name = String(node.data.name || '新场景')
  const desc = String(node.data.description || 'A scene')
  const style = String(node.data.style || 'cinematic')
  const mood = String(node.data.mood || 'dramatic')

  const prompt = renderTemplate(sceneSheetTemplate.template, {
    scene_name: name,
    scene_description: desc,
    style,
    mood,
  })

  store.updateNodeData(nodeId, { status: 'generating', errorMsg: null, outputImage: null })

  try {
    const modelId = DEFAULT_IMAGE_MODEL
    let dataUrl: string | null = null

    const res = await backendApi.generateImage({
      model_id: modelId, prompt,
      params: { aspectRatio: '1:1', imageSize: '2k' },
    })
    const img = res.images?.[0]
    if (img) {
      dataUrl = img.url || `data:${img.mime_type};base64,${img.data}`
      if (img.url) store.updateNodeData(nodeId, { outputImageUrl: img.url })
    }

    if (dataUrl) {
      store.updateNodeData(nodeId, { status: 'done', outputImage: dataUrl })
      return { success: true, message: `场景「${name}」九宫图生成完成`, output: dataUrl }
    }
    store.updateNodeData(nodeId, { status: 'error', errorMsg: '未返回图片 (已重试 3 次)' })
    return { success: false, message: `场景「${name}」生成失败：未返回图片 (已重试)` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '生成失败'
    store.updateNodeData(nodeId, { status: 'error', errorMsg: msg })
    return { success: false, message: `场景「${name}」生成失败：${msg}` }
  }
}

// ── Image Gen: generate image with Gemini ──
export async function executeImageGen(nodeId: string): Promise<ExecutionResult> {
  const store = useFlowStore.getState()
  const node = store.nodes.find(n => n.id === nodeId)
  if (!node || node.type !== 'imageGen') {
    return { success: false, message: `未找到图片生成节点 (${nodeId})` }
  }

  const basePrompt = String(node.data.prompt || '')
  if (!basePrompt.trim()) {
    return { success: false, message: `图片生成节点「${node.data.label}」缺少 prompt` }
  }

  // 1) Resolve @assetId tokens in the prompt (expand + collect refs)
  const assetStore = useAssetStore.getState()
  const extraAssetRefs = Array.isArray(node.data.assetRefs) ? (node.data.assetRefs as string[]) : []
  const resolved = resolvePromptRefs(basePrompt, assetStore, extraAssetRefs)
  if (resolved.unresolved.length > 0) {
    console.warn('[executeImageGen] unresolved asset tokens:', resolved.unresolved)
  }

  // 2) 自动注入角色外貌锚定词
  const anchoredPrompt = buildCharacterAnchorPrefix(resolved.expandedPrompt)

  // 3) 附加 styleLock 注入的风格描述
  const stylePrompt = node.data.stylePrompt as string | null
  const prompt = stylePrompt ? `${anchoredPrompt}\n\nStyle: ${stylePrompt}` : anchoredPrompt

  const currentModel = String(node.data.model || DEFAULT_IMAGE_MODEL)
  store.updateNodeData(nodeId, { status: 'generating', errorMsg: null, outputImage: null })

  // 4) referenceImages 由上游通过 propagateNodeOutput 写入（支持多角色）+ 合并 @资产引用
  const refImages: string[] = []
  const allRefs = node.data.referenceImages as string[] | null
  if (allRefs?.length) {
    refImages.push(...allRefs)
  } else {
    const singleRef = node.data.referenceImage as string | null
    if (singleRef) refImages.push(singleRef)
  }
  // Union with resolved asset references (de-duplicated)
  for (const img of resolved.referenceImages) {
    if (img && !refImages.includes(img)) refImages.push(img)
  }

  try {
    let dataUrl: string | null = null

    const res = await backendApi.generateImage({
      model_id: currentModel,
      prompt,
      reference_images: refImages.length > 0 ? refImages : undefined,
      params: {
        aspectRatio: String(node.data.aspectRatio || '16:9'),
        imageSize: String(node.data.imageSize || '2k'),
      },
    })
    const img = res.images?.[0]
    if (img) {
      dataUrl = img.url || `data:${img.mime_type};base64,${img.data}`
      if (img.url) store.updateNodeData(nodeId, { outputImageUrl: img.url })
    }

    if (dataUrl) {
      store.updateNodeData(nodeId, { status: 'done', outputImage: dataUrl })
      return { success: true, message: `图片「${node.data.label}」生成完成${refImages.length ? '（含参考图）' : ''}`, output: dataUrl }
    }
    store.updateNodeData(nodeId, { status: 'error', errorMsg: '未返回图片 (已重试 3 次)' })
    return { success: false, message: `图片「${node.data.label}」生成失败：未返回图片 (已重试)` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '生成失败'
    store.updateNodeData(nodeId, { status: 'error', errorMsg: msg })
    return { success: false, message: `图片「${node.data.label}」生成失败：${msg}` }
  }
}

// ── Video Gen: submit to video model (Sora/VEO/Kling) via TaskManager ──
export async function executeVideoGen(nodeId: string): Promise<ExecutionResult> {
  const store = useFlowStore.getState()
  const node = store.nodes.find(n => n.id === nodeId)
  if (!node || node.type !== 'videoGen') {
    return { success: false, message: `未找到视频生成节点 (${nodeId})` }
  }

  const rawPrompt = String(node.data.prompt || '')
  if (!rawPrompt.trim()) {
    return { success: false, message: `视频生成节点「${node.data.label}」缺少 prompt` }
  }

  const currentModel = String(node.data.model || DEFAULT_VIDEO_MODEL)
  store.updateNodeData(nodeId, { status: 'generating', errorMsg: null, outputVideo: null, progress: 0 })

  try {
    // 1) Resolve @assetId tokens (prompt expansion + asset ref aggregation)
    const assetStore = useAssetStore.getState()
    const extraAssetRefs = Array.isArray(node.data.assetRefs) ? (node.data.assetRefs as string[]) : []
    const resolved = resolvePromptRefs(rawPrompt, assetStore, extraAssetRefs)

    // 2) Legacy anchor prefix still applies to the expanded prompt
    const prompt = buildCharacterAnchorPrefix(resolved.expandedPrompt)

    // 3) Existing first/last frames (prefer COS URLs over base64)
    const existingImages: string[] = []
    const firstFrame = (node.data.firstFrameImageUrl || node.data.firstFrameImage) as string | undefined
    const lastFrame = (node.data.lastFrameImageUrl || node.data.lastFrameImage) as string | undefined
    if (firstFrame) existingImages.push(firstFrame)
    if (lastFrame) existingImages.push(lastFrame)

    // 4) Load schema; adapter + sanitizer use it
    const model = await getVideoModel(currentModel)
    const schema = (model?.param_schema || []) as ParamField[]

    // 5) Model-specific injection
    const adaptation = injectVideoReferences(currentModel, schema, {
      referenceImages: resolved.referenceImages,
      characterUrls: resolved.characterUrls,
      timestamps: resolved.timestamps,
      existingImages,
    })

    if (adaptation.notes.length > 0) {
      console.debug('[executeVideoGen] adapter notes:', adaptation.notes)
    }
    if (resolved.unresolved.length > 0) {
      console.warn('[executeVideoGen] unresolved asset tokens:', resolved.unresolved)
    }

    // 6) Build params → sanitize → re-inject adapter params not in schema
    const mergedParams = { ...(node.data as Record<string, unknown>), ...adaptation.params }
    const params = sanitizeForExecute(mergedParams, schema)
    for (const [key, value] of Object.entries(adaptation.params)) {
      if (!(key in params)) params[key] = value
    }

    const res = await backendApi.submitVideo({
      model_id: currentModel,
      prompt,
      images: adaptation.images.length > 0 ? adaptation.images : undefined,
      params,
    })
    store.updateNodeData(nodeId, { taskId: res.task_id })

    // Start polling
    const pollInterval = setInterval(async () => {
      try {
        const status = await backendApi.queryTask(res.task_id)
        store.updateNodeData(nodeId, {
          status: status.status === 'completed' ? 'done'
            : status.status === 'failed' ? 'error'
            : 'generating',
          progress: status.progress || 0,
          outputVideo: status.output_url || null,
          errorMsg: status.error || null,
        })
        if (status.status === 'completed' || status.status === 'failed') {
          clearInterval(pollInterval)
        }
      } catch (pollErr) {
        console.warn('[executeVideoGen] Poll error:', pollErr)
      }
    }, 5000)

    return {
      success: true,
      message: `视频「${node.data.label}」已提交生成 (任务ID: ${res.task_id.slice(0, 8)}...)`,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '生成失败'
    store.updateNodeData(nodeId, { status: 'error', errorMsg: msg })
    return { success: false, message: `视频「${node.data.label}」提交失败：${msg}` }
  }
}
