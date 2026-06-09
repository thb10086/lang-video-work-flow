/**
 * KeyframeGridNode — 镜头级"分镜拼贴图"节点（PoC v0.1）
 *
 * 灵感来自 LibTV `/` slash 功能（剧情推演四宫格 / 多机位九宫格）和
 * Higgsfield Shots（1 张 → 9 帧 contact sheet）。核心机制：
 *   ✦ 一次调用 image model，prompt 工程引导出 **一张包含 N 帧布局的拼贴图**
 *   ✦ 而不是 N 次独立调用 → 成本 ≈ 1 张 4K 单图
 *
 * 与 SceneGridNode 的差异：
 *   sceneGrid 锚定 "同一地点的不同维度变化"（机位 / 时段 / 天气）
 *   keyframeGrid 锚定 "同一镜头的时间序列 / 动作分解 / 状态演进 / 多机位"
 *
 * 与 imageGen 的关系：
 *   imageGen 出单帧（短镜头默认）；keyframeGrid 出多帧拼贴（复杂镜头）。
 *   两者并存，由 Agent 根据 storyboard 场景决策（见 videoWorkflowRecipe SKILL）。
 */
import { memo, useCallback, useMemo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  LayoutGrid, AlertTriangle, Palette, Sparkles, ChevronDown, Grid3x3, Clock,
} from 'lucide-react'

import { useFlowStore } from '@/store/flowStore'
import { backendApi } from '@/api/backend'
import { DEFAULT_IMAGE_MODEL } from '@/providers/modelDefaults'
import {
  buildKeyframePrompt,
  KEYFRAME_LAYOUTS,
  SUBTYPE_LABELS,
  type KeyframeSubType,
  type KeyframeLayout,
} from '@/prompts/templates/keyframeSheet'

import {
  NodeShell, PreviewArea, NodeToolbar, SubmitButton, ParamPopover,
  SegmentedPicker,
} from '@/components/nodes/_shell'

const SUBTYPE_OPTIONS = [
  { value: 'time-progression', label: SUBTYPE_LABELS['time-progression'] },
  { value: 'scene-evolution',  label: SUBTYPE_LABELS['scene-evolution'] },
  { value: 'action-breakdown', label: SUBTYPE_LABELS['action-breakdown'] },
  { value: 'multi-camera',     label: SUBTYPE_LABELS['multi-camera'] },
]

const LAYOUT_OPTIONS = [
  { value: '2x2', label: '四宫格' },
  { value: '2x3', label: '六宫格' },
  { value: '3x3', label: '九宫格' },
]

const STYLE_OPTIONS = [
  { value: 'cinematic', label: '电影' },
  { value: 'anime',     label: '动漫' },
  { value: 'realistic', label: '写实' },
  { value: 'painterly', label: '绘画' },
  { value: 'noir',      label: '黑色' },
  { value: 'fantasy',   label: '奇幻' },
]

const MOOD_OPTIONS = [
  { value: 'dramatic',   label: '戏剧' },
  { value: 'peaceful',   label: '宁静' },
  { value: 'tense',      label: '紧张' },
  { value: 'romantic',   label: '浪漫' },
  { value: 'mysterious', label: '神秘' },
  { value: 'epic',       label: '史诗' },
]

