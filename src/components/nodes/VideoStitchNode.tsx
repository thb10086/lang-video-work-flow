import { memo, useCallback, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  Clapperboard, Play, Download, Trash2, GripVertical,
  ArrowDown, ArrowUp, CheckCircle2, AlertCircle, Loader2, RefreshCw,
  ExternalLink,
} from 'lucide-react'
import { useFlowStore } from '@/store/flowStore'
import { executeNode } from '@/providers/nodeExecutor'

interface VideoClip {
  id: string
  url: string
  label: string
  duration?: number
}

function VideoStitchNode({ id, data, selected }: NodeProps) {
  const label = String(data.label || '视频拼接')
  const clips = (data.clips as VideoClip[]) || []
  const status = String(data.status || 'idle')
  const errorMsg = data.errorMsg ? String(data.errorMsg) : null
  const [activeClipIndex, setActiveClipIndex] = useState(0)
  const [isExecuting, setIsExecuting] = useState(false)

  const updateNodeData = useFlowStore((s) => s.updateNodeData)

  // Collect videos from upstream nodes
  const handleCollect = useCallback(async () => {
    if (isExecuting) return
    setIsExecuting(true)
    try {
      await executeNode(id)
    } finally {
      setIsExecuting(false)
    }
  }, [id, isExecuting])

  const handleRemoveClip = useCallback((clipId: string) => {
    const newClips = clips.filter(c => c.id !== clipId)
    updateNodeData(id, { clips: newClips })
  }, [id, clips, updateNodeData])

  const handleMoveClip = useCallback((index: number, direction: 'up' | 'down') => {
    const newClips = [...clips]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= newClips.length) return
    ;[newClips[index], newClips[targetIndex]] = [newClips[targetIndex], newClips[index]]
    updateNodeData(id, { clips: newClips })
  }, [id, clips, updateNodeData])

  const handleDownloadClip = useCallback((clip: VideoClip, index: number) => {
    const a = document.createElement('a')
    a.href = clip.url
    a.download = `${clip.label || `片段${index + 1}`}.mp4`
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }, [])

  const handleOpenInNewTab = useCallback((url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [])

  // Get clips that have valid URLs
  const validClips = clips.filter(c => c.url)
  const activeClip = validClips[activeClipIndex] || null

  const borderClass = isExecuting
    ? 'border-yellow-400 shadow-yellow-200/50 animate-pulse'
    : status === 'done' && validClips.length > 0
    ? 'border-green-500 shadow-green-200/50'
    : status === 'error'
    ? 'border-red-500 shadow-red-200/50'
    : selected
    ? 'border-rose-500 shadow-rose-200'
    : 'border-border'

  return (
    <div className={`workflow-node bg-card border-2 rounded-xl shadow-lg w-[320px] transition-all duration-300 ${borderClass}`}>
      <Handle type="target" position={Position.Left} id="video-in" className="!w-3 !h-3 !bg-rose-500" style={{ top: '40%' }} />
      <Handle type="target" position={Position.Left} id="audio-in" className="!w-3 !h-3 !bg-amber-500" style={{ top: '60%' }} />

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-rose-500/10 rounded-t-xl border-b border-border">
        <Clapperboard className="w-4 h-4 text-rose-500" />
        <span className="font-semibold text-sm">{label}</span>
        <div className="flex items-center gap-1.5 ml-auto">
          {status === 'done' && validClips.length > 0 && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
          {status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-red-500" />}
          <span className="text-[10px] text-muted-foreground">{validClips.length} 段视频</span>
        </div>
      </div>

      {/* Content */}
      <div className="p-3 space-y-2">
        {/* Video Player */}
        {activeClip ? (
          <div className="space-y-1.5">
            <div className="rounded-lg overflow-hidden border border-border bg-black aspect-video">
              <video
                key={activeClip.url}
                src={activeClip.url}
                controls
                className="w-full h-full object-contain"
                playsInline
              />
            </div>
            {/* Clip selector tabs */}
            {validClips.length > 1 && (
              <div className="flex gap-1 overflow-x-auto pb-1">
                {validClips.map((clip, i) => (
                  <button
                    key={clip.id}
                    onClick={() => setActiveClipIndex(i)}
                    className={`px-2 py-1 rounded text-[10px] font-medium whitespace-nowrap transition-colors ${
                      i === activeClipIndex
                        ? 'bg-rose-500 text-white'
                        : 'bg-muted/60 text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {i + 1}. {clip.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : clips.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-6 space-y-1">
            <Clapperboard className="w-8 h-8 mx-auto text-muted-foreground/30" />
            <p>连接上游视频节点后</p>
            <p>点击「收集视频」自动汇总</p>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground text-center py-4">
            {clips.length} 个片段，{clips.filter(c => !c.url).length} 个缺少视频URL
          </div>
        )}

        {/* Clip list with actions */}
        {validClips.length > 0 && (
          <div className="space-y-1 max-h-[140px] overflow-y-auto">
            {clips.map((clip, i) => (
              <div key={clip.id} className={`flex items-center gap-1.5 rounded p-1.5 ${
                clip.url ? 'bg-muted/40' : 'bg-red-50 dark:bg-red-900/10'
              }`}>
                <GripVertical className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                <span className="text-[10px] text-muted-foreground w-4">{i + 1}</span>
                <span className="flex-1 text-[10px] truncate">{clip.label}</span>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  {clip.url && (
                    <>
                      <button
                        onClick={() => { setActiveClipIndex(validClips.indexOf(clip)) }}
                        className="p-0.5 rounded hover:bg-muted"
                        title="预览"
                      >
                        <Play className="w-2.5 h-2.5 text-rose-500" />
                      </button>
                      <button
                        onClick={() => handleDownloadClip(clip, i)}
                        className="p-0.5 rounded hover:bg-muted"
                        title="下载"
                      >
                        <Download className="w-2.5 h-2.5 text-blue-500" />
                      </button>
                      <button
                        onClick={() => handleOpenInNewTab(clip.url)}
                        className="p-0.5 rounded hover:bg-muted"
                        title="新标签页打开"
                      >
                        <ExternalLink className="w-2.5 h-2.5 text-muted-foreground" />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => handleMoveClip(i, 'up')}
                    disabled={i === 0}
                    className="p-0.5 rounded hover:bg-muted disabled:opacity-30"
                  >
                    <ArrowUp className="w-2.5 h-2.5" />
                  </button>
                  <button
                    onClick={() => handleMoveClip(i, 'down')}
                    disabled={i === clips.length - 1}
                    className="p-0.5 rounded hover:bg-muted disabled:opacity-30"
                  >
                    <ArrowDown className="w-2.5 h-2.5" />
                  </button>
                  <button
                    onClick={() => handleRemoveClip(clip.id)}
                    className="p-0.5 rounded hover:bg-red-100"
                  >
                    <Trash2 className="w-2.5 h-2.5 text-red-400" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error message */}
        {errorMsg && (
          <div className="text-[10px] text-red-500 bg-red-50 dark:bg-red-900/10 rounded p-2">
            {errorMsg}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border flex gap-2">
        <button
          onClick={handleCollect}
          disabled={isExecuting}
          className="flex-1 py-1.5 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-50 transition-colors"
        >
          {isExecuting ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> 收集中...</>
          ) : validClips.length > 0 ? (
            <><RefreshCw className="w-3 h-3" /> 重新收集</>
          ) : (
            <><Play className="w-3 h-3" /> 收集视频</>
          )}
        </button>
        {validClips.length > 0 && (
          <button
            onClick={() => validClips.forEach((c, i) => handleDownloadClip(c, i))}
            className="py-1.5 px-3 rounded-md text-xs font-medium flex items-center gap-1.5 bg-blue-500 text-white hover:bg-blue-600 transition-colors"
            title="下载全部视频片段"
          >
            <Download className="w-3 h-3" />
          </button>
        )}
      </div>

      <Handle type="source" position={Position.Right} id="video-out" className="!w-3 !h-3 !bg-rose-500" />
    </div>
  )
}

export default memo(VideoStitchNode)
