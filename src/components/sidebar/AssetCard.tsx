/**
 * AssetCard — single asset tile in the library grid.
 *
 * LibTV-inspired: primary thumbnail, name, variation badge, hover overlay
 * with Edit + Drag actions. Acts as a drag source with MIME
 * `application/x-asset-id` so the canvas drop handler can materialize
 * the corresponding node type.
 */

import { memo } from 'react'
import { Edit3, Move } from 'lucide-react'
import type { AssetDTO } from '@/api/backend'

interface AssetCardProps {
  asset: AssetDTO
  onEdit: (asset: AssetDTO) => void
  onDragStart?: (e: React.DragEvent, asset: AssetDTO) => void
}

function AssetCard({ asset, onEdit, onDragStart }: AssetCardProps) {
  const thumb = asset.reference_images?.[0]
  const variationCount = asset.variations?.length || 0

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData('application/x-asset-id', asset.asset_id)
    e.dataTransfer.setData('application/x-asset-kind', asset.kind)
    onDragStart?.(e, asset)
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className="group relative bg-card border border-border rounded-lg overflow-hidden hover:border-primary/50 transition-all cursor-grab active:cursor-grabbing"
    >
      {/* Thumbnail */}
      <div className="aspect-square bg-muted relative">
        {thumb ? (
          <img src={thumb} alt={asset.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
            无缩略图
          </div>
        )}
        {variationCount > 0 && (
          <div className="absolute top-1.5 right-1.5 bg-black/70 text-white text-[9px] font-medium px-1.5 py-0.5 rounded-full">
            +{variationCount} 变体
          </div>
        )}
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onEdit(asset) }}
            className="p-1.5 bg-white/90 rounded-md hover:bg-white transition-colors"
            title="编辑"
          >
            <Edit3 className="w-3.5 h-3.5 text-foreground" />
          </button>
          <div className="p-1.5 bg-white/90 rounded-md flex items-center gap-1 text-[10px] text-foreground">
            <Move className="w-3 h-3" /> 拖放到画布
          </div>
        </div>
      </div>

      {/* Name */}
      <div className="px-2 py-1.5 border-t border-border">
        <div className="text-xs font-medium truncate" title={asset.name}>
          {asset.name}
        </div>
        <div className="text-[10px] text-muted-foreground truncate">
          @{asset.asset_id}
        </div>
      </div>
    </div>
  )
}

export default memo(AssetCard)
