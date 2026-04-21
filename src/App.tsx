import { useCallback, useEffect, useRef } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import {
  Download,
  Upload,
  Play,
  MessageSquare,
  Settings,
  LayoutTemplate,
  PanelLeft,
  Maximize2,
  X,
} from 'lucide-react'
import NodePanel from '@/components/sidebar/NodePanel'
import WorkflowCanvas from '@/components/canvas/WorkflowCanvas'
import AgentChat from '@/components/sidebar/AgentChat'
import SettingsPanel from '@/components/sidebar/SettingsPanel'
import { useSettingsStore } from '@/store/settingsStore'
import { useFlowStore } from '@/store/flowStore'
import { useUIStore } from '@/store/uiStore'
import TemplatePanel from '@/components/sidebar/TemplatePanel'

function App() {
  const initialize = useSettingsStore((s) => s.initialize)
  const exportWorkflow = useFlowStore((s) => s.exportWorkflow)
  const importWorkflow = useFlowStore((s) => s.importWorkflow)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const {
    leftPanelOpen,
    agentDrawerOpen,
    agentDrawerWidth,
    rightTab,
    templatePanelOpen,
    fullscreenMode,
    toggleLeftPanel,
    toggleAgentDrawer,
    setAgentDrawerOpen,
    setAgentDrawerWidth,
    setRightTab,
    setTemplatePanelOpen,
    toggleFullscreen,
    toggleQuickNodePanel,
  } = useUIStore()

  // ── Resizable agent drawer ──
  const isResizing = useRef(false)

  const handleDrawerResizeStart = useCallback(() => {
    isResizing.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return
      const newWidth = window.innerWidth - e.clientX
      setAgentDrawerWidth(newWidth)
    }
    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [setAgentDrawerWidth])

  // ── Global keyboard shortcuts ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey
      if (isCtrl && e.key === 'b') { e.preventDefault(); toggleLeftPanel() }
      if (isCtrl && e.key === 'j') { e.preventDefault(); toggleAgentDrawer() }
      if (isCtrl && e.key === 'k') { e.preventDefault(); toggleQuickNodePanel() }
      if (isCtrl && e.key === 'f' && e.shiftKey) { e.preventDefault(); toggleFullscreen() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleLeftPanel, toggleAgentDrawer, toggleQuickNodePanel, toggleFullscreen])

  useEffect(() => {
    initialize()
  }, [initialize])

  const handleExport = useCallback(() => {
    const json = exportWorkflow()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `workflow-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [exportWorkflow])

  const handleImport = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        const text = ev.target?.result as string
        if (text) importWorkflow(text)
      }
      reader.readAsText(file)
      e.target.value = ''
    },
    [importWorkflow]
  )

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background">
      {/* Hidden file input for import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* ── Slim Top Bar (40px) ── */}
      {!fullscreenMode && (
        <header className="h-10 border-b border-border flex items-center px-3 justify-between bg-card/95 backdrop-blur-sm flex-shrink-0 z-20">
          <div className="flex items-center gap-2">
            <button
              onClick={toggleLeftPanel}
              className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="节点面板 (Ctrl+B)"
            >
              <PanelLeft className="w-4 h-4" />
            </button>
            <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-[10px]">P</span>
            </div>
            <h1 className="font-semibold text-xs tracking-tight">Prism AI</h1>
            <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 bg-muted rounded">v0.4</span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setTemplatePanelOpen(true)}
              className="px-2.5 py-1 text-[11px] rounded-md border border-primary/40 text-primary hover:bg-primary/10 transition-colors flex items-center gap-1"
            >
              <LayoutTemplate className="w-3 h-3" /> 模板
            </button>
            <button
              onClick={handleImport}
              className="px-2.5 py-1 text-[11px] rounded-md border border-border hover:bg-muted transition-colors flex items-center gap-1"
            >
              <Upload className="w-3 h-3" /> 导入
            </button>
            <button
              onClick={handleExport}
              className="px-2.5 py-1 text-[11px] rounded-md border border-border hover:bg-muted transition-colors flex items-center gap-1"
            >
              <Download className="w-3 h-3" /> 导出
            </button>

            <div className="w-px h-5 bg-border mx-0.5" />

            <button className="px-2.5 py-1 text-[11px] rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-1">
              <Play className="w-3 h-3" /> 运行
            </button>

            <div className="w-px h-5 bg-border mx-0.5" />

            <button
              onClick={() => { setRightTab('chat'); toggleAgentDrawer() }}
              className={`p-1.5 rounded-md transition-colors ${
                agentDrawerOpen && rightTab === 'chat'
                  ? 'bg-primary/12 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
              title="Agent (Ctrl+J)"
            >
              <MessageSquare className="w-4 h-4" />
            </button>
            <button
              onClick={() => { setRightTab('settings'); setAgentDrawerOpen(true) }}
              className={`p-1.5 rounded-md transition-colors ${
                agentDrawerOpen && rightTab === 'settings'
                  ? 'bg-primary/12 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
              title="设置"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={toggleFullscreen}
              className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="全屏 (Ctrl+Shift+F)"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </header>
      )}

      {/* Template Panel Modal */}
      <TemplatePanel open={templatePanelOpen} onClose={() => setTemplatePanelOpen(false)} />

      {/* ── Main Content: Canvas takes full space ── */}
      <div className="flex-1 flex overflow-hidden relative">
        <ReactFlowProvider>
          {/* Left: Collapsible Node Panel */}
          <div
            className={`flex-shrink-0 h-full transition-[width] duration-300 ease-out overflow-hidden border-r border-border bg-card ${
              leftPanelOpen ? 'w-[240px]' : 'w-0'
            }`}
          >
            {leftPanelOpen && <NodePanel />}
          </div>

          {/* Center: Canvas (takes all remaining space) */}
          <div className="flex-1 relative">
            <WorkflowCanvas />

            {/* Fullscreen exit button */}
            {fullscreenMode && (
              <button
                onClick={toggleFullscreen}
                className="absolute top-3 right-3 z-30 p-2 rounded-lg bg-card/80 backdrop-blur-sm border border-border text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
                title="退出全屏 (Ctrl+Shift+F)"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* ── Right: Floating Agent Drawer ── */}
          {agentDrawerOpen && (
            <>
              {/* Drawer backdrop (click to close on mobile, transparent on desktop) */}
              <div
                className="absolute inset-0 z-30 lg:hidden overlay-backdrop animate-fade-in"
                onClick={() => setAgentDrawerOpen(false)}
              />

              {/* Drawer panel */}
              <div
                style={{ width: agentDrawerWidth }}
                className="absolute top-0 right-0 bottom-0 z-40 flex flex-col bg-card border-l border-border animate-slide-in-right"
              >
                {/* Resize handle */}
                <div
                  onMouseDown={handleDrawerResizeStart}
                  className="absolute left-0 top-0 bottom-0 w-1 hover:w-1.5 hover:bg-primary/40 cursor-col-resize transition-colors z-10"
                />

                {/* Tab Switcher */}
                <div className="flex border-b border-border flex-shrink-0">
                  <button
                    onClick={() => setRightTab('chat')}
                    className={`flex-1 py-2 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                      rightTab === 'chat'
                        ? 'text-primary border-b-2 border-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5" /> Agent
                  </button>
                  <button
                    onClick={() => setRightTab('settings')}
                    className={`flex-1 py-2 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                      rightTab === 'settings'
                        ? 'text-primary border-b-2 border-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Settings className="w-3.5 h-3.5" /> 设置
                  </button>
                  <button
                    onClick={() => setAgentDrawerOpen(false)}
                    className="px-3 py-2 text-muted-foreground hover:text-foreground transition-colors"
                    title="关闭"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Tab Content */}
                <div className="flex-1 overflow-hidden">
                  {rightTab === 'chat' ? <AgentChat /> : <SettingsPanel />}
                </div>
              </div>
            </>
          )}
        </ReactFlowProvider>
      </div>
    </div>
  )
}

export default App
