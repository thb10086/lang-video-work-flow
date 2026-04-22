/**
 * AssetLibraryPanel — LibTV-style right-side drawer for browsing and managing
 * character / scene / style assets.
 *
 *  - Three tabs grouped by kind.
 *  - Search box filters within the active tab.
 *  - Card grid (AssetCard) — draggable to canvas, clickable for edit.
 *  - "+ New" button opens AssetDetailModal in create mode.
 *  - Ctrl+Shift+A toggles visibility.
 */

import { useEffect, useMemo, useState } from 'react'
import { X, Search, Plus, RefreshCw, Library, AlertCircle, User, MapPin, Palette } from 'lucide-react'
import type { AssetDTO, AssetKind } from '@/api/backend'
import { useAssetStore } from '@/store/assetStore'
import { useUIStore } from '@/store/uiStore'
import AssetCard from './AssetCard'
import AssetDetailModal from './AssetDetailModal'

const TABS: { kind: AssetKind; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { kind: 'character', label: '角色', icon: User },
  { kind: 'scene', label: '场景', icon: MapPin },
  { kind: 'style', label: '风格', icon: Palette },
]

function AssetLibraryPanel() {
  const open = useUIStore(s => s.assetPanelOpen)
  const setOpen = useUIStore(s => s.setAssetPanelOpen)

  const characters = useAssetStore(s => s.characters)
  const scenes = useAssetStore(s => s.scenes)
  const styles = useAssetStore(s => s.styles)
  const loading = useAssetStore(s => s.loading)
  const error = useAssetStore(s => s.error)
  const fetchAll = useAssetStore(s => s.fetchAll)
  const lastFetchedAt = useAssetStore(s => s.lastFetchedAt)

  const [activeKind, setActiveKind] = useState<AssetKind>('character')
  const [query, setQuery] = useState('')
  const [editingAsset, setEditingAsset] = useState<AssetDTO | null>(null)
  const [creating, setCreating] = useState(false)

  // Lazy-load on first open
  useEffect(() => {
    if (open && !lastFetchedAt) {
      fetchAll()
    }
  }, [open, lastFetchedAt, fetchAll])

  // Global shortcut: Ctrl+Shift+A
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey
      if (isCtrl && e.shiftKey && (e.key === 'a' || e.key === 'A')) {
        // Don't steal focus from editable inputs
        const target = e.target as HTMLElement | null
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
        e.preventDefault()
        useUIStore.getState().toggleAssetPanel()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const source = activeKind === 'character' ? characters : activeKind === 'scene' ? scenes : styles
  const assets = useMemo(() => {
    const list = Object.values(source)
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter(a =>
      a.name.toLowerCase().includes(q) ||
      (a.name_en || '').toLowerCase().includes(q) ||
      a.asset_id.toLowerCase().includes(q) ||
      (a.appearance || a.environment || a.guide || '').toLowerCase().includes(q)
    )
  }, [source, query])

  if (!open) return null

  return (
    <>
      <div className="fixed top-0 right-0 bottom-0 w-[360px] z-[150] bg-background border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
          <div className="flex items-center gap-2">
            <Library className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">素材库</span>
            <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
              Ctrl+Shift+A
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => fetchAll()}
              disabled={loading}
              className="p-1 hover:bg-muted rounded-md"
              title="刷新"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 hover:bg-muted rounded-md"
              title="关闭"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          {TABS.map(tab => {
            const Icon = tab.icon
            const count = Object.keys(
              tab.kind === 'character' ? characters : tab.kind === 'scene' ? scenes : styles,
            ).length
            const active = activeKind === tab.kind
            return (
              <button
                key={tab.kind}
                type="button"
                onClick={() => setActiveKind(tab.kind)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs transition-colors ${
                  active
                    ? 'border-b-2 border-primary text-primary font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
                <span className="text-[10px] opacity-60">({count})</span>
              </button>
            )
          })}
        </div>

        {/* Search + New */}
        <div className="px-3 py-2 flex items-center gap-2 border-b border-border">
          <div className="flex-1 relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`搜索${TABS.find(t => t.kind === activeKind)?.label}...`}
              className="w-full pl-6 pr-2 py-1 text-xs border border-border rounded-md bg-background focus:border-primary focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-primary text-primary-foreground rounded-md hover:opacity-90"
          >
            <Plus className="w-3 h-3" />
            新建
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="px-3 py-2 bg-red-500/10 border-b border-red-300/60 flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
            <div className="flex-1 text-[11px] text-red-700 truncate" title={error}>
              {error}
            </div>
            <button
              type="button"
              onClick={() => fetchAll()}
              className="text-[10px] text-red-700 underline hover:no-underline"
            >
              重试
            </button>
          </div>
        )}

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading && assets.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
              加载中...
            </div>
          ) : assets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-xs text-muted-foreground gap-2">
              <div>暂无{TABS.find(t => t.kind === activeKind)?.label}</div>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="text-primary hover:underline"
              >
                创建第一个
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {assets.map(asset => (
                <AssetCard
                  key={asset.asset_id}
                  asset={asset}
                  onEdit={(a) => setEditingAsset(a)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-3 py-1.5 border-t border-border bg-muted/20 text-[10px] text-muted-foreground">
          拖动卡片到画布，或在 prompt 中输入 <span className="font-mono text-foreground/80">@</span> 引用
        </div>
      </div>

      {/* Create / Edit modal */}
      <AssetDetailModal
        open={creating || !!editingAsset}
        kind={editingAsset?.kind || activeKind}
        asset={editingAsset}
        onClose={() => {
          setCreating(false)
          setEditingAsset(null)
        }}
      />
    </>
  )
}

export default AssetLibraryPanel
