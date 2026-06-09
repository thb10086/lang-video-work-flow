/**
 * CharacterManagerNode — LibTV-style character registry.
 *
 * A canvas-level registry of reusable character anchors. Each entry can be
 * edited inline (name + short description) and copied by downstream nodes
 * as a reference. Characters can be added manually or flow in via
 * character-in from upstream CharacterExtract / CharacterGrid nodes.
 */
import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Users, Plus, Trash2, Copy, UserCircle } from 'lucide-react'

import { useFlowStore } from '@/store/flowStore'
import { NodeShell, NodeToolbar } from '@/components/nodes/_shell'

interface CharacterEntry {
  id: string
  name: string
  characterUrl?: string
  characterId?: string
  thumbnailUrl?: string
  description?: string
}

function CharacterManagerNode({ id, data }: NodeProps) {
  const label = String(data.label || '角色管理器')
  const characters = (data.characters as CharacterEntry[]) || []

  const updateNodeData = useFlowStore((s) => s.updateNodeData)

  const handleAddCharacter = useCallback(() => {
    const entry: CharacterEntry = {
      id: `char-${Date.now()}`,
      name: '新角色',
    }
    updateNodeData(id, { characters: [...characters, entry] })
  }, [id, characters, updateNodeData])

  const handleRemoveCharacter = useCallback((charId: string) => {
    updateNodeData(id, {
      characters: characters.filter(c => c.id !== charId),
    })
  }, [id, characters, updateNodeData])

  const handleUpdateCharacter = useCallback((charId: string, field: string, value: string) => {
    updateNodeData(id, {
      characters: characters.map(c =>
        c.id === charId ? { ...c, [field]: value } : c
      ),
    })
  }, [id, characters, updateNodeData])

  const handleCopyCharacterUrl = useCallback((url: string) => {
    navigator.clipboard.writeText(url).catch(() => {})
  }, [])

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

  const labelRightSlot = (
    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-[hsl(var(--libtv-chip-bg))] text-[hsl(var(--libtv-chip-fg))]">
      {characters.length} 角色
    </span>
  )

  return (
    <NodeShell
      icon={<Users size={11} strokeWidth={2.5} />}
      label={label}
      labelRight={labelRightSlot}
      width={360}
      ghostConnect={{ left: true, right: true }}
      onGhostConnect={handleGhostConnect}
    >
      <Handle type="target" position={Position.Left} id="character-in" />
      <Handle type="source" position={Position.Right} id="character-out" />

      <div className="p-3 space-y-2.5">
        {/* ── CHARACTER LIST ── */}
        {characters.length === 0 ? (
          <div className="libtv-preview flex items-center justify-center p-6" style={{ aspectRatio: 'auto', minHeight: 120 }}>
            <div className="flex flex-col items-center gap-1.5 text-[hsl(var(--libtv-muted))]">
              <UserCircle size={32} strokeWidth={1.5} />
              <span className="text-[11px]">点击下方添加角色</span>
              <span className="text-[10px] opacity-60">或连接上游角色提取节点</span>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-[hsl(var(--libtv-line))] bg-[hsl(var(--libtv-chip-bg)/0.4)] overflow-hidden">
            <div className="max-h-[260px] overflow-y-auto divide-y divide-[hsl(var(--libtv-line))]">
              {characters.map((char) => (
                <div key={char.id} className="px-2.5 py-2 space-y-1.5 hover:bg-[hsl(var(--libtv-chip-bg-hover)/0.5)] transition-colors">
                  <div className="flex items-center gap-2">
                    {char.thumbnailUrl ? (
                      <img src={char.thumbnailUrl} alt={char.name} className="w-9 h-9 rounded-lg object-cover" />
                    ) : (
                      <div className="w-9 h-9 rounded-lg bg-[hsl(var(--libtv-accent)/0.15)] flex items-center justify-center shrink-0">
                        <UserCircle size={18} className="text-[hsl(var(--libtv-accent))]" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <input
                        type="text"
                        value={char.name}
                        onChange={(e) => handleUpdateCharacter(char.id, 'name', e.target.value)}
                        className="w-full text-[11px] font-semibold bg-transparent border-0 outline-none text-[hsl(var(--foreground))]"
                        placeholder="角色名称"
                      />
                      <input
                        type="text"
                        value={char.description || ''}
                        onChange={(e) => handleUpdateCharacter(char.id, 'description', e.target.value)}
                        className="w-full text-[10px] bg-transparent border-0 outline-none text-[hsl(var(--libtv-muted))]"
                        placeholder="描述（服装、特征…）"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveCharacter(char.id)}
                      className="p-1 rounded-lg hover:bg-[hsl(var(--destructive)/0.15)] transition-colors"
                      title="删除"
                    >
                      <Trash2 size={11} className="text-[hsl(var(--destructive)/0.8)]" />
                    </button>
                  </div>
                  {char.characterId && (
                    <div className="flex items-center gap-1 pl-11">
                      <span className="text-[9px] text-[hsl(var(--libtv-accent))] font-mono truncate flex-1">
                        {char.characterId}
                      </span>
                      {char.characterUrl && (
                        <button
                          type="button"
                          onClick={() => handleCopyCharacterUrl(char.characterUrl!)}
                          className="p-0.5 rounded hover:bg-[hsl(var(--libtv-chip-bg))] transition-colors"
                          title="复制 Character URL"
                        >
                          <Copy size={10} className="text-[hsl(var(--libtv-muted))]" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── TOOLBAR: add button as ghost chip on left ── */}
        <NodeToolbar
          left={
            <button
              type="button"
              onClick={handleAddCharacter}
              className="libtv-chip libtv-chip--ghost"
            >
              <Plus size={12} strokeWidth={2.5} />
              <span>添加角色</span>
            </button>
          }
        />
      </div>
    </NodeShell>
  )
}

export default memo(CharacterManagerNode)
