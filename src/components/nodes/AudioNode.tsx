/**
 * AudioNode — LibTV-style text-to-speech node.
 *
 * Produces an audio clip from a text prompt. The "preview" is a compact
 * waveform-shaped banner (we don't render actual FFT — just a suggestive
 * animated bar row) that also hosts an inline <audio> player once an
 * output is available.
 */
import { memo, useCallback, useMemo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  Music, Mic, Sparkles, ChevronDown, AlertTriangle, Volume2,
} from 'lucide-react'

import { useFlowStore } from '@/store/flowStore'
import { DEFAULT_AUDIO_MODEL } from '@/providers/modelDefaults'
import { useBackendModels } from '@/hooks/useBackendModels'
import { sanitizeOnModelSwitch } from '@/providers/paramSanitizer'
import { executeNode } from '@/providers/nodeExecutor'
import type { ParamField } from '@/providers/types'

import {
  NodeShell, NodeToolbar, SubmitButton, ParamPopover,
} from '@/components/nodes/_shell'

function AudioNode({ id, data }: NodeProps) {
  const { models: backendAudioModels } = useBackendModels('audio')
  const audioModels = useMemo(() => {
    return backendAudioModels.map(m => ({ id: m.model_id, name: m.name }))
  }, [backendAudioModels])
  const modelId = String(data.model || DEFAULT_AUDIO_MODEL)
  const status = data.status as string
  const voice = String(data.voice || 'default')
  const text = String(data.text || '')

  const updateNodeData = useFlowStore((s) => s.updateNodeData)
  const nodes = useFlowStore((s) => s.nodes)

  const handleModelChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModelId = e.target.value
    const bm = backendAudioModels.find(m => m.model_id === newModelId)
    const schema = (bm?.param_schema?.length ? bm.param_schema : []) as ParamField[]
    const currentData = (nodes.find(n => n.id === id)?.data || {}) as Record<string, unknown>
    const { clean, removed } = sanitizeOnModelSwitch(currentData, schema)
    if (removed.length > 0) {
      const nullify: Record<string, unknown> = {}
      for (const k of removed) nullify[k] = undefined
      updateNodeData(id, { ...nullify, ...clean, model: newModelId })
    } else {
      updateNodeData(id, { ...clean, model: newModelId })
    }
  }, [id, updateNodeData, backendAudioModels, nodes])

  const handleVoiceChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateNodeData(id, { voice: e.target.value })
  }, [id, updateNodeData])

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateNodeData(id, { text: e.target.value })
  }, [id, updateNodeData])

  const isGenerating = status === 'generating'

  // Dispatch to executor so the SubmitButton actually does something. The
  // audioNode executor currently marks status='pending' (TTS adapter not wired
  // yet), but at least the user gets feedback instead of a dead button.
  const handleGenerate = useCallback(async () => {
    if (isGenerating) return
    if (!String(data.text || '').trim()) return
    await executeNode(id)
  }, [id, data.text, isGenerating])
  const label = (data.label as string) || '音频生成'
  const audioUrl = (data.outputAudioUrl || data.outputAudio) as string | undefined
  const errorMsg = data.errorMsg ? String(data.errorMsg) : null
  const currentModel = audioModels.find(m => m.id === modelId)

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
      icon={<Music size={11} strokeWidth={2.5} />}
      label={label}
      labelRight={labelRightSlot}
      width={340}
      executing={isGenerating}
      ghostConnect={{ left: true, right: true }}
      onGhostConnect={handleGhostConnect}
    >
      <Handle type="target" position={Position.Left} id="text-in" />
      <Handle type="source" position={Position.Right} id="audio-out" />

      <div className="p-3 space-y-2.5">
        {/* ── WAVEFORM PREVIEW BANNER ── */}
        <div className="libtv-preview h-20 flex items-center justify-center px-3" style={{ aspectRatio: 'auto' }}>
          {audioUrl ? (
            <audio src={audioUrl} controls className="w-full" />
          ) : isGenerating ? (
            <div className="flex items-end gap-0.5 h-10">
              {Array.from({ length: 24 }).map((_, i) => (
                <span
                  key={i}
                  className="w-[3px] rounded-full bg-[hsl(var(--libtv-accent)/0.8)] animate-pulse"
                  style={{ height: `${30 + Math.abs(Math.sin(i * 0.6)) * 40}%`, animationDelay: `${i * 40}ms` }}
                />
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[11px] text-[hsl(var(--libtv-muted))]">
              <Volume2 size={14} />
              <span>输入文本后点击 ↑ 生成语音</span>
            </div>
          )}
        </div>

        {/* ── TEXT INPUT ── */}
        <textarea
          value={text}
          onChange={handleTextChange}
          placeholder="输入要转为语音的文本..."
          rows={3}
          className="libtv-prompt"
        />

        {/* ── TOOLBAR ── */}
        <NodeToolbar
          left={
            <>
              <ParamPopover
                align="start"
                width={240}
                trigger={({ toggle }) => (
                  <button type="button" className="libtv-chip" onClick={toggle}>
                    <Sparkles size={12} strokeWidth={2} className="text-[hsl(var(--libtv-accent))]" />
                    <span className="truncate max-w-[100px]" title={currentModel?.name || modelId}>
                      {currentModel?.name || modelId}
                    </span>
                    <ChevronDown size={11} strokeWidth={2} />
                  </button>
                )}
              >
                <div className="space-y-0.5 max-h-[220px] overflow-y-auto">
                  {audioModels.length === 0 && (
                    <div className="text-[11px] text-[hsl(var(--libtv-muted))] p-2">加载模型列表...</div>
                  )}
                  {audioModels.map(m => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleModelChange({ target: { value: m.id } } as React.ChangeEvent<HTMLSelectElement>)}
                      className={`w-full text-left px-2 py-1.5 rounded-md text-[11px] transition-colors ${
                        m.id === modelId
                          ? 'bg-[hsl(var(--libtv-accent)/0.15)] text-[hsl(var(--libtv-accent))]'
                          : 'hover:bg-[hsl(var(--libtv-chip-bg))]'
                      }`}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              </ParamPopover>

              <ParamPopover
                align="start"
                width={220}
                trigger={({ toggle }) => (
                  <button type="button" className="libtv-chip" onClick={toggle}>
                    <Mic size={12} strokeWidth={2} />
                    <span>{voice || 'default'}</span>
                    <ChevronDown size={11} strokeWidth={2} />
                  </button>
                )}
              >
                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-[hsl(var(--libtv-chip-fg))]">声音</div>
                  <input
                    value={voice}
                    onChange={handleVoiceChange}
                    placeholder="default"
                    className="libtv-input"
                  />
                </div>
              </ParamPopover>
            </>
          }
          right={
            <SubmitButton
              onClick={handleGenerate}
              disabled={!text.trim() || isGenerating}
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

export default memo(AudioNode)
