/**
 * VideoGenNode — LibTV-style video generation node.
 *
 * Redesigned around four structural zones:
 *   1. Label row  (tiny text above the card: "▶ 视频节点 N")
 *   2. Preview    (60% height, big playable video or guided empty state)
 *   3. Input      (mode tabs + quick action chips + prompt textarea)
 *   4. Toolbar    (model chip + aggregated param chip + submit button)
 *
 * All parameter tweaks happen in a pop-up drawer triggered by the param chip.
 * The chip label summarises the whole drawer ("16:9 · 720P · 5s").
 */

import { memo, useCallback, useMemo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  Play, Video, Film, ImagePlus, Layers, Tag, Aperture, ShieldCheck,
  Loader2, AlertTriangle, Volume2, VolumeX, Sparkles, ChevronDown,
} from 'lucide-react'

import { useFlowStore } from '@/store/flowStore'
import { useAssetStore } from '@/store/assetStore'
import { DEFAULT_VIDEO_MODEL } from '@/providers/modelDefaults'
import { useBackendModels } from '@/hooks/useBackendModels'
import { backendApi } from '@/api/backend'
import type { ParamField } from '@/providers/types'
import { useSlashMenu } from '@/hooks/useSlashMenu'
import SlashMenu, { type SlashCommand } from '@/components/canvas/SlashMenu'
import { sanitizeForExecute, sanitizeOnModelSwitch } from '@/providers/paramSanitizer'
import { resolvePromptRefs } from '@/providers/assetReferenceResolver'
import { injectVideoReferences } from '@/providers/modelReferenceAdapter'
import PromptInput from '@/components/ui/PromptInput'

import {
  NodeShell, PreviewArea, ModeTabs, ActionChips, NodeToolbar, SubmitButton,
  ParamPopover, AspectRatioPicker, SegmentedPicker, DurationSlider,
  DEFAULT_VIDEO_RATIOS,
  type ModeTabItem, type ActionChipItem,
} from '@/components/nodes/_shell'

// ── Types ──

type VideoMode = 't2v' | 'ref' | 'i2v' | 'fl-frames' | 'img-ref'

const MODE_TABS: ModeTabItem<VideoMode>[] = [
  { value: 't2v',       label: '文生视频' },
  { value: 'ref',       label: '全能参考' },
  { value: 'i2v',       label: '图生视频' },
  { value: 'fl-frames', label: '首尾帧' },
  { value: 'img-ref',   label: '图片参考' },
]

// ── Schema → picker field mapping helpers ──

/**
 * Schema fields come from the backend per-model `param_schema`. LibTV exposes
 * the four common ones (aspect / resolution / duration / audio) as first-class
 * pickers in the param popover. Anything else shows up under "更多参数".
 */
function findField(schema: ParamField[], predicate: (f: ParamField) => boolean) {
  return schema.find(predicate)
}

function aspectField(schema: ParamField[]) {
  return findField(schema, f => /aspect|ratio/i.test(f.key))
}
function resolutionField(schema: ParamField[]) {
  return findField(schema, f => /resolution|quality/i.test(f.key) && !/aspect/i.test(f.key))
}
function durationField(schema: ParamField[]) {
  return findField(schema, f => /duration|length/i.test(f.key))
}
function audioField(schema: ParamField[]) {
  return findField(schema, f => /audio|sound/i.test(f.key))
}

