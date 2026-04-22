/**
 * ImageGenNode — LibTV-style image generation node.
 *
 * Mirror of VideoGenNode but for stills. Mode tabs switch between
 * 文生图 / 图生图 / 图片高清 / 图片参考 / 风格. First-class params are
 * aspect + resolution + count; everything else drops into the popover's
 * "更多参数" section (future work).
 */
import { memo, useCallback, useMemo, useRef } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  Image as ImageIcon, Upload, X, AlertTriangle, Loader2,
  ChevronDown, Palette, Tag, Camera, Mountain, Sparkles, HardDrive,
} from 'lucide-react'

import { useFlowStore } from '@/store/flowStore'
import { backendApi } from '@/api/backend'
import { DEFAULT_IMAGE_MODEL } from '@/providers/modelDefaults'
import type { ParamField } from '@/providers/types'
import { useBackendModels } from '@/hooks/useBackendModels'
import { useSlashMenu } from '@/hooks/useSlashMenu'
import SlashMenu, { type SlashCommand } from '@/components/canvas/SlashMenu'
import { sanitizeForExecute, sanitizeOnModelSwitch } from '@/providers/paramSanitizer'
import PromptInput from '@/components/ui/PromptInput'

import {
  NodeShell, PreviewArea, ModeTabs, ActionChips, NodeToolbar, SubmitButton,
  ParamPopover, AspectRatioPicker, SegmentedPicker,
  DEFAULT_IMAGE_RATIOS,
  type ModeTabItem, type ActionChipItem,
} from '@/components/nodes/_shell'

// ── Types ──

type ImageMode = 't2i' | 'i2i' | 'upscale' | 'img-ref' | 'style'

const MODE_TABS: ModeTabItem<ImageMode>[] = [
  { value: 't2i',     label: '文生图' },
  { value: 'i2i',     label: '图生图' },
  { value: 'upscale', label: '图片高清' },
  { value: 'img-ref', label: '图片参考' },
  { value: 'style',   label: '风格' },
]

function findField(schema: ParamField[], predicate: (f: ParamField) => boolean) {
  return schema.find(predicate)
}
function aspectField(schema: ParamField[]) {
  return findField(schema, f => /aspect|ratio/i.test(f.key))
}
function sizeField(schema: ParamField[]) {
  return findField(schema, f => /(size|resolution|quality)/i.test(f.key) && !/aspect/i.test(f.key))
}
function countField(schema: ParamField[]) {
  return findField(schema, f => /(n|count|num_images|batch)/i.test(f.key) && /^n|count|num|batch/i.test(f.key))
}

