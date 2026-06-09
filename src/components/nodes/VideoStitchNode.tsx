import { memo, useCallback, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  Clapperboard, Play, Download, Trash2,
  ArrowDown, ArrowUp, ExternalLink,
} from 'lucide-react'
import { useFlowStore } from '@/store/flowStore'
import { executeNode } from '@/providers/nodeExecutor'
import {
  NodeShell,
  PreviewArea,
  NodeToolbar,
  SubmitButton,
} from './_shell'

/* ─── types ─── */
interface VideoClip {
  id: string
  url: string
  label: string
  duration?: number
}

/* ─── helpers ─── */
const downloadClip = (clip: VideoClip, index: number) => {
  const a = document.createElement('a')
  a.href = clip.url
  a.download = `${clip.label || `片段${index + 1}`}.mp4`
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

/* ─── component ─── */
function VideoStitchNode({ id, data }: NodeProps) {
  const label = String(data.label || '视频拼接')
  const clips = (data.clips as VideoClip[]) || []
  const errorMsg = data.errorMsg ? String(data.errorMsg) : null
  const [activeIdx, setActiveIdx] = useState(0)
  const [isExecuting, setIsExecuting] = useState(false)

  const updateNodeData = useFlowStore((s) => s.updateNodeData)
  const nodes = useFlowStore((s) => s.nodes)

  const validClips = clips.filter(c => c.url)
  const activeClip = validClips[activeIdx] || null

  /* ── actions ── */
  const handleCollect = useCallback(async () => {
    if (isExecuting) return
    setIsExecuting(true)
    try { await executeNode(id) } finally { setIsExecuting(false) }
  }, [id, isExecuting])

  const handleRemove = useCallback((clipId: string) => {
    updateNodeData(id, { clips: clips.filter(c => c.id !== clipId) })
  }, [id, clips, updateNodeData])

  const handleMove = useCallback((index: number, dir: 'up' | 'down') => {
    const arr = [...clips]
    const t = dir === 'up' ? index - 1 : index + 1
    if (t < 0 || t >= arr.length) return
    ;[arr[index], arr[t]] = [arr[t], arr[index]]
    updateNodeData(id, { clips: arr })
  }, [id, clips, updateNodeData])

  const handleGhostConnect = useCallback((side: 'left' | 'right') => {
    const self = nodes.find(n => n.id === id)
    if (!self) return
    const offset = side === 'left' ? -340 : 340
    const position = { x: (self.position?.x ?? 0) + offset, y: self.position?.y ?? 0 }
    window.dispatchEvent(new CustomEvent('libtv-ghost-connect', {
      detail: { sourceNodeId: id, side, position },
    }))
  }, [nodes, id])

  /* ── render ── */
  return (
    <NodeShell
      icon={<Clapperboard size={11} strokeWidth={2.5} />}
      label={label}
      labelRight={
        <span className="text-[9px] text-[hsl(var(--libtv-muted))]">
          {validClips.length} 段视频
        </span>
      }
      width={380}
      executing={isExecuting}
      ghostConnect={{ left: true, right: true }}
      onGhostConnect={handleGhostConnect}
    >
      <Handle type="target" position={Position.Left} id="video-in" style={{ top: '40%' }} />
      <Handle type="target" position={Position.Left} id="audio-in" style={{ top: '60%' }} />
      <Handle type="source" position={Position.Right} id="video-out" />

      <div className="p-3 space-y-2.5">
        {/* ── Preview ── */}
        <PreviewArea
          aspect="16/9"
          loading={isExecuting}
          placeholderIcon={Clapperboard}
          suggestions={!activeClip ? [
            { icon: Play, label: '连接上游视频节点后点击收集' },
          ] : undefined}
        >
          {activeClip ? (
            <video
              key={activeClip.url}
              src={activeClip.url}
              controls
              playsInline
              className="absolute inset-0 w-full h-full object-contain bg-black"
            />
          ) : undefined}
        </PreviewArea>

        {/* ── clip selector tabs ── */}
        {validClips.length > 1 && (
          <div className="flex gap-1 overflow-x-auto">
            {validClips.map((clip, i) => (
              <button
                key={clip.id}
                onClick={() => setActiveIdx(i)}
                className={`px-2 py-0.5 rounded text-[9px] font-medium whitespace-nowrap transition-colors ${
                  i === activeIdx
                    ? 'bg-rose-500 text-white'
                    : 'bg-[hsl(var(--libtv-chip-bg))] text-[hsl(var(--libtv-muted))] hover:bg-[hsl(var(--libtv-chip-bg-hover))]'
                }`}
              >
                {i + 1}. {clip.label}
              </button>
            ))}
          </div>
        )}

        {/* ── clip list ── */}
        {clips.length > 0 && (
          <div className="rounded-xl border border-[hsl(var(--libtv-line))] bg-[hsl(var(--libtv-chip-bg)/0.4)] overflow-hidden">
            <div className="max-h-[120px] overflow-y-auto divide-y divide-[hsl(var(--libtv-line))]">
              {clips.map((clip, i) => (
                <div key={clip.id} className={`flex items-center gap-1 px-2 py-1 text-[9px] ${
                  !clip.url ? 'bg-[hsl(var(--destructive)/0.06)]' : 'hover:bg-[hsl(var(--libtv-chip-bg-hover)/0.5)]'
                } transition-colors`}>
                  <span className="text-[hsl(var(--libtv-muted))] w-3 text-center shrink-0">{i + 1}</span>
                  <span className="flex-1 truncate text-[hsl(var(--foreground))]">{clip.label}</span>

                  {clip.url && (
                    <>
                      <button onClick={() => setActiveIdx(validClips.indexOf(clip))}
                        className="p-0.5 rounded hover:bg-[hsl(var(--libtv-chip-bg))]" title="预览">
                        <Play size={10} className="text-rose-500" />
                      </button>
                      <button onClick={() => downloadClip(clip, i)}
                        className="p-0.5 rounded hover:bg-[hsl(var(--libtv-chip-bg))]" title="下载">
                        <Download size={10} className="text-blue-400" />
                      </button>
                      <button onClick={() => window.open(clip.url, '_blank', 'noopener,noreferrer')}
                        className="p-0.5 rounded hover:bg-[hsl(var(--libtv-chip-bg))]" title="新标签页">
                        <ExternalLink size={10} className="text-[hsl(var(--libtv-muted))]" />
                      </button>
                    </>
                  )}

                  <button onClick={() => handleMove(i, 'up')} disabled={i === 0}
                    className="p-0.5 rounded hover:bg-[hsl(var(--libtv-chip-bg))] disabled:opacity-30">
                    <ArrowUp size={10} />
                  </button>
                  <button onClick={() => handleMove(i, 'down')} disabled={i === clips.length - 1}
                    className="p-0.5 rounded hover:bg-[hsl(var(--libtv-chip-bg))] disabled:opacity-30">
                    <ArrowDown size={10} />
                  </button>
                  <button onClick={() => handleRemove(clip.id)}
                    className="p-0.5 rounded hover:bg-[hsl(var(--destructive)/0.15)]">
                    <Trash2 size={10} className="text-[hsl(var(--destructive))]" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── error ── */}
        {errorMsg && (
          <div className="text-[10px] text-[hsl(var(--destructive))] bg-[hsl(var(--destructive)/0.08)] border border-[hsl(var(--destructive)/0.2)] rounded-lg px-2 py-1.5 break-all">
            {errorMsg}
          </div>
        )}

        {/* ── toolbar ── */}
        <NodeToolbar
          left={
            validClips.length > 0 ? (
              <button
                className="libtv-chip text-[9px] flex items-center gap-1"
                onClick={() => validClips.forEach((c, i) => downloadClip(c, i))}
                title="下载全部"
              >
                <Download size={11} /> 全部下载
              </button>
            ) : undefined
          }
          right={
            <SubmitButton
              loading={isExecuting}
              onClick={handleCollect}
            />
          }
        />
      </div>
    </NodeShell>
  )
}

export default memo(VideoStitchNode)
