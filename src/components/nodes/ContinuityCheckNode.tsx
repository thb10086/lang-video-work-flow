import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ScanEye, Play, Loader2, CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react'
import { useFlowStore } from '@/store/flowStore'
import { backendApi } from '@/api/backend'
import { useSettingsStore } from '@/store/settingsStore'
import { TASK_TOKEN_BUDGETS } from '@/providers/modelDefaults'

interface CheckResult {
  aspect: string
  status: 'pass' | 'warning' | 'fail'
  detail: string
}

function ContinuityCheckNode({ id, data, selected }: NodeProps) {
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

  const passCount = results.filter(r => r.status === 'pass').length
  const warnCount = results.filter(r => r.status === 'warning').length
  const failCount = results.filter(r => r.status === 'fail').length

  const borderClass = status === 'checking'
    ? 'border-yellow-400 shadow-yellow-200/50 animate-pulse'
    : status === 'done' && failCount === 0
    ? 'border-green-500 shadow-green-200/50'
    : status === 'done' && failCount > 0
    ? 'border-red-500 shadow-red-200/50'
    : status === 'error'
    ? 'border-red-500 shadow-red-200/50'
    : selected
    ? 'border-teal-500 shadow-teal-200'
    : 'border-border'

  return (
    <div className={`workflow-node bg-card border-2 rounded-xl shadow-lg w-[280px] transition-all duration-300 ${borderClass}`}>
      <Handle type="target" position={Position.Left} id="image-a" className="!w-3 !h-3 !bg-blue-500" style={{ top: '35%' }} />
      <Handle type="target" position={Position.Left} id="image-b" className="!w-3 !h-3 !bg-blue-500" style={{ top: '65%' }} />

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-teal-500/10 rounded-t-xl border-b border-border">
        <ScanEye className="w-4 h-4 text-teal-500" />
        <span className="font-semibold text-sm">{label}</span>
        {status === 'done' && failCount === 0 && <CheckCircle2 className="w-3.5 h-3.5 text-green-500 ml-auto" />}
        {status === 'done' && failCount > 0 && <AlertCircle className="w-3.5 h-3.5 text-red-500 ml-auto" />}
      </div>

      {/* Content */}
      <div className="p-3 space-y-2">
        {/* Image Previews */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-0.5">
            <span className="text-[9px] text-muted-foreground">镜头 A</span>
            <div className="h-16 rounded border border-border overflow-hidden bg-muted/30 flex items-center justify-center">
              {imageA ? (
                <img src={imageA} alt="A" className="w-full h-full object-cover" />
              ) : (
                <span className="text-[9px] text-muted-foreground">未连接</span>
              )}
            </div>
          </div>
          <div className="space-y-0.5">
            <span className="text-[9px] text-muted-foreground">镜头 B</span>
            <div className="h-16 rounded border border-border overflow-hidden bg-muted/30 flex items-center justify-center">
              {imageB ? (
                <img src={imageB} alt="B" className="w-full h-full object-cover" />
              ) : (
                <span className="text-[9px] text-muted-foreground">未连接</span>
              )}
            </div>
          </div>
        </div>

        {/* Error */}
        {errorMsg && (
          <div className="text-[10px] text-red-500 bg-red-50 rounded px-2 py-1 break-all">{errorMsg}</div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[10px]">
              {passCount > 0 && <span className="text-green-600">{passCount} 通过</span>}
              {warnCount > 0 && <span className="text-yellow-600">{warnCount} 警告</span>}
              {failCount > 0 && <span className="text-red-600">{failCount} 不一致</span>}
            </div>
            <div className="space-y-1 max-h-[150px] overflow-y-auto">
              {results.map((r, i) => (
                <div
                  key={i}
                  className={`rounded p-1.5 text-[10px] flex items-start gap-1.5 ${
                    r.status === 'pass' ? 'bg-green-50' :
                    r.status === 'warning' ? 'bg-yellow-50' : 'bg-red-50'
                  }`}
                >
                  {r.status === 'pass' ? (
                    <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0 mt-0.5" />
                  ) : r.status === 'warning' ? (
                    <AlertTriangle className="w-3 h-3 text-yellow-500 flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-3 h-3 text-red-500 flex-shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className="font-medium">{r.aspect}</span>
                    <p className="text-muted-foreground">{r.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border">
        <button
          onClick={handleCheck}
          disabled={(!imageA && !imageB) || status === 'checking'}
          className={`w-full py-1.5 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            status === 'checking'
              ? 'bg-yellow-100 text-yellow-700'
              : status === 'done'
              ? 'bg-teal-500 text-white hover:bg-teal-600'
              : 'bg-teal-500 text-white hover:bg-teal-600'
          }`}
        >
          {status === 'checking' ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> 检查中...</>
          ) : (
            <><ScanEye className="w-3 h-3" /> {status === 'done' ? '重新检查' : '检查连续性'}</>
          )}
        </button>
      </div>

      <Handle type="source" position={Position.Right} id="report-out" className="!w-3 !h-3 !bg-amber-500" />
    </div>
  )
}

export default memo(ContinuityCheckNode)
