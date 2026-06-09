/**
 * ImageEditNode — LibTV-style image edit (prompt-driven).
 *
 * Takes an upstream image + a natural-language edit instruction and returns
 * a modified image. The preview shows the source before edit and swaps to
 * the result when done.
 */
import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Pencil, AlertTriangle, Sparkles } from 'lucide-react'

import { useFlowStore } from '@/store/flowStore'
import { backendApi } from '@/api/backend'
import { DEFAULT_IMAGE_MODEL } from '@/providers/modelDefaults'

import {
  NodeShell, PreviewArea, NodeToolbar, SubmitButton,
} from '@/components/nodes/_shell'

function ImageEditNode({ id, data }: NodeProps) {
  const status = String(data.status || 'idle')
  const label = String(data.label || '图片编辑')
  const inputImage = data.inputImage as string | null
  const editInstruction = String(data.editInstruction || data.editPrompt || '')
  const outputImage = data.outputImage as string | null
  const modelId = String(data.model || DEFAULT_IMAGE_MODEL)
  const errorMsg = data.errorMsg ? String(data.errorMsg) : null

  const updateNodeData = useFlowStore((s) => s.updateNodeData)

  const handlePromptChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // Write canonical key only. editPrompt legacy alias is read-only via
    // the fallback above for pre-migration data.
    updateNodeData(id, { editInstruction: e.target.value, editPrompt: undefined })
  }, [id, updateNodeData])

  const handleEdit = useCallback(async () => {
    const img = data.inputImage as string | null
    const prompt = String(data.editInstruction || data.editPrompt || '')
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
  }, [id, data.inputImage, data.editInstruction, data.editPrompt, data.model, status, updateNodeData])

  const isEditing = status === 'editing'
  const displayImage = outputImage || inputImage
  const nodes = useFlowStore(s => s.nodes)

  const handleGhostConnect = useCallback((side: 'left' | 'right') => {
    const self = nodes.find(n => n.id === id)
    if (!self) return
    const offset = side === 'left' ? -320 : 320
    const position = { x: (self.position?.x ?? 0) + offset, y: self.position?.y ?? 0 }
    window.dispatchEvent(new CustomEvent('libtv-ghost-connect', {
      detail: { sourceNodeId: id, side, position },
    }))
  }, [nodes, id])

  const labelRightSlot = (
    <div className="flex items-center gap-1">
      {status === 'done' && <span className="text-[hsl(var(--success))]">✓</span>}
      {status === 'error' && <AlertTriangle size={11} className="text-[hsl(var(--destructive))]" />}
    </div>
  )

  return (
    <NodeShell
      icon={<Pencil size={11} strokeWidth={2.5} />}
      label={label}
      labelRight={labelRightSlot}
      width={380}
      executing={isEditing}
      ghostConnect={{ left: true, right: true }}
      onGhostConnect={handleGhostConnect}
    >
      <Handle type="target" position={Position.Left} id="image-in" />
      <Handle type="source" position={Position.Right} id="image-out" />

      <div className="p-3 space-y-2.5">
        {/* ── PREVIEW ── */}
        <PreviewArea
          aspect="1/1"
          placeholderIcon={Pencil}
          suggestions={displayImage ? undefined : [
            { icon: Pencil, label: '连接上游图片' },
          ]}
          loading={isEditing && !outputImage}
        >
          {displayImage && (
            <>
              <img
                src={displayImage}
                alt={label}
                className="absolute inset-0 w-full h-full object-cover"
              />
              {outputImage && inputImage && outputImage !== inputImage && (
                <span className="absolute bottom-2 left-2 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">
                  编辑后
                </span>
              )}
              {!outputImage && inputImage && (
                <span className="absolute bottom-2 left-2 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">
                  原图
                </span>
              )}
            </>
          )}
        </PreviewArea>

        {/* ── EDIT INSTRUCTION ── */}
        <textarea
          value={editInstruction}
          onChange={handlePromptChange}
          placeholder="描述编辑操作，如：换背景为海滨 / 添加太阳镜 / 改发色..."
          rows={3}
          className="libtv-prompt"
        />

        {/* ── TOOLBAR ── */}
        <NodeToolbar
          left={
            <div className="libtv-chip">
              <Sparkles size={12} strokeWidth={2} className="text-[hsl(var(--libtv-accent))]" />
              <span className="truncate max-w-[140px]" title={modelId}>
                {modelId}
              </span>
            </div>
          }
          right={
            <SubmitButton
              onClick={handleEdit}
              disabled={!inputImage || !editInstruction.trim() || isEditing}
              loading={isEditing}
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

export default memo(ImageEditNode)
