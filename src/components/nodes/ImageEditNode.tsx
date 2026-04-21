import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Pencil, Play, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { useFlowStore } from '@/store/flowStore'
import { backendApi } from '@/api/backend'
import { DEFAULT_IMAGE_MODEL } from '@/providers/modelDefaults'

function ImageEditNode({ id, data, selected }: NodeProps) {
  const status = String(data.status || 'idle')
  const label = String(data.label || '图片编辑')
  const inputImage = data.inputImage as string | null
  const editPrompt = String(data.editPrompt || '')
  const outputImage = data.outputImage as string | null
  const modelId = String(data.model || DEFAULT_IMAGE_MODEL)
  const errorMsg = data.errorMsg ? String(data.errorMsg) : null

  const updateNodeData = useFlowStore((s) => s.updateNodeData)

  const handlePromptChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateNodeData(id, { editPrompt: e.target.value })
  }, [id, updateNodeData])

  const handleEdit = useCallback(async () => {
    const img = data.inputImage as string | null
    const prompt = String(data.editPrompt || '')
    if (!img || !prompt.trim() || status === 'editing') return

    updateNodeData(id, { status: 'editing', errorMsg: null, outputImage: null })

    try {
      const currentModel = String(data.model || DEFAULT_IMAGE_MODEL)

      const res = await backendApi.generateImage({
        model_id: currentModel,
        prompt: `Edit this image: ${prompt}`,
        reference_images: [img],
        params: { aspectRatio: '1:1' },
      })

      const imgResult = res.images?.[0]
      if (imgResult) {
        const url = imgResult.url || `data:${imgResult.mime_type};base64,${imgResult.data}`
        updateNodeData(id, { status: 'done', outputImage: url })
        if (imgResult.url) updateNodeData(id, { outputImageUrl: imgResult.url })
      } else {
        throw new Error('未返回编辑后的图片')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '编辑失败'
      updateNodeData(id, { status: 'error', errorMsg: msg })
    }
  }, [id, data.inputImage, data.editPrompt, data.model, status, updateNodeData])

  const borderClass = status === 'editing'
    ? 'border-yellow-400 shadow-yellow-200/50 animate-pulse'
    : status === 'done'
    ? 'border-green-500 shadow-green-200/50'
    : status === 'error'
    ? 'border-red-500 shadow-red-200/50'
    : selected
    ? 'border-orange-500 shadow-orange-200'
    : 'border-border'

  return (
    <div className={`workflow-node bg-card border-2 rounded-xl shadow-lg w-[280px] transition-all duration-300 ${borderClass}`}>
      <Handle type="target" position={Position.Left} id="image-in" className="!w-3 !h-3 !bg-blue-500" />

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-orange-500/10 rounded-t-xl border-b border-border">
        <Pencil className="w-4 h-4 text-orange-500" />
        <span className="font-semibold text-sm">{label}</span>
        {status === 'done' && <CheckCircle2 className="w-3.5 h-3.5 text-green-500 ml-auto" />}
        {status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-red-500 ml-auto" />}
      </div>

      {/* Content */}
      <div className="p-3 space-y-2">
        {/* Input image preview */}
        {inputImage ? (
          <div className="rounded-md overflow-hidden border border-border h-24">
            <img src={inputImage} alt="input" className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border h-20 flex items-center justify-center">
            <span className="text-[10px] text-muted-foreground">连接图片到输入端口</span>
          </div>
        )}

        {/* Model */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">模型</span>
          <span className="text-[10px] font-medium bg-orange-100 text-orange-700 px-2 py-0.5 rounded">
            {modelId.replace('gemini-', 'Gemini ')}
          </span>
        </div>

        {/* Edit prompt */}
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">编辑指令</label>
          <textarea
            value={editPrompt}
            onChange={handlePromptChange}
            placeholder="描述编辑操作，如：换背景为海滩、添加太阳镜、改变发色..."
            rows={2}
            className="w-full text-xs rounded-md border border-border bg-muted/30 p-2 resize-none focus:outline-none focus:ring-1 focus:ring-orange-400 placeholder:text-muted-foreground/50"
          />
        </div>

        {/* Error */}
        {errorMsg && (
          <div className="text-[10px] text-red-500 bg-red-50 rounded px-2 py-1 break-all">{errorMsg}</div>
        )}

        {/* Output preview */}
        {outputImage && (
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground">编辑结果:</p>
            <div className="rounded-md overflow-hidden border border-border">
              <img src={outputImage} alt="edited" className="w-full" />
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border">
        <button
          onClick={handleEdit}
          disabled={!inputImage || !editPrompt.trim() || status === 'editing'}
          className={`w-full py-1.5 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            status === 'editing'
              ? 'bg-yellow-100 text-yellow-700'
              : status === 'done'
              ? 'bg-green-500 text-white hover:bg-green-600'
              : 'bg-orange-500 text-white hover:bg-orange-600'
          }`}
        >
          {status === 'editing' ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> 编辑中...</>
          ) : (
            <><Play className="w-3 h-3" /> {status === 'done' ? '重新编辑' : '执行编辑'}</>
          )}
        </button>
      </div>

      <Handle type="source" position={Position.Right} id="image-out" className="!w-3 !h-3 !bg-blue-500" />
    </div>
  )
}

export default memo(ImageEditNode)
