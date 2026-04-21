/**
 * QuickNodePanel — Ctrl+K 浮动节点搜索面板
 *
 * 类似 VS Code 命令面板，在画布中心弹出，支持模糊搜索快速创建节点。
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useReactFlow } from '@xyflow/react'
import { Search, X } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
import { useFlowStore } from '@/store/flowStore'
import { resolveTargetHandle } from '@/providers/toolHelpers'
import { NODE_REGISTRY, NODE_CATEGORIES, renderNodeIcon, type NodeDefinition } from '@/data/nodeDefinitions'

/* Uses NODE_REGISTRY as single source of truth */

function QuickNodePanel() {
  const open = useUIStore((s) => s.quickNodePanelOpen)
  const setOpen = useUIStore((s) => s.setQuickNodePanelOpen)
  const pendingConnection = useUIStore((s) => s.pendingConnection)
  const setPendingConnection = useUIStore((s) => s.setPendingConnection)
  const addNode = useFlowStore((s) => s.addNode)
  const onConnect = useFlowStore((s) => s.onConnect)
  const nodes = useFlowStore((s) => s.nodes)
  const reactFlow = useReactFlow()

  const [query, setQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('全部')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    return NODE_REGISTRY.filter((def) => {
      if (selectedCategory !== '全部' && def.category !== selectedCategory) return false
      if (!q) return true
      return (
        def.label.toLowerCase().includes(q) ||
        def.type.toLowerCase().includes(q) ||
        def.keywords.some((k) => k.includes(q))
      )
    })
  }, [query, selectedCategory])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedCategory('全部')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query, selectedCategory])

  const handleClose = useCallback(() => {
    setOpen(false)
    if (pendingConnection) setPendingConnection(null)
  }, [setOpen, pendingConnection, setPendingConnection])

  const handleCreate = useCallback(
    (def: NodeDefinition) => {
      let posX: number, posY: number

      if (pendingConnection) {
        posX = pendingConnection.position.x
        posY = pendingConnection.position.y
      } else {
        const viewport = reactFlow.getViewport()
        const containerEl = document.querySelector('.react-flow')
        const w = containerEl?.clientWidth || window.innerWidth
        const h = containerEl?.clientHeight || window.innerHeight
        posX = (-viewport.x + w / 2) / viewport.zoom + (Math.random() - 0.5) * 80
        posY = (-viewport.y + h / 2) / viewport.zoom + (Math.random() - 0.5) * 80
      }

      const newNodeId = addNode(def.type, { x: posX, y: posY }, { ...def.defaultData })

      // Auto-connect if we have a pending connection
      if (pendingConnection && newNodeId) {
        const sourceNode = nodes.find((n) => n.id === pendingConnection.sourceNodeId)
        const sourceType = sourceNode?.type || ''
        let targetHandle: string | null = null
        try {
          targetHandle = resolveTargetHandle(def.type, sourceType)
        } catch { /* no compatible handle */ }

        if (targetHandle) {
          onConnect({
            source: pendingConnection.sourceNodeId,
            target: newNodeId,
            sourceHandle: pendingConnection.sourceHandleId,
            targetHandle,
          })
        }
        setPendingConnection(null)
      }

      handleClose()
    },
    [reactFlow, addNode, handleClose, pendingConnection, setPendingConnection, onConnect, nodes]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') { handleClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)) }
      if (e.key === 'Enter' && filtered[selectedIndex]) { handleCreate(filtered[selectedIndex]) }
    },
    [filtered, selectedIndex, handleCreate, handleClose]
  )

  if (!open) return null

  return (
    <div className="absolute inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 overlay-backdrop animate-fade-in" onClick={handleClose} />

      {/* Panel */}
      <div
        className="relative floating-panel w-[420px] max-h-[60vh] flex flex-col animate-scale-in overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        {/* Search Input */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
          <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索节点... (输入名称或关键词)"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button onClick={handleClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Category Tabs */}
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border">
          {NODE_CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat as string)}
              className={`px-2 py-0.5 text-[11px] rounded-md transition-colors ${
                selectedCategory === cat
                  ? 'bg-primary/12 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {cat}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-muted-foreground">{filtered.length} 个节点</span>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">未找到匹配节点</div>
          ) : (
            filtered.map((def, i) => (
              <button
                key={def.type}
                onClick={() => handleCreate(def)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                  i === selectedIndex ? 'bg-primary/8 text-foreground' : 'text-foreground/80 hover:bg-muted'
                }`}
              >
                <span className="flex-shrink-0 text-muted-foreground">{renderNodeIcon(def)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{def.label}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {def.keywords.join(' · ')}
                  </p>
                </div>
                <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">{def.category}</span>
              </button>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="px-3 py-1.5 border-t border-border flex items-center gap-3 text-[10px] text-muted-foreground">
          <span><kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">↑↓</kbd> 选择</span>
          <span><kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">Enter</kbd> 创建</span>
          <span><kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">Esc</kbd> 关闭</span>
        </div>
      </div>
    </div>
  )
}

export default QuickNodePanel
