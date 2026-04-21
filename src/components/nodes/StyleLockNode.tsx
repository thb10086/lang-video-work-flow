import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Palette, Lock, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { useFlowStore } from '@/store/flowStore'
import { backendApi } from '@/api/backend'
import { useSettingsStore } from '@/store/settingsStore'
import { TASK_TOKEN_BUDGETS } from '@/providers/modelDefaults'

function StyleLockNode({ id, data, selected }: NodeProps) {
  const status = String(data.status || 'idle')
  const label = String(data.label || '风格锁定')
  const referenceImage = data.referenceImage as string | null
  const styleDescription = String(data.styleDescription || '')
  const extractedStyle = String(data.extractedStyle || '')
  const errorMsg = data.errorMsg ? String(data.errorMsg) : null

  const updateNodeData = useFlowStore((s) => s.updateNodeData)

  const handleStyleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateNodeData(id, { styleDescription: e.target.value })
  }, [id, updateNodeData])

  const handleExtractStyle = useCallback(async () => {
    if (status === 'extracting') return

    const refImg = data.referenceImage as string | null
    const manualStyle = String(data.styleDescription || '')

    if (!refImg && !manualStyle.trim()) return

    updateNodeData(id, { status: 'extracting', errorMsg: null })

    try {
      const settings = useSettingsStore.getState()
      const modelId = settings.defaultLLMModel

      const prompt = refImg
        ? `分析这张参考图片的视觉风格特征，提取以下维度并输出为简洁的风格描述（用于注入到后续图片/视频生成的提示词中）：

1. 色彩方案（色调、饱和度、对比度）
2. 光照风格（自然光/人工光/戏剧性/柔和）
3. 艺术风格（写实/动漫/插画/水彩/3D等）
4. 构图特点
5. 氛围情绪
6. 材质纹理

${manualStyle ? `用户补充描述: ${manualStyle}` : ''}

请输出一段 50-100 词的英文风格描述，可以直接拼接到 prompt 末尾使用。`
        : `根据以下风格描述，生成一段标准化的英文风格提示词（50-100词），可以直接拼接到图片/视频生成 prompt 末尾确保风格统一：

${manualStyle}

输出格式: Style: [风格描述]`

      const result = await backendApi.chat({
        model_id: modelId,
        prompt,
        system_prompt: '你是专业的视觉风格分析师。擅长将视觉风格特征转化为 AI 图片/视频生成的提示词。',
        temperature: 0.5,
        max_tokens: TASK_TOKEN_BUDGETS.STYLE_EXTRACT,
      })

      updateNodeData(id, {
        status: 'done',
        extractedStyle: result.text || '',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '风格提取失败'
      updateNodeData(id, { status: 'error', errorMsg: msg })
    }
  }, [id, data.referenceImage, data.styleDescription, status, updateNodeData])

  const borderClass = status === 'extracting'
    ? 'border-yellow-400 shadow-yellow-200/50 animate-pulse'
    : status === 'done'
    ? 'border-green-500 shadow-green-200/50'
    : status === 'error'
    ? 'border-red-500 shadow-red-200/50'
    : selected
    ? 'border-pink-500 shadow-pink-200'
    : 'border-border'

  return (
    <div className={`workflow-node bg-card border-2 rounded-xl shadow-lg w-[280px] transition-all duration-300 ${borderClass}`}>
      <Handle type="target" position={Position.Left} id="ref-in" className="!w-3 !h-3 !bg-blue-500" style={{ top: '30%' }} />
      <Handle type="target" position={Position.Left} id="style-in" className="!w-3 !h-3 !bg-amber-500" style={{ top: '70%' }} />

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-pink-500/10 rounded-t-xl border-b border-border">
        <Palette className="w-4 h-4 text-pink-500" />
        <span className="font-semibold text-sm">{label}</span>
        {status === 'done' && <Lock className="w-3.5 h-3.5 text-green-500 ml-auto" />}
        {status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-red-500 ml-auto" />}
      </div>

      {/* Content */}
      <div className="p-3 space-y-2">
        {/* Reference Image Preview */}
        {referenceImage && (
          <div className="rounded-md overflow-hidden border border-border h-20">
            <img src={referenceImage} alt="ref" className="w-full h-full object-cover" />
          </div>
        )}

        {/* Manual Style Description */}
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">风格描述 (可选)</label>
          <textarea
            value={styleDescription}
            onChange={handleStyleChange}
            placeholder="描述期望的风格，如：赛博朋克、暖色调、胶片质感..."
            rows={2}
            className="w-full text-xs rounded-md border border-border bg-muted/30 p-2 resize-none focus:outline-none focus:ring-1 focus:ring-pink-400 placeholder:text-muted-foreground/50"
          />
        </div>

        {/* Error */}
        {errorMsg && (
          <div className="text-[10px] text-red-500 bg-red-50 rounded px-2 py-1 break-all">{errorMsg}</div>
        )}

        {/* Extracted Style */}
        {extractedStyle && (
          <div className="bg-pink-50 rounded-md p-2">
            <div className="flex items-center gap-1 mb-1">
              <Lock className="w-3 h-3 text-pink-500" />
              <span className="text-[10px] text-pink-700 font-medium">锁定风格</span>
            </div>
            <p className="text-[10px] text-pink-800 leading-relaxed">{extractedStyle}</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border">
        <button
          onClick={handleExtractStyle}
          disabled={(!referenceImage && !styleDescription.trim()) || status === 'extracting'}
          className={`w-full py-1.5 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            status === 'extracting'
              ? 'bg-yellow-100 text-yellow-700'
              : status === 'done'
              ? 'bg-green-500 text-white hover:bg-green-600'
              : 'bg-pink-500 text-white hover:bg-pink-600'
          }`}
        >
          {status === 'extracting' ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> 分析中...</>
          ) : status === 'done' ? (
            <><CheckCircle2 className="w-3 h-3" /> 重新提取</>
          ) : (
            <><Palette className="w-3 h-3" /> 提取风格</>
          )}
        </button>
      </div>

      <Handle type="source" position={Position.Right} id="style-out" className="!w-3 !h-3 !bg-emerald-500" />
    </div>
  )
}

export default memo(StyleLockNode)
