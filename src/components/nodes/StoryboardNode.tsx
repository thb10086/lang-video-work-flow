/**
 * StoryboardNode — LibTV-style AI storyboard breakdown.
 *
 * Input is a free-form script; AI returns an array of `ShotItem`s which are
 * rendered as a compact shot-card list. A toolbar chip expands the shots
 * into image+video node pairs on the canvas (auto-connected).
 *
 * Unlike the generation nodes, the preview surface is not an image but a
 * scrollable list, so we skip PreviewArea and use a hairline-bordered
 * scroll container instead.
 */
import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  Film, AlertTriangle, Layers, Clapperboard,
} from 'lucide-react'

import { useFlowStore } from '@/store/flowStore'
import { backendApi } from '@/api/backend'
import { useSettingsStore } from '@/store/settingsStore'
import {
  DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, DEFAULT_VIDEO_SIZE,
  DEFAULT_VIDEO_DURATION, TASK_TOKEN_BUDGETS,
} from '@/providers/modelDefaults'

import {
  NodeShell, NodeToolbar, SubmitButton,
} from '@/components/nodes/_shell'

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

function StoryboardNode({ id, data }: NodeProps) {
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

  const isGenerating = status === 'generating'
  const nodes = useFlowStore(s => s.nodes)
  const handleGhostConnect = useCallback((side: 'left' | 'right') => {
    const self = nodes.find(n => n.id === id)
    if (!self) return
    const offset = side === 'left' ? -360 : 360
    const position = { x: (self.position?.x ?? 0) + offset, y: self.position?.y ?? 0 }
    window.dispatchEvent(new CustomEvent('libtv-ghost-connect', {
      detail: { sourceNodeId: id, side, position },
    }))
  }, [nodes, id])

  const labelRightSlot = (
    <div className="flex items-center gap-1">
      {shots.length > 0 && (
        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-[hsl(var(--libtv-chip-bg))] text-[hsl(var(--libtv-chip-fg))]">
          {shots.length} 镜
        </span>
      )}
      {status === 'done' && <span className="text-[hsl(var(--success))]">✓</span>}
      {status === 'error' && <AlertTriangle size={11} className="text-[hsl(var(--destructive))]" />}
    </div>
  )

  return (
    <NodeShell
      icon={<Film size={11} strokeWidth={2.5} />}
      label={label}
      labelRight={labelRightSlot}
      width={420}
      executing={isGenerating}
      ghostConnect={{ left: true, right: true }}
      onGhostConnect={handleGhostConnect}
    >
      <Handle type="target" position={Position.Left} id="script-in" />
      <Handle type="source" position={Position.Right} id="scenes-out" />

      <div className="p-3 space-y-2.5">
        {/* ── INPUT ── */}
        <textarea
          value={script}
          onChange={handleScriptChange}
          placeholder="粘贴剧本或一句话创意，AI 将自动拆解为 3-8 个分镜..."
          rows={4}
          className="libtv-prompt"
        />

        {/* ── SHOT LIST — hairline bordered scrollable section ── */}
        {shots.length > 0 && (
          <div className="rounded-xl border border-[hsl(var(--libtv-line))] bg-[hsl(var(--libtv-chip-bg)/0.4)] overflow-hidden">
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[hsl(var(--libtv-line))]">
              <span className="text-[10px] text-[hsl(var(--libtv-muted))] font-medium">
                分镜列表
              </span>
              <button
                type="button"
                onClick={handleExpandToNodes}
                className="libtv-chip libtv-chip--ghost !py-0.5 !px-1.5"
                title="为每个分镜创建 imageGen + videoGen 节点，并自动连接"
              >
                <Layers size={11} strokeWidth={2} />
                <span>展开为节点</span>
              </button>
            </div>
            <div className="max-h-[220px] overflow-y-auto divide-y divide-[hsl(var(--libtv-line))]">
              {shots.map((shot, i) => (
                <div key={i} className="px-2.5 py-2 space-y-0.5 hover:bg-[hsl(var(--libtv-chip-bg-hover)/0.5)] transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-[hsl(var(--foreground))] flex items-center gap-1">
                      <Clapperboard size={10} className="text-[hsl(var(--libtv-accent))]" />
                      镜头 {shot.id || i + 1}
                    </span>
                    <span className="text-[9px] text-[hsl(var(--libtv-muted))] truncate max-w-[60%] text-right">
                      {shot.duration}s · {shot.camera}
                    </span>
                  </div>
                  <p className="text-[10px] text-[hsl(var(--libtv-muted))]">{shot.scene}</p>
                  {shot.charactersPresent && shot.charactersPresent.length > 0 && (
                    <p className="text-[9px] text-[hsl(var(--libtv-accent))]">
                      角色：{shot.charactersPresent.join(', ')}
                    </p>
                  )}
                  <p className="text-[10px] text-[hsl(var(--foreground)/0.8)] line-clamp-2">
                    {shot.imagePrompt || shot.description}
                  </p>
                  {shot.dialogue && (
                    <p className="text-[9px] text-amber-500 italic line-clamp-1">
                      “{shot.dialogue}”
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── TOOLBAR ── */}
        <NodeToolbar
          right={
            <SubmitButton
              onClick={handleGenerateStoryboard}
              disabled={!script.trim() || isGenerating}
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

export default memo(StoryboardNode)
