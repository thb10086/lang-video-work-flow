import { useCallback, useEffect, useMemo, useRef, type DragEvent } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  type ReactFlowInstance,
  type Connection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { useFlowStore } from '@/store/flowStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useUIStore } from '@/store/uiStore'
import { canConnect } from '@/types/portRegistry'
import CanvasToolbar from '@/components/canvas/CanvasToolbar'
import QuickNodePanel from '@/components/canvas/QuickNodePanel'
import CanvasContextMenu from '@/components/canvas/CanvasContextMenu'
import CharacterGridNode from '@/components/nodes/CharacterGridNode'
import SceneGridNode from '@/components/nodes/SceneGridNode'
import ImageGenNode from '@/components/nodes/ImageGenNode'
import VideoGenNode from '@/components/nodes/VideoGenNode'
import TextNode from '@/components/nodes/TextNode'
import AudioNode from '@/components/nodes/AudioNode'
import LLMChatNode from '@/components/nodes/LLMChatNode'
import ImageCropNode from '@/components/nodes/ImageCropNode'
import CharacterExtractNode from '@/components/nodes/CharacterExtractNode'
import StoryboardNode from '@/components/nodes/StoryboardNode'
import CharacterManagerNode from '@/components/nodes/CharacterManagerNode'
import StyleLockNode from '@/components/nodes/StyleLockNode'
import ContinuityCheckNode from '@/components/nodes/ContinuityCheckNode'
import VideoStitchNode from '@/components/nodes/VideoStitchNode'
import ImageEditNode from '@/components/nodes/ImageEditNode'

const nodeTypes = {
  characterGrid: CharacterGridNode,
  sceneGrid: SceneGridNode,
  imageGen: ImageGenNode,
  videoGen: VideoGenNode,
  textNode: TextNode,
  audioNode: AudioNode,
  llmChat: LLMChatNode,
  imageCrop: ImageCropNode,
  characterExtract: CharacterExtractNode,
  storyboard: StoryboardNode,
  characterManager: CharacterManagerNode,
  styleLock: StyleLockNode,
  continuityCheck: ContinuityCheckNode,
  videoStitch: VideoStitchNode,
  imageEdit: ImageEditNode,
}

const BG_VARIANT_MAP: Record<string, BackgroundVariant> = {
  dots: BackgroundVariant.Dots,
  lines: BackgroundVariant.Lines,
  cross: BackgroundVariant.Cross,
}

