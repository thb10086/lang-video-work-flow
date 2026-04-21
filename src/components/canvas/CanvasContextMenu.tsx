/**
 * CanvasContextMenu — 画布右键上下文菜单
 *
 * 空白处右键: 创建节点 / 粘贴 / 适应视图
 * 节点上右键: 执行 / 复制 / 删除 / 优化提示词
 */

import { useCallback, useEffect, useState, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import {
  Plus, Clipboard, Maximize2, Play, Copy, Trash2, Sparkles,
} from 'lucide-react'
import { useFlowStore } from '@/store/flowStore'
import { useUIStore } from '@/store/uiStore'
import { NODE_REGISTRY, renderNodeIcon, type NodeDefinition } from '@/data/nodeDefinitions'

interface MenuPosition {
  x: number
  y: number
  canvasX: number
  canvasY: number
}

interface ContextMenuState {
  visible: boolean
  position: MenuPosition | null
  targetNodeId: string | null
}

/** Quick-create shows the 6 most common node types */
const QUICK_CREATE_TYPES = ['imageGen', 'videoGen', 'textNode', 'llmChat', 'storyboard', 'audioNode']
const QUICK_CREATE_ITEMS = NODE_REGISTRY.filter((d) => QUICK_CREATE_TYPES.includes(d.type))

function CanvasContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState>({ visible: false, position: null, targetNodeId: null })
  const [showSubMenu, setShowSubMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const reactFlow = useReactFlow()
  const addNode = useFlowStore((s) => s.addNode)
  const removeNode = useFlowStore((s) => s.removeNode)
  const nodes = useFlowStore((s) => s.nodes)
  const setQuickNodePanelOpen = useUIStore((s) => s.setQuickNodePanelOpen)

  // Register context menu handler
  const handleContextMenu = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement
    const reactFlowEl = target.closest('.react-flow')
    if (!reactFlowEl) return

    // Don't intercept if on a handle or edge
    if (target.closest('.react-flow__handle') || target.closest('.react-flow__edge')) return

    e.preventDefault()

    const nodeEl = target.closest('.react-flow__node')
    const nodeId = nodeEl?.getAttribute('data-id') || null

    const bounds = reactFlowEl.getBoundingClientRect()
    const viewport = reactFlow.getViewport()
    const canvasX = (e.clientX - bounds.left - viewport.x) / viewport.zoom
    const canvasY = (e.clientY - bounds.top - viewport.y) / viewport.zoom

    setMenu({
      visible: true,
      position: { x: e.clientX, y: e.clientY, canvasX, canvasY },
      targetNodeId: nodeId,
    })
    setShowSubMenu(false)
  }, [reactFlow])

  // Close on click outside
  useEffect(() => {
    const handleClick = () => setMenu({ visible: false, position: null, targetNodeId: null })
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClick() }
    window.addEventListener('click', handleClick)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('click', handleClick)
      window.removeEventListener('keydown', handleKey)
    }
  }, [])

  // Register context menu listener
  useEffect(() => {
    window.addEventListener('contextmenu', handleContextMenu)
    return () => window.removeEventListener('contextmenu', handleContextMenu)
  }, [handleContextMenu])

  const handleQuickCreate = useCallback((item: NodeDefinition) => {
    if (!menu.position) return
    addNode(item.type, { x: menu.position.canvasX, y: menu.position.canvasY }, { ...item.defaultData })
    setMenu({ visible: false, position: null, targetNodeId: null })
  }, [menu.position, addNode])

  const handleDeleteNode = useCallback(() => {
    if (menu.targetNodeId) removeNode(menu.targetNodeId)
    setMenu({ visible: false, position: null, targetNodeId: null })
  }, [menu.targetNodeId, removeNode])

  const handleDuplicateNode = useCallback(() => {
    if (!menu.targetNodeId || !menu.position) return
    const node = nodes.find((n) => n.id === menu.targetNodeId)
    if (!node) return
    addNode(
      node.type || 'textNode',
      { x: menu.position.canvasX + 30, y: menu.position.canvasY + 30 },
      { ...(node.data as Record<string, unknown>), status: 'idle' },
    )
    setMenu({ visible: false, position: null, targetNodeId: null })
  }, [menu.targetNodeId, menu.position, nodes, addNode])

  const handleFitView = useCallback(() => {
    reactFlow.fitView({ duration: 300, padding: 0.2 })
    setMenu({ visible: false, position: null, targetNodeId: null })
  }, [reactFlow])

  const handleOpenQuickPanel = useCallback(() => {
    setQuickNodePanelOpen(true)
    setMenu({ visible: false, position: null, targetNodeId: null })
  }, [setQuickNodePanelOpen])

  if (!menu.visible || !menu.position) return null

  const isNodeMenu = !!menu.targetNodeId
  const targetNode = isNodeMenu ? nodes.find((n) => n.id === menu.targetNodeId) : null

  // Clamp menu position to viewport
  const menuX = Math.min(menu.position.x, window.innerWidth - 220)
  const menuY = Math.min(menu.position.y, window.innerHeight - 320)

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] floating-panel py-1 min-w-[200px] animate-scale-in"
      style={{ left: menuX, top: menuY }}
      onClick={(e) => e.stopPropagation()}
    >
      {isNodeMenu ? (
        /* ── Node Context Menu ── */
        <>
          <div className="px-3 py-1.5 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
            {targetNode ? String((targetNode.data as Record<string, unknown>).label || targetNode.type) : '节点'}
          </div>
          <MenuItem icon={<Play className="w-3.5 h-3.5" />} label="执行节点" shortcut="Enter" onClick={() => setMenu({ visible: false, position: null, targetNodeId: null })} />
          <MenuItem icon={<Copy className="w-3.5 h-3.5" />} label="复制节点" onClick={handleDuplicateNode} />
          <MenuItem icon={<Sparkles className="w-3.5 h-3.5" />} label="优化提示词" onClick={() => setMenu({ visible: false, position: null, targetNodeId: null })} />
          <div className="my-1 h-px bg-border" />
          <MenuItem icon={<Trash2 className="w-3.5 h-3.5 text-destructive" />} label="删除节点" className="text-destructive" shortcut="Del" onClick={handleDeleteNode} />
        </>
      ) : (
        /* ── Canvas Context Menu ── */
        <>
          <div className="px-3 py-1.5 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
            画布
          </div>
          <div
            className="relative"
            onMouseEnter={() => setShowSubMenu(true)}
            onMouseLeave={() => setShowSubMenu(false)}
          >
            <MenuItem icon={<Plus className="w-3.5 h-3.5" />} label="新建节点" hasSubmenu onClick={() => {}} />
            {showSubMenu && (
              <div className="absolute left-full top-0 ml-1 floating-panel py-1 min-w-[180px] animate-scale-in">
                {QUICK_CREATE_ITEMS.map((item) => (
                  <MenuItem key={item.type} icon={renderNodeIcon(item, 'w-3.5 h-3.5')} label={item.label} onClick={() => handleQuickCreate(item)} />
                ))}
                <div className="my-1 h-px bg-border" />
                <MenuItem icon={<Plus className="w-3.5 h-3.5" />} label="更多... (Ctrl+K)" onClick={handleOpenQuickPanel} />
              </div>
            )}
          </div>
          <MenuItem icon={<Clipboard className="w-3.5 h-3.5" />} label="粘贴" onClick={() => setMenu({ visible: false, position: null, targetNodeId: null })} />
          <div className="my-1 h-px bg-border" />
          <MenuItem icon={<Maximize2 className="w-3.5 h-3.5" />} label="适应视图" onClick={handleFitView} />
        </>
      )}
    </div>
  )
}

function MenuItem({
  icon, label, shortcut, className, hasSubmenu, onClick,
}: {
  icon: React.ReactNode
  label: string
  shortcut?: string
  className?: string
  hasSubmenu?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-muted transition-colors ${className || 'text-foreground'}`}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <span className="text-[10px] text-muted-foreground/60">{shortcut}</span>}
      {hasSubmenu && <span className="text-muted-foreground/60 text-[10px]">▸</span>}
    </button>
  )
}

export default CanvasContextMenu
