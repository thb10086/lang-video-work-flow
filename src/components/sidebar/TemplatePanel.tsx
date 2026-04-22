import { useState, useMemo, useCallback } from 'react'
import { LayoutTemplate, X, ChevronRight, Film, Image, Clock, Layers } from 'lucide-react'
import { BUILTIN_TEMPLATES, CATEGORY_LABELS, instantiateTemplate, type WorkflowTemplate } from '@/templates/workflowTemplates'
import { useFlowStore } from '@/store/flowStore'
import { useBackendModels } from '@/hooks/useBackendModels'

interface TemplatePanelProps {
  open: boolean
  onClose: () => void
}

/** Compute stats from template nodes */
function getTemplateStats(template: WorkflowTemplate) {
  let videoCount = 0
  let imageCount = 0
  let totalDuration = 0
  let styleDesc = ''

  for (const n of template.nodes) {
    if (n.type === 'videoGen') {
      videoCount++
      totalDuration += Number(n.data?.duration || 5)
    } else if (n.type === 'imageGen') {
      imageCount++
    } else if (n.type === 'styleLock' && n.data?.styleDescription) {
      styleDesc = String(n.data.styleDescription).split(',')[0].trim()
    }
  }

  return { videoCount, imageCount, totalDuration, styleDesc }
}

function TemplatePanel({ open, onClose }: TemplatePanelProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [hoveredTemplate, setHoveredTemplate] = useState<string | null>(null)
  const [confirmTemplate, setConfirmTemplate] = useState<WorkflowTemplate | null>(null)
  const importWorkflow = useFlowStore((s) => s.importWorkflow)
  const nodeCount = useFlowStore((s) => s.nodes.length)

  // Load model registry for schema-aware template instantiation
  const { models: videoModels } = useBackendModels('video')
  const { models: imageModels } = useBackendModels('image')
  const { models: audioModels } = useBackendModels('audio')
  const modelRegistry = useMemo(
    () => ({ video: videoModels, image: imageModels, audio: audioModels }),
    [videoModels, imageModels, audioModels],
  )

  const categories = useMemo(
    () => [...new Set(BUILTIN_TEMPLATES.map(t => t.category))],
    []
  )

  const filtered = useMemo(
    () => selectedCategory
      ? BUILTIN_TEMPLATES.filter(t => t.category === selectedCategory)
      : BUILTIN_TEMPLATES,
    [selectedCategory]
  )

  const handleApplyTemplate = useCallback((template: WorkflowTemplate) => {
    if (nodeCount > 0) {
      setConfirmTemplate(template)
    } else {
      const { nodes, edges } = instantiateTemplate(template, modelRegistry)
      const json = JSON.stringify({ nodes, edges })
      importWorkflow(json)
      onClose()
    }
  }, [nodeCount, importWorkflow, onClose, modelRegistry])

  const handleConfirmApply = useCallback(() => {
    if (!confirmTemplate) return
    const { nodes, edges } = instantiateTemplate(confirmTemplate, modelRegistry)
    const json = JSON.stringify({ nodes, edges })
    importWorkflow(json)
    setConfirmTemplate(null)
    onClose()
  }, [confirmTemplate, importWorkflow, onClose, modelRegistry])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-[740px] max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <LayoutTemplate className="w-5 h-5 text-primary" />
            <h2 className="font-bold text-base">工作流模板</h2>
            <span className="text-xs text-muted-foreground">{BUILTIN_TEMPLATES.length} 个模板</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Category Tabs */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-border bg-muted/30 flex-wrap">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              !selectedCategory ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-muted-foreground'
            }`}
          >
            全部
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                selectedCategory === cat ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-muted-foreground'
              }`}
            >
              {CATEGORY_LABELS[cat] || cat}
            </button>
          ))}
        </div>

        {/* Template Grid */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-2 gap-4">
          {filtered.map(template => {
            const stats = getTemplateStats(template)
            return (
              <div
                key={template.id}
                onMouseEnter={() => setHoveredTemplate(template.id)}
                onMouseLeave={() => setHoveredTemplate(null)}
                className={`rounded-xl border p-4 cursor-pointer transition-all duration-200 ${
                  hoveredTemplate === template.id
                    ? 'border-primary shadow-lg shadow-primary/10 scale-[1.02]'
                    : 'border-border hover:border-primary/50'
                }`}
                onClick={() => handleApplyTemplate(template)}
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{template.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-sm">{template.name}</h3>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                        {CATEGORY_LABELS[template.category] || template.category}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed line-clamp-2">
                      {template.description}
                    </p>

                    {/* Stats Row */}
                    <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                      {stats.videoCount > 0 && (
                        <span className="flex items-center gap-0.5">
                          <Film className="w-3 h-3" /> {stats.videoCount} 镜头
                        </span>
                      )}
                      {stats.imageCount > 0 && (
                        <span className="flex items-center gap-0.5">
                          <Image className="w-3 h-3" /> {stats.imageCount} 关键帧
                        </span>
                      )}
                      {stats.totalDuration > 0 && (
                        <span className="flex items-center gap-0.5">
                          <Clock className="w-3 h-3" /> ~{stats.totalDuration}s
                        </span>
                      )}
                      <span className="flex items-center gap-0.5">
                        <Layers className="w-3 h-3" /> {template.nodes.length}
                      </span>
                    </div>

                    {/* Tags + Style */}
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      {stats.styleDesc && (
                        <span className="px-1.5 py-0.5 text-[9px] rounded bg-primary/10 text-primary border border-primary/20">
                          {stats.styleDesc}
                        </span>
                      )}
                      {template.tags.slice(0, 3).map(tag => (
                        <span key={tag} className="px-1.5 py-0.5 text-[9px] rounded bg-muted text-muted-foreground">
                          {tag}
                        </span>
                      ))}
                    </div>

                    <div className="flex items-center justify-end mt-3">
                      <span className="text-[10px] text-primary flex items-center gap-0.5 font-medium">
                        使用模板 <ChevronRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border bg-muted/30">
          <p className="text-[10px] text-muted-foreground text-center">
            使用模板将替换当前画布内容。可通过"导出"保存当前工作。
          </p>
        </div>
      </div>

      {/* Confirm Dialog */}
      {confirmTemplate && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
          <div className="bg-card border border-border rounded-xl shadow-2xl p-6 w-[360px]">
            <h3 className="font-semibold text-sm">确认替换画布？</h3>
            <p className="text-xs text-muted-foreground mt-2">
              当前画布有 {nodeCount} 个节点，加载模板「{confirmTemplate.name}」将替换全部内容。
            </p>
            <div className="flex items-center justify-end gap-3 mt-5">
              <button
                onClick={() => setConfirmTemplate(null)}
                className="px-4 py-1.5 text-xs rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmApply}
                className="px-4 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                确认替换
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default TemplatePanel