function KeyframeGridNode({ id, data }: NodeProps) {
  const status = String(data.status || 'idle')
  const label = String(data.label || '分镜拼贴图')
  const shotName = String(data.shotName || '')
  const shotDescription = String(data.shotDescription || '')
  const subType = (String(data.subType || 'time-progression')) as KeyframeSubType
  const layout = (String(data.layout || '2x3')) as KeyframeLayout
  const style = String(data.style || 'cinematic')
  const mood = String(data.mood || 'dramatic')
  const outputImage = data.outputImage as string | null
  const outputImageUrl = data.outputImageUrl as string | null
  const displayImage = outputImage || outputImageUrl
  const errorMsg = data.errorMsg ? String(data.errorMsg) : null

  const updateNodeData = useFlowStore((s) => s.updateNodeData)

  const handleShotNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateNodeData(id, {
      shotName: e.target.value,
      label: `分镜: ${e.target.value || '未命名'}`,
    })
  }, [id, updateNodeData])

  const handleShotDescChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateNodeData(id, { shotDescription: e.target.value })
  }, [id, updateNodeData])

  const handleGenerate = useCallback(async () => {
    if (status === 'generating') return
    const name = shotName || '未命名镜头'
    const desc = shotDescription || 'A cinematic shot'

    const prompt = buildKeyframePrompt({
      subType,
      layout,
      shotName: name,
      shotDescription: desc,
      style,
      mood,
    })

    updateNodeData(id, { status: 'generating', errorMsg: null, outputImage: null })

    try {
      const modelId = DEFAULT_IMAGE_MODEL
      // 注意：keyframeGrid 的输出是 "一张大图含 N 个 panel"，所以 aspectRatio 固定
      // 让模型有足够空间排布所有 panel。
      //   2x2 → 1:1（4 panel，方形最稳）
      //   2x3 → 4:3（横向 6 panel）
      //   3x3 → 1:1（9 panel，方形）
      const aspectRatio = layout === '2x3' ? '4:3' : '1:1'
      const res = await backendApi.generateImage({
        model_id: modelId, prompt,
        params: { aspectRatio, imageSize: '2k' },
      })
      const img = res.images?.[0]
      if (img) {
        const dataUrl = img.url || `data:${img.mime_type};base64,${img.data}`
        updateNodeData(id, { status: 'done', outputImage: dataUrl })
        if (img.url) updateNodeData(id, { outputImageUrl: img.url })
      } else {
        updateNodeData(id, { status: 'error', errorMsg: '未返回拼贴图 (已重试 3 次)' })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生成失败'
      updateNodeData(id, { status: 'error', errorMsg: msg })
    }
  }, [id, shotName, shotDescription, subType, layout, style, mood, status, updateNodeData])

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

  const subTypeLabel = useMemo(
    () => SUBTYPE_OPTIONS.find(o => o.value === subType)?.label || subType,
    [subType],
  )
  const layoutLabel = useMemo(
    () => LAYOUT_OPTIONS.find(o => o.value === layout)?.label || layout,
    [layout],
  )
  const styleLabel = useMemo(
    () => STYLE_OPTIONS.find(o => o.value === style)?.label || style,
    [style],
  )
  const moodLabel = useMemo(
    () => MOOD_OPTIONS.find(o => o.value === mood)?.label || mood,
    [mood],
  )

  const nPanels = KEYFRAME_LAYOUTS[layout]?.n ?? 6

  const labelRightSlot = (
    <div className="flex items-center gap-1">
      <span className="text-[9px] opacity-60">{nPanels}格</span>
      {status === 'done' && <span className="text-[hsl(var(--success))]">✓</span>}
      {status === 'error' && <AlertTriangle size={11} className="text-[hsl(var(--destructive))]" />}
    </div>
  )

  return (
    <NodeShell
      icon={<LayoutGrid size={11} strokeWidth={2.5} />}
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
          aspect={layout === '2x3' ? '4/3' : '1/1'}
          placeholderIcon={LayoutGrid}
          loading={isGenerating && !displayImage}
        >
          {displayImage && (
            <img
              src={displayImage}
              alt="keyframe grid"
              className="absolute inset-0 w-full h-full object-cover cursor-zoom-in"
              onClick={() => window.open(outputImageUrl || outputImage!, '_blank')}
            />
          )}
        </PreviewArea>

        {/* ── 2. INPUT ── */}
        <div className="space-y-1.5">
          <input
            type="text"
            value={shotName}
            onChange={handleShotNameChange}
            placeholder="镜头名（例：shot-3-revenge）"
            className="libtv-input"
          />
          <textarea
            value={shotDescription}
            onChange={handleShotDescChange}
            placeholder="镜头描述：动作 / 环境 / 角色 / 镜头运动..."
            rows={3}
            className="libtv-prompt"
          />
        </div>

        {/* ── 3. TOOLBAR ── */}
        <NodeToolbar
          left={
            <>
              {/* 子类型 chip */}
              <ParamPopover
                align="start"
                width={260}
                trigger={({ toggle }) => (
                  <button type="button" className="libtv-chip" onClick={toggle}>
                    <Clock size={12} strokeWidth={2} className="text-[hsl(var(--libtv-accent))]" />
                    <span>{subTypeLabel}</span>
                    <ChevronDown size={11} strokeWidth={2} />
                  </button>
                )}
              >
                <SegmentedPicker
                  title="分镜类型"
                  options={SUBTYPE_OPTIONS}
                  value={subType}
                  onChange={v => updateNodeData(id, { subType: v })}
                  cols={2}
                />
              </ParamPopover>

              {/* 布局 chip */}
              <ParamPopover
                align="start"
                width={220}
                trigger={({ toggle }) => (
                  <button type="button" className="libtv-chip" onClick={toggle}>
                    <Grid3x3 size={12} strokeWidth={2} className="text-[hsl(var(--libtv-accent))]" />
                    <span>{layoutLabel}</span>
                    <ChevronDown size={11} strokeWidth={2} />
                  </button>
                )}
              >
                <SegmentedPicker
                  title="布局"
                  options={LAYOUT_OPTIONS}
                  value={layout}
                  onChange={v => updateNodeData(id, { layout: v })}
                  cols={3}
                />
              </ParamPopover>

              {/* 风格 chip */}
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
                  options={STYLE_OPTIONS}
                  value={style}
                  onChange={v => updateNodeData(id, { style: v })}
                  cols={3}
                />
              </ParamPopover>

              {/* 情绪 chip */}
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
                  options={MOOD_OPTIONS}
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

export default memo(KeyframeGridNode)
