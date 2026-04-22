/**
 * StyleLockNode — LibTV-style style extraction / locking.
 *
 * The node analyses a reference image and/or a user-written style hint and
 * produces a deterministic style prompt string. Downstream imageGen /
 * videoGen nodes concatenate this string onto their prompts so the whole
 * workflow stays visually consistent.
 *
 * Visual structure mirrors the other generation nodes:
 *   1. Preview (4:3, holds the reference image — upload + pan hint)
 *   2. Input (style keywords textarea)
 *   3. Toolbar (upload chip + submit button)
 *   4. "Locked style" banner once extracted
 */
import { memo, useCallback, useRef } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  Palette, Lock, AlertTriangle, Upload, X,
} from 'lucide-react'

import { useFlowStore } from '@/store/flowStore'
import { backendApi } from '@/api/backend'
import { useSettingsStore } from '@/store/settingsStore'
import { TASK_TOKEN_BUDGETS } from '@/providers/modelDefaults'

import {
  NodeShell, PreviewArea, NodeToolbar, SubmitButton,
} from '@/components/nodes/_shell'

function StyleLockNode({ id, data }: NodeProps) {
  const status = String(data.status || 'idle')
  const label = String(data.label || '风格锁定')
  const referenceImage = data.referenceImage as string | null
  const styleDescription = String(data.styleDescription || '')
  const extractedStyle = String(data.extractedStyle || '')
  const errorMsg = data.errorMsg ? String(data.errorMsg) : null

  const updateNodeData = useFlowStore((s) => s.updateNodeData)

  const handleStyleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateNodeData(id, { styleDescription: e.target.value })
  }, [id, updateNodeData])

  const handleExtractStyle = useCallback(async () => {
    if (status === 'extracting') return

    const refImg = data.referenceImage as string | null
    const manualStyle = String(data.styleDescription || '')

    if (!refImg && !manualStyle.trim()) return

    updateNodeData(id, { status: 'extracting', errorMsg: null })

    try {
      const settings = useSettingsStore.getState()
      const modelId = settings.defaultLLMModel

      const prompt = refImg
        ? `分析这张参考图片的视觉风格特征，提取以下维度并输出为简洁的风格描述（用于注入到后续图片/视频生成的提示词中）：

1. 色彩方案（色调、饱和度、对比度）
2. 光照风格（自然光/人工光/戏剧性/柔和）
3. 艺术风格（写实/动漫/插画/水彩/3D等）
4. 构图特点
5. 氛围情绪
6. 材质纹理

${manualStyle ? `用户补充描述: ${manualStyle}` : ''}

请输出一段 50-100 词的英文风格描述，可以直接拼接到 prompt 末尾使用。`
        : `根据以下风格描述，生成一段标准化的英文风格提示词（50-100词），可以直接拼接到图片/视频生成 prompt 末尾确保风格统一：

${manualStyle}

输出格式: Style: [风格描述]`

      const result = await backendApi.chat({
        model_id: modelId,
        prompt,
        system_prompt: '你是专业的视觉风格分析师。擅长将视觉风格特征转化为 AI 图片/视频生成的提示词。',
        temperature: 0.5,
        max_tokens: TASK_TOKEN_BUDGETS.STYLE_EXTRACT,
      })

      updateNodeData(id, {
        status: 'done',
        extractedStyle: result.text || '',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '风格提取失败'
      updateNodeData(id, { status: 'error', errorMsg: msg })
    }
  }, [id, data.referenceImage, data.styleDescription, status, updateNodeData])

  const isExtracting = status === 'extracting'
  const nodes = useFlowStore(s => s.nodes)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const canExtract = !!(referenceImage || styleDescription.trim())

  const labelRightSlot = (
    <div className="flex items-center gap-1">
      {status === 'done' && <Lock size={11} className="text-[hsl(var(--success))]" />}
      {status === 'error' && <AlertTriangle size={11} className="text-[hsl(var(--destructive))]" />}
    </div>
  )

  return (
    <NodeShell
      icon={<Palette size={11} strokeWidth={2.5} />}
      label={label}
      labelRight={labelRightSlot}
      width={380}
      executing={isExtracting}
      ghostConnect={{ left: true, right: true }}
      onGhostConnect={handleGhostConnect}
    >
      <Handle type="target" position={Position.Left} id="ref-in"   style={{ top: '35%' }} />
      <Handle type="target" position={Position.Left} id="style-in" style={{ top: '65%' }} />
      <Handle type="source" position={Position.Right} id="style-out" />

      <div className="p-3 space-y-2.5">
        {/* ── 1. PREVIEW — reference image (4/3) ── */}
        <PreviewArea
          aspect="4/3"
          placeholderIcon={Palette}
          suggestions={referenceImage ? undefined : [
            {
              icon: Upload,
              label: '上传参考图',
              onClick: () => fileInputRef.current?.click(),
            },
          ]}
          loading={isExtracting && !extractedStyle}
        >
          {referenceImage && (
            <div className="absolute inset-0 flex items-center justify-center">
              <img
                src={referenceImage}
                alt="ref"
                className="max-w-full max-h-full object-contain"
              />
              <button
                type="button"
                onClick={handleRemoveRefImage}
                className="absolute top-2 right-2 w-6 h-6 bg-black/60 text-white rounded-full flex items-center justify-center hover:bg-black/80"
                aria-label="Remove reference"
              >
                <X size={12} />
              </button>
            </div>
          )}
        </PreviewArea>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleRefImageUpload}
          className="hidden"
        />

        {/* ── 2. INPUT ── */}
        <textarea
          value={styleDescription}
          onChange={handleStyleChange}
          placeholder="描述期望的风格：赛博朋克 / 暖色调 / 胶片质感 / 柔焦..."
          rows={3}
          className="libtv-prompt"
        />

        {/* ── 3. TOOLBAR ── */}
        <NodeToolbar
          left={
            <button
              type="button"
              className="libtv-chip"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={12} strokeWidth={2} />
              <span>{referenceImage ? '更换参考图' : '上传参考图'}</span>
            </button>
          }
          right={
            <SubmitButton
              onClick={handleExtractStyle}
              disabled={!canExtract || isExtracting}
              loading={isExtracting}
            />
          }
        />

        {/* ── 4. SECONDARY BANNERS ── */}
        {errorMsg && (
          <div className="text-[10px] text-[hsl(var(--destructive))] bg-[hsl(var(--destructive)/0.08)] border border-[hsl(var(--destructive)/0.2)] rounded-lg px-2 py-1.5 break-all">
            {errorMsg}
          </div>
        )}
        {extractedStyle && (
          <div className="bg-[hsl(var(--libtv-accent)/0.08)] border border-[hsl(var(--libtv-accent)/0.25)] rounded-lg px-2.5 py-2">
            <div className="flex items-center gap-1 mb-1">
              <Lock size={10} className="text-[hsl(var(--libtv-accent))]" strokeWidth={2.5} />
              <span className="text-[10px] text-[hsl(var(--libtv-accent))] font-medium">已锁定风格</span>
            </div>
            <p className="text-[11px] text-[hsl(var(--libtv-chip-fg))] leading-relaxed">{extractedStyle}</p>
          </div>
        )}
      </div>
    </NodeShell>
  )
}

export default memo(StyleLockNode)
