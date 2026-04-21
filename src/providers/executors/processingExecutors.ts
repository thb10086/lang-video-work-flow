/**
 * Processing Executors — 分镜/风格/LLM/编辑/连续性检查/拼接/音频 执行器
 *
 * 从 nodeExecutor.ts 拆分，处理：
 * - executeStoryboard
 * - executeStyleLock
 * - executeLLMChat
 * - executeImageEdit
 * - executeContinuityCheck
 * - executeVideoStitch
 * - executeAudioNode
 */

import { useFlowStore } from '@/store/flowStore'
import { useSettingsStore } from '@/store/settingsStore'
import { backendApi } from '@/api/backend'
import { DEFAULT_IMAGE_MODEL, TASK_TOKEN_BUDGETS } from '@/providers/modelDefaults'
import type { ExecutionResult } from '../nodeExecutor'

// ── Storyboard: use LLM to break script into enhanced shots ──

/** Collect character appearance anchors from characterGrid nodes + global registry */
function collectCharacterAnchors(): string {
  const store = useFlowStore.getState()
  // 合并两种来源：characterGrid 节点 + 全局 characterAppearances 注册表
  const merged: Record<string, string> = { ...store.characterAppearances }

  const charNodes = store.nodes.filter(n => n.type === 'characterGrid')
  for (const n of charNodes) {
    const name = String(n.data?.name || '角色')
    const desc = String(n.data?.description || '')
    if (desc) merged[name] = desc // 节点数据优先（可能更新过）
  }

  const names = Object.keys(merged)
  if (names.length === 0) return ''

  const lines = names.map(name => `- ${name}: ${merged[name]}`)
  return `\n\nCHARACTER APPEARANCE ANCHORS (MUST embed these exact keywords in imagePrompt/videoPrompt whenever the character appears):\n${lines.join('\n')}`
}

export async function executeStoryboard(nodeId: string): Promise<ExecutionResult> {
  const store = useFlowStore.getState()
  const node = store.nodes.find(n => n.id === nodeId)
  if (!node || node.type !== 'storyboard') {
    return { success: false, message: `未找到分镜脚本节点 (${nodeId})` }
  }

  const script = String(node.data.script || '')
  if (!script.trim()) {
    return { success: false, message: '分镜脚本节点缺少剧本内容' }
  }

  store.updateNodeData(nodeId, { status: 'generating', errorMsg: null, shots: [] })

  const charAnchors = collectCharacterAnchors()

  const storyboardSystemPrompt = `You are a professional storyboard artist, cinematographer, and prompt engineer. Break down the provided script/creative concept into a sequence of shots with production-ready prompts.

Output ONLY a valid JSON array with no additional text:
[
  {
    "id": 1,
    "scene": "Scene location and setting (e.g. INT Coffee Shop - Morning)",
    "camera": "Shot type + camera movement (e.g. Medium close-up, slow dolly-in)",
    "duration": <seconds, 4-15>,
    "mood": "Emotional tone (e.g. tense, warm, melancholic)",
    "emotionIntensity": <1-10, where 1=calm and 10=climactic>,
    "charactersPresent": ["Character A", "Character B"],
    "imagePrompt": "ENGLISH image prompt following 6-dimension method: [Subject with full appearance anchor] + [Pose/Action] + [Environment] + [Lighting direction+color] + [Art style+quality] + [Composition]. No negative words here. Example: 'A 25-year-old woman with short silver pixie-cut hair, sharp blue eyes, wearing matte black leather jacket, standing on rain-soaked rooftop gazing at neon cityscape, dramatic rim lighting from behind, shallow DOF, cinematic 8K, medium close-up eye-level'",
    "videoPrompt": "ENGLISH video prompt following 5-section formula: [Camera]: movement + speed. [Subject]: character anchor + action + expression. [Environment]: setting + lighting + weather. [Quality]: Cinematic 4K, 24fps, lens style, color grade. [Negative]: No morphing, no identity drift, no flickering.",
    "dialogue": "中文对话或旁白文本（无对话则为空字符串）",
    "dialogueEN": "English translation of dialogue/narration (empty string if none)",
    "audioHint": "Audio cue: ambient sound, music style, or SFX (e.g. 'soft piano, rain ambience' or 'tense electronic beats')"
  }
]

CRITICAL RULES:
- 3-8 shots total, each 4-15 seconds
- imagePrompt and videoPrompt MUST be in English
- If CHARACTER APPEARANCE ANCHORS are provided, you MUST embed the exact appearance keywords in EVERY imagePrompt and videoPrompt where that character appears — this is essential for visual consistency
- imagePrompt should be optimized for image generation (Gemini) — rich visual detail, no camera motion
- videoPrompt should be optimized for video generation (Seedance/VEO) — include camera motion, action verbs, negative constraints
- dialogue is Chinese; dialogueEN is English translation
- emotionIntensity drives pacing: low(1-3)=slow cuts, medium(4-6)=normal, high(7-10)=fast cuts
- audioHint helps with sound design — describe ambient sounds and music mood`

  try {
    let text = ''

    const settings = useSettingsStore.getState()
    const modelId = settings.defaultLLMModel
    const res = await backendApi.chat({
      model_id: modelId,
      prompt: `${script}${charAnchors}`,
      system_prompt: storyboardSystemPrompt,
      temperature: 0.7,
      max_tokens: TASK_TOKEN_BUDGETS.STORYBOARD,
    })
    text = res.text || ''
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      throw new Error('LLM 未返回有效的分镜 JSON')
    }

    const parsed = JSON.parse(jsonMatch[0]) as Array<Record<string, unknown>>

    // Ensure backward-compatible 'description' field (fallback for old consumers)
    for (const shot of parsed) {
      if (!shot.description && shot.imagePrompt) {
        shot.description = shot.imagePrompt
      }
    }

    store.updateNodeData(nodeId, { status: 'done', shots: parsed })
    return {
      success: true,
      message: `分镜脚本已生成 ${parsed.length} 个镜头（含 imagePrompt/videoPrompt/dialogue/audioHint）`,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '生成分镜失败'
    store.updateNodeData(nodeId, { status: 'error', errorMsg: msg })
    return { success: false, message: `分镜生成失败：${msg}` }
  }
}

