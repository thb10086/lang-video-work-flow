/**
 * SceneGridNode — LibTV-style scene reference grid.
 *
 * Same structural DNA as CharacterGridNode; produces a grid of scene angles
 * / time-of-day variations. Style + mood are exposed as two popover chips
 * so they can be swapped quickly.
 */
import { memo, useCallback, useMemo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  Mountain, AlertTriangle, Palette, Sparkles, ChevronDown,
} from 'lucide-react'

import { useFlowStore } from '@/store/flowStore'
import { backendApi } from '@/api/backend'
import { DEFAULT_IMAGE_MODEL } from '@/providers/modelDefaults'
import { sceneSheetTemplate } from '@/prompts/templates/sceneSheet'
import { renderTemplate } from '@/prompts/promptEngine'

import {
  NodeShell, PreviewArea, NodeToolbar, SubmitButton, ParamPopover,
  SegmentedPicker,
} from '@/components/nodes/_shell'

const SCENE_STYLES = [
  { value: 'cinematic', label: '电影' },
  { value: 'anime',     label: '动漫' },
  { value: 'realistic', label: '写实' },
  { value: 'painterly', label: '绘画' },
  { value: 'noir',      label: '黑色' },
  { value: 'fantasy',   label: '奇幻' },
]
const SCENE_MOODS = [
  { value: 'dramatic',   label: '戏剧' },
  { value: 'peaceful',   label: '宁静' },
  { value: 'tense',      label: '紧张' },
  { value: 'romantic',   label: '浪漫' },
  { value: 'mysterious', label: '神秘' },
  { value: 'epic',       label: '史诗' },
]

function SceneGridNode({ id, data }: NodeProps) {
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

  const styleLabel = useMemo(
    () => SCENE_STYLES.find(s => s.value === style)?.label || style,
    [style],
  )
  const moodLabel = useMemo(
    () => SCENE_MOODS.find(m => m.value === mood)?.label || mood,
    [mood],
  )

  const labelRightSlot = (
    <div className="flex items-center gap-1">
      {status === 'done' && <span className="text-[hsl(var(--success))]">✓</span>}
      {status === 'error' && <AlertTriangle size={11} className="text-[hsl(var(--destructive))]" />}
    </div>
  )

  return (
    <NodeShell
      icon={<Mountain size={11} strokeWidth={2.5} />}
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
        {/* ── 1. PREVIEW ── */}
        <PreviewArea
          aspect="1/1"
          placeholderIcon={Mountain}
          loading={isGenerating && !displayImage}
        >
          {displayImage && (
            <img
              src={displayImage}
              alt="scene grid"
              className="absolute inset-0 w-full h-full object-cover cursor-zoom-in"
              onClick={() => window.open(outputImageUrl || outputImage!, '_blank')}
            />
          )}
        </PreviewArea>

        {/* ── 2. INPUT ── */}
        <div className="space-y-1.5">
          <input
            type="text"
            value={sceneName}
            onChange={handleNameChange}
            placeholder="场景名称（例：赛博朋克城市）"
            className="libtv-input"
          />
          <textarea
            value={sceneDesc}
            onChange={handleDescChange}
            placeholder="描述场景环境、建筑、氛围..."
            rows={3}
            className="libtv-prompt"
          />
        </div>

        {/* ── 3. TOOLBAR ── */}
        <NodeToolbar
          left={
            <>
              <ParamPopover
                align="start"
                width={260}
                trigger={({ toggle }) => (
                  <button type="button" className="libtv-chip" onClick={toggle}>
                    <Palette size={12} strokeWidth={2} className="text-[hsl(var(--libtv-accent))]" />
                    <span>{styleLabel}</span>
                    <ChevronDown size={11} strokeWidth={2} />
                  </button>
                )}
              >
                <SegmentedPicker
                  title="风格"
                  options={SCENE_STYLES}
                  value={style}
                  onChange={v => updateNodeData(id, { style: v })}
                  cols={3}
                />
              </ParamPopover>

              <ParamPopover
                align="start"
                width={260}
                trigger={({ toggle }) => (
                  <button type="button" className="libtv-chip" onClick={toggle}>
                    <Sparkles size={12} strokeWidth={2} className="text-[hsl(var(--libtv-accent))]" />
                    <span>{moodLabel}</span>
                    <ChevronDown size={11} strokeWidth={2} />
                  </button>
                )}
              >
                <SegmentedPicker
                  title="情绪"
                  options={SCENE_MOODS}
                  value={mood}
                  onChange={v => updateNodeData(id, { mood: v })}
                  cols={3}
                />
              </ParamPopover>
            </>
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

export default memo(SceneGridNode)
