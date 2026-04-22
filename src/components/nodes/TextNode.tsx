/**
 * TextNode — LibTV-style inline text holder.
 *
 * Passive node: no execution, just a piece of text (role-tagged) that
 * flows down to other nodes via text-out. Content is editable inline.
 */
import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { FileText, ScrollText, Pencil, Megaphone, MessagesSquare } from 'lucide-react'

import { useFlowStore } from '@/store/flowStore'
import { NodeShell } from '@/components/nodes/_shell'

const ROLE_META: Record<string, { label: string; icon: typeof FileText }> = {
  script:    { label: '脚本',   icon: ScrollText },
  prompt:    { label: '提示词', icon: Pencil },
  narration: { label: '旁白',   icon: Megaphone },
  dialogue:  { label: '对话',   icon: MessagesSquare },
}

function TextNode({ id, data }: NodeProps) {
  const role = (data.role as string) || 'script'
  const roleMeta = ROLE_META[role] || ROLE_META.script
  const label = (data.label as string) || '文本'
  const content = (data.content as string) || ''

  const updateNodeData = useFlowStore(s => s.updateNodeData)
  const nodes = useFlowStore(s => s.nodes)

  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateNodeData(id, { content: e.target.value })
  }, [id, updateNodeData])

  const handleGhostConnect = useCallback((side: 'left' | 'right') => {
    const self = nodes.find(n => n.id === id)
    if (!self) return
    const offset = side === 'left' ? -300 : 300
    const position = { x: (self.position?.x ?? 0) + offset, y: self.position?.y ?? 0 }
    window.dispatchEvent(new CustomEvent('libtv-ghost-connect', {
      detail: { sourceNodeId: id, side, position },
    }))
  }, [nodes, id])

  const RoleIcon = roleMeta.icon

  return (
    <NodeShell
      icon={<RoleIcon size={11} strokeWidth={2.5} />}
      label={label}
      labelRight={
        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-[hsl(var(--libtv-chip-bg))] text-[hsl(var(--libtv-muted))]">
          {roleMeta.label}
        </span>
      }
      width={280}
      ghostConnect={{ left: true, right: true }}
      onGhostConnect={handleGhostConnect}
    >
      <Handle type="target" position={Position.Left} id="text-in" />
      <Handle type="source" position={Position.Right} id="text-out" />

      <div className="p-3">
        <textarea
          value={content}
          onChange={handleContentChange}
          placeholder="点击编辑内容…"
          rows={4}
          className="libtv-prompt min-h-[80px]"
        />
      </div>
    </NodeShell>
  )
}

export default memo(TextNode)