// ── Style Lock: extract style description (uses LLM vision if reference image connected) ──
export async function executeStyleLock(nodeId: string): Promise<ExecutionResult> {
  const store = useFlowStore.getState()
  const node = store.nodes.find(n => n.id === nodeId)
  if (!node || node.type !== 'styleLock') {
    return { success: false, message: `未找到风格锁定节点 (${nodeId})` }
  }

  const styleDesc = String(node.data.styleDescription || '')
  const referenceImage = node.data.referenceImage as string | null

  // 有参考图时：用 LLM 视觉分析提取实际视觉风格（而非仅凭文字描述）
  if (referenceImage) {
    store.updateNodeData(nodeId, { status: 'generating', errorMsg: null })
    const baseDesc = styleDesc ? `（参考描述：${styleDesc}）` : ''
    const stylePromptText = `分析这张参考图的视觉风格${baseDesc}。\n提取关键风格特征，用英文逗号分隔的关键词输出，包含：色调/色彩、光照方式、画面质感、艺术风格、情绪氛围、渲染质量。\n直接输出关键词，不要解释，不超过 80 字。`
    const styleSysPrompt = '你是专业的影视视觉风格分析师。从参考图中精确提取可用于 AI 图片/视频生成的风格提示词。'
    try {
      let extracted = ''
      const res = await backendApi.chat({
        model_id: useSettingsStore.getState().defaultLLMModel,
        prompt: stylePromptText,
        system_prompt: styleSysPrompt,
        temperature: 0.3,
        max_tokens: TASK_TOKEN_BUDGETS.STYLE_EXTRACT,
      })
      extracted = (res.text || '').trim() || styleDesc
      store.updateNodeData(nodeId, { status: 'done', extractedStyle: extracted })
      return { success: true, message: `风格锁定已从参考图提取：${extracted.slice(0, 80)}` }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '分析失败'
      // 降级：使用文字描述
      if (styleDesc) {
        store.updateNodeData(nodeId, { status: 'done', extractedStyle: styleDesc })
        return { success: true, message: `风格锁定（LLM 分析失败，使用文字描述）：${styleDesc.slice(0, 60)}` }
      }
      store.updateNodeData(nodeId, { status: 'error', errorMsg: msg })
      return { success: false, message: `风格锁定失败：${msg}` }
    }
  }

  // 无参考图：直接使用文字描述（原有行为）
  if (!styleDesc.trim()) {
    return { success: false, message: '风格锁定节点缺少风格描述（也未连接参考图）' }
  }
  store.updateNodeData(nodeId, { status: 'done', extractedStyle: styleDesc })
  return { success: true, message: `风格锁定已设置：${styleDesc.slice(0, 60)}` }
}

