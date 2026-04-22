import { memo, useCallback, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { User, Play, Loader2, CheckCircle2, AlertCircle, Library } from 'lucide-react'
import { useFlowStore } from '@/store/flowStore'
import { backendApi } from '@/api/backend'
import { DEFAULT_IMAGE_MODEL } from '@/providers/modelDefaults'
import { characterSheetTemplate } from '@/prompts/templates/characterSheet'
import { renderTemplate } from '@/prompts/promptEngine'
import { useAssetStore } from '@/store/assetStore'

const ART_STYLES = ['anime', 'realistic', 'cartoon', 'watercolor', 'pixel art', 'comic book', '3D render']

function CharacterGridNode({ id, data, selected }: NodeProps) {
  const status = String(data.status || 'idle')
  const label = String(data.label || '角色九宫图')
  const charName = String(data.name || '')
  const charDesc = String(data.description || '')
  const style = String(data.style || 'anime')
  const outputImage = data.outputImage as string | null
  const outputImageUrl = data.outputImageUrl as string | null
  const displayImage = outputImage || outputImageUrl
  const errorMsg = data.errorMsg ? String(data.errorMsg) : null

  const updateNodeData = useFlowStore((s) => s.updateNodeData)
  const assetId = data.assetId as string | null | undefined
  const [savingToLibrary, setSavingToLibrary] = useState(false)
  const canSaveToLibrary = !assetId && charName.trim().length > 0 && charDesc.trim().length > 0
  const handleSaveToLibrary = useCallback(async () => {
    if (!canSaveToLibrary) return
    setSavingToLibrary(true)
    try {
      const refs: string[] = []
      if (outputImage) refs.push(outputImage)
      else if (outputImageUrl) refs.push(outputImageUrl)
      const created = await useAssetStore.getState().create({
        kind: 'character',
        name: charName,
        appearance: charDesc,
        reference_images: refs,
      })
      updateNodeData(id, { assetId: created.asset_id })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败'
      updateNodeData(id, { errorMsg: msg })
    } finally {
      setSavingToLibrary(false)
    }
  }, [canSaveToLibrary, charName, charDesc, outputImage, outputImageUrl, id, updateNodeData])

  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateNodeData(id, { name: e.target.value, label: `角色: ${e.target.value || '新角色'}` })
  }, [id, updateNodeData])

  const handleDescChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateNodeData(id, { description: e.target.value })
  }, [id, updateNodeData])

  const handleStyleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    updateNodeData(id, { style: e.target.value })
  }, [id, updateNodeData])

  const handleGenerate = useCallback(async () => {
    if (status === 'generating') return
    const name = String(data.name || '新角色')
    const desc = String(data.description || 'A character')
    const artStyle = String(data.style || 'anime')

    const prompt = renderTemplate(characterSheetTemplate.template, {
      character_name: name,
      character_description: desc,
      art_style: artStyle,
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
  }, [id, data.name, data.description, data.style, status, updateNodeData])

  const borderClass = status === 'generating'
    ? 'border-yellow-400 shadow-yellow-200/50 animate-pulse'
    : status === 'done'
    ? 'border-green-500 shadow-green-200/50'
    : status === 'error'
    ? 'border-red-500 shadow-red-200/50'
    : selected
    ? 'border-purple-500 shadow-purple-200'
    : 'border-border'

  return (
    <div className={`workflow-node bg-card border-2 rounded-xl shadow-lg w-[300px] transition-all duration-300 ${borderClass}`}>
      <Handle type="target" position={Position.Left} id="prompt-in" className="!w-3 !h-3 !bg-purple-500" />

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-purple-500/10 rounded-t-xl border-b border-border">
        <User className="w-4 h-4 text-purple-500" />
        <span className="font-semibold text-sm flex-1 truncate">{label}</span>
        {assetId ? (
          <span
            className="flex items-center gap-0.5 text-[9px] text-green-700 bg-green-500/15 border border-green-300/60 rounded-full px-1.5 py-0.5"
            title={`已保存到素材库：${assetId}`}
          >
            <Library className="w-2.5 h-2.5" />
            库内
          </span>
        ) : canSaveToLibrary ? (
          <button
            type="button"
            onClick={handleSaveToLibrary}
            disabled={savingToLibrary}
            className="flex items-center gap-0.5 text-[10px] font-medium text-purple-700 bg-purple-500/15 border border-purple-300/60 rounded-full px-2 py-0.5 hover:bg-purple-500/25 disabled:opacity-50"
            title="保存为素材库中的角色资产"
          >
            {savingToLibrary ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Library className="w-2.5 h-2.5" />}
            保存
          </button>
        ) : null}
        {status === 'done' && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
        {status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-red-500" />}
      </div>

      {/* Content */}
      <div className="p-3 space-y-2">
        {/* Character Name */}
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">角色名称</label>
          <input
            type="text"
            value={charName}
            onChange={handleNameChange}
            placeholder="例: 小明"
            className="w-full text-xs rounded-md border border-border bg-muted/30 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-400"
          />
        </div>

        {/* Character Description */}
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">角色描述</label>
          <textarea
            value={charDesc}
            onChange={handleDescChange}
            placeholder="描述角色外貌、服装、特征..."
            rows={2}
            className="w-full text-xs rounded-md border border-border bg-muted/30 p-2 resize-none focus:outline-none focus:ring-1 focus:ring-purple-400 placeholder:text-muted-foreground/50"
          />
        </div>

        {/* Art Style */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">画风</span>
          <select
            value={style}
            onChange={handleStyleChange}
            className="text-xs font-medium px-2 py-0.5 rounded border border-border bg-muted/30 outline-none cursor-pointer"
          >
            {ART_STYLES.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
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
            <img src={displayImage} alt="character grid" className="w-full" />
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
              : 'bg-purple-500 text-white hover:bg-purple-600'
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

      <Handle type="source" position={Position.Right} id="grid-out" className="!w-3 !h-3 !bg-purple-500" />
    </div>
  )
}

export default memo(CharacterGridNode)