function ImageGenNode({ id, data }: NodeProps) {
  const { models: backendImageModels, error: modelsError, retry: retryModels } = useBackendModels('image')
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
  const modelId = String(data.model || DEFAULT_IMAGE_MODEL)
  const errorMsg = data.errorMsg ? String(data.errorMsg) : null
  const retryCount = Number(data.retryCount || 0)
  const mode = (data.imageMode as ImageMode) || 't2i'

  const fileInputRef = useRef<HTMLInputElement>(null)
  const updateNodeData = useFlowStore((s) => s.updateNodeData)
  const addNode = useFlowStore((s) => s.addNode)
  const nodes = useFlowStore((s) => s.nodes)
  const { slashState, handleSlashKeyDown, closeSlash } = useSlashMenu()

  // ── Dynamic param schema (from backend DB) ──
  const paramSchema: ParamField[] = useMemo(() => {
    const bm = backendImageModels.find(m => m.model_id === modelId)
    return (bm?.param_schema?.length ? bm.param_schema : []) as ParamField[]
  }, [modelId, backendImageModels])

  const currentModelInfo = useMemo(
    () => backendImageModels.find(m => m.model_id === modelId),
    [backendImageModels, modelId],
  )

  const aspectSchema = useMemo(() => aspectField(paramSchema), [paramSchema])
  const sizeSchema = useMemo(() => sizeField(paramSchema), [paramSchema])
  const cntSchema = useMemo(() => countField(paramSchema), [paramSchema])

  const aspectValue = aspectSchema ? String(data[aspectSchema.key] ?? aspectSchema.default ?? '1:1') : '1:1'
  const sizeValue = sizeSchema ? String(data[sizeSchema.key] ?? sizeSchema.default ?? '2k').toUpperCase() : '2K'
  const countValue = cntSchema ? Number(data[cntSchema.key] ?? cntSchema.default ?? 1) : 1

  const paramSummary = useMemo(() => {
    const parts: string[] = []
    if (aspectSchema) parts.push(aspectValue)
    if (sizeSchema) parts.push(sizeValue)
    return parts.join(' · ') || '参数'
  }, [aspectSchema, sizeSchema, aspectValue, sizeValue])

  const previewAspect = useMemo(() => {
    if (!aspectValue || aspectValue === 'auto' || aspectValue === '自适应') return '1/1'
    return aspectValue.replace(':', '/')
  }, [aspectValue])

  const ratioOptions = useMemo(() => {
    if (!aspectSchema?.options?.length) return DEFAULT_IMAGE_RATIOS
    const shapeFor = (v: string) => DEFAULT_IMAGE_RATIOS.find(r => r.value === v)?.shape || { w: 18, h: 14 }
    return aspectSchema.options.map(o => ({
      value: String(o.value),
      label: o.label,
      shape: shapeFor(String(o.value)),
    }))
  }, [aspectSchema])

  const sizeOptions = useMemo(() => {
    if (!sizeSchema?.options?.length) return [] as { value: string; label: string }[]
    return sizeSchema.options.map(o => ({
      value: String(o.value),
      label: o.label,
    }))
  }, [sizeSchema])

  // ── Handlers ──
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

  const handlePromptChange = useCallback((next: string) => {
    updateNodeData(id, { prompt: next })
  }, [id, updateNodeData])

  const extraAssetRefs = useMemo(
    () => (Array.isArray(data.assetRefs) ? (data.assetRefs as string[]) : []),
    [data.assetRefs],
  )
  const handleExtraRefsChange = useCallback((refs: string[]) => {
    updateNodeData(id, { assetRefs: refs })
  }, [id, updateNodeData])

  const handleModelChange = useCallback((newModelId: string) => {
    const bm = backendImageModels.find(m => m.model_id === newModelId)
    const schema = (bm?.param_schema?.length ? bm.param_schema : []) as ParamField[]
    const currentData = (nodes.find(n => n.id === id)?.data || {}) as Record<string, unknown>
    const { clean, removed } = sanitizeOnModelSwitch(currentData, schema)
    if (removed.length > 0) {
      const nullify: Record<string, unknown> = {}
      for (const k of removed) nullify[k] = undefined
      updateNodeData(id, { ...nullify, ...clean, model: newModelId })
    } else {
      updateNodeData(id, { ...clean, model: newModelId })
    }
  }, [id, updateNodeData, backendImageModels, nodes])

  const handleModeChange = useCallback((next: ImageMode) => {
    updateNodeData(id, { imageMode: next })
    // 图生图 and 图片高清 modes imply a reference image — auto-prompt for upload
    if ((next === 'i2i' || next === 'upscale') && !referenceImage && !hasRefImages) {
      fileInputRef.current?.click()
    }
  }, [id, updateNodeData, referenceImage, hasRefImages])

  const handleGhostConnect = useCallback((side: 'left' | 'right') => {
    const self = nodes.find(n => n.id === id)
    if (!self) return
    const offset = side === 'left' ? -340 : 340
    const position = { x: (self.position?.x ?? 0) + offset, y: self.position?.y ?? 0 }
    window.dispatchEvent(new CustomEvent('libtv-ghost-connect', {
      detail: { sourceNodeId: id, side, position },
    }))
  }, [nodes, id])

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

      const bm = backendImageModels.find(m => m.model_id === currentModel)
      const schema = (bm?.param_schema?.length ? bm.param_schema : []) as ParamField[]
      const params = sanitizeForExecute(data as Record<string, unknown>, schema)

      const res = await backendApi.generateImage({
        model_id: currentModel,
        prompt: currentPrompt,
        reference_images: refImages.length > 0 ? refImages : undefined,
        params,
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
  }, [id, data, status, updateNodeData, backendImageModels])

  // ── Action chips (quick accessors under the mode tabs) ──
  const actionChips: ActionChipItem[] = useMemo(() => ([
    { key: 'style',    icon: Palette,    label: '风格' },
    { key: 'tag',      icon: Tag,        label: '标记' },
    { key: 'camera',   icon: Camera,     label: '摄像机' },
    { key: 'panorama', icon: Mountain,   label: '全景' },
  ]), [])

  const emptySuggestions = useMemo(() => ([
    {
      icon: Upload,
      label: '图生图',
      onClick: () => handleModeChange('i2i'),
    },
    {
      icon: HardDrive,
      label: '图片高清',
      onClick: () => handleModeChange('upscale'),
    },
  ]), [handleModeChange])

  const paramDrawer = (
    <div className="space-y-4">
      {sizeSchema && sizeOptions.length > 0 && (
        <SegmentedPicker
          title="分辨率"
          options={sizeOptions}
          value={sizeValue.toLowerCase()}
          onChange={v => updateNodeData(id, { [sizeSchema.key]: v })}
        />
      )}
      {aspectSchema && (
        <AspectRatioPicker
          title="比例"
          ratios={ratioOptions}
          value={aspectValue}
          onChange={v => updateNodeData(id, { [aspectSchema.key]: v })}
          cols={5}
        />
      )}
    </div>
  )

  const isGenerating = status === 'generating'

  const labelRightSlot = (
    <div className="flex items-center gap-1">
      {(referenceImages?.length ?? 0) > 1 && (
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[hsl(var(--libtv-accent)/0.15)] text-[hsl(var(--libtv-accent))]">
          {referenceImages!.length}参考
        </span>
      )}
      {retryCount > 0 && (
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[hsl(var(--libtv-accent)/0.15)] text-[hsl(var(--libtv-accent))]">
          #{retryCount}
        </span>
      )}
      {status === 'done' && <span className="text-[hsl(var(--success))]">✓</span>}
      {status === 'error' && <AlertTriangle size={11} className="text-[hsl(var(--destructive))]" />}
    </div>
  )

  return (
    <NodeShell
      icon={<ImageIcon size={11} strokeWidth={2.5} />}
      label={label}
      labelRight={labelRightSlot}
      width={460}
      executing={isGenerating}
      ghostConnect={{ left: true, right: true }}
      onGhostConnect={handleGhostConnect}
    >
      {/* Handles — invisible by default, visible on hover */}
      <Handle type="target" position={Position.Left} id="prompt-in" style={{ top: '30%' }} />
      <Handle type="target" position={Position.Left} id="ref-in"    style={{ top: '50%' }} />
      <Handle type="target" position={Position.Left} id="style-in"  style={{ top: '70%' }} />
      <Handle type="source" position={Position.Right} id="image-out" />

      <div className="p-3 space-y-2.5">
        {/* ── 1. PREVIEW ── */}
        <PreviewArea
          aspect={previewAspect}
          placeholderIcon={Mountain}
          suggestions={displayImage || referenceImage ? undefined : emptySuggestions}
          loading={isGenerating && !displayImage}
        >
          {displayImage ? (
            <img
              src={displayImage}
              alt={label}
              className="absolute inset-0 w-full h-full object-cover cursor-zoom-in"
              onClick={() => window.open(outputImageUrl || outputImage!, '_blank')}
            />
          ) : referenceImage && !hasRefImages ? (
            /* Referenced image inline in preview — with remove button */
            <div className="absolute inset-0 flex items-center justify-center">
              <img src={referenceImage} alt="ref" className="max-w-full max-h-full object-contain" />
              <button
                type="button"
                onClick={handleRemoveRefImage}
                className="absolute top-2 right-2 w-6 h-6 bg-black/60 text-white rounded-full flex items-center justify-center hover:bg-black/80"
                aria-label="Remove reference"
              >
                <X size={12} />
              </button>
              <span className="absolute bottom-2 left-2 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">
                参考图 · {mode === 'upscale' ? '高清' : '图生图'}
              </span>
            </div>
          ) : null}
        </PreviewArea>

        {/* Hidden file input used by upload chip + mode auto-prompt */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleRefImageUpload}
          className="hidden"
        />

        {/* Reference images banner (when upstream characterGrid connected) */}
        {hasRefImages && (
          <div className="text-[10px] text-[hsl(var(--success))] bg-[hsl(var(--success)/0.08)] border border-[hsl(var(--success)/0.2)] rounded-lg px-2 py-1">
            ✓ 已连接 {referenceImages?.length ?? 1} 张角色/场景参考图
          </div>
        )}

        {/* ── 2. INPUT ── */}
        <div className="space-y-2">
          <ModeTabs tabs={MODE_TABS} value={mode} onChange={handleModeChange} />
          <ActionChips
            actions={[
              ...actionChips,
              {
                key: 'upload',
                icon: Upload,
                label: referenceImage ? '更换参考图' : '上传参考图',
                variant: 'ghost',
                onClick: () => fileInputRef.current?.click(),
                active: !!referenceImage,
              },
            ]}
          />

          <div className="relative">
            <PromptInput
              value={prompt}
              onChange={handlePromptChange}
              extraRefs={extraAssetRefs}
              onExtraRefsChange={handleExtraRefsChange}
              onKeyDown={handleSlashKeyDown}
              placeholder={referenceImage ? '描述如何编辑参考图，@引用素材' : '描述你想要生成的画面内容，@引用素材'}
              rows={3}
              className="libtv-prompt"
            />
            <SlashMenu
              visible={slashState.visible}
              anchorX={slashState.anchorX}
              anchorY={slashState.anchorY}
              onSelect={handleSlashSelect}
              onClose={closeSlash}
            />
          </div>
        </div>

        {/* ── 3. TOOLBAR ── */}
        <NodeToolbar
          left={
            <>
              <ParamPopover
                align="start"
                width={280}
                trigger={({ toggle }) => (
                  <button type="button" className="libtv-chip" onClick={toggle}>
                    <Sparkles size={12} strokeWidth={2} className="text-[hsl(var(--libtv-accent))]" />
                    <span className="truncate max-w-[120px]" title={currentModelInfo?.name || modelId}>
                      {currentModelInfo?.name || modelId}
                    </span>
                    <ChevronDown size={11} strokeWidth={2} />
                  </button>
                )}
              >
                <div className="space-y-0.5 max-h-[240px] overflow-y-auto">
                  {imageModels.length === 0 && (
                    <div className="text-[11px] text-[hsl(var(--libtv-muted))] p-2">加载模型列表...</div>
                  )}
                  {modelsError && (
                    <div className="text-[11px] text-[hsl(var(--destructive))] p-2 flex items-center justify-between">
                      <span>加载失败</span>
                      <button type="button" onClick={retryModels} className="underline">重试</button>
                    </div>
                  )}
                  {imageModels.map(m => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleModelChange(m.id)}
                      className={`w-full text-left px-2 py-1.5 rounded-md text-[11px] transition-colors ${
                        m.id === modelId
                          ? 'bg-[hsl(var(--libtv-accent)/0.15)] text-[hsl(var(--libtv-accent))]'
                          : 'hover:bg-[hsl(var(--libtv-chip-bg))]'
                      }`}
                    >
                      <div className="font-medium">{m.name}</div>
                      {m.description && (
                        <div className="text-[10px] text-[hsl(var(--libtv-muted))] truncate mt-0.5">
                          {m.description}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </ParamPopover>

              {(aspectSchema || sizeSchema) && (
                <ParamPopover
                  align="start"
                  width={340}
                  trigger={({ toggle }) => (
                    <button type="button" className="libtv-chip" onClick={toggle}>
                      <span className="w-3 h-2.5 rounded-sm border border-current opacity-70" />
                      <span>{paramSummary}</span>
                      <ChevronDown size={11} strokeWidth={2} />
                    </button>
                  )}
                >
                  {paramDrawer}
                </ParamPopover>
              )}

              {cntSchema && (
                <button type="button" className="libtv-chip" onClick={() => {
                  const next = countValue >= 4 ? 1 : countValue + 1
                  updateNodeData(id, { [cntSchema.key]: next })
                }}>
                  <span>{countValue}张</span>
                  <ChevronDown size={11} strokeWidth={2} />
                </button>
              )}
            </>
          }
          right={
            <SubmitButton
              onClick={handleGenerate}
              disabled={!prompt.trim() || isGenerating}
              loading={isGenerating}
            />
          }
        />

        {/* ── 4. SECONDARY BANNERS ── */}
        {errorMsg && (
          <div className="text-[10px] text-[hsl(var(--destructive))] bg-[hsl(var(--destructive)/0.08)] border border-[hsl(var(--destructive)/0.2)] rounded-lg px-2 py-1.5 break-all">
            {errorMsg}
          </div>
        )}
      </div>
    </NodeShell>
  )
}

export default memo(ImageGenNode)
