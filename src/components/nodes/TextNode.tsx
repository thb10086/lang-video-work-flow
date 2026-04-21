import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { FileText } from 'lucide-react'

const ROLE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  script: { bg: 'bg-amber-500/10', text: 'text-amber-600', border: 'border-amber-500' },
  prompt: { bg: 'bg-cyan-500/10', text: 'text-cyan-600', border: 'border-cyan-500' },
  narration: { bg: 'bg-indigo-500/10', text: 'text-indigo-600', border: 'border-indigo-500' },
  dialogue: { bg: 'bg-pink-500/10', text: 'text-pink-600', border: 'border-pink-500' },
}

const ROLE_LABELS: Record<string, string> = {
  script: '脚本',
  prompt: '提示词',
  narration: '旁白',
  dialogue: '对话',
}

function TextNode({ data, selected }: NodeProps) {
  const role = (data.role as string) || 'script'
  const colors = ROLE_COLORS[role] || ROLE_COLORS.script

  return (
    <div className={`workflow-node bg-card border-2 rounded-xl shadow-lg w-[240px] ${
      selected ? colors.border : 'border-border'
    }`}>
      <Handle type="target" position={Position.Left} id="text-in" className={`!w-3 !h-3 !bg-amber-500`} />

      <div className={`flex items-center gap-2 px-4 py-3 ${colors.bg} rounded-t-xl border-b border-border`}>
        <FileText className={`w-4 h-4 ${colors.text}`} />
        <span className="font-semibold text-sm">{(data.label as string) || '文本'}</span>
        <span className={`text-xs ml-auto px-1.5 py-0.5 rounded ${colors.bg} ${colors.text} font-medium`}>
          {ROLE_LABELS[role]}
        </span>
      </div>

      <div className="p-3">
        <div className="bg-muted/50 rounded-md p-2 min-h-[60px]">
          <p className="text-xs text-foreground whitespace-pre-wrap">
            {(data.content as string) || '点击编辑内容...'}
          </p>
        </div>
      </div>

      <Handle type="source" position={Position.Right} id="text-out" className={`!w-3 !h-3 !bg-amber-500`} />
    </div>
  )
}

export default memo(TextNode)
