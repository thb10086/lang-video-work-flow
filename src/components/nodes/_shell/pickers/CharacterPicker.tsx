/**
 * CharacterPicker — LibTV-style 角色库 selector.
 *
 * Reads all characters from every CharacterManager node on the canvas and
 * renders them as clickable thumbnail cards. Picking a card inserts a
 * `@角色名` token into the prompt (via `onPick`) so downstream AI calls
 * will resolve the asset reference.
 *
 * Also includes an option to open the nearest CharacterManager for inline
 * editing (via `onOpenManager` callback — the parent decides navigation).
 */

import { useMemo } from 'react'
import { UserCircle, Plus } from 'lucide-react'
import { useFlowStore } from '@/store/flowStore'

export interface CharacterRef {
  id: string
  name: string
  thumbnailUrl?: string
  characterUrl?: string
  /** Source node id (so the caller can auto-link if needed). */
  sourceNodeId: string
}

export interface CharacterPickerProps {
  onPick: (character: CharacterRef) => void
  /** Optional handler for the "管理角色" button (open CharacterManager). */
  onOpenManager?: () => void
  title?: string
}

interface CharacterRaw {
  id: string
  name: string
  thumbnailUrl?: string
  characterUrl?: string
}

export default function CharacterPicker({
  onPick,
  onOpenManager,
  title = '角色库',
}: CharacterPickerProps) {
  const nodes = useFlowStore((s) => s.nodes)

  const characters = useMemo<CharacterRef[]>(() => {
    const out: CharacterRef[] = []
    for (const n of nodes) {
      if (n.type !== 'characterManager') continue
      const list = (n.data?.characters as CharacterRaw[] | undefined) || []
      for (const c of list) {
        if (!c?.id || !c?.name) continue
        out.push({
          id: c.id,
          name: c.name,
          thumbnailUrl: c.thumbnailUrl,
          characterUrl: c.characterUrl,
          sourceNodeId: n.id,
        })
      }
    }
    return out
  }, [nodes])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium text-[hsl(var(--libtv-chip-fg))] pl-0.5">
          {title}
          {characters.length > 0 && (
            <span className="ml-1.5 text-[hsl(var(--libtv-muted))] font-normal">
              · {characters.length}
            </span>
          )}
        </div>
        {onOpenManager && (
          <button
            type="button"
            onClick={onOpenManager}
            className="nodrag text-[10px] text-[hsl(var(--libtv-accent))] hover:underline inline-flex items-center gap-0.5"
            title="打开角色管理器"
          >
            <Plus size={11} strokeWidth={2} />
            管理
          </button>
        )}
      </div>

      {characters.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-1.5 py-4 text-[hsl(var(--libtv-muted))]">
          <UserCircle size={28} strokeWidth={1.3} />
          <div className="text-[10.5px]">暂无角色</div>
          <div className="text-[9.5px] opacity-80 text-center leading-tight">
            在画布添加「角色管理器」节点
            <br />
            即可注册可引用角色
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5 max-h-[240px] overflow-y-auto pr-0.5 nowheel">
          {characters.map((c) => (
            <button
              key={`${c.sourceNodeId}-${c.id}`}
              type="button"
              onClick={() => onPick(c)}
              title={c.name}
              className="nodrag group flex flex-col items-center gap-1 rounded-lg p-1 transition-colors hover:bg-[hsl(var(--libtv-chip-bg-hover))]"
            >
              <div className="w-full aspect-square rounded-md overflow-hidden ring-1 ring-[hsl(var(--libtv-line))] bg-[hsl(var(--libtv-chip-bg))] flex items-center justify-center">
                {c.thumbnailUrl || c.characterUrl ? (
                  <img
                    src={c.thumbnailUrl || c.characterUrl}
                    alt={c.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    draggable={false}
                  />
                ) : (
                  <UserCircle
                    size={28}
                    strokeWidth={1.3}
                    className="text-[hsl(var(--libtv-muted)/0.7)]"
                  />
                )}
              </div>
              <span className="text-[10px] font-medium truncate max-w-full leading-tight text-[hsl(var(--libtv-chip-fg))]">
                {c.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