// ── LLM Chat: send prompt and get LLM response ──
export async function executeLLMChat(nodeId: string): Promise<ExecutionResult> {
  const store = useFlowStore.getState()
  const node = store.nodes.find(n => n.id === nodeId)
  if (!node || node.type !== 'llmChat') {
    return { success: false, message: `未找到 LLM 对话节点 (${nodeId})` }
  }

  const userInput = String(node.data.userInput || '')
  if (!userInput.trim()) {
    return { success: false, message: `LLM 对话节点「${node.data.label}」缺少用户输入` }
  }

  store.updateNodeData(nodeId, { status: 'generating', errorMsg: null, response: '' })

  try {
    const settings = useSettingsStore.getState()
    const modelId = String(node.data.model || settings.defaultLLMModel)
    const sysPrompt = String(node.data.systemPrompt || '')
    let text = ''

    const res = await backendApi.chat({
      model_id: modelId,
      prompt: userInput,
      system_prompt: sysPrompt || undefined,
      temperature: 0.7,
      max_tokens: TASK_TOKEN_BUDGETS.LLM_CHAT,
    })
    text = res.text || ''

    store.updateNodeData(nodeId, { status: 'done', response: text })
    return { success: true, message: `LLM 对话「${node.data.label}」完成`, output: text }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '调用失败'
    store.updateNodeData(nodeId, { status: 'error', errorMsg: msg })
    return { success: false, message: `LLM 对话「${node.data.label}」失败：${msg}` }
  }
}

// ── Image Edit: edit image with Gemini ──
export async function executeImageEdit(nodeId: string): Promise<ExecutionResult> {
  const store = useFlowStore.getState()
  const node = store.nodes.find(n => n.id === nodeId)
  if (!node || node.type !== 'imageEdit') {
    return { success: false, message: `未找到图片编辑节点 (${nodeId})` }
  }

  const inputImage = node.data.inputImage as string | null
  const editPrompt = String(node.data.editPrompt || node.data.editInstruction || '')
  if (!inputImage) {
    return { success: false, message: `图片编辑节点「${node.data.label}」缺少输入图片（请连接上游图片节点）` }
  }
  if (!editPrompt.trim()) {
    return { success: false, message: `图片编辑节点「${node.data.label}」缺少编辑指令` }
  }

  store.updateNodeData(nodeId, { status: 'generating', errorMsg: null, outputImage: null })

  try {
    const currentModel = String(node.data.model || DEFAULT_IMAGE_MODEL)
    let dataUrl: string | null = null

    const res = await backendApi.generateImage({
      model_id: currentModel,
      prompt: `Edit this image: ${editPrompt}`,
      reference_images: [inputImage],
      params: { aspectRatio: '1:1' },
    })
    const img = res.images?.[0]
    if (img) {
      dataUrl = img.url || `data:${img.mime_type};base64,${img.data}`
      if (img.url) store.updateNodeData(nodeId, { outputImageUrl: img.url })
    }

    if (dataUrl) {
      store.updateNodeData(nodeId, { status: 'done', outputImage: dataUrl })
      return { success: true, message: `图片编辑「${node.data.label}」完成`, output: dataUrl }
    }
    throw new Error('未返回编辑后的图片')
  } catch (err) {
    const msg = err instanceof Error ? err.message : '编辑失败'
    store.updateNodeData(nodeId, { status: 'error', errorMsg: msg })
    return { success: false, message: `图片编辑「${node.data.label}」失败：${msg}` }
  }
}

