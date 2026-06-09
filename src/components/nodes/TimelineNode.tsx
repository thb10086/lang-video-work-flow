/**
 * TimelineNode — horizontal multi-track timeline.
 *
 * Sits between content-generation nodes (video/audio/storyboard) and the
 * downstream stitch node. Renders:
 *   - Track 1 (video):    each clip drawn as a colored segment, width proportional to duration
 *   - Track 2 (audio):    audio inputs drawn beneath, length-aligned
 *   - Cut points:         vertical hairlines at scene-change boundaries
 *   - Total duration:     summary chip in the top-right
 *
 * Phase 2.5 minimum viable scope: read-only visualisation + structured
 * cuts JSON output. Drag-to-reorder and per-clip trim sliders are
 * intentionally out of scope; they can be layered on later because the
 * data model already separates clips from positions.
 *
 * Output (`outputCuts`) shape:
 *   {
 *     totalDurationSec: number,
 *     videoTrack: Array<{ id, url, label, startSec, durationSec }>,
 *     audioTrack: Array<{ id, url, label, startSec, durationSec }>,
 *     cutPoints: number[]   // seconds where scene changes occur
 *   }
 */
import { memo, useCallback, useMemo, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Film, Music, Clock } from 'lucide-react'
import { useFlowStore } from '@/store/flowStore'
import { executeNode } from '@/providers/nodeExecutor'
import { NodeShell, NodeToolbar, SubmitButton } from './_shell'

interface TimelineClip {
  id: string
  url: string
  label: string
  durationSec: number
}

interface TimelineCuts {
  totalDurationSec: number
  videoTrack: Array<{ id: string; url: string; label: string; startSec: number; durationSec: number }>
  audioTrack: Array<{ id: string; url: string; label: string; startSec: number; durationSec: number }>
  cutPoints: number[]
}

