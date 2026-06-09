/**
 * ContinuityCheckNode — LibTV-style visual continuity checker.
 *
 * Takes two adjacent-shot images (image-a, image-b) and runs an LLM
 * analysis to check character / lighting / colour / scene / perspective
 * consistency. Results are rendered as a traffic-light list.
 */
import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  ScanEye, AlertTriangle, CheckCircle2, XCircle, Image as ImageIcon,
} from 'lucide-react'

import { useFlowStore } from '@/store/flowStore'
import { backendApi } from '@/api/backend'
import { useSettingsStore } from '@/store/settingsStore'
import { TASK_TOKEN_BUDGETS } from '@/providers/modelDefaults'

import {
  NodeShell, NodeToolbar, SubmitButton,
} from '@/components/nodes/_shell'

interface CheckResult {
  aspect: string
  status: 'pass' | 'warning' | 'fail'
  detail: string
}

function ContinuityCheckNode({ id, data }: NodeProps) {
  const status = String(data.status || 'idle')
  const label = String(data.label || '连续性检查')
  const imageA = data.imageA as string | null
  const imageB = data.imageB as string | null
  const results = (data.results as CheckResult[]) || []
  const errorMsg = data.errorMsg ? String(data.errorMsg) : null

  const updateNodeData = useFlowStore((s) => s.updateNodeData)

  const handleCheck = useCallback(async () => {
    if (status === 'checking') return

    const imgA = data.imageA as string | null
    const imgB = data.imageB as string | null
    if (!imgA && !imgB) return

    updateNodeData(id, { status: 'checking', errorMsg: null, results: [] })

    try {
      const settings = useSettingsStore.getState()
      const modelId = settings.defaultLLMModel

      const prompt = `对比这两张相邻镜头的图片，检查视觉连续性。
分析以下维度并输出 JSON 数组:

1. 角色一致性 (character_consistency) - 角色外观、服装、体型是否一致
2. 光照一致性 (lighting_consistency) - 光源方向、强度、色温是否匹配
3. 色调一致性 (color_consistency) - 整体色调、饱和度、对比度是否统一
4. 场景一致性 (scene_consistency) - 背景环境、道具摆放是否合理衔接
5. 透视一致性 (perspective_consistency) - 景深、视角切换是否符合电影语法

输出格式:
[
  {"aspect": "角色一致性", "status": "pass|warning|fail", "detail": "具体描述"},
  ...
]

${!imgA || !imgB ? '注意：只有一张图片，请基于单张图片评估其质量和潜在连续性问题。' : ''}`

      const refs: string[] = []
      if (imgA) refs.push(imgA)
      if (imgB) refs.push(imgB)

      const result = await backendApi.chat({
        model_id: modelId,
        prompt,
        system_prompt: '你是专业的影视后期连续性检查师(Script Supervisor)。擅长发现相邻镜头间的视觉不一致问题。',
        temperature: 0.3,
        max_tokens: TASK_TOKEN_BUDGETS.CONTINUITY_CHECK,
      })

      const text = result.text || ''
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        throw new Error('LLM 未返回有效的检查结果 JSON')
      }

      const parsed = JSON.parse(jsonMatch[0]) as CheckResult[]
      updateNodeData(id, { status: 'done', results: parsed })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '检查失败'
      updateNodeData(id, { status: 'error', errorMsg: msg })
    }
  }, [id, data.imageA, data.imageB, status, updateNodeData])

  const isChecking = status === 'checking'
  const passCount = results.filter(r => r.status === 'pass').length
  const warnCount = results.filter(r => r.status === 'warning').length
  const failCount = results.filter(r => r.status === 'fail').length
  const nodes = useFlowStore(s => s.nodes)

  const handleGhostConnect = useCallback((side: 'left' | 'right') => {
    const self = nodes.find(n => n.id === id)
    if (!self) return
    const offset = side === 'left' ? -340 : 340
    const position = { x: (self.position?.x ?? 0) + offset, y: self.position?.y ?? 0 }
    window.dispatchEvent(new CustomEvent('libtv-ghost-connect', {
      detail: { sourceNodeId: id, side, position },
    }))
  }, [nodes, id])

  const statusIcon = (s: CheckResult['status']) =>
    s === 'pass'    ? <CheckCircle2 size={11} className="text-[hsl(var(--success))]" /> :
    s === 'warning' ? <AlertTriangle size={11} className="text-amber-400" /> :
                      <XCircle size={11} className="text-[hsl(var(--destructive))]" />

  const labelRightSlot = (
    <div className="flex items-center gap-1">
      {results.length > 0 && (
        <>
          {passCount > 0 && <span className="text-[9px] text-[hsl(var(--success))]">{passCount}✓</span>}
          {warnCount > 0 && <span className="text-[9px] text-amber-400">{warnCount}⚠</span>}
          {failCount > 0 && <span className="text-[9px] text-[hsl(var(--destructive))]">{failCount}✗</span>}
        </>
      )}
      {status === 'error' && <AlertTriangle size={11} className="text-[hsl(var(--destructive))]" />}
    </div>
  )

  return (
    <NodeShell
      icon={<ScanEye size={11} strokeWidth={2.5} />}
      label={label}
      labelRight={labelRightSlot}
      width={380}
      executing={isChecking}
      ghostConnect={{ left: true, right: true }}
      onGhostConnect={handleGhostConnect}
    >
      <Handle type="target" position={Position.Left} id="image-a" style={{ top: '35%' }} />
      <Handle type="target" position={Position.Left} id="image-b" style={{ top: '65%' }} />
      <Handle type="source" position={Position.Right} id="report-out" />

      <div className="p-3 space-y-2.5">
        {/* ── SIDE-BY-SIDE IMAGE PREVIEW ── */}
        <div className="grid grid-cols-2 gap-2">
          {[{ img: imageA, tag: '镜头 A' }, { img: imageB, tag: '镜头 B' }].map(({ img, tag }) => (
            <div key={tag} className="space-y-0.5">
              <span className="text-[9px] text-[hsl(var(--libtv-muted))]">{tag}</span>
              <div className="libtv-preview aspect-video flex items-center justify-center">
                {img ? (
                  <img src={img} alt={tag} className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <ImageIcon size={18} className="text-[hsl(var(--libtv-muted)/0.4)]" />
                )}
              </div>
            </div>
          ))}
        </div>

        {/* ── RESULTS LIST ── */}
        {results.length > 0 && (
          <div className="rounded-xl border border-[hsl(var(--libtv-line))] bg-[hsl(var(--libtv-chip-bg)/0.4)] overflow-hidden">
            <div className="max-h-[180px] overflow-y-auto divide-y divide-[hsl(var(--libtv-line))]">
              {results.map((r, i) => (
                <div key={i} className="px-2.5 py-1.5 flex items-start gap-2 hover:bg-[hsl(var(--libtv-chip-bg-hover)/0.5)] transition-colors">
                  <span className="mt-0.5 shrink-0">{statusIcon(r.status)}</span>
                  <div className="min-w-0">
                    <span className="text-[10px] font-medium text-[hsl(var(--foreground))]">{r.aspect}</span>
                    <p className="text-[10px] text-[hsl(var(--libtv-muted))] line-clamp-2">{r.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── TOOLBAR ── */}
        <NodeToolbar
          right={
            <SubmitButton
              onClick={handleCheck}
              disabled={(!imageA && !imageB) || isChecking}
              loading={isChecking}
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

export default memo(ContinuityCheckNode)
