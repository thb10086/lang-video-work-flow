import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Film, Play, Loader2, CheckCircle2, AlertCircle, Plus } from 'lucide-react'
import { useFlowStore } from '@/store/flowStore'
import { backendApi } from '@/api/backend'
import { useSettingsStore } from '@/store/settingsStore'
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, DEFAULT_VIDEO_SIZE, DEFAULT_VIDEO_DURATION, TASK_TOKEN_BUDGETS } from '@/providers/modelDefaults'

interface ShotItem {
  id: number
  scene: string
  camera: string
  duration: number
  mood: string
  description?: string
  imagePrompt?: string
  videoPrompt?: string
  dialogue?: string
  dialogueEN?: string
  audioHint?: string
  charactersPresent?: string[]
  emotionIntensity?: number
}

function StoryboardNode({ id, data, selected }: NodeProps) {
  const status = String(data.status || 'idle')
  const label = String(data.label || '分镜脚本')
  const script = String(data.script || '')
  const shots = (data.shots as ShotItem[]) || []
  const errorMsg = data.errorMsg ? String(data.errorMsg) : null

  const updateNodeData = useFlowStore((s) => s.updateNodeData)
  const addNode = useFlowStore((s) => s.addNode)
  const onConnect = useFlowStore((s) => s.onConnect)

  const handleScriptChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateNodeData(id, { script: e.target.value })
  }, [id, updateNodeData])

  const handleGenerateStoryboard = useCallback(async () => {
    const currentScript = String(data.script || '')
    if (!currentScript.trim() || status === 'generating') return

    updateNodeData(id, { status: 'generating', errorMsg: null, shots: [] })

    try {
      const settings = useSettingsStore.getState()
      const modelId = settings.defaultLLMModel

      const result = await backendApi.chat({
        model_id: modelId,
        prompt: currentScript,
        system_prompt: `You are a professional storyboard artist. Break down the script into shots.

Output ONLY a valid JSON array:
[
  {
    "id": 1,
    "scene": "Scene location (e.g. INT Coffee Shop - Morning)",
    "camera": "Shot type + movement (e.g. Medium close-up, slow dolly-in)",
    "duration": <seconds, 4-15>,
    "mood": "Emotional tone",
    "emotionIntensity": <1-10>,
    "charactersPresent": ["Character A"],
    "imagePrompt": "ENGLISH image prompt: [Subject+appearance] + [Pose] + [Environment] + [Lighting] + [Style+Quality] + [Composition]",
    "videoPrompt": "ENGLISH video prompt: [Camera]: movement. [Subject]: anchor+action. [Environment]: setting+lighting. [Quality]: Cinematic 4K. [Negative]: No morphing, no identity drift.",
    "dialogue": "中文对话/旁白（无则空字符串）",
    "dialogueEN": "English translation (empty if none)",
    "audioHint": "Audio cue: ambient sound, music mood"
  }
]

Rules: 3-8 shots, 4-15s each, imagePrompt/videoPrompt in English, embed character appearance keywords.`,
        temperature: 0.7,
        max_tokens: TASK_TOKEN_BUDGETS.STORYBOARD,
      })

      const text = result.text || ''
      // Extract JSON from response
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        throw new Error('LLM 未返回有效的分镜 JSON')
      }

      const parsed = JSON.parse(jsonMatch[0]) as ShotItem[]
      // Backward compat: ensure description field exists
      for (const shot of parsed) {
        if (!shot.description && shot.imagePrompt) shot.description = shot.imagePrompt
      }
      updateNodeData(id, { status: 'done', shots: parsed })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生成分镜失败'
      updateNodeData(id, { status: 'error', errorMsg: msg })
    }
  }, [id, data.script, status, updateNodeData])

  // Expand storyboard into image+video node pairs on the canvas
  const handleExpandToNodes = useCallback(() => {
    const currentShots = (data.shots as ShotItem[]) || []
    if (currentShots.length === 0) return

    // Get this node's position from store
    const thisNode = useFlowStore.getState().nodes.find(n => n.id === id)
    const baseX = (thisNode?.position.x || 0) + 400
    const baseY = (thisNode?.position.y || 0)

    currentShots.forEach((shot, i) => {
      // Use enhanced fields if available, fall back to legacy description
      const imgPrompt = shot.imagePrompt || shot.description || ''
      const vidPrompt = shot.videoPrompt
        || `[Camera]: ${shot.camera}. [Subject]: ${shot.description || ''}. [Environment]: ${shot.mood}. [Quality]: Cinematic 4K, 24fps. [Negative]: No morphing, no identity drift.`

      const imgId = addNode('imageGen', { x: baseX, y: baseY + i * 280 }, {
        label: `镜头${shot.id} 关键帧`,
        model: DEFAULT_IMAGE_MODEL,
        prompt: imgPrompt,
        aspectRatio: '16:9',
        outputImage: null,
        status: 'idle',
      })

      const vidId = addNode('videoGen', { x: baseX + 380, y: baseY + i * 280 }, {
        label: `镜头${shot.id} 视频`,
        model: DEFAULT_VIDEO_MODEL,
        prompt: vidPrompt,
        size: DEFAULT_VIDEO_SIZE,
        duration: Math.min(shot.duration, DEFAULT_VIDEO_DURATION),
        outputVideo: null,
        status: 'idle',
      })

      // Auto-connect: image → video first frame
      onConnect({
        source: imgId,
        target: vidId,
        sourceHandle: 'image-out',
        targetHandle: 'first-frame',
      })
    })
  }, [id, data.shots, addNode, onConnect])

  const borderClass = status === 'generating'
    ? 'border-yellow-400 shadow-yellow-200/50 animate-pulse'
    : status === 'done'
    ? 'border-green-500 shadow-green-200/50'
    : status === 'error'
    ? 'border-red-500 shadow-red-200/50'
    : selected
    ? 'border-purple-500 shadow-purple-200'
    : 'border-border'

  return (
    <div className={`workflow-node bg-card border-2 rounded-xl shadow-lg w-[320px] transition-all duration-300 ${borderClass}`}>
      <Handle type="target" position={Position.Left} id="script-in" className="!w-3 !h-3 !bg-amber-500" />

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-purple-500/10 rounded-t-xl border-b border-border">
        <Film className="w-4 h-4 text-purple-500" />
        <span className="font-semibold text-sm">{label}</span>
        {status === 'done' && <CheckCircle2 className="w-3.5 h-3.5 text-green-500 ml-auto" />}
        {status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-red-500 ml-auto" />}
      </div>

      {/* Content */}
      <div className="p-3 space-y-2">
        {/* Script Input */}
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">剧本 / 创意描述</label>
          <textarea
            value={script}
            onChange={handleScriptChange}
            placeholder="输入剧本或创意描述，AI将自动拆解为分镜..."
            rows={3}
            className="w-full text-xs rounded-md border border-border bg-muted/30 p-2 resize-none focus:outline-none focus:ring-1 focus:ring-purple-400 placeholder:text-muted-foreground/50"
          />
        </div>

        {/* Error */}
        {errorMsg && (
          <div className="text-[10px] text-red-500 bg-red-50 rounded px-2 py-1 break-all">{errorMsg}</div>
        )}

        {/* Shot List */}
        {shots.length > 0 && (
          <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground font-medium">分镜列表 ({shots.length})</span>
              <button
                onClick={handleExpandToNodes}
                className="text-[10px] text-purple-500 hover:text-purple-600 flex items-center gap-0.5"
              >
                <Plus className="w-3 h-3" /> 展开为节点
              </button>
            </div>
            {shots.map((shot, i) => (
              <div key={i} className="bg-muted/40 rounded p-2 space-y-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-foreground">镜头 {shot.id || i + 1}</span>
                  <span className="text-[9px] text-muted-foreground">{shot.duration}s | {shot.camera}</span>
                </div>
                <p className="text-[10px] text-muted-foreground">{shot.scene}</p>
                {shot.charactersPresent && shot.charactersPresent.length > 0 && (
                  <p className="text-[9px] text-blue-500">{shot.charactersPresent.join(', ')}</p>
                )}
                <p className="text-[10px] text-foreground/80 line-clamp-2">{shot.imagePrompt || shot.description}</p>
                {shot.dialogue && (
                  <p className="text-[9px] text-amber-600 italic line-clamp-1">{shot.dialogue}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border">
        <button
          onClick={handleGenerateStoryboard}
          disabled={!script.trim() || status === 'generating'}
          className={`w-full py-1.5 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            status === 'generating'
              ? 'bg-yellow-100 text-yellow-700'
              : status === 'done'
              ? 'bg-green-500 text-white hover:bg-green-600'
              : 'bg-purple-500 text-white hover:bg-purple-600'
          }`}
        >
          {status === 'generating' ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> 生成分镜中...</>
          ) : status === 'done' ? (
            <><Play className="w-3 h-3" /> 重新生成</>
          ) : (
            <><Play className="w-3 h-3" /> AI 拆解分镜</>
          )}
        </button>
      </div>

      <Handle type="source" position={Position.Right} id="scenes-out" className="!w-3 !h-3 !bg-purple-400" />
    </div>
  )
}

export default memo(StoryboardNode)
