/**
 * CharacterGridNode — LibTV-style 3×3 character reference sheet.
 *
 * The node generates a single 3×3 grid image (front/side/back/etc.) of the
 * character for use as a reference in downstream imageGen / videoGen.
 *
 * LibTV visual treatment: preview occupies ~square area showing the grid
 * image, name + description inputs stack under it, style picker becomes a
 * popover chip in the toolbar, and the "Save to Library" action is a chip
 * in the label-right slot.
 */

import { memo, useCallback, useMemo, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  User, Library, Loader2, AlertTriangle, Palette, ChevronDown, Users,
} from 'lucide-react'

import { useFlowStore } from '@/store/flowStore'
import { useAssetStore } from '@/store/assetStore'
import { backendApi } from '@/api/backend'
import { DEFAULT_IMAGE_MODEL } from '@/providers/modelDefaults'
import { characterSheetTemplate } from '@/prompts/templates/characterSheet'
import { renderTemplate } from '@/prompts/promptEngine'

import {
  NodeShell, PreviewArea, NodeToolbar, SubmitButton, ParamPopover,
  SegmentedPicker,
} from '@/components/nodes/_shell'

const ART_STYLES = [
  { value: 'anime',       label: '动漫' },
  { value: 'realistic',   label: '写实' },
  { value: 'cartoon',     label: '卡通' },
  { value: 'watercolor',  label: '水彩' },
  { value: 'pixel art',   label: '像素' },
  { value: 'comic book',  label: '漫画' },
  { value: '3D render',   label: '3D' },
]

function CharacterGridNode({ id, data }: NodeProps) {
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

  const isGenerating = status === 'generating'
  const nodes = useFlowStore(s => s.nodes)
  const handleGhostConnect = useCallback((side: 'left' | 'right') => {
    const self = nodes.find(n => n.id === id)
    if (!self) return
    const offset = side === 'left' ? -340 : 340
    const position = { x: (self.position?.x ?? 0) + offset, y: self.position?.y ?? 0 }
    window.dispatchEvent(new CustomEvent('libtv-ghost-connect', {
      detail: { sourceNodeId: id, side, position },
    }))
  }, [nodes, id])

  const currentStyleLabel = useMemo(
    () => ART_STYLES.find(s => s.value === style)?.label || style,
    [style],
  )

  const labelRightSlot = (
    <div className="flex items-center gap-1">
      {assetId ? (
        <span
          className="flex items-center gap-0.5 text-[9px] text-[hsl(var(--success))] bg-[hsl(var(--success)/0.15)] border border-[hsl(var(--success)/0.3)] rounded-full px-1.5 py-0.5"
          title={`已保存：${assetId}`}
        >
          <Library size={9} strokeWidth={2.5} />
          库内
        </span>
      ) : canSaveToLibrary ? (
        <button
          type="button"
          onClick={handleSaveToLibrary}
          disabled={savingToLibrary}
          className="flex items-center gap-0.5 text-[9px] font-medium text-[hsl(var(--libtv-accent))] bg-[hsl(var(--libtv-accent)/0.15)] border border-[hsl(var(--libtv-accent)/0.3)] rounded-full px-1.5 py-0.5 hover:bg-[hsl(var(--libtv-accent)/0.25)] disabled:opacity-50"
        >
          {savingToLibrary ? <Loader2 size={9} className="animate-spin" /> : <Library size={9} strokeWidth={2.5} />}
          入库
        </button>
      ) : null}
      {status === 'done' && <span className="text-[hsl(var(--success))]">✓</span>}
      {status === 'error' && <AlertTriangle size={11} className="text-[hsl(var(--destructive))]" />}
    </div>
  )

  return (
    <NodeShell
      icon={<Users size={11} strokeWidth={2.5} />}
      label={label}
      labelRight={labelRightSlot}
      width={380}
      executing={isGenerating}
      ghostConnect={{ left: true, right: true }}
      onGhostConnect={handleGhostConnect}
    >
      <Handle type="target" position={Position.Left} id="prompt-in" />
      <Handle type="source" position={Position.Right} id="grid-out" />

      <div className="p-3 space-y-2.5">
        {/* ── 1. PREVIEW (square, hosts the 3x3 grid) ── */}
        <PreviewArea
          aspect="1/1"
          placeholderIcon={User}
          loading={isGenerating && !displayImage}
        >
          {displayImage && (
            <img
              src={displayImage}
              alt="character grid"
              className="absolute inset-0 w-full h-full object-cover cursor-zoom-in"
              onClick={() => window.open(outputImageUrl || outputImage!, '_blank')}
            />
          )}
        </PreviewArea>

        {/* ── 2. INPUT ── */}
        <div className="space-y-1.5">
          <input
            type="text"
            value={charName}
            onChange={handleNameChange}
            placeholder="角色名称（例：小明）"
            className="libtv-input"
          />
          <textarea
            value={charDesc}
            onChange={handleDescChange}
            placeholder="描述角色外貌、服装、特征..."
            rows={3}
            className="libtv-prompt"
          />
        </div>

        {/* ── 3. TOOLBAR ── */}
        <NodeToolbar
          left={
            <ParamPopover
              align="start"
              width={280}
              trigger={({ toggle }) => (
                <button type="button" className="libtv-chip" onClick={toggle}>
                  <Palette size={12} strokeWidth={2} className="text-[hsl(var(--libtv-accent))]" />
                  <span>{currentStyleLabel}</span>
                  <ChevronDown size={11} strokeWidth={2} />
                </button>
              )}
            >
              <SegmentedPicker
                title="画风"
                options={ART_STYLES}
                value={style}
                onChange={v => updateNodeData(id, { style: v })}
                cols={4}
              />
            </ParamPopover>
          }
          right={
            <SubmitButton
              onClick={handleGenerate}
              disabled={isGenerating}
              loading={isGenerating}
            />
          }
        />

        {errorMsg && (
          <div className="text-[10px] text-[hsl(var(--destructive))] bg-[hsl(var(--destructive)/0.08)] border border-[hsl(var(--destructive)/0.2)] rounded-lg px-2 py-1.5 break-all">
            {errorMsg}
          </div>
        )}
      </div>
    </NodeShell>
  )
}

export default memo(CharacterGridNode)
