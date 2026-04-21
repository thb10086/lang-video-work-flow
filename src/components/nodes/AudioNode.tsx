import { memo, useCallback, useMemo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Music, Play, Loader2 } from 'lucide-react'
import { useFlowStore } from '@/store/flowStore'
import { useBackendModels } from '@/hooks/useBackendModels'

function AudioNode({ id, data, selected }: NodeProps) {
  const { models: backendAudioModels } = useBackendModels('audio')
  const audioModels = useMemo(() => {
    return backendAudioModels.map(m => ({ id: m.model_id, name: m.name }))
  }, [backendAudioModels])
  const modelId = String(data.model || 'elevenlabs')
  const status = data.status as string
  const voice = String(data.voice || 'default')
  const text = String(data.text || '')

  const updateNodeData = useFlowStore((s) => s.updateNodeData)

  const handleModelChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    updateNodeData(id, { model: e.target.value })
  }, [id, updateNodeData])

  const handleVoiceChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateNodeData(id, { voice: e.target.value })
  }, [id, updateNodeData])

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateNodeData(id, { text: e.target.value })
  }, [id, updateNodeData])

  return (
    <div className={`workflow-node bg-card border-2 rounded-xl shadow-lg w-[240px] ${
      selected ? 'border-orange-500 shadow-orange-200' : 'border-border'
    }`}>
      <Handle type="target" position={Position.Left} id="text-in" className="!w-3 !h-3 !bg-orange-500" />

      <div className="flex items-center gap-2 px-4 py-3 bg-orange-500/10 rounded-t-xl border-b border-border">
        <Music className="w-4 h-4 text-orange-500" />
        <span className="font-semibold text-sm">{(data.label as string) || '音频生成'}</span>
      </div>

      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">模型</span>
          <select
            value={modelId}
            onChange={handleModelChange}
            className="text-xs font-medium bg-orange-50 text-orange-700 px-2 py-1 rounded-md border border-orange-200 outline-none cursor-pointer hover:bg-orange-100 transition-colors"
          >
            {audioModels.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">声音</span>
          <input
            value={voice}
            onChange={handleVoiceChange}
            className="w-24 text-xs px-2 py-1 rounded-md border border-border bg-muted/30 outline-none focus:ring-1 focus:ring-orange-400"
            placeholder="default"
          />
        </div>

        <textarea
          value={text}
          onChange={handleTextChange}
          placeholder="输入要转为语音的文本..."
          rows={2}
          className="w-full text-xs rounded-md border border-border bg-muted/30 p-2 resize-none focus:outline-none focus:ring-1 focus:ring-orange-400 placeholder:text-muted-foreground/50"
        />
      </div>

      <div className="px-4 py-2 border-t border-border">
        <button className={`w-full py-1.5 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 ${
          status === 'generating'
            ? 'bg-yellow-100 text-yellow-700'
            : 'bg-orange-500 text-white hover:bg-orange-600'
        } transition-colors`}>
          {status === 'generating' ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> 生成中...</>
          ) : (
            <><Play className="w-3 h-3" /> 生成音频</>
          )}
        </button>
      </div>

      <Handle type="source" position={Position.Right} id="audio-out" className="!w-3 !h-3 !bg-orange-500" />
    </div>
  )
}

export default memo(AudioNode)
