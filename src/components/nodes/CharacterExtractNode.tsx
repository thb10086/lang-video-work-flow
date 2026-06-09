/**
 * CharacterExtractNode — LibTV-style extract-character-from-video node.
 *
 * Given a video URL (or upstream task_id) and a list of timestamps,
 * extracts a Character asset (character-anchor reference). Output is a
 * character reference (id + thumbnail URL) fed to downstream ref-in.
 */
import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { UserCheck, AlertTriangle, Clock, Video } from 'lucide-react'

import { useFlowStore } from '@/store/flowStore'
import { api } from '@/api/client'

import {
  NodeShell, PreviewArea, NodeToolbar, SubmitButton,
} from '@/components/nodes/_shell'

function CharacterExtractNode({ id, data }: NodeProps) {
  const status = String(data.status || 'idle')
  const label = String(data.label || '角色提取')
  const videoUrl = data.videoUrl as string | null
  const taskId = data.taskId as string | null
  const timestamps = String(data.timestamps || '1,3')
  const characterId = data.characterId as string | null
  const characterUrl = data.characterUrl as string | null
  const errorMsg = data.errorMsg ? String(data.errorMsg) : null

  const updateNodeData = useFlowStore((s) => s.updateNodeData)

  const handleTimestampsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateNodeData(id, { timestamps: e.target.value })
  }, [id, updateNodeData])

  const handleExtract = useCallback(async () => {
    if (status === 'extracting') return

    const currentVideoUrl = data.videoUrl as string | null
    const currentTaskId = data.taskId as string | null
    if (!currentVideoUrl && !currentTaskId) return

    updateNodeData(id, { status: 'extracting', errorMsg: null, characterId: null, characterUrl: null })

    try {
      // Character extraction via backend
      const result = await api.post<{ id: string; url?: string }>('/api/character/extract', {
        from_task_id: currentTaskId || undefined,
        video_url: currentVideoUrl || undefined,
        timestamps: String(data.timestamps || '1,3'),
      })

      updateNodeData(id, {
        status: 'done',
        characterId: result.id,
        characterUrl: result.url || null,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '提取失败'
      updateNodeData(id, { status: 'error', errorMsg: msg })
    }
  }, [id, data.videoUrl, data.taskId, data.timestamps, status, updateNodeData])

  const isExtracting = status === 'extracting'
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

  const sourceLabel = taskId
    ? `上游任务 ${taskId.slice(0, 8)}...`
    : videoUrl ? '视频 URL' : '未连接'

  const labelRightSlot = (
    <div className="flex items-center gap-1">
      {status === 'done' && <span className="text-[hsl(var(--success))]">✓</span>}
      {status === 'error' && <AlertTriangle size={11} className="text-[hsl(var(--destructive))]" />}
    </div>
  )

  return (
    <NodeShell
      icon={<UserCheck size={11} strokeWidth={2.5} />}
      label={label}
      labelRight={labelRightSlot}
      width={340}
      executing={isExtracting}
      ghostConnect={{ left: true, right: true }}
      onGhostConnect={handleGhostConnect}
    >
      <Handle type="target" position={Position.Left} id="video-in" />
      <Handle type="source" position={Position.Right} id="character-out" />

      <div className="p-3 space-y-2.5">
        {/* ── PREVIEW (character thumbnail if we have one) ── */}
        <PreviewArea
          aspect="1/1"
          placeholderIcon={UserCheck}
          suggestions={characterId ? undefined : [
            { icon: Video, label: '连接上游视频' },
          ]}
          loading={isExtracting && !characterId}
        >
          {characterUrl && (
            <img
              src={characterUrl}
              alt="character"
              className="absolute inset-0 w-full h-full object-cover"
            />
          )}
          {characterId && !characterUrl && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-3">
              <UserCheck size={32} className="text-[hsl(var(--libtv-accent))]" strokeWidth={1.5} />
              <span className="text-[10px] font-mono text-[hsl(var(--libtv-muted))] break-all text-center">
                {characterId}
              </span>
            </div>
          )}
        </PreviewArea>

        {/* ── SOURCE LABEL ── */}
        <div className="flex items-center justify-between text-[10px] text-[hsl(var(--libtv-muted))] px-1">
          <span>来源</span>
          <span className="truncate max-w-[200px]" title={sourceLabel}>{sourceLabel}</span>
        </div>

        {/* ── TIMESTAMPS INPUT ── */}
        <div className="space-y-1">
          <label className="text-[10px] text-[hsl(var(--libtv-muted))] flex items-center gap-1">
            <Clock size={10} />
            时间戳（秒，逗号分隔）
          </label>
          <input
            type="text"
            value={timestamps}
            onChange={handleTimestampsChange}
            placeholder="1,3"
            className="libtv-input"
          />
        </div>

        {/* ── TOOLBAR ── */}
        <NodeToolbar
          right={
            <SubmitButton
              onClick={handleExtract}
              disabled={(!videoUrl && !taskId) || isExtracting}
              loading={isExtracting}
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

export default memo(CharacterExtractNode)
