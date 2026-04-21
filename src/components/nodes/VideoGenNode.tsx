import { memo, useCallback, useMemo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Video, Play, Loader2, CheckCircle2, AlertCircle, ImagePlus, Dices } from 'lucide-react'
import { useFlowStore } from '@/store/flowStore'
import { DEFAULT_VIDEO_MODEL } from '@/providers/modelDefaults'
import { useBackendModels } from '@/hooks/useBackendModels'
import { backendApi } from '@/api/backend'
import type { ModelInfo, ParamField } from '@/providers/types'
import { useSlashMenu } from '@/hooks/useSlashMenu'
import SlashMenu, { type SlashCommand } from '@/components/canvas/SlashMenu'

// ── Toggle Switch ──
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer select-none group">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={`relative w-7 h-[15px] rounded-full transition-colors duration-200 ${
          checked ? 'bg-rose-500' : 'bg-muted-foreground/20'
        }`}
      >
        <span className={`absolute top-[1.5px] w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? 'translate-x-[13px]' : 'translate-x-[1.5px]'
        }`} />
      </button>
      <span className="text-[10px] text-muted-foreground group-hover:text-foreground transition-colors">{label}</span>
    </label>
  )
}

// ── Image Input Zone ──
function ImageZone({ label, image, color = 'border-muted-foreground/20', onClick }: {
  label: string; image: string | null; color?: string; onClick?: () => void
}) {
  return (
    <div
      className={`flex flex-col items-center gap-0.5 ${ image ? 'cursor-zoom-in' : 'cursor-default'}`}
      onClick={image ? onClick : undefined}
      title={image ? `点击查看${label}` : `等待${label}连接`}
    >
      <div className={`w-[52px] h-[52px] rounded-lg border-[1.5px] transition-colors ${
        image
          ? 'border-border overflow-hidden'
          : `border-dashed ${color} flex items-center justify-center bg-muted/20`
      }`}>
        {image ? (
          <img src={image} alt={label} className="w-full h-full object-cover" />
        ) : (
          <ImagePlus className="w-3.5 h-3.5 text-muted-foreground/30" />
        )}
      </div>
      <span className="text-[9px] text-muted-foreground/50 leading-none">{label}</span>
    </div>
  )
}

// ── Dynamic param renderer ──
function DynamicParams({ schema, data, onChange }: {
  schema: ParamField[]
  data: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
}) {
  if (!schema.length) return null

  const selectFields = schema.filter(f => f.type === 'select')
  const sliderFields = schema.filter(f => f.type === 'slider')
  const numberFields = schema.filter(f => f.type === 'number')
  const boolFields = schema.filter(f => f.type === 'boolean')
  const textFields = schema.filter(f => f.type === 'textarea' || f.type === 'string')

  return (
    <>
      {/* Select fields in 2-col grid */}
      {selectFields.length > 0 && (
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          {selectFields.map(field => (
            <div key={field.key}>
              <span className="text-[10px] text-muted-foreground/70 block mb-0.5">{field.label}</span>
              <select
                value={String(data[field.key] ?? field.default ?? '')}
                onChange={e => {
                  const opt = field.options?.find(o => String(o.value) === e.target.value)
                  onChange(field.key, opt ? opt.value : e.target.value)
                }}
                className="w-full text-xs px-2 py-[5px] rounded border border-border/60 bg-muted/20 outline-none cursor-pointer hover:border-border transition-colors"
              >
                {field.options?.map(o => (
                  <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Slider fields */}
      {sliderFields.map(field => (
        <div key={field.key}>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] text-muted-foreground/70">{field.label}</span>
            <span className="text-[10px] font-mono font-medium text-foreground tabular-nums">
              {Number(data[field.key] ?? field.default ?? 0)}{field.key.includes('duration') ? 's' : ''}
            </span>
          </div>
          <input
            type="range"
            value={Number(data[field.key] ?? field.default ?? 0)}
            onChange={e => onChange(field.key, Number(e.target.value))}
            min={field.min ?? 1}
            max={field.max ?? 30}
            step={field.step ?? 1}
            className="w-full h-1 accent-rose-500 cursor-pointer"
          />
        </div>
      ))}

      {/* Number input fields with seed randomize */}
      {numberFields.map(field => (
        <div key={field.key} className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground/70">{field.label}</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={Number(data[field.key] ?? field.default ?? 0)}
              onChange={e => onChange(field.key, Number(e.target.value))}
              min={field.min}
              max={field.max}
              step={field.step}
              className="w-20 text-xs px-2 py-[3px] rounded border border-border/60 bg-muted/20 outline-none text-right tabular-nums"
            />
            {field.key === 'seed' && (
              <button
                type="button"
                onClick={() => onChange(field.key, Math.floor(Math.random() * 2147483647))}
                className="p-1 rounded hover:bg-muted/50 text-muted-foreground/50 hover:text-foreground transition-colors"
                title="随机种子"
              >
                <Dices className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      ))}

      {/* Boolean fields as toggle switches */}
      {boolFields.length > 0 && (
        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
          {boolFields.map(field => (
            <Toggle
              key={field.key}
              checked={Boolean(data[field.key] ?? field.default ?? false)}
              onChange={() => onChange(field.key, !(data[field.key] ?? field.default ?? false))}
              label={field.label}
            />
          ))}
        </div>
      )}

      {/* Text/string fields */}
      {textFields.map(field => (
        <div key={field.key}>
          <span className="text-[10px] text-muted-foreground/70 block mb-0.5">{field.label}</span>
          {field.type === 'textarea' ? (
            <textarea
              value={String(data[field.key] ?? field.default ?? '')}
              onChange={e => onChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              rows={2}
              className="w-full text-xs rounded border border-border/60 bg-muted/20 p-2 resize-none focus:outline-none focus:border-rose-400/60 placeholder:text-muted-foreground/30"
            />
          ) : (
            <input
              type="text"
              value={String(data[field.key] ?? field.default ?? '')}
              onChange={e => onChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              className="w-full text-xs px-2 py-[5px] rounded border border-border/60 bg-muted/20 outline-none focus:border-rose-400/60 placeholder:text-muted-foreground/30"
            />
          )}
        </div>
      ))}
    </>
  )
}

function VideoGenNode({ id, data, selected }: NodeProps) {
  const { models: backendVideoModels } = useBackendModels('video')
  const ALL_VIDEO_MODELS = useMemo(() => {
    if (backendVideoModels.length > 0) {
      return backendVideoModels.map(m => ({
        id: m.model_id, name: m.name, provider: m.provider,
        capabilities: [m.capability] as ModelInfo['capabilities'],
        description: m.description,
      }))
    }
    return [{ id: DEFAULT_VIDEO_MODEL, name: DEFAULT_VIDEO_MODEL, provider: 'Backend', capabilities: ['video'] as ModelInfo['capabilities'], description: '' }]
  }, [backendVideoModels])

  const status = String(data.status || 'idle')
  const label = String(data.label || '视频生成')
  const prompt = String(data.prompt || '')
  const outputVideo = data.outputVideo as string | null
  const progress = Number(data.progress || 0)
  const modelId = String(data.model || DEFAULT_VIDEO_MODEL)
  const errorMsg = data.errorMsg ? String(data.errorMsg) : null
  const taskId = data.taskId ? String(data.taskId) : null
  const firstFrameImage = data.firstFrameImage as string | null
  const firstFrameImageUrl = data.firstFrameImageUrl as string | null
  const displayFirstFrame = firstFrameImage || firstFrameImageUrl
  const lastFrameImage = data.lastFrameImage as string | null
  const lastFrameImageUrl = data.lastFrameImageUrl as string | null
  const displayLastFrame = lastFrameImage || lastFrameImageUrl
  const characterUrl = data.characterUrl as string | null
  const characterImage = data.characterImage as string | null
  const displayCharacter = characterImage || characterUrl
  const retryCount = Number(data.retryCount || 0)

  const updateNodeData = useFlowStore((s) => s.updateNodeData)

  // Dynamic param schema — purely from backend DB (single source of truth)
  const paramSchema: ParamField[] = useMemo(() => {
    const bm = backendVideoModels.find(m => m.model_id === modelId)
    return (bm?.param_schema?.length ? bm.param_schema : []) as ParamField[]
  }, [modelId, backendVideoModels])

  // Model capabilities / description — from backend DB
  const modelCaps = useMemo(() => {
    const bm = backendVideoModels.find(m => m.model_id === modelId)
    return bm?.description || ''
  }, [modelId, backendVideoModels])

  // Compact param summary badges (e.g. "16:9 · 720P · 5s")
  const paramSummaryParts = useMemo(() => {
    const parts: string[] = []
    for (const field of paramSchema) {
      if (field.key === 'seed') continue
      const val = data[field.key] ?? field.default
      if (val === undefined || val === null || val === '') continue
      if (field.type === 'boolean') { if (val) parts.push(field.label) }
      else if (field.key.includes('duration')) parts.push(`${val}s`)
      else if (field.type === 'string' || field.type === 'textarea') continue
      else { const s = String(val); parts.push(s.match(/\d+p$/i) ? s.toUpperCase() : s) }
    }
    return parts
  }, [paramSchema, data])

  const handlePromptChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateNodeData(id, { prompt: e.target.value })
  }, [id, updateNodeData])

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

  const handleModelChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModelId = e.target.value
    const bm = backendVideoModels.find(m => m.model_id === newModelId)
    const schema = (bm?.param_schema?.length ? bm.param_schema : []) as ParamField[]
    const defaults: Record<string, unknown> = { model: newModelId }
    for (const field of schema) {
      if (field.default !== undefined) defaults[field.key] = field.default
    }
    updateNodeData(id, defaults)
  }, [id, updateNodeData, backendVideoModels])

  const handleParamChange = useCallback((key: string, value: unknown) => {
    updateNodeData(id, { [key]: value })
  }, [id, updateNodeData])

  const handleGenerate = useCallback(async () => {
    const currentPrompt = String(data.prompt || '')
    if (!currentPrompt.trim()) return
    if (status === 'generating') return

    const currentModel = String(data.model || DEFAULT_VIDEO_MODEL)
    updateNodeData(id, { status: 'generating', errorMsg: null, outputVideo: null, progress: 0 })

    try {
      const images: string[] = []
      const firstFrame = (data.firstFrameImage || data.firstFrameImageUrl) as string | undefined
      const lastFrame = (data.lastFrameImage || data.lastFrameImageUrl) as string | undefined
      if (firstFrame) images.push(firstFrame)
      if (lastFrame) images.push(lastFrame)

      // Build params from schema (schema-driven, not hardcoded)
      const bm = backendVideoModels.find(m => m.model_id === currentModel)
      const schema = (bm?.param_schema?.length ? bm.param_schema : []) as ParamField[]
      const params: Record<string, unknown> = {}
      for (const field of schema) {
        const val = data[field.key]
        if (val !== undefined && val !== null && val !== '') {
          params[field.key] = val
        } else if (field.default !== undefined) {
          params[field.key] = field.default
        }
      }

      const res = await backendApi.submitVideo({
        model_id: currentModel,
        prompt: currentPrompt,
        images: images.length > 0 ? images : undefined,
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

  const borderClass = status === 'generating'
    ? 'border-yellow-400 shadow-yellow-200/50 animate-pulse'
    : status === 'done'
    ? 'border-green-500 shadow-green-200/50'
    : status === 'error'
    ? 'border-red-500 shadow-red-200/50'
    : selected
    ? 'border-rose-500 shadow-rose-200'
    : 'border-border'

  return (
    <div className={`workflow-node bg-card border-2 rounded-xl shadow-lg w-[300px] transition-all duration-300 ${borderClass}`}>
      <Handle type="target" position={Position.Left} id="prompt-in" className="!w-3 !h-3 !bg-rose-500" style={{ top: '12%' }} />
      <Handle type="target" position={Position.Left} id="first-frame" className="!w-3 !h-3 !bg-blue-400" style={{ top: '33%' }} />
      <Handle type="target" position={Position.Left} id="last-frame" className="!w-3 !h-3 !bg-indigo-400" style={{ top: '40%' }} />
      <Handle type="target" position={Position.Left} id="character-in" className="!w-3 !h-3 !bg-cyan-400" style={{ top: '47%' }} />

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-rose-500/8 rounded-t-xl border-b border-border/50">
        <Video className="w-4 h-4 text-rose-500 flex-shrink-0" />
        <span className="font-semibold text-sm truncate flex-1">{label}</span>
        {retryCount > 0 && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-500 flex-shrink-0">
            #{retryCount}
          </span>
        )}
        {status === 'done' && <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />}
        {status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
        {status === 'generating' && <Loader2 className="w-3.5 h-3.5 text-yellow-500 animate-spin flex-shrink-0" />}
      </div>

      {/* Content */}
      <div className="px-3 py-2.5 space-y-2.5">
        {/* Model Selector */}
        <div>
          <select
            value={modelId}
            onChange={handleModelChange}
            className="w-full text-xs font-medium px-2.5 py-[6px] rounded-lg border border-border/60 bg-muted/20 outline-none cursor-pointer hover:border-border transition-colors"
          >
            {ALL_VIDEO_MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <p className="text-[9px] text-muted-foreground/50 mt-1 leading-tight">{modelCaps}</p>
        </div>

        {/* Param summary badges */}
        {paramSummaryParts.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {paramSummaryParts.map((part, i) => (
              <span key={i} className="text-[10px] px-1.5 py-[2px] rounded bg-muted/40 text-muted-foreground font-medium">
                {part}
              </span>
            ))}
          </div>
        )}

        {/* Image Input Zones */}
        <div className="flex items-start gap-2">
          <ImageZone
            label="首帧"
            image={displayFirstFrame}
            color="border-blue-400/30"
            onClick={() => displayFirstFrame && window.open(firstFrameImageUrl || firstFrameImage!, '_blank')}
          />
          <ImageZone
            label="尾帧"
            image={displayLastFrame}
            color="border-indigo-400/30"
            onClick={() => displayLastFrame && window.open(lastFrameImageUrl || lastFrameImage!, '_blank')}
          />
          <ImageZone
            label="角色"
            image={displayCharacter}
            color="border-cyan-400/30"
            onClick={() => displayCharacter && window.open(displayCharacter, '_blank')}
          />
          {/* Spacer for visual balance */}
          <div className="flex-1" />
        </div>

        {/* Divider */}
        <div className="border-t border-border/30" />

        {/* Dynamic Params from Schema */}
        <DynamicParams schema={paramSchema} data={data} onChange={handleParamChange} />

        {/* Prompt Input */}
        <div className="relative">
          <textarea
            value={prompt}
            onChange={handlePromptChange}
            onKeyDown={handleSlashKeyDown}
            placeholder="输入视频描述提示词... (输入 / 打开菜单)"
            rows={3}
            className="w-full text-xs rounded-lg border border-border/60 bg-muted/20 p-2 resize-none focus:outline-none focus:border-rose-400/60 placeholder:text-muted-foreground/30"
          />
          <SlashMenu
            visible={slashState.visible}
            anchorX={slashState.anchorX}
            anchorY={slashState.anchorY}
            onSelect={handleSlashSelect}
            onClose={closeSlash}
          />
        </div>

        {/* Progress Bar */}
        {status === 'generating' && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground/60">
                {taskId ? `任务: ${taskId.slice(0, 8)}...` : '提交中...'}
              </span>
              <span className="text-[10px] font-mono text-yellow-600 tabular-nums">{progress}%</span>
            </div>
            <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-rose-400 to-rose-600 rounded-full transition-all duration-500"
                style={{ width: `${Math.max(progress, 5)}%` }}
              />
            </div>
          </div>
        )}

        {/* Error Message */}
        {errorMsg && (
          <div className="text-[10px] text-red-400 bg-red-500/5 border border-red-500/10 rounded-lg px-2 py-1.5 break-all">
            {errorMsg}
          </div>
        )}

        {/* Video Preview */}
        {outputVideo && (
          <div className="rounded-lg overflow-hidden border border-border/40 bg-black aspect-video">
            <video
              src={outputVideo}
              controls
              className="w-full h-full object-contain"
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-border/30">
        <button
          onClick={handleGenerate}
          disabled={!prompt.trim() || status === 'generating'}
          className={`w-full py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            status === 'generating'
              ? 'bg-muted text-muted-foreground'
              : status === 'done'
              ? 'bg-green-600 text-white hover:bg-green-700'
              : 'bg-rose-600 text-white hover:bg-rose-700 active:scale-[0.98]'
          }`}
        >
          {status === 'generating' ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> 生成中 {progress}%</>
          ) : status === 'done' ? (
            <><Play className="w-3 h-3" /> 重新生成</>
          ) : (
            <><Play className="w-3 h-3" /> 生成视频</>
          )}
        </button>
      </div>

      <Handle type="source" position={Position.Right} id="video-out" className="!w-3 !h-3 !bg-rose-500" />
    </div>
  )
}

export default memo(VideoGenNode)
