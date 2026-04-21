import { type DragEvent } from 'react'
import { NODE_REGISTRY, renderNodeIcon, type NodeDefinition } from '@/data/nodeDefinitions'

function NodePanel() {
  const onDragStart = (event: DragEvent, nodeDef: NodeDefinition) => {
    event.dataTransfer.setData('application/reactflow-type', nodeDef.type)
    event.dataTransfer.setData('application/reactflow-data', JSON.stringify(nodeDef.defaultData))
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div className="w-full bg-card flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <h2 className="font-bold text-sm">节点面板</h2>
        <p className="text-xs text-muted-foreground mt-1">拖拽节点到画布</p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {NODE_REGISTRY.map((def) => (
          <div
            key={def.type}
            draggable
            onDragStart={(e) => onDragStart(e, def)}
            className={`flex items-center gap-3 p-3 rounded-lg border cursor-grab active:cursor-grabbing
              hover:shadow-md transition-all duration-150 ${def.cardColor}`}
          >
            <div className="flex-shrink-0">{renderNodeIcon(def, 'w-5 h-5')}</div>
            <div className="min-w-0">
              <p className="font-medium text-sm text-foreground">{def.label}</p>
              <p className="text-[10px] text-muted-foreground truncate">{def.description}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-border">
        <p className="text-[10px] text-muted-foreground text-center">
          AI Video Workflow Studio v0.4
        </p>
      </div>
    </div>
  )
}

export default NodePanel