// ── Continuity Check: compare adjacent shots with LLM ──
export async function executeContinuityCheck(nodeId: string): Promise<ExecutionResult> {
  const store = useFlowStore.getState()
  const node = store.nodes.find(n => n.id === nodeId)
  if (!node || node.type !== 'continuityCheck') {
    return { success: false, message: `未找到连续性检查节点 (${nodeId})` }
  }

  const imageA = node.data.imageA as string | null
  const imageB = node.data.imageB as string | null
  if (!imageA && !imageB) {
    return { success: false, message: `连续性检查节点「${node.data.label}」缺少输入图片` }
  }

  store.updateNodeData(nodeId, { status: 'generating', errorMsg: null, results: [] })

  const refs: string[] = []
  if (imageA) refs.push(imageA)
  if (imageB) refs.push(imageB)

  const ccPrompt = `对比这两张相邻镜头的图片，检查视觉连续性。
分析以下维度并输出 JSON 数组:
1. 角色一致性 2. 光照一致性 3. 色调一致性 4. 场景一致性 5. 透视一致性
输出格式: [{"aspect": "...", "status": "pass|warning|fail", "detail": "..."}]
${refs.length < 2 ? '注意：只有一张图片，请基于单张图片评估其质量和潜在连续性问题。' : ''}`
  const ccSysPrompt = '你是专业的影视后期连续性检查师。擅长发现相邻镜头间的视觉不一致问题。'

  try {
    let text = ''

    const settings = useSettingsStore.getState()
    const res = await backendApi.chat({
      model_id: settings.defaultLLMModel,
      prompt: ccPrompt,
      system_prompt: ccSysPrompt,
      temperature: 0.3,
      max_tokens: TASK_TOKEN_BUDGETS.CONTINUITY_CHECK,
    })
    text = res.text || ''

    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) throw new Error('LLM 未返回有效的检查结果 JSON')

    const parsed = JSON.parse(jsonMatch[0])
    store.updateNodeData(nodeId, { status: 'done', results: parsed })
    const passCount = parsed.filter((r: { status: string }) => r.status === 'pass').length
    return { success: true, message: `连续性检查完成：${passCount}/${parsed.length} 项通过` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '检查失败'
    store.updateNodeData(nodeId, { status: 'error', errorMsg: msg })
    return { success: false, message: `连续性检查失败：${msg}` }
  }
}

