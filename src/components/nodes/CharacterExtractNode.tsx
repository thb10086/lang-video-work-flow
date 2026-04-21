import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { UserCheck, Play, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { useFlowStore } from '@/store/flowStore'
import { api } from '@/api/client'

function CharacterExtractNode({ id, data, selected }: NodeProps) {
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

  const borderClass = status === 'extracting'
    ? 'border-yellow-400 shadow-yellow-200/50 animate-pulse'
    : status === 'done'
    ? 'border-green-500 shadow-green-200/50'
    : status === 'error'
    ? 'border-red-500 shadow-red-200/50'
    : selected
    ? 'border-cyan-500 shadow-cyan-200'
    : 'border-border'

  return (
    <div className={`workflow-node bg-card border-2 rounded-xl shadow-lg w-[260px] transition-all duration-300 ${borderClass}`}>
      <Handle type="target" position={Position.Left} id="video-in" className="!w-3 !h-3 !bg-rose-500" />

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-cyan-500/10 rounded-t-xl border-b border-border">
        <UserCheck className="w-4 h-4 text-cyan-500" />
        <span className="font-semibold text-sm">{label}</span>
        {status === 'done' && <CheckCircle2 className="w-3.5 h-3.5 text-green-500 ml-auto" />}
        {status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-red-500 ml-auto" />}
      </div>

      {/* Content */}
      <div className="p-3 space-y-2">
        {/* Source info */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">来源</span>
          <span className="text-xs font-medium">
            {taskId ? `任务 ${taskId.slice(0, 8)}...` : videoUrl ? '视频 URL' : '未连接'}
          </span>
        </div>

        {/* Timestamps */}
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">时间戳 (秒，逗号分隔)</label>
          <input
            type="text"
            value={timestamps}
            onChange={handleTimestampsChange}
            placeholder="1,3"
            className="w-full text-xs rounded-md border border-border bg-muted/30 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-cyan-400"
          />
        </div>

        {/* Error */}
        {errorMsg && (
          <div className="text-[10px] text-red-500 bg-red-50 rounded px-2 py-1 break-all">{errorMsg}</div>
        )}

        {/* Result */}
        {characterId && (
          <div className="bg-cyan-50 rounded-md p-2 space-y-1">
            <p className="text-[10px] text-cyan-700 font-medium">Character 已创建</p>
            <p className="text-[10px] text-cyan-600 font-mono break-all">ID: {characterId}</p>
            {characterUrl && (
              <p className="text-[10px] text-cyan-600 truncate">URL: {characterUrl}</p>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border">
        <button
          onClick={handleExtract}
          disabled={(!videoUrl && !taskId) || status === 'extracting'}
          className={`w-full py-1.5 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            status === 'extracting'
              ? 'bg-yellow-100 text-yellow-700'
              : status === 'done'
              ? 'bg-green-500 text-white hover:bg-green-600'
              : 'bg-cyan-500 text-white hover:bg-cyan-600'
          }`}
        >
          {status === 'extracting' ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> 提取中...</>
          ) : status === 'done' ? (
            <><Play className="w-3 h-3" /> 重新提取</>
          ) : (
            <><Play className="w-3 h-3" /> 提取角色</>
          )}
        </button>
      </div>

      <Handle type="source" position={Position.Right} id="character-out" className="!w-3 !h-3 !bg-cyan-400" />
    </div>
  )
}

export default memo(CharacterExtractNode)