function WorkflowCanvas() {
  const reactFlowRef = useRef<ReactFlowInstance | null>(null)
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect: storeOnConnect,
    addNode,
    selectNode,
    undo,
    redo,
    copySelected,
    paste,
    duplicateSelected,
    deleteSelected,
    selectAll,
  } = useFlowStore()

  const {
    canvasBackground,
    canvasGridGap,
    canvasSnapToGrid,
  } = useSettingsStore()

  const snapGrid = useMemo((): [number, number] => [canvasGridGap, canvasGridGap], [canvasGridGap])

  // ── Global keyboard shortcuts ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in an input/textarea/select
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      if ((e.target as HTMLElement)?.isContentEditable) return

      const ctrl = e.ctrlKey || e.metaKey

      if (ctrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        redo()
      } else if (ctrl && e.key === 'c') {
        e.preventDefault()
        copySelected()
      } else if (ctrl && e.key === 'v') {
        e.preventDefault()
        paste()
      } else if (ctrl && e.key === 'd') {
        e.preventDefault()
        duplicateSelected()
      } else if (ctrl && e.key === 'a') {
        e.preventDefault()
        selectAll()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo, copySelected, paste, duplicateSelected, deleteSelected, selectAll])

  // ── Agent fitView trigger ──
  useEffect(() => {
    const handleAgentFitView = () => {
      if (reactFlowRef.current) {
        reactFlowRef.current.fitView({ padding: 0.15, duration: 400 })
      }
    }
    window.addEventListener('agent-fitview', handleAgentFitView)
    return () => window.removeEventListener('agent-fitview', handleAgentFitView)
  }, [])

  // Connection validation: only allow compatible port types
  const isValidConnection = useCallback((connection: Connection | { source?: string; target?: string; sourceHandle?: string | null; targetHandle?: string | null }) => {
    const source = connection.source
    const target = connection.target
    const sourceHandle = connection.sourceHandle
    const targetHandle = connection.targetHandle
    if (!source || !target || !sourceHandle || !targetHandle) return true
    const sourceNode = nodes.find(n => n.id === source)
    const targetNode = nodes.find(n => n.id === target)
    if (!sourceNode?.type || !targetNode?.type) return true
    return canConnect(sourceNode.type, sourceHandle, targetNode.type, targetHandle)
  }, [nodes])

  const onConnect = useCallback((connection: Connection) => {
    if (!isValidConnection(connection)) return
    storeOnConnect(connection)
  }, [isValidConnection, storeOnConnect])

  const onInit = useCallback((instance: ReactFlowInstance) => {
    reactFlowRef.current = instance
  }, [])

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault()

      const type = event.dataTransfer.getData('application/reactflow-type')
      const dataStr = event.dataTransfer.getData('application/reactflow-data')

      if (!type || !reactFlowRef.current) return

      const position = reactFlowRef.current.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      try {
        const data = JSON.parse(dataStr)
        addNode(type, position, data)
      } catch {
        addNode(type, position, { label: type })
      }
    },
    [addNode]
  )

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      selectNode(node.id)
    },
    [selectNode]
  )

  const onPaneClick = useCallback(() => {
    selectNode(null)
  }, [selectNode])

  // ── Edge-to-Node: open QuickNodePanel when dragging to blank area ──
  const setPendingConnection = useUIStore((s) => s.setPendingConnection)
  const setQuickNodePanelOpen = useUIStore((s) => s.setQuickNodePanelOpen)

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const target = event.target as HTMLElement
      // Only trigger if dropped on the canvas pane (not on a node or handle)
      if (target.classList.contains('react-flow__pane') && reactFlowRef.current) {
        const clientX = 'clientX' in event ? event.clientX : event.changedTouches[0].clientX
        const clientY = 'clientY' in event ? event.clientY : event.changedTouches[0].clientY
        const position = reactFlowRef.current.screenToFlowPosition({ x: clientX, y: clientY })

        // Try to find the source from the internal connecting state
        const connectingEl = document.querySelector('.react-flow__handle.connecting')
        const nodeEl = connectingEl?.closest('.react-flow__node')
        const sourceNodeId = nodeEl?.getAttribute('data-id')
        const sourceHandleId = connectingEl?.getAttribute('data-handleid')

        if (sourceNodeId && sourceHandleId) {
          setPendingConnection({ sourceNodeId, sourceHandleId, position })
        }

        setQuickNodePanelOpen(true)
      }
    },
    [setPendingConnection, setQuickNodePanelOpen]
  )

  return (
    <div className="flex-1 h-full relative">
      <CanvasToolbar />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onInit={onInit}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onConnectEnd={onConnectEnd}
        nodeTypes={nodeTypes}
        fitView
        deleteKeyCode={['Backspace', 'Delete']}
        snapToGrid={canvasSnapToGrid}
        snapGrid={snapGrid}
        defaultEdgeOptions={{
          animated: true,
          style: { stroke: 'hsl(var(--primary))', strokeWidth: 2 },
        }}
        proOptions={{ hideAttribution: true }}
      >
        {canvasBackground !== 'none' && (
          <Background
            variant={BG_VARIANT_MAP[canvasBackground] || BackgroundVariant.Dots}
            gap={canvasGridGap}
            size={1}
            color="hsl(var(--muted-foreground) / 0.15)"
          />
        )}
        <Controls className="!bg-card !border-border !shadow-lg" />
        <MiniMap
          className="!bg-card !border-border"
          nodeColor={(node) => {
            switch (node.type) {
              case 'characterGrid': return '#a855f7'
              case 'sceneGrid': return '#10b981'
              case 'imageGen': return '#3b82f6'
              case 'videoGen': return '#f43f5e'
              case 'textNode': return '#f59e0b'
              case 'audioNode': return '#f97316'
              case 'llmChat': return '#8b5cf6'
              case 'imageCrop': return '#06b6d4'
              case 'characterExtract': return '#06b6d4'
              case 'storyboard': return '#a855f7'
              case 'characterManager': return '#6366f1'
              case 'styleLock': return '#ec4899'
              case 'continuityCheck': return '#14b8a6'
              case 'videoStitch': return '#f43f5e'
              case 'imageEdit': return '#f97316'
              default: return '#6b7280'
            }
          }}
          maskColor="hsl(var(--background) / 0.7)"
        />
      </ReactFlow>

      {/* Quick Node Panel (Ctrl+K) */}
      <QuickNodePanel />

      {/* Right-click Context Menu */}
      <CanvasContextMenu />
    </div>
  )
}

export default WorkflowCanvas
