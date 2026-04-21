import { memo, useCallback, useMemo, useRef } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ImageIcon, Play, Loader2, CheckCircle2, AlertCircle, Upload, X } from 'lucide-react'
import { useFlowStore } from '@/store/flowStore'
import { backendApi } from '@/api/backend'
import { DEFAULT_IMAGE_MODEL } from '@/providers/modelDefaults'
import type { ParamField } from '@/providers/types'
import { useBackendModels } from '@/hooks/useBackendModels'
import { useSlashMenu } from '@/hooks/useSlashMenu'
import SlashMenu, { type SlashCommand } from '@/components/canvas/SlashMenu'

function ImageGenNode({ id, data, selected }: NodeProps) {
  const { models: backendImageModels } = useBackendModels('image')
  const imageModels = useMemo(() => {
    return backendImageModels.map(m => ({ id: m.model_id, name: m.name, description: m.description }))
  }, [backendImageModels])
  const status = String(data.status || 'idle')
  const label = String(data.label || '图片生成')
  const prompt = String(data.prompt || '')
  const outputImage = data.outputImage as string | null
  const outputImageUrl = data.outputImageUrl as string | null
  const displayImage = outputImage || outputImageUrl
  const referenceImage = data.referenceImage as string | null
  const referenceImages = data.referenceImages as string[] | null
  const hasRefImages = !!(referenceImages?.length || referenceImage)
  const aspectRatio = String(data.aspectRatio || '1:1')
  const imageSize = String(data.imageSize || '2k')
  const modelId = String(data.model || DEFAULT_IMAGE_MODEL)

  // Dynamic param schema from backend DB (single source of truth)
  const paramSchema: ParamField[] = useMemo(() => {
    const bm = backendImageModels.find(m => m.model_id === modelId)
    return (bm?.param_schema?.length ? bm.param_schema : []) as ParamField[]
  }, [modelId, backendImageModels])
  const aspectRatioField = useMemo(() => paramSchema.find(f => f.key === 'aspectRatio'), [paramSchema])
  const imageSizeField = useMemo(() => paramSchema.find(f => f.key === 'imageSize'), [paramSchema])
  const errorMsg = data.errorMsg ? String(data.errorMsg) : null
  const retryCount = Number(data.retryCount || 0)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const updateNodeData = useFlowStore((s) => s.updateNodeData)
  const addNode = useFlowStore((s) => s.addNode)
  const nodes = useFlowStore((s) => s.nodes)
  const { slashState, handleSlashKeyDown, closeSlash } = useSlashMenu()

  const handleSlashSelect = useCallback((cmd: SlashCommand) => {
    closeSlash()
    if (cmd.action.startsWith('create:')) {
      const nodeType = cmd.action.replace('create:', '')
      const self = nodes.find((n) => n.id === id)
      const posX = (self?.position?.x ?? 0) + 320
      const posY = self?.position?.y ?? 0
      addNode(nodeType, { x: posX, y: posY }, { label: cmd.label, status: 'idle' })
    }
  }, [closeSlash, addNode, nodes, id])

  const handlePromptChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateNodeData(id, { prompt: e.target.value })
  }, [id, updateNodeData])

  const handleModelChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    updateNodeData(id, { model: e.target.value })
  }, [id, updateNodeData])

  const handleAspectChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    updateNodeData(id, { aspectRatio: e.target.value })
  }, [id, updateNodeData])

  const handleSizeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    updateNodeData(id, { imageSize: e.target.value })
  }, [id, updateNodeData])

  const handleRefImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      updateNodeData(id, { referenceImage: reader.result as string })
    }
    reader.readAsDataURL(file)
  }, [id, updateNodeData])

  const handleRemoveRefImage = useCallback(() => {
    updateNodeData(id, { referenceImage: null })
  }, [id, updateNodeData])

  const handleGenerate = useCallback(async () => {
    const currentPrompt = String(data.prompt || '')
    if (!currentPrompt.trim()) return
    if (status === 'generating') return

    const currentModel = String(data.model || DEFAULT_IMAGE_MODEL)
    updateNodeData(id, { status: 'generating', errorMsg: null, outputImage: null })

    try {
      const refImages: string[] = []
      const currentRef = data.referenceImage as string | null
      if (currentRef) refImages.push(currentRef)

      const res = await backendApi.generateImage({
        model_id: currentModel,
        prompt: currentPrompt,
        reference_images: refImages.length > 0 ? refImages : undefined,
        params: {
          aspectRatio: String(data.aspectRatio || '1:1'),
          imageSize: String(data.imageSize || '2k'),
        },
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
  }, [id, data.prompt, data.model, data.aspectRatio, data.imageSize, data.referenceImage, status, updateNodeData])

  const borderClass = status === 'generating'
    ? 'border-yellow-400 shadow-yellow-200/50 animate-pulse'
    : status === 'done'
    ? 'border-green-500 shadow-green-200/50'
    : status === 'error'
    ? 'border-red-500 shadow-red-200/50'
    : selected
    ? 'border-blue-500 shadow-blue-200'
    : 'border-border'

  const currentModelInfo = imageModels.find(m => m.id === modelId)

  return (
    <div className={`workflow-node bg-card border-2 rounded-xl shadow-lg w-[280px] transition-all duration-300 ${borderClass}`}>
      <Handle type="target" position={Position.Left} id="prompt-in" className="!w-3 !h-3 !bg-blue-500" style={{ top: '30%' }} />
      <Handle type="target" position={Position.Left} id="ref-in" className="!w-3 !h-3 !bg-cyan-400" style={{ top: '70%' }} />

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-blue-500/10 rounded-t-xl border-b border-border">
        <ImageIcon className="w-4 h-4 text-blue-500" />
        <span className="font-semibold text-sm truncate flex-1">{label}</span>
        {retryCount > 0 && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-600 border border-orange-200 flex-shrink-0">
            重试#{retryCount}
          </span>
        )}
        {(referenceImages?.length ?? 0) > 1 && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-cyan-100 text-cyan-700 border border-cyan-200 flex-shrink-0">
            {referenceImages!.length}张参考
          </span>
        )}
        {status === 'done' && <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />}
        {status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
        {status === 'generating' && <Loader2 className="w-3.5 h-3.5 text-yellow-500 animate-spin flex-shrink-0" />}
      </div>
      {/* Generating progress bar */}
      {status === 'generating' && (
        <div className="h-1 w-full bg-yellow-100 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-yellow-400 via-amber-300 to-yellow-400 animate-[shimmer_1.5s_ease-in-out_infinite] bg-[length:200%_100%]" />
        </div>
      )}

      {/* Content */}
      <div className="p-3 space-y-2">
        {/* Model Selector */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">模型</span>
          <select
            value={modelId}
            onChange={handleModelChange}
            className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-1 rounded-md border border-blue-200 outline-none cursor-pointer hover:bg-blue-100 transition-colors"
          >
            {imageModels.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
        {currentModelInfo?.description && (
          <p className="text-[10px] text-muted-foreground/70 -mt-1">{currentModelInfo.description}</p>
        )}

        {/* Aspect Ratio + Image Size row */}
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <span className="text-[10px] text-muted-foreground block mb-0.5">宽高比</span>
            <select
              value={aspectRatio}
              onChange={handleAspectChange}
              className="w-full text-xs px-2 py-1 rounded-md border border-border bg-muted/30 outline-none cursor-pointer hover:bg-muted/50 transition-colors"
            >
              {(aspectRatioField?.options ?? [{ label: '1:1', value: '1:1' }]).map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div className="w-[70px]">
            <span className="text-[10px] text-muted-foreground block mb-0.5">分辨率</span>
            <select
              value={imageSize}
              onChange={handleSizeChange}
              className="w-full text-xs px-2 py-1 rounded-md border border-border bg-muted/30 outline-none cursor-pointer hover:bg-muted/50 transition-colors"
            >
              {(imageSizeField?.options ?? [{ label: '2K', value: '2k' }]).map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Reference Image indicator — shows when upstream crops are connected */}
        {hasRefImages && (
          <div className="text-[10px] text-green-600 bg-green-50 rounded px-2 py-1">
            角色参考图: {referenceImages?.length ?? 1} 张 (已连接)
          </div>
        )}

        {/* Reference Image */}
        <div>
          <span className="text-[10px] text-muted-foreground block mb-1">手动参考图</span>
          {referenceImage && !hasRefImages ? (
            <div className="relative group">
              <img src={referenceImage} alt="ref" className="w-full h-16 object-cover rounded-md border border-border" />
              <button
                onClick={handleRemoveRefImage}
                className="absolute top-1 right-1 w-4 h-4 bg-black/60 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full h-12 border border-dashed border-border rounded-md flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:bg-muted/30 hover:border-blue-300 transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              上传参考图
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleRefImageUpload}
            className="hidden"
          />
        </div>

        {/* Prompt Input */}
        <div className="relative">
          <textarea
            value={prompt}
            onChange={handlePromptChange}
            onKeyDown={handleSlashKeyDown}
            placeholder={referenceImage ? '描述如何编辑参考图... (输入 / 打开菜单)' : '输入图片描述提示词... (输入 / 打开菜单)'}
            rows={3}
            className="w-full text-xs rounded-md border border-border bg-muted/30 p-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400 placeholder:text-muted-foreground/50"
          />
          <SlashMenu
            visible={slashState.visible}
            anchorX={slashState.anchorX}
            anchorY={slashState.anchorY}
            onSelect={handleSlashSelect}
            onClose={closeSlash}
          />
        </div>

        {/* Error Message */}
        {errorMsg && (
          <div className="text-[10px] text-red-500 bg-red-50 rounded px-2 py-1 break-all">
            {errorMsg}
          </div>
        )}

        {/* Output Preview */}
        {displayImage && (
          <div
            className="rounded-md overflow-hidden border border-border cursor-zoom-in"
            onClick={() => window.open(outputImageUrl || outputImage!, '_blank')}
            title="点击查看原图"
          >
            <img src={displayImage} alt="output" className="w-full" />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border">
        <button
          onClick={handleGenerate}
          disabled={!prompt.trim() || status === 'generating'}
          className={`w-full py-1.5 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            status === 'generating'
              ? 'bg-yellow-100 text-yellow-700'
              : status === 'done'
              ? 'bg-green-500 text-white hover:bg-green-600'
              : 'bg-blue-500 text-white hover:bg-blue-600'
          }`}
        >
          {status === 'generating' ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> 生成中...</>
          ) : status === 'done' ? (
            <><Play className="w-3 h-3" /> 重新生成</>
          ) : referenceImage ? (
            <><Play className="w-3 h-3" /> 编辑图片</>
          ) : (
            <><Play className="w-3 h-3" /> 生成图片</>
          )}
        </button>
      </div>

      <Handle type="source" position={Position.Right} id="image-out" className="!w-3 !h-3 !bg-blue-500" />
    </div>
  )
}

export default memo(ImageGenNode)
