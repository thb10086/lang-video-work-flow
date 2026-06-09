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
import { resolveCharacterNames } from '@/providers/characterNameResolver'
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
  // Accept both legacy `characterGrid` and unified `characterAsset` (mode=design).
  // The dispatcher in nodeExecutor.ts routes by characterKind() so either type
  // can land here.
  const isLegacyGrid = node?.type === 'characterGrid'
  const isUnifiedAsset = node?.type === 'characterAsset'
  if (!node || (!isLegacyGrid && !isUnifiedAsset)) {
    return { success: false, message: `未找到角色节点 (${nodeId})` }
  }

  // For characterAsset, the user-friendly name lives in `data.name`; for older
  // characterGrid nodes it lives in `data.name` too — so single source of truth.
  const name = String(node.data.name || '新角色')
  // characterAsset uses `appearance` for the long descriptor; characterGrid
  // historically used `description`. Read both for backward compatibility.
  const desc = String(node.data.description || node.data.appearance || 'A character')
  const artStyle = String(node.data.style || 'anime')

  // ── Short-circuit: if the user uploaded a referenceImage via
  //    create_from_images, treat that original image as the authoritative
  //    output (do NOT let gpt-image-2 redraw a brand-anchored face).
  //    Still register the appearance keywords so downstream imageGen prompts
  //    pick up the character anchor.
  const uploadedRef = String(node.data.referenceImage || '')
  if (uploadedRef && (uploadedRef.startsWith('data:') || uploadedRef.startsWith('http'))) {
    store.updateNodeData(nodeId, {
      status: 'done',
      outputImage: uploadedRef,
      ...(uploadedRef.startsWith('http') ? { outputImageUrl: uploadedRef } : {}),
    })
    if (desc && desc !== 'A character') store.setCharacterAppearance(name, desc)
    return {
      success: true,
      message: `角色「${name}」直接采用上传的参考图（未走 AI 重绘）`,
      output: uploadedRef,
    }
  }

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
  // Only sceneGrid for now — unified sceneAsset is not yet introduced, but
  // keep the check explicit so a future migration trips a clear error.
  if (!node || node.type !== 'sceneGrid') {
    return { success: false, message: `未找到场景节点 (${nodeId})` }
  }

  const name = String(node.data.name || '新场景')
  const desc = String(node.data.description || 'A scene')
  const style = String(node.data.style || 'cinematic')
  const mood = String(node.data.mood || 'dramatic')

  // ── Short-circuit: if the user uploaded a referenceImage (product shot,
  //    location photo, brand visual), use it AS-IS instead of letting
  //    gpt-image-2 redraw a fictional version. This is the single biggest
  //    fix for product-ad workflows where brand logos must stay readable.
  const uploadedRef = String(node.data.referenceImage || '')
  if (uploadedRef && (uploadedRef.startsWith('data:') || uploadedRef.startsWith('http'))) {
    store.updateNodeData(nodeId, {
      status: 'done',
      outputImage: uploadedRef,
      ...(uploadedRef.startsWith('http') ? { outputImageUrl: uploadedRef } : {}),
    })
    return {
      success: true,
      message: `场景「${name}」直接采用上传的参考图（未走 AI 重绘，品牌锁定）`,
      output: uploadedRef,
    }
  }

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

  // 1a) Resolve @asset_id tokens (ASCII) via assetStore
  const assetStore = useAssetStore.getState()
  const extraAssetRefs = Array.isArray(node.data.assetRefs) ? (node.data.assetRefs as string[]) : []
  const resolved = resolvePromptRefs(basePrompt, assetStore, extraAssetRefs)

  // 1b) Resolve @角色名 tokens against CharacterManager nodes
  const nameResolved = resolveCharacterNames(resolved.expandedPrompt, store.nodes)

  const allUnresolved = [...resolved.unresolved, ...nameResolved.unresolved]
  if (allUnresolved.length > 0) {
    console.warn('[executeImageGen] unresolved tokens:', allUnresolved)
  }

  // 2) 自动注入角色外貌锚定词
  const anchoredPrompt = buildCharacterAnchorPrefix(nameResolved.expandedPrompt)

  // 3) 附加 styleLock 注入的风格描述
  const stylePrompt = node.data.stylePrompt as string | null
  const prompt = stylePrompt ? `${anchoredPrompt}\n\nStyle: ${stylePrompt}` : anchoredPrompt

  const currentModel = String(node.data.model || DEFAULT_IMAGE_MODEL)
  store.updateNodeData(nodeId, { status: 'generating', errorMsg: null, outputImage: null })

  // 4) referenceImages 由上游通过 propagateNodeOutput 写入（支持多角色）+ 合并 @资产引用 + @角色名
  const refImages: string[] = []
  const allRefs = node.data.referenceImages as string[] | null
  if (allRefs?.length) {
    refImages.push(...allRefs)
  } else {
    const singleRef = node.data.referenceImage as string | null
    if (singleRef) refImages.push(singleRef)
  }
  // Union with resolved references (de-duplicated) from both resolvers
  for (const img of resolved.referenceImages) {
    if (img && !refImages.includes(img)) refImages.push(img)
  }
  for (const img of nameResolved.referenceImages) {
    if (img && !refImages.includes(img)) refImages.push(img)
  }
  // CharacterExtract → ImageGen direct character-in wiring (populated by propagateNodeOutput)
  const charImg = (node.data.characterImage || node.data.characterUrl) as string | null
  if (charImg && !refImages.includes(charImg)) refImages.push(charImg)

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
    // 1a) Resolve @asset_id tokens (ASCII) via assetStore
    const assetStore = useAssetStore.getState()
    const extraAssetRefs = Array.isArray(node.data.assetRefs) ? (node.data.assetRefs as string[]) : []
    const resolved = resolvePromptRefs(rawPrompt, assetStore, extraAssetRefs)

    // 1b) Resolve @角色名 tokens against CharacterManager nodes
    const nameResolved = resolveCharacterNames(resolved.expandedPrompt, store.nodes)

    // Merge references from both resolvers + character-in edge value
    const mergedReferenceImages = Array.from(
      new Set([...resolved.referenceImages, ...nameResolved.referenceImages]),
    )
    const mergedCharacterUrls = Array.from(
      new Set([...resolved.characterUrls, ...nameResolved.characterUrls]),
    )
    const charImg = (node.data.characterImage || node.data.characterUrl) as string | null
    if (charImg) {
      if (!mergedReferenceImages.includes(charImg)) mergedReferenceImages.push(charImg)
      if (!mergedCharacterUrls.includes(charImg)) mergedCharacterUrls.push(charImg)
    }
    const mergedUnresolved = [...resolved.unresolved, ...nameResolved.unresolved]

    // 2) Legacy anchor prefix still applies to the expanded prompt
    const prompt = buildCharacterAnchorPrefix(nameResolved.expandedPrompt)

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
      referenceImages: mergedReferenceImages,
      characterUrls: mergedCharacterUrls,
      timestamps: resolved.timestamps,
      existingImages,
    })

    if (adaptation.notes.length > 0) {
      console.debug('[executeVideoGen] adapter notes:', adaptation.notes)
    }
    if (mergedUnresolved.length > 0) {
      console.warn('[executeVideoGen] unresolved tokens:', mergedUnresolved)
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

    // Await polling until completion. This is critical: parallel_execute
    // must observe ACTUAL completion (success/failure/timeout) so the Agent
    // does not advance to videoStitch prematurely and re-submit the same
    // video tasks (each call is a paid API request).
    const pollResult = await pollVideoTaskUntilDone(res.task_id, nodeId, node.data.label as string)
    return pollResult
  } catch (err) {
    const msg = err instanceof Error ? err.message : '生成失败'
    store.updateNodeData(nodeId, { status: 'error', errorMsg: msg })
    return { success: false, message: `视频「${node.data.label}」提交失败：${msg}` }
  }
}

