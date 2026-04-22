/**
 * AssetPicker — popover rendered on top of a PromptInput when the user types
 * `@query`. Shows up to 8 matching assets grouped implicitly by rank.
 *
 *  - Keyboard: ArrowUp/Down to move, Enter to commit, Escape to dismiss.
 *  - Listens on window so keypresses in the source textarea steer selection.
 *  - Click support for mouse users.
 */

import { useEffect, useMemo, useState, useRef } from 'react'
import { User, MapPin, Palette } from 'lucide-react'
import type { AssetDTO, AssetKind } from '@/api/backend'
import { useAssetStore } from '@/store/assetStore'

const KIND_ICON: Record<AssetKind, React.ComponentType<{ className?: string }>> = {
  character: User,
  scene:     MapPin,
  style:     Palette,
}

const KIND_LABEL: Record<AssetKind, string> = {
  character: '角色',
  scene:     '场景',
  style:     '风格',
}

interface AssetPickerProps {
  visible: boolean
  query: string
  anchorX: number
  anchorY: number
  onSelect: (asset: AssetDTO) => void
  onClose: () => void
}

const MAX_RESULTS = 8

function AssetPicker({ visible, query, anchorX, anchorY, onSelect, onClose }: AssetPickerProps) {
  const search = useAssetStore(s => s.search)
  const all = useAssetStore(s => s.all)
  const [activeIdx, setActiveIdx] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const results = useMemo((): AssetDTO[] => {
    if (!visible) return []
    const q = query.trim()
    if (!q) return all().slice(0, MAX_RESULTS)
    return search(q).slice(0, MAX_RESULTS)
  }, [visible, query, search, all])

  // Reset selection when query changes
  useEffect(() => {
    setActiveIdx(0)
  }, [query, visible])

  // Global keyboard nav — attached on window so the textarea keeps focus
  useEffect(() => {
    if (!visible) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        if (results.length === 0) return
        e.preventDefault()
        setActiveIdx(i => (i + 1) % results.length)
      } else if (e.key === 'ArrowUp') {
        if (results.length === 0) return
        e.preventDefault()
        setActiveIdx(i => (i - 1 + results.length) % results.length)
      } else if (e.key === 'Enter') {
        if (results.length > 0) {
          e.preventDefault()
          onSelect(results[activeIdx])
        } else {
          onClose()
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [visible, results, activeIdx, onSelect, onClose])

  if (!visible) return null
  // clamp position
  const left = Math.min(anchorX, window.innerWidth - 320)
  const top = Math.min(anchorY, window.innerHeight - 320)

  return (
    <div
      ref={containerRef}
      className="fixed z-[120] floating-panel w-[300px] max-h-[320px] flex flex-col overflow-hidden animate-scale-in"
      style={{ left, top }}
      onMouseDown={(e) => e.preventDefault() /* keep textarea focus */}
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border bg-muted/30">
        <span className="text-primary text-xs font-bold">@</span>
        <span className="text-[11px] text-muted-foreground flex-1 truncate">
          {query ? `搜索 "${query}"` : '所有素材'}
        </span>
        <span className="text-[10px] text-muted-foreground">{results.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {results.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            无匹配素材
            <div className="text-[10px] mt-0.5 opacity-70">按 Esc 取消</div>
          </div>
        ) : (
          results.map((asset, idx) => {
            const Icon = KIND_ICON[asset.kind]
            const thumb = asset.reference_images?.[0]
            return (
              <button
                key={asset.asset_id}
                type="button"
                onClick={() => onSelect(asset)}
                onMouseEnter={() => setActiveIdx(idx)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${
                  idx === activeIdx ? 'bg-primary/10' : 'hover:bg-muted/50'
                }`}
              >
                {thumb ? (
                  <img
                    src={thumb}
                    alt=""
                    className="w-8 h-8 rounded object-cover flex-shrink-0 border border-border"
                  />
                ) : (
                  <div className="w-8 h-8 rounded bg-muted flex items-center justify-center flex-shrink-0">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium truncate">{asset.name}</span>
                    <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
                      {KIND_LABEL[asset.kind]}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {asset.appearance || asset.asset_id}
                  </div>
                </div>
              </button>
            )
          })
        )}
      </div>
      {results.length > 0 && (
        <div className="px-2.5 py-1 border-t border-border bg-muted/20 text-[9px] text-muted-foreground flex gap-3">
          <span>↑↓ 选择</span>
          <span>↵ 插入</span>
          <span>Esc 取消</span>
        </div>
      )}
    </div>
  )
}

export default AssetPicker