function VideoGenNode({ id, data }: NodeProps) {
  const { models: backendVideoModels, loading: modelsLoading, error: modelsError } = useBackendModels('video')

  // ── Derive state from node data ──
  const status = String(data.status || 'idle')
  const label = String(data.label || '视频节点')
  const prompt = String(data.prompt || '')
  const outputVideo = data.outputVideo as string | null
  const progress = Number(data.progress || 0)
  const modelId = String(data.model || DEFAULT_VIDEO_MODEL)
  const errorMsg = data.errorMsg ? String(data.errorMsg) : null
  const mode = (data.videoMode as VideoMode) || 't2v'

  // Visual refs on the node — computed for emptyStateGuide, not directly rendered
  const firstFrameImage = (data.firstFrameImage || data.firstFrameImageUrl) as string | null
  const lastFrameImage = (data.lastFrameImage || data.lastFrameImageUrl) as string | null
  const characterImage = (data.characterImage || data.characterUrl) as string | null
  const retryCount = Number(data.retryCount || 0)

  const updateNodeData = useFlowStore((s) => s.updateNodeData)
  const addNode = useFlowStore((s) => s.addNode)
  const nodes = useFlowStore((s) => s.nodes)

  // ── Dynamic param schema (from backend DB, single source of truth) ──
  const paramSchema: ParamField[] = useMemo(() => {
    const bm = backendVideoModels.find(m => m.model_id === modelId)
    return (bm?.param_schema?.length ? bm.param_schema : []) as ParamField[]
  }, [modelId, backendVideoModels])

  const currentModelInfo = useMemo(
    () => backendVideoModels.find(m => m.model_id === modelId),
    [backendVideoModels, modelId],
  )

  // ── Extract the four first-class fields + "rest" for the more-params section ──
  const aspectSchema = useMemo(() => aspectField(paramSchema), [paramSchema])
  const resolutionSchema = useMemo(() => resolutionField(paramSchema), [paramSchema])
  const durationSchema = useMemo(() => durationField(paramSchema), [paramSchema])
  const audioSchema = useMemo(() => audioField(paramSchema), [paramSchema])

  const aspectValue = aspectSchema ? String(data[aspectSchema.key] ?? aspectSchema.default ?? '16:9') : '16:9'
  const resolutionValue = resolutionSchema ? String(data[resolutionSchema.key] ?? resolutionSchema.default ?? '720P') : '720P'
  const durationValue = durationSchema ? Number(data[durationSchema.key] ?? durationSchema.default ?? 5) : 5
  const audioValue = audioSchema ? Boolean(data[audioSchema.key] ?? audioSchema.default ?? false) : false

  // Summary badge text ("16:9 · 720P · 5s")
  const paramSummary = useMemo(() => {
    const parts: string[] = []
    if (aspectSchema) parts.push(aspectValue)
    if (resolutionSchema) parts.push(String(resolutionValue).toUpperCase())
    if (durationSchema) parts.push(`${durationValue}s`)
    return parts.join(' · ') || '参数'
  }, [aspectSchema, resolutionSchema, durationSchema, aspectValue, resolutionValue, durationValue])

  // Aspect ratio of the preview area — keep in sync with user's selected value
  const previewAspect = useMemo(() => {
    if (!aspectValue || aspectValue === 'auto') return '16/9'
    return aspectValue.replace(':', '/')
  }, [aspectValue])

  // Available ratios / resolutions / durations (fall back to defaults if schema is sparse)
  const ratioOptions = useMemo(() => {
    if (!aspectSchema?.options?.length) return DEFAULT_VIDEO_RATIOS
    const shapeFor = (v: string) => DEFAULT_VIDEO_RATIOS.find(r => r.value === v)?.shape || { w: 18, h: 14 }
    return aspectSchema.options.map(o => ({
      value: String(o.value),
      label: o.label,
      shape: shapeFor(String(o.value)),
    }))
  }, [aspectSchema])

  const resolutionOptions = useMemo(() => {
    if (!resolutionSchema?.options?.length) return []
    return resolutionSchema.options.map(o => ({
      value: String(o.value),
      label: o.label,
    }))
  }, [resolutionSchema])

  const durationSteps = useMemo(() => {
    if (!durationSchema) return undefined
    if (durationSchema.type === 'select' && durationSchema.options?.length) {
      return durationSchema.options.map(o => Number(o.value)).filter(n => !Number.isNaN(n))
    }
    // No discrete steps — DurationSlider will use min/max from the schema
    return undefined
  }, [durationSchema])

  // ── Event handlers ──
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

  const handleModelChange = useCallback((newModelId: string) => {
    const bm = backendVideoModels.find(m => m.model_id === newModelId)
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
  }, [id, updateNodeData, backendVideoModels, nodes])

  const handleModeChange = useCallback((next: VideoMode) => {
    updateNodeData(id, { videoMode: next })
  }, [id, updateNodeData])

  const handleGhostConnect = useCallback((side: 'left' | 'right') => {
    // Trigger the global Quick-Node panel so user can pick what to connect
    const self = nodes.find(n => n.id === id)
    if (!self) return
    const offset = side === 'left' ? -340 : 340
    const position = { x: (self.position?.x ?? 0) + offset, y: self.position?.y ?? 0 }
    // Emit the same event used by the canvas's QuickNodePanel keyboard shortcut.
    // Users can then drop a suitable upstream/downstream node into place.
    window.dispatchEvent(new CustomEvent('libtv-ghost-connect', {
      detail: { sourceNodeId: id, side, position },
    }))
  }, [nodes, id])

  const handleGenerate = useCallback(async () => {
    const currentPrompt = String(data.prompt || '')
    if (!currentPrompt.trim()) return
    if (status === 'generating') return

    const currentModel = String(data.model || DEFAULT_VIDEO_MODEL)
    updateNodeData(id, { status: 'generating', errorMsg: null, outputVideo: null, progress: 0 })

    try {
      // 1) Resolve @assetId tokens in the prompt → expanded text + aggregated refs
      const assetStore = useAssetStore.getState()
      const refList = Array.isArray(data.assetRefs) ? (data.assetRefs as string[]) : []
      const resolved = resolvePromptRefs(currentPrompt, assetStore, refList)

      // 2) Gather explicit first/last frames from the node itself
      const existingImages: string[] = []
      const firstFrame = (data.firstFrameImage || data.firstFrameImageUrl) as string | undefined
      const lastFrame = (data.lastFrameImage || data.lastFrameImageUrl) as string | undefined
      if (firstFrame) existingImages.push(firstFrame)
      if (lastFrame) existingImages.push(lastFrame)

      // 3) Pick schema for sanitizer + adapter
      const bm = backendVideoModels.find(m => m.model_id === currentModel)
      const schema = (bm?.param_schema?.length ? bm.param_schema : []) as ParamField[]

      // 4) Model-specific injection: reference images → correct fields for this model
      const adaptation = injectVideoReferences(currentModel, schema, {
        referenceImages: resolved.referenceImages,
        characterUrls: resolved.characterUrls,
        timestamps: resolved.timestamps,
        existingImages,
      })

      // Surface adapter notes + unresolved tokens to the node itself so the
      // user can see truncation/ignored-field warnings without opening devtools.
      updateNodeData(id, {
        adapterNotes: adaptation.notes.length > 0 ? adaptation.notes : undefined,
        unresolvedRefs: resolved.unresolved.length > 0 ? resolved.unresolved : undefined,
      })
      if (adaptation.notes.length > 0) {
        console.debug('[VideoGenNode] adapter notes:', adaptation.notes)
      }
      if (resolved.unresolved.length > 0) {
        console.warn('[VideoGenNode] unresolved asset tokens:', resolved.unresolved)
      }

      // 5) Merge node-driven params with adapter-added params, then sanitize
      const mergedParams = { ...(data as Record<string, unknown>), ...adaptation.params }
      const params = sanitizeForExecute(mergedParams, schema)
      // adapter fields may be schema-absent (e.g. sora characterUrl) → re-inject after sanitize
      for (const [key, value] of Object.entries(adaptation.params)) {
        if (!(key in params)) params[key] = value
      }

      const res = await backendApi.submitVideo({
        model_id: currentModel,
        prompt: resolved.expandedPrompt,
        images: adaptation.images.length > 0 ? adaptation.images : undefined,
        params,
      })
      updateNodeData(id, { taskId: res.task_id })

      // Start polling
      const pollInterval = setInterval(async () => {
        try {
          const taskStatus = await backendApi.queryTask(res.task_id)
          updateNodeData(id, {
            status: taskStatus.status === 'completed' ? 'done'
              : taskStatus.status === 'failed' ? 'error'
              : 'generating',
            progress: taskStatus.progress || 0,
            outputVideo: taskStatus.output_url || null,
            errorMsg: taskStatus.error || null,
          })
          if (taskStatus.status === 'completed' || taskStatus.status === 'failed') {
            clearInterval(pollInterval)
          }
        } catch (pollErr) {
          console.warn('[VideoGenNode] Poll error:', pollErr)
        }
      }, 5000)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生成失败'
      updateNodeData(id, { status: 'error', errorMsg: msg })
    }
  }, [id, data, status, updateNodeData, backendVideoModels])

  // ── Suggested actions (quick-start chips under the mode tabs) ──
  const actionChips: ActionChipItem[] = useMemo(() => ([
    { key: 'tag',      icon: Tag,          label: '标记' },
    { key: 'camera',   icon: Aperture,     label: '运镜' },
    { key: 'character',icon: ShieldCheck,  label: '角色库' },
  ]), [])

  // ── Empty state suggestions (shown when no output yet) ──
  const emptySuggestions = useMemo(() => ([
    {
      icon: Layers,
      label: '首尾帧生成视频',
      onClick: () => handleModeChange('fl-frames'),
    },
    {
      icon: Sparkles,
      label: '首帧生成视频',
      onClick: () => handleModeChange('i2v'),
    },
  ]), [handleModeChange])

  // Param popover content, toggled via the summary chip
  const paramDrawer = (
    <div className="space-y-4">
      {aspectSchema && (
        <AspectRatioPicker
          title="比例"
          ratios={ratioOptions}
          value={aspectValue}
          onChange={v => updateNodeData(id, { [aspectSchema.key]: v })}
          cols={5}
        />
      )}
      {resolutionSchema && resolutionOptions.length > 0 && (
        <SegmentedPicker
          title="清晰度"
          options={resolutionOptions}
          value={resolutionValue}
          onChange={v => updateNodeData(id, { [resolutionSchema.key]: v })}
        />
      )}
      {durationSchema && (
        <DurationSlider
          title="视频时长"
          value={durationValue}
          onChange={v => updateNodeData(id, { [durationSchema.key]: v })}
          min={durationSchema.min ?? 1}
          max={durationSchema.max ?? 30}
          steps={durationSteps}
        />
      )}
      {audioSchema && (
        <SegmentedPicker
          title="生成音频"
          options={[{ value: 'on', label: '开启' }, { value: 'off', label: '关闭' }]}
          value={audioValue ? 'on' : 'off'}
          onChange={v => updateNodeData(id, { [audioSchema.key]: v === 'on' })}
        />
      )}
    </div>
  )

  // ── Render ──
  const inputHasFrames = !!(firstFrameImage || lastFrameImage || characterImage)
  const isGenerating = status === 'generating'

  // Icon + label for the header row
  const labelRightSlot = (
    <div className="flex items-center gap-1">
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
      icon={<Play size={11} strokeWidth={2.5} />}
      label={label}
      labelRight={labelRightSlot}
      width={460}
      executing={isGenerating}
      ghostConnect={{ left: true, right: true }}
      onGhostConnect={handleGhostConnect}
    >
      {/* Connection handles — invisible by default, visible on hover (see .libtv-node .react-flow__handle) */}
      <Handle type="target" position={Position.Left} id="prompt-in"    style={{ top: '30%' }} />
      <Handle type="target" position={Position.Left} id="first-frame"  style={{ top: '45%' }} />
      <Handle type="target" position={Position.Left} id="last-frame"   style={{ top: '55%' }} />
      <Handle type="target" position={Position.Left} id="character-in" style={{ top: '65%' }} />
      <Handle type="source" position={Position.Right} id="video-out" />

      <div className="p-3 space-y-2.5">
        {/* ── 1. PREVIEW ── */}
        <PreviewArea
          aspect={previewAspect}
          placeholderIcon={Film}
          suggestions={outputVideo || inputHasFrames ? undefined : emptySuggestions}
          loading={isGenerating && !outputVideo}
          cornerOverlay={isGenerating ? (
            <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-black/60 backdrop-blur-sm text-white text-[10px] font-mono">
              <Loader2 size={10} className="animate-spin" />
              {progress}%
            </div>
          ) : undefined}
        >
          {outputVideo ? (
            <video
              src={outputVideo}
              controls
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : inputHasFrames ? (
            <div className="absolute inset-0 grid grid-cols-3 gap-1.5 p-2">
              {[
                { img: firstFrameImage, label: '首帧' },
                { img: lastFrameImage, label: '尾帧' },
                { img: characterImage, label: '角色' },
              ].map((slot, i) =>
                slot.img ? (
                  <div key={i} className="relative rounded-md overflow-hidden bg-black/20">
                    <img src={slot.img} alt={slot.label} className="w-full h-full object-cover" />
                    <span className="absolute bottom-0.5 left-0.5 text-[9px] px-1 rounded bg-black/60 text-white">{slot.label}</span>
                  </div>
                ) : (
                  <div key={i} className="rounded-md border border-dashed border-[hsl(var(--libtv-muted)/0.25)] flex items-center justify-center">
                    <ImagePlus size={14} className="text-[hsl(var(--libtv-muted)/0.4)]" />
                  </div>
                ),
              )}
            </div>
          ) : null}
        </PreviewArea>

        {/* ── 2. INPUT ── */}
        <div className="space-y-2">
          <ModeTabs tabs={MODE_TABS} value={mode} onChange={handleModeChange} />
          <ActionChips actions={actionChips} />

          <div className="relative">
            <PromptInput
              value={prompt}
              onChange={handlePromptChange}
              extraRefs={extraAssetRefs}
              onExtraRefsChange={handleExtraRefsChange}
              onKeyDown={handleSlashKeyDown}
              placeholder="描述你想要生成的画面内容，@引用素材"
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
              {/* Model picker chip (opens a list popover) */}
              <ParamPopover
                align="start"
                width={280}
                trigger={({ toggle }) => (
                  <button type="button" className="libtv-chip" onClick={toggle}>
                    <Video size={12} strokeWidth={2} className="text-[hsl(var(--libtv-accent))]" />
                    <span className="truncate max-w-[120px]" title={currentModelInfo?.name || modelId}>
                      {currentModelInfo?.name || modelId}
                    </span>
                    <ChevronDown size={11} strokeWidth={2} />
                  </button>
                )}
              >
                <div className="space-y-0.5 max-h-[240px] overflow-y-auto">
                  {modelsLoading && backendVideoModels.length === 0 && (
                    <div className="text-[11px] text-[hsl(var(--libtv-muted))] p-2">加载模型列表...</div>
                  )}
                  {modelsError && (
                    <div className="text-[11px] text-[hsl(var(--destructive))] p-2">
                      模型列表加载失败，使用默认值
                    </div>
                  )}
                  {backendVideoModels.map(m => (
                    <button
                      key={m.model_id}
                      type="button"
                      onClick={() => handleModelChange(m.model_id)}
                      className={`w-full text-left px-2 py-1.5 rounded-md text-[11px] transition-colors ${
                        m.model_id === modelId
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

              {/* Aggregated param summary chip — opens the param drawer */}
              {(aspectSchema || resolutionSchema || durationSchema || audioSchema) && (
                <ParamPopover
                  align="start"
                  width={340}
                  trigger={({ toggle }) => (
                    <button type="button" className="libtv-chip" onClick={toggle}>
                      <span className="w-3 h-2.5 rounded-sm border border-current opacity-70" />
                      <span>{paramSummary}</span>
                      {audioSchema && (
                        audioValue
                          ? <Volume2 size={11} strokeWidth={2} />
                          : <VolumeX size={11} strokeWidth={2} className="opacity-50" />
                      )}
                      <ChevronDown size={11} strokeWidth={2} />
                    </button>
                  )}
                >
                  {paramDrawer}
                </ParamPopover>
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

        {/* ── 4. SECONDARY BANNERS (adapter notes / unresolved / error) ── */}
        {Array.isArray(data.adapterNotes) && (data.adapterNotes as string[]).length > 0 && (
          <div className="text-[10px] text-[hsl(var(--warning))] bg-[hsl(var(--warning)/0.08)] border border-[hsl(var(--warning)/0.2)] rounded-lg px-2 py-1.5 space-y-0.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">⚠ 模型适配提示</span>
              <button
                type="button"
                onClick={() => updateNodeData(id, { adapterNotes: undefined })}
                className="opacity-70 hover:opacity-100"
                aria-label="关闭提示"
              >
                ✕
              </button>
            </div>
            {(data.adapterNotes as string[]).map((note, i) => (
              <div key={i} className="leading-tight break-all">· {note}</div>
            ))}
          </div>
        )}

        {Array.isArray(data.unresolvedRefs) && (data.unresolvedRefs as string[]).length > 0 && (
          <div className="text-[10px] text-[hsl(var(--warning))] bg-[hsl(var(--warning)/0.08)] border border-[hsl(var(--warning)/0.2)] rounded-lg px-2 py-1.5">
            <div className="font-medium">⚠ 未解析引用: {(data.unresolvedRefs as string[]).map(t => `@${t}`).join(', ')}</div>
            <div className="opacity-70 leading-tight mt-0.5">请检查素材是否被删除，或在素材库中重新绑定</div>
          </div>
        )}

        {errorMsg && (
          <div className="text-[10px] text-[hsl(var(--destructive))] bg-[hsl(var(--destructive)/0.08)] border border-[hsl(var(--destructive)/0.2)] rounded-lg px-2 py-1.5 break-all">
            {errorMsg}
          </div>
        )}
      </div>
    </NodeShell>
  )
}

export default memo(VideoGenNode)
