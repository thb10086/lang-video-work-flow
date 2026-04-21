import { useCallback } from 'react'
import {
  Grid3X3,
  Minus,
  Plus,
  Settings2,
  Circle,
  Hash,
  X,
  Maximize2,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react'
import { useReactFlow } from '@xyflow/react'
import { useSettingsStore } from '@/store/settingsStore'

const BG_OPTIONS = [
  { value: 'dots' as const, label: '点阵', icon: Circle },
  { value: 'lines' as const, label: '线格', icon: Grid3X3 },
  { value: 'cross' as const, label: '十字', icon: Hash },
  { value: 'none' as const, label: '无', icon: X },
]

const GAP_OPTIONS = [10, 15, 20, 25, 30]

function CanvasToolbar() {
  const reactFlow = useReactFlow()

  const {
    canvasBackground,
    canvasGridGap,
    canvasSnapToGrid,
    theme,
    setCanvasSettings,
    setTheme,
  } = useSettingsStore()

  const handleZoomIn = useCallback(() => {
    reactFlow.zoomIn({ duration: 200 })
  }, [reactFlow])

  const handleZoomOut = useCallback(() => {
    reactFlow.zoomOut({ duration: 200 })
  }, [reactFlow])

  const handleFitView = useCallback(() => {
    reactFlow.fitView({ duration: 300, padding: 0.2 })
  }, [reactFlow])

  const handleBgChange = useCallback(
    (value: 'dots' | 'lines' | 'cross' | 'none') => {
      setCanvasSettings({ canvasBackground: value })
    },
    [setCanvasSettings]
  )

  const handleGapChange = useCallback(
    (gap: number) => {
      setCanvasSettings({ canvasGridGap: gap })
    },
    [setCanvasSettings]
  )

  const handleSnapToggle = useCallback(() => {
    setCanvasSettings({ canvasSnapToGrid: !canvasSnapToGrid })
  }, [canvasSnapToGrid, setCanvasSettings])

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 px-2 py-1.5 bg-card/95 backdrop-blur-sm border border-border rounded-lg shadow-lg">
      {/* Background Mode */}
      <div className="flex items-center gap-0.5 border-r border-border pr-2 mr-1">
        {BG_OPTIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            onClick={() => handleBgChange(value)}
            className={`p-1.5 rounded-md text-xs transition-colors ${
              canvasBackground === value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
            title={label}
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        ))}
      </div>

      {/* Grid Gap */}
      <div className="flex items-center gap-0.5 border-r border-border pr-2 mr-1">
        <span className="text-[10px] text-muted-foreground mr-1">间距</span>
        {GAP_OPTIONS.map((gap) => (
          <button
            key={gap}
            onClick={() => handleGapChange(gap)}
            className={`px-1.5 py-1 rounded text-[10px] font-mono transition-colors ${
              canvasGridGap === gap
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {gap}
          </button>
        ))}
      </div>

      {/* Snap Toggle */}
      <button
        onClick={handleSnapToggle}
        className={`p-1.5 rounded-md text-xs transition-colors border-r border-border mr-1 pr-2 ${
          canvasSnapToGrid
            ? 'text-primary'
            : 'text-muted-foreground'
        }`}
        title={canvasSnapToGrid ? '吸附开启' : '吸附关闭'}
      >
        <Settings2 className="w-3.5 h-3.5" />
      </button>

      {/* Zoom Controls */}
      <div className="flex items-center gap-0.5 border-r border-border pr-2 mr-1">
        <button
          onClick={handleZoomOut}
          className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title="缩小"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleFitView}
          className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title="适应视图"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleZoomIn}
          className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title="放大"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Theme Toggle */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => setTheme('light')}
          className={`p-1.5 rounded-md text-xs transition-colors ${
            theme === 'light' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
          title="浅色主题"
        >
          <Sun className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setTheme('dark')}
          className={`p-1.5 rounded-md text-xs transition-colors ${
            theme === 'dark' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
          title="深色主题"
        >
          <Moon className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setTheme('system')}
          className={`p-1.5 rounded-md text-xs transition-colors ${
            theme === 'system' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
          title="跟随系统"
        >
          <Monitor className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

export default CanvasToolbar
