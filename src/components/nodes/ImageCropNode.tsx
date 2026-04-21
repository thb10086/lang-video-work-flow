import { memo, useCallback, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Crop, Check } from 'lucide-react'
import { useFlowStore } from '@/store/flowStore'

const GRID_CELLS = [
  { idx: 0, label: '左上' }, { idx: 1, label: '中上' }, { idx: 2, label: '右上' },
  { idx: 3, label: '左中' }, { idx: 4, label: '正中' }, { idx: 5, label: '右中' },
  { idx: 6, label: '左下' }, { idx: 7, label: '中下' }, { idx: 8, label: '右下' },
]

function ImageCropNode({ id, data, selected }: NodeProps) {
  const label = String(data.label || '图片裁切')
  const inputImage = data.inputImage as string | null
  const selectedCell = data.selectedCell as number ?? 4
  const croppedImage = data.croppedImage as string | null
  const croppedImageUrl = data.croppedImageUrl as string | null
  const displayCropped = croppedImage || croppedImageUrl
  const [hoveredCell, setHoveredCell] = useState<number | null>(null)

  const updateNodeData = useFlowStore((s) => s.updateNodeData)

  const handleCellSelect = useCallback(async (idx: number) => {
    updateNodeData(id, { selectedCell: idx, croppedImage: null, croppedImageUrl: null })
    const img = data.inputImage as string | null
    if (!img) return

    try {
      // Use blob URL to avoid CORS tainted-canvas SecurityError on COS URLs
      let srcUrl = img
      let blobUrl: string | null = null
      if (!img.startsWith('data:')) {
        const resp = await fetch(img)
        if (!resp.ok) return
        const blob = await resp.blob()
        blobUrl = URL.createObjectURL(blob)
        srcUrl = blobUrl
      }

      const image = new Image()
      image.onload = () => {
        const cellW = Math.floor(image.width / 3)
        const cellH = Math.floor(image.height / 3)
        const row = Math.floor(idx / 3)
        const col = idx % 3
        const canvas = document.createElement('canvas')
        canvas.width = cellW
        canvas.height = cellH
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(image, col * cellW, row * cellH, cellW, cellH, 0, 0, cellW, cellH)
        const cropped = canvas.toDataURL('image/png')
        updateNodeData(id, { croppedImage: cropped })
        if (blobUrl) URL.revokeObjectURL(blobUrl)
      }
      image.onerror = () => { if (blobUrl) URL.revokeObjectURL(blobUrl) }
      image.src = srcUrl
    } catch { /* silent — user can re-execute via Agent */ }
  }, [id, data.inputImage, updateNodeData])

  const borderClass = selected
    ? 'border-cyan-500 shadow-cyan-200'
    : 'border-border'

  return (
    <div className={`workflow-node bg-card border-2 rounded-xl shadow-lg w-[260px] transition-all duration-300 ${borderClass}`}>
      <Handle type="target" position={Position.Left} id="grid-in" className="!w-3 !h-3 !bg-cyan-500" />

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-cyan-500/10 rounded-t-xl border-b border-border">
        <Crop className="w-4 h-4 text-cyan-500" />
        <span className="font-semibold text-sm">{label}</span>
      </div>

      {/* Content */}
      <div className="p-3 space-y-2">
        {inputImage ? (
          <>
            {/* Grid overlay for selection */}
            <div className="relative rounded-md overflow-hidden border border-border">
              <img src={inputImage} alt="grid" className="w-full" />
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
                {GRID_CELLS.map(cell => (
                  <button
                    key={cell.idx}
                    onClick={() => handleCellSelect(cell.idx)}
                    onMouseEnter={() => setHoveredCell(cell.idx)}
                    onMouseLeave={() => setHoveredCell(null)}
                    className={`border border-white/20 transition-all flex items-center justify-center ${
                      selectedCell === cell.idx
                        ? 'bg-cyan-500/40 ring-2 ring-cyan-400'
                        : hoveredCell === cell.idx
                        ? 'bg-white/20'
                        : 'bg-transparent hover:bg-white/10'
                    }`}
                  >
                    {selectedCell === cell.idx && (
                      <Check className="w-4 h-4 text-white drop-shadow" />
                    )}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground text-center">
              点击选择格子: {GRID_CELLS[selectedCell]?.label || '正中'}
            </p>
          </>
        ) : (
          <div className="bg-muted/30 rounded-md p-4 flex flex-col items-center gap-2">
            <Crop className="w-6 h-6 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground text-center">
              连接九宫图输出到此节点的输入端口
            </p>
          </div>
        )}

        {/* Cropped preview */}
        {displayCropped && (
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground">裁切结果:</p>
            <div
              className="rounded-md overflow-hidden border border-border cursor-zoom-in"
              onClick={() => window.open(croppedImageUrl || croppedImage!, '_blank')}
              title="点击查看原图"
            >
              <img src={displayCropped} alt="cropped" className="w-full" />
            </div>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} id="image-out" className="!w-3 !h-3 !bg-blue-500" />
    </div>
  )
}

export default memo(ImageCropNode)
