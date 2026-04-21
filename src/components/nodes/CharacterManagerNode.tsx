import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Users, Plus, Trash2, Copy } from 'lucide-react'
import { useFlowStore } from '@/store/flowStore'

interface CharacterEntry {
  id: string
  name: string
  characterUrl?: string
  characterId?: string
  thumbnailUrl?: string
  description?: string
}

function CharacterManagerNode({ id, data, selected }: NodeProps) {
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

  const borderClass = selected
    ? 'border-indigo-500 shadow-indigo-200'
    : 'border-border'

  return (
    <div className={`workflow-node bg-card border-2 rounded-xl shadow-lg w-[300px] transition-all duration-300 ${borderClass}`}>
      <Handle type="target" position={Position.Left} id="character-in" className="!w-3 !h-3 !bg-cyan-400" />

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-indigo-500/10 rounded-t-xl border-b border-border">
        <Users className="w-4 h-4 text-indigo-500" />
        <span className="font-semibold text-sm">{label}</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{characters.length} 角色</span>
      </div>

      {/* Content */}
      <div className="p-3 space-y-2">
        {characters.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-4">
            暂无角色。点击下方添加，或连接角色提取节点的输出。
          </div>
        ) : (
          <div className="space-y-2 max-h-[250px] overflow-y-auto">
            {characters.map((char) => (
              <div key={char.id} className="bg-muted/40 rounded-lg p-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <input
                    type="text"
                    value={char.name}
                    onChange={(e) => handleUpdateCharacter(char.id, 'name', e.target.value)}
                    className="text-xs font-semibold bg-transparent border-0 outline-none flex-1 min-w-0"
                    placeholder="角色名称"
                  />
                  <button
                    onClick={() => handleRemoveCharacter(char.id)}
                    className="p-0.5 rounded hover:bg-red-100 transition-colors"
                  >
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </button>
                </div>

                <input
                  type="text"
                  value={char.description || ''}
                  onChange={(e) => handleUpdateCharacter(char.id, 'description', e.target.value)}
                  className="w-full text-[10px] bg-transparent border-0 outline-none text-muted-foreground"
                  placeholder="角色描述..."
                />

                {char.characterId && (
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] text-cyan-600 font-mono truncate flex-1">
                      ID: {char.characterId}
                    </span>
                    {char.characterUrl && (
                      <button
                        onClick={() => handleCopyCharacterUrl(char.characterUrl!)}
                        className="p-0.5 rounded hover:bg-muted transition-colors"
                        title="复制 Character URL"
                      >
                        <Copy className="w-2.5 h-2.5 text-muted-foreground" />
                      </button>
                    )}
                  </div>
                )}

                {char.thumbnailUrl && (
                  <div className="w-full h-16 rounded overflow-hidden">
                    <img src={char.thumbnailUrl} alt={char.name} className="w-full h-full object-cover" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border">
        <button
          onClick={handleAddCharacter}
          className="w-full py-1.5 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 bg-indigo-500 text-white hover:bg-indigo-600 transition-colors"
        >
          <Plus className="w-3 h-3" /> 添加角色
        </button>
      </div>

      <Handle type="source" position={Position.Right} id="character-out" className="!w-3 !h-3 !bg-cyan-400" />
    </div>
  )
}

export default memo(CharacterManagerNode)
