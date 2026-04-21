/**
 * Image Classification — LLM Vision 图片智能分类
 *
 * 分类维度：product / character / scene / style_ref / logo / other
 * 返回：分类结果 + 描述 + 建议注入的节点类型
 */

import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { backendApi } from '@/api/backend'
import { TASK_TOKEN_BUDGETS } from '@/providers/modelDefaults'
import type { ToolCallResult } from './toolHelpers'

const IMAGE_CATEGORIES = {
  product:   { label: '产品', suggestNode: 'imageGen (referenceImages)', tip: '建议注入 imageGen 作为产品参考图，或 styleLock 提取品牌视觉风格' },
  character: { label: '角色', suggestNode: 'characterGrid (inputImage)', tip: '建议注入 characterGrid 作为角色参考，生成九宫图后裁切复用' },
  scene:     { label: '场景', suggestNode: 'sceneGrid (inputImage)',     tip: '建议注入 sceneGrid 作为场景参考，或 imageGen 作为首帧参考' },
  style_ref: { label: '风格参考', suggestNode: 'styleLock (referenceImage)', tip: '建议注入 styleLock 提取风格特征，统一全片视觉风格' },
  logo:      { label: 'Logo', suggestNode: 'imageGen (referenceImages)', tip: '建议注入品牌 Logo 节点或最后一镜的 imageGen 参考' },
  other:     { label: '其他', suggestNode: 'textNode 或手动指定',        tip: '无法自动分类，建议描述图片用途后手动注入' },
} as const

type ImageCategory = keyof typeof IMAGE_CATEGORIES

const CLASSIFY_PROMPT = `You are an image classifier for a video production pipeline.
Analyze the given image and classify it into EXACTLY ONE of these categories:
- product: A product photo, merchandise, packaging, food item, or commercial item
- character: A person, character design, portrait, or character reference sheet
- scene: A location, background, environment, or landscape
- style_ref: An artwork, style reference, mood board, or visual aesthetic reference
- logo: A brand logo, wordmark, icon, or brand identity element
- other: None of the above

Respond in this exact JSON format (no markdown, no extra text):
{"category":"<category>","description":"<brief English description of what the image shows>","confidence":<0.0-1.0>}`

export async function handleClassifyImage(args: Record<string, unknown>): Promise<ToolCallResult> {
  // 1. Resolve image source
  let imageData = args.imageUrl ? String(args.imageUrl) : ''

  if (!imageData) {
    const imageIndex = args.imageIndex !== undefined ? Number(args.imageIndex) : 0
    const chatMessages = useChatStore.getState().messages
    const allUserImages: string[] = []
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      const m = chatMessages[i]
      if (m.role === 'user' && m.images && m.images.length > 0) {
        allUserImages.push(...m.images)
        break
      }
    }
    if (allUserImages.length === 0) {
      return { success: false, message: '当前对话中未找到用户上传的图片。请让用户先上传图片再调用此工具。' }
    }
    if (imageIndex < 0 || imageIndex >= allUserImages.length) {
      return { success: false, message: `图片索引 ${imageIndex} 超出范围 (共 ${allUserImages.length} 张)` }
    }
    imageData = allUserImages[imageIndex]
  }

  // 2. Use backend LLM chat for classification
  try {
    const settings = useSettingsStore.getState()
    const result = await backendApi.chat({
      model_id: settings.defaultLLMModel,
      prompt: `${CLASSIFY_PROMPT}\n\n[Image attached: ${imageData.slice(0, 60)}...]`,
      temperature: 0.1,
      max_tokens: TASK_TOKEN_BUDGETS.IMAGE_CLASSIFY,
    })

    const rawContent = result.text || ''

    // 3. Parse JSON response
    let parsed: { category: string; description: string; confidence: number }
    try {
      const jsonStr = rawContent.replace(/```json\n?|```/g, '').trim()
      parsed = JSON.parse(jsonStr)
    } catch {
      return {
        success: true,
        message: `图片分析完成但无法解析分类结果。LLM 原始回复: ${rawContent.slice(0, 300)}`,
      }
    }

    const cat = (parsed.category in IMAGE_CATEGORIES ? parsed.category : 'other') as ImageCategory
    const info = IMAGE_CATEGORIES[cat]
    const confidence = Math.round((parsed.confidence || 0.5) * 100)

    const lines = [
      `图片分类: ${info.label} (${cat}, 置信度 ${confidence}%)`,
      `描述: ${parsed.description}`,
      `建议注入: ${info.suggestNode}`,
      info.tip,
    ]

    return { success: true, message: lines.join('\n') }
  } catch (err) {
    return { success: false, message: `图片分类失败: ${err instanceof Error ? err.message : String(err)}` }
  }
}