// ── Video polling config (mutable for tests; auto-shrunk in test mode) ──
const _isTestMode = (() => {
  try {
    return typeof process !== 'undefined'
      && (process.env?.NODE_ENV === 'test' || process.env?.VITEST === 'true')
  } catch {
    return false
  }
})()

/**
 * Mutable polling configuration for video tasks.
 *
 * Production: 5s interval × 180 attempts = **15 minute** ceiling. Sora / VEO
 * commonly take 5-10 min for 12s clips; the previous 2-minute window made the
 * UI freeze on "首帧生成中…50%" and forced the Agent to time-budget out.
 *
 * Tests: 5ms interval × 5 attempts = ~25ms ceiling so the suite doesn't hang.
 *
 * Tests that need other values may mutate this object directly.
 */
export const videoPollConfig = {
  intervalMs: _isTestMode ? 5 : 5000,
  maxAttempts: _isTestMode ? 5 : 180,
}

/**
 * Poll a backend video task until it completes, fails, or exceeds the
 * configured max attempts. Updates node status on every poll so the UI
 * reflects backend state in real time. Returns a final ExecutionResult
 * that callers (parallel_execute, etc.) can use to advance only after
 * the video URL is actually available.
 */
async function pollVideoTaskUntilDone(
  taskId: string,
  nodeId: string,
  label: string,
): Promise<ExecutionResult> {
  const store = useFlowStore.getState()

  for (let attempts = 0; attempts < videoPollConfig.maxAttempts; attempts++) {
    // Query first, then sleep — lets fast backends short-circuit without
    // an initial 5s wait, which also keeps the test suite responsive.
    if (attempts > 0) {
      await new Promise(resolve => setTimeout(resolve, videoPollConfig.intervalMs))
    }
    try {
      const status = await backendApi.queryTask(taskId)
      const isCompleted = status.status === 'completed'
      const isFailed = status.status === 'failed'
      const hasUrl = !!status.output_url

      store.updateNodeData(nodeId, {
        status: isCompleted && hasUrl ? 'done'
          : isFailed ? 'error'
          : 'generating',
        progress: status.progress || 0,
        outputVideo: status.output_url || null,
        errorMsg: status.error || null,
      })

      if (isCompleted && hasUrl) {
        return {
          success: true,
          message: `视频「${label}」生成完成`,
          output: status.output_url,
        }
      }
      if (isFailed) {
        return {
          success: false,
          message: `视频「${label}」生成失败：${status.error || '未知错误'}`,
        }
      }
      // Else: still processing — keep polling.
    } catch (pollErr) {
      // Network blips during polling shouldn't kill the whole task; log and
      // keep trying until maxAttempts. Only the final timeout is fatal.
      console.warn('[pollVideoTaskUntilDone] poll error:', pollErr)
    }
  }

  // Reached maxAttempts without completion — transition to error so the UI
  // does not remain stuck on "generating" (which was the previous bug).
  const ceilingMinutes = Math.round((videoPollConfig.intervalMs * videoPollConfig.maxAttempts) / 60000)
  const timeoutMsg = `视频生成轮询超时（${ceilingMinutes}min 未完成），请检查后端任务 ${taskId}`
  store.updateNodeData(nodeId, {
    status: 'error',
    errorMsg: timeoutMsg,
  })
  return { success: false, message: `视频「${label}」${timeoutMsg}` }
}