const TRACK_PALETTE = [
  'bg-rose-500/70 hover:bg-rose-500',
  'bg-purple-500/70 hover:bg-purple-500',
  'bg-blue-500/70 hover:bg-blue-500',
  'bg-emerald-500/70 hover:bg-emerald-500',
  'bg-amber-500/70 hover:bg-amber-500',
  'bg-cyan-500/70 hover:bg-cyan-500',
]

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function TimelineNode({ id, data }: NodeProps) {
  const label = String(data.label || '时间轴')
  const videoClips = (data.videoClips as TimelineClip[]) || []
  const audioClips = (data.audioClips as TimelineClip[]) || []
  const status = String(data.status || 'idle')
  const errorMsg = data.errorMsg ? String(data.errorMsg) : null
  const [isExecuting, setIsExecuting] = useState(false)

  const nodes = useFlowStore((s) => s.nodes)

  // Compute timeline geometry once per render. Both tracks share the same
  // total length (the longer of the two) so the visualisation aligns.
  const totalDurationSec = useMemo(() => {
    const videoTotal = videoClips.reduce((s, c) => s + (c.durationSec || 0), 0)
    const audioTotal = audioClips.reduce((s, c) => s + (c.durationSec || 0), 0)
    return Math.max(videoTotal, audioTotal, 1)
  }, [videoClips, audioClips])

  // Pre-compute per-clip positions so the JSX is just a width/offset map.
  const videoPositions = useMemo(() => {
    let cursor = 0
    return videoClips.map((c) => {
      const start = cursor
      cursor += c.durationSec || 0
      return { ...c, startSec: start }
    })
  }, [videoClips])

  const audioPositions = useMemo(() => {
    let cursor = 0
    return audioClips.map((c) => {
      const start = cursor
      cursor += c.durationSec || 0
      return { ...c, startSec: start }
    })
  }, [audioClips])

  // Cut points = scene boundaries (between video clips). Audio boundaries
  // are intentionally not surfaced as cuts — they're for mixing, not editing.
  const cutPoints = useMemo(
    () => videoPositions.slice(1).map((c) => c.startSec),
    [videoPositions],
  )

  const handleExecute = useCallback(async () => {
    if (isExecuting) return
    setIsExecuting(true)
    try {
      await executeNode(id)
    } finally {
      setIsExecuting(false)
    }
  }, [id, isExecuting])

  const handleGhostConnect = useCallback((side: 'left' | 'right') => {
    const self = nodes.find((n) => n.id === id)
    if (!self) return
    const offset = side === 'left' ? -340 : 340
    const position = { x: (self.position?.x ?? 0) + offset, y: self.position?.y ?? 0 }
    window.dispatchEvent(new CustomEvent('libtv-ghost-connect', {
      detail: { sourceNodeId: id, side, position },
    }))
  }, [nodes, id])

  const totalClips = videoClips.length + audioClips.length

  const labelRight = totalClips > 0 ? (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
      <Clock className="w-3 h-3" />
      {formatDuration(totalDurationSec)}
    </span>
  ) : null

  return (
    <NodeShell
      icon={<Film size={11} strokeWidth={2.5} />}
      label={label}
      labelRight={labelRight}
      width={460}
      executing={isExecuting}
      status={status}
      ghostConnect={{ left: true, right: true }}
      onGhostConnect={handleGhostConnect}
    >
      <Handle type="target" position={Position.Left}  id="video-in"     style={{ top: '30%' }} />
      <Handle type="target" position={Position.Left}  id="audio-in"     style={{ top: '60%' }} />
      <Handle type="target" position={Position.Left}  id="subtitles-in" style={{ top: '85%' }} />
      <Handle type="source" position={Position.Right} id="output-cuts" />

      <div className="p-3 space-y-3">
        {totalClips === 0 ? (
          <div className="text-xs text-muted-foreground/70 italic text-center py-4">
            连接上游视频 / 音频节点，然后点击"生成时间轴"
          </div>
        ) : (
          <>
            {/* ── Video track ── */}
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/80 uppercase tracking-wider">
                <Film className="w-3 h-3" /> 视频轨 · {videoClips.length} 段
              </div>
              <div className="relative h-8 rounded bg-muted/40 overflow-hidden">
                {videoPositions.map((c, i) => {
                  const widthPct = (c.durationSec / totalDurationSec) * 100
                  const leftPct = (c.startSec / totalDurationSec) * 100
                  return (
                    <div
                      key={c.id}
                      className={`absolute top-0 h-full ${TRACK_PALETTE[i % TRACK_PALETTE.length]} flex items-center justify-center transition-colors`}
                      style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 2)}%` }}
                      title={`${c.label} · ${formatDuration(c.durationSec)}`}
                    >
                      <span className="text-[9px] text-white/95 font-medium truncate px-1">
                        {c.label || `片段${i + 1}`}
                      </span>
                    </div>
                  )
                })}
                {/* Cut point hairlines — render on top of segments. */}
                {cutPoints.map((cp, i) => (
                  <div
                    key={`cut-${i}`}
                    className="absolute top-0 bottom-0 w-px bg-foreground/40 pointer-events-none"
                    style={{ left: `${(cp / totalDurationSec) * 100}%` }}
                  />
                ))}
              </div>
            </div>

            {/* ── Audio track ── */}
            {audioClips.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/80 uppercase tracking-wider">
                  <Music className="w-3 h-3" /> 音频轨 · {audioClips.length} 段
                </div>
                <div className="relative h-5 rounded bg-muted/40 overflow-hidden">
                  {audioPositions.map((c, i) => {
                    const widthPct = (c.durationSec / totalDurationSec) * 100
                    const leftPct = (c.startSec / totalDurationSec) * 100
                    return (
                      <div
                        key={c.id}
                        className={`absolute top-0 h-full ${TRACK_PALETTE[(i + 3) % TRACK_PALETTE.length]} opacity-80`}
                        style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 2)}%` }}
                        title={`${c.label} · ${formatDuration(c.durationSec)}`}
                      />
                    )
                  })}
                </div>
              </div>
            )}

            {/* ── Stats footer ── */}
            <div className="flex items-center justify-between text-[10px] text-muted-foreground/70 pt-1 border-t border-border/40">
              <span>{cutPoints.length} 个剪切点</span>
              <span>总时长 {formatDuration(totalDurationSec)}</span>
            </div>

            {errorMsg && (
              <div className="text-[10px] text-red-500 bg-red-500/10 rounded px-2 py-1">
                {errorMsg}
              </div>
            )}
          </>
        )}

        <NodeToolbar
          left={
            <span className="text-[10px] text-muted-foreground/70 px-1.5">
              {totalClips > 0 ? `${totalClips} 段已就绪` : '等待上游'}
            </span>
          }
          right={
            <SubmitButton
              onClick={handleExecute}
              disabled={isExecuting || totalClips === 0}
              loading={isExecuting}
              title={totalClips > 0 ? '重新生成时间轴' : '生成时间轴'}
            />
          }
        />
      </div>
    </NodeShell>
  )
}

export default memo(TimelineNode)
export type { TimelineCuts, TimelineClip }