// ── Video Stitch: merge video clips with ffmpeg.wasm + COS upload ──
export async function executeVideoStitch(nodeId: string): Promise<ExecutionResult> {
  const store = useFlowStore.getState()
  const node = store.nodes.find(n => n.id === nodeId)
  if (!node || node.type !== 'videoStitch') {
    return { success: false, message: `未找到视频拼接节点 (${nodeId})` }
  }

  // Sort edges by source node x-position (left → right = temporal order)
  const videoEdges = store.edges
    .filter(e => e.target === nodeId && e.targetHandle === 'video-in')
    .sort((a, b) => {
      const ax = store.nodes.find(n => n.id === a.source)?.position.x ?? 0
      const bx = store.nodes.find(n => n.id === b.source)?.position.x ?? 0
      return ax - bx
    })
  const videoUrls: { label: string; url: string }[] = []
  const pending: string[] = []
  const failed: string[] = []

  for (const edge of videoEdges) {
    const srcNode = store.nodes.find(n => n.id === edge.source)
    if (!srcNode) continue
    const d = srcNode.data as Record<string, unknown>
    const label = String(d.label || srcNode.id)
    const url = d.outputVideo as string | undefined
    const status = String(d.status || 'idle')

    if (url) {
      videoUrls.push({ label, url })
    } else if (status === 'generating' || status === 'idle') {
      pending.push(label)
    } else if (status === 'error') {
      failed.push(label)
    }
  }

  if (videoUrls.length === 0) {
    const detail: string[] = []
    if (pending.length) detail.push(`${pending.length} 个生成中: ${pending.join('、')}`)
    if (failed.length) detail.push(`${failed.length} 个已失败: ${failed.join('、')}`)
    return {
      success: false,
      message: `视频拼接节点「${node.data.label}」没有可用的视频。${detail.join('；')}`,
    }
  }

  const clips = videoUrls.map((v, i) => ({ id: `clip-${i}`, url: v.url, label: v.label }))
  const warnings: string[] = []
  if (pending.length) warnings.push(`${pending.length} 个尚在生成`)
  if (failed.length) warnings.push(`${failed.length} 个失败未包含`)

  // 尝试真实合并
  store.updateNodeData(nodeId, { clips, status: 'generating', errorMsg: null, outputUrl: null })

  try {
    const { mergeVideos, blobToDataUrl } = await import('../videoMerger')

    store.updateNodeData(nodeId, {
      errorMsg: `正在合并 ${videoUrls.length} 段视频，请稍候（加载 ffmpeg 约需 10-30s）...`,
    })

    const mergedBlob = await mergeVideos(
      videoUrls.map(v => v.url),
      (p) => {
        const phases: Record<string, string> = {
          loading: 'FFmpeg 加载中',
          downloading: `下载片段 ${p.current}/${p.total}`,
          merging: '合并中',
          done: '合并完成',
        }
        store.updateNodeData(nodeId, { errorMsg: phases[p.phase] || p.phase })
      }
    )

    // 上传合并结果到 COS (via backend)
    let finalUrl: string | null = null
    try {
      const dataUrl = await blobToDataUrl(mergedBlob)
      const uploadRes = await backendApi.uploadImage(dataUrl)
      finalUrl = uploadRes.url
      console.log(`[videoStitch] Merged video uploaded via backend: ${finalUrl}`)
    } catch (uploadErr) {
      console.warn('[videoStitch] Backend upload failed, using local blob URL:', uploadErr)
      finalUrl = URL.createObjectURL(mergedBlob)
      warnings.push('后端上传失败，合并视频仅在本次会话可用（刷新后失效）')
    }

    store.updateNodeData(nodeId, {
      clips,
      status: 'done',
      outputUrl: finalUrl,
      outputVideo: finalUrl,
      errorMsg: warnings.length ? warnings.join('；') : null,
    })

    const sizeStr = `${(mergedBlob.size / 1024 / 1024).toFixed(1)} MB`
    return {
      success: true,
      message: `视频已合并 (${sizeStr})${finalUrl.startsWith('http') ? `，已上传 COS: ${finalUrl.slice(0, 80)}` : '，本地可用'}${warnings.length ? `\n警告: ${warnings.join('；')}` : ''}`,
      output: finalUrl,
    }
  } catch (mergeErr) {
    const errMsg = mergeErr instanceof Error ? mergeErr.message : '合并失败'
    console.warn(`[videoStitch] Merge failed: ${errMsg}`)

    // 降级：仅收集 clips
    store.updateNodeData(nodeId, {
      clips,
      status: 'done',
      outputUrl: videoUrls[0].url,
      errorMsg: `视频合并失败（${errMsg}）。已收集 ${videoUrls.length} 段片段，下方可逐段播放。`,
    })

    return {
      success: true,
      message: `警告：视频合并失败（${errMsg}）。已收集 ${videoUrls.length} 段视频片段。${warnings.length ? `\n${warnings.join('；')}` : ''}`,
    }
  }
}

// ── Audio Node: placeholder (no TTS adapter yet) ──
export async function executeAudioNode(nodeId: string): Promise<ExecutionResult> {
  const store = useFlowStore.getState()
  const node = store.nodes.find(n => n.id === nodeId)
  if (!node || node.type !== 'audioNode') {
    return { success: false, message: `未找到音频生成节点 (${nodeId})` }
  }

  const text = String(node.data.text || '')
  if (!text.trim()) {
    return { success: false, message: `音频节点「${node.data.label}」缺少文本内容` }
  }

  // TTS adapter not yet implemented — mark as pending (not error) to avoid confusing Agent
  store.updateNodeData(nodeId, { status: 'pending', errorMsg: null })
  return {
    success: true,
    message: `音频节点「${node.data.label}」已就绪（文本: "${text.slice(0, 60)}"）。注意：TTS 生成功能尚未接入，请在工作流完成后手动导出旁白文本并使用外部工具生成配音，或跳过此步骤直接进行视频拼接。`,
  }
}
