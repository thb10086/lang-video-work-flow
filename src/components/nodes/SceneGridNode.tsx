import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Mountain, Play, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { useFlowStore } from '@/store/flowStore'
import { backendApi } from '@/api/backend'
import { DEFAULT_IMAGE_MODEL } from '@/providers/modelDefaults'
import { sceneSheetTemplate } from '@/prompts/templates/sceneSheet'
import { renderTemplate } from '@/prompts/promptEngine'

const SCENE_STYLES = ['cinematic', 'anime', 'realistic', 'painterly', 'noir', 'fantasy']
const SCENE_MOODS = ['dramatic', 'peaceful', 'tense', 'romantic', 'mysterious', 'epic']

function SceneGridNode({ id, data, selected }: NodeProps) {
  const status = String(data.status || 'idle')
  const label = String(data.label || '场景九宫图')
  const sceneName = String(data.name || '')
  const sceneDesc = String(data.description || '')
  const style = String(data.style || 'cinematic')
  const mood = String(data.mood || 'dramatic')
  const outputImage = data.outputImage as string | null
  const outputImageUrl = data.outputImageUrl as string | null
  const displayImage = outputImage || outputImageUrl
  const errorMsg = data.errorMsg ? String(data.errorMsg) : null

  const updateNodeData = useFlowStore((s) => s.updateNodeData)

  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateNodeData(id, { name: e.target.value, label: `场景: ${e.target.value || '新场景'}` })
  }, [id, updateNodeData])

  const handleDescChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateNodeData(id, { description: e.target.value })
  }, [id, updateNodeData])

  const handleStyleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    updateNodeData(id, { style: e.target.value })
  }, [id, updateNodeData])

  const handleMoodChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    updateNodeData(id, { mood: e.target.value })
  }, [id, updateNodeData])

  const handleGenerate = useCallback(async () => {
    if (status === 'generating') return
    const name = String(data.name || '新场景')
    const desc = String(data.description || 'A scene')
    const sceneStyle = String(data.style || 'cinematic')
    const sceneMood = String(data.mood || 'dramatic')

    const prompt = renderTemplate(sceneSheetTemplate.template, {
      scene_name: name,
      scene_description: desc,
      style: sceneStyle,
      mood: sceneMood,
    })

    updateNodeData(id, { status: 'generating', errorMsg: null, outputImage: null })

    try {
      const modelId = DEFAULT_IMAGE_MODEL
      const res = await backendApi.generateImage({
        model_id: modelId, prompt,
        params: { aspectRatio: '1:1', imageSize: '2k' },
      })
      const img = res.images?.[0]
      if (img) {
        const dataUrl = img.url || `data:${img.mime_type};base64,${img.data}`
        updateNodeData(id, { status: 'done', outputImage: dataUrl })
        if (img.url) updateNodeData(id, { outputImageUrl: img.url })
      } else {
        updateNodeData(id, { status: 'error', errorMsg: '未返回图片 (已重试 3 次)' })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生成失败'
      updateNodeData(id, { status: 'error', errorMsg: msg })
    }
  }, [id, data.name, data.description, data.style, data.mood, status, updateNodeData])

  const borderClass = status === 'generating'
    ? 'border-yellow-400 shadow-yellow-200/50 animate-pulse'
    : status === 'done'
    ? 'border-green-500 shadow-green-200/50'
    : status === 'error'
    ? 'border-red-500 shadow-red-200/50'
    : selected
    ? 'border-emerald-500 shadow-emerald-200'
    : 'border-border'

  return (
    <div className={`workflow-node bg-card border-2 rounded-xl shadow-lg w-[300px] transition-all duration-300 ${borderClass}`}>
      <Handle type="target" position={Position.Left} id="prompt-in" className="!w-3 !h-3 !bg-emerald-500" />

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-emerald-500/10 rounded-t-xl border-b border-border">
        <Mountain className="w-4 h-4 text-emerald-500" />
        <span className="font-semibold text-sm">{label}</span>
        {status === 'done' && <CheckCircle2 className="w-3.5 h-3.5 text-green-500 ml-auto" />}
        {status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-red-500 ml-auto" />}
      </div>

      {/* Content */}
      <div className="p-3 space-y-2">
        {/* Scene Name */}
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">场景名称</label>
          <input
            type="text"
            value={sceneName}
            onChange={handleNameChange}
            placeholder="例: 赛博朋克城市"
            className="w-full text-xs rounded-md border border-border bg-muted/30 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-400"
          />
        </div>

        {/* Scene Description */}
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">场景描述</label>
          <textarea
            value={sceneDesc}
            onChange={handleDescChange}
            placeholder="描述场景环境、建筑、氛围..."
            rows={2}
            className="w-full text-xs rounded-md border border-border bg-muted/30 p-2 resize-none focus:outline-none focus:ring-1 focus:ring-emerald-400 placeholder:text-muted-foreground/50"
          />
        </div>

        {/* Style & Mood */}
        <div className="flex gap-2">
          <div className="flex-1">
            <span className="text-[10px] text-muted-foreground">风格</span>
            <select
              value={style}
              onChange={handleStyleChange}
              className="w-full text-xs font-medium px-2 py-1 rounded border border-border bg-muted/30 outline-none cursor-pointer mt-0.5"
            >
              {SCENE_STYLES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <span className="text-[10px] text-muted-foreground">情绪</span>
            <select
              value={mood}
              onChange={handleMoodChange}
              className="w-full text-xs font-medium px-2 py-1 rounded border border-border bg-muted/30 outline-none cursor-pointer mt-0.5"
            >
              {SCENE_MOODS.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Error Message */}
        {errorMsg && (
          <div className="text-[10px] text-red-500 bg-red-50 rounded px-2 py-1 break-all">
            {errorMsg}
          </div>
        )}

        {/* Output Preview — single grid image */}
        {displayImage && (
          <div
            className="rounded-md overflow-hidden border border-border cursor-zoom-in"
            onClick={() => window.open(outputImageUrl || outputImage!, '_blank')}
            title="点击查看原图"
          >
            <img src={displayImage} alt="scene grid" className="w-full" />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border">
        <button
          onClick={handleGenerate}
          disabled={status === 'generating'}
          className={`w-full py-1.5 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            status === 'generating'
              ? 'bg-yellow-100 text-yellow-700'
              : status === 'done'
              ? 'bg-green-500 text-white hover:bg-green-600'
              : 'bg-emerald-500 text-white hover:bg-emerald-600'
          }`}
        >
          {status === 'generating' ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> 生成中...</>
          ) : status === 'done' ? (
            <><Play className="w-3 h-3" /> 重新生成</>
          ) : (
            <><Play className="w-3 h-3" /> 生成九宫图</>
          )}
        </button>
      </div>

      <Handle type="source" position={Position.Right} id="grid-out" className="!w-3 !h-3 !bg-emerald-500" />
    </div>
  )
}

export default memo(SceneGridNode)
