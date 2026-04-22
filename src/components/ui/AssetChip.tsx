/**
 * AssetChip — small colored pill representing a resolved or dangling asset ref.
 *
 *  - character → indigo
 *  - scene     → teal
 *  - style     → amber
 *  - missing   → red (when the assetId no longer exists in the library)
 *
 * Use to render chip rows above prompt inputs and above node previews.
 */

import { memo } from 'react'
import { X, AlertTriangle, User, MapPin, Palette } from 'lucide-react'
import type { AssetDTO, AssetKind } from '@/api/backend'

const KIND_COLORS: Record<AssetKind, string> = {
  character: 'bg-indigo-500/10 text-indigo-700 border-indigo-300/60',
  scene:     'bg-teal-500/10 text-teal-700 border-teal-300/60',
  style:     'bg-amber-500/10 text-amber-700 border-amber-300/60',
}

const KIND_ICON: Record<AssetKind, React.ComponentType<{ className?: string }>> = {
  character: User,
  scene:     MapPin,
  style:     Palette,
}

interface AssetChipProps {
  asset?: AssetDTO
  /** Used for the missing / unresolved case. */
  assetId?: string
  /** Optional variation suffix (e.g. `smiling` from `@sarah:smiling`). */
  variation?: string
  onClick?: () => void
  onRemove?: () => void
  size?: 'sm' | 'md'
}

function AssetChip({ asset, assetId, variation, onClick, onRemove, size = 'sm' }: AssetChipProps) {
  const missing = !asset
  const kind = asset?.kind
  const Icon = kind ? KIND_ICON[kind] : AlertTriangle
  const color = missing
    ? 'bg-red-500/10 text-red-700 border-red-300/60'
    : kind
      ? KIND_COLORS[kind]
      : 'bg-muted text-foreground/70 border-border'
  const paddingCls = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'
  const label = asset?.name || assetId || 'unknown'
  const title = missing
    ? `素材 "${assetId}" 未找到或已删除`
    : `${label}${variation ? ` · ${variation}` : ''}`

  return (
    <span
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick() } : undefined}
      className={`inline-flex items-center gap-1 rounded-full border font-medium ${paddingCls} ${color} ${onClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
      title={title}
    >
      <Icon className="w-3 h-3 flex-shrink-0" />
      <span className="truncate max-w-[140px]">{label}{variation && `·${variation}`}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="opacity-60 hover:opacity-100"
          aria-label="移除"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  )
}

export default memo(AssetChip)
