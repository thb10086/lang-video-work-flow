import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react'
import {
  Send, Bot, UserIcon, Loader2, Trash2, ChevronDown, ChevronRight,
  Clapperboard, PenLine, Palette, Camera, Check, X, Brain,
  ListChecks, Database, Circle, CheckCircle2, XCircle,
  Wrench, Paperclip, ImageIcon, Square, Timer, Zap, Layers,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useChatStore, type ChatMessage, type AgentStats } from '@/store/chatStore'
import { useAgentMemoryStore } from '@/store/agentMemoryStore'
import { ALL_ROLES } from '@/prompts/roles'
import { useBackendModels } from '@/hooks/useBackendModels'
import { useFlowStore } from '@/store/flowStore'
import { useSettingsStore } from '@/store/settingsStore'
import ProgressTimeline from '@/components/sidebar/ProgressTimeline'

// ── Lucide icon resolver for role icons ──
function RoleIcon({ iconId, className }: { iconId: string; className?: string }) {
  const cls = className || 'w-4 h-4'
  switch (iconId) {
    case 'clapperboard': return <Clapperboard className={cls} />
    case 'pen-line': return <PenLine className={cls} />
    case 'palette': return <Palette className={cls} />
    case 'camera': return <Camera className={cls} />
    default: return <Bot className={cls} />
  }
}

// ── Tool name → Chinese label mapping ──
//
// Phase 3.2 makes `<noun>.<verb>` the canonical form for every backend
// tool. The legacy snake_case names remain accepted as aliases until
// Phase 4 cleanup, so this dict carries both forms (canonical + legacy)
// and they share the same Chinese label. Lookup is `TOOL_LABELS[name]
// || name` — when an unknown name appears (e.g. a frontend-only tool
// not yet migrated, or a brand-new tool the user just added), the raw
// name is shown so the chat UI never goes blank.
const TOOL_LABELS: Record<string, string> = {
  // ── Canonical (`<noun>.<verb>`) names registered by the backend
  //    (server/app/agents/tool_registry.py) — preferred going forward.
  // canvas.*
  'canvas.add_node': '创建节点',
  'canvas.update_node': '更新节点',
  'canvas.delete_node': '删除节点',
  'canvas.connect': '连接节点',
  'canvas.highlight': '高亮节点',
  'canvas.undo': '撤销',
  // character.*
  'character.create_grid': '创建角色',
  'character.create_extract': '创建角色提取',
  'character.create_registry': '创建角色管理器',
  // images.* / ui.* / timeline.*
  'images.collect_user_uploads': '注入用户图片',
  'images.upload_to_cos': '上传图片',
  'ui.show_diff': '展示差异',
  'timeline.create': '创建时间轴',
  // memory.*
  'memory.save': '保存记忆',
  'memory.recall': '检索记忆',
  'memory.forget': '删除记忆',
  // model.* / phase.* / plan.*
  'model.list': '查询模型',
  'model.get_params': '获取模型参数',
  'phase.set': '切换阶段',
  'plan.create': '制定计划',
  'plan.update_step': '更新进度',
  // agent.* — subagent delegation (Tier 3 surface)
  'agent.delegate': '委派子代理',
  'agent.parallel_delegate': '并行委派',
  // asset.* — admin/internal only; here for completeness in the rare
  // event the call is logged in chat (e.g. via dev-tools / test runs).
  'asset.update_identity': '更新身份特征',

  // ── Legacy snake_case aliases — share labels with their canonical
  //    counterparts. Kept until Phase 4 alias retirement (4.2.x).
  generate_workflow: '生成工作流',
  create_character_grid: '创建角色',           // ↳ character.create_grid
  create_character_extract_node: '创建角色提取', // ↳ character.create_extract
  create_character_manager_node: '创建角色管理器', // ↳ character.create_registry
  create_scene_grid: '创建场景',
  create_image_node: '创建图片节点',
  create_video_node: '创建视频节点',
  create_text_node: '创建文本',
  create_audio_node: '创建音频',
  create_storyboard_node: '创建分镜',
  create_style_lock_node: '创建风格锁定',
  create_image_edit_node: '创建图片编辑',
  create_video_stitch_node: '创建视频拼接',
  create_continuity_check_node: '创建连续性检查',
  create_timeline: '创建时间轴',                // ↳ timeline.create
  create_timeline_node: '创建时间轴',           // ↳ timeline.create (older form)
  create_llm_node: '创建LLM节点',
  connect_nodes: '连接节点',                    // ↳ canvas.connect
  update_node: '更新节点',                      // ↳ canvas.update_node
  delete_node: '删除节点',                      // ↳ canvas.delete_node
  execute_node: '执行节点',
  batch_execute: '串行批量执行',
  parallel_execute: '并行执行',
  plan_task: '制定计划',                        // ↳ plan.create
  update_plan_step: '更新进度',                 // ↳ plan.update_step
  verify_task: '验证任务',
  save_memory: '保存记忆',                      // ↳ memory.save
  recall_memory: '检索记忆',                    // ↳ memory.recall
  forget_memory: '删除记忆',                    // ↳ memory.forget
  retry_node: '重试节点',
  list_models: '查询模型',                      // ↳ model.list
  get_model_params: '获取模型参数',             // ↳ model.get_params
  set_phase: '切换阶段',                        // ↳ phase.set
  get_node_output: '检查节点结果',
  get_canvas_state: '获取画布状态',
  inject_user_images: '注入用户图片',           // ↳ images.collect_user_uploads
  review_content: '质量审查',
  optimize_prompt: '优化提示词',
  detect_scenario: '场景识别',
  classify_image: '图片分类',
}

// ── Tool call display: Cursor-style with live progress ──
function ToolCallSection({ calls, isLive }: { calls: { name: string; result: string; success: boolean }[]; isLive?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  // Auto-expand when live
  useEffect(() => {
    if (isLive) setExpanded(true)
  }, [isLive])
  if (!calls || calls.length === 0) return null

  const successCount = calls.filter(c => c.success).length
  const failCount = calls.filter(c => !c.success).length
  const lastCall = calls[calls.length - 1]

  return (
    <div className={`rounded-lg border overflow-hidden transition-colors ${
      isLive ? 'border-primary/30 bg-primary/5' : 'border-border/40 bg-background/50'
    }`}>
      {/* Header bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-muted/30 transition-colors text-left"
      >
        {isLive ? (
          <Loader2 className="w-3 h-3 animate-spin text-primary flex-shrink-0" />
        ) : (
          <Wrench className="w-3 h-3 text-muted-foreground flex-shrink-0" />
        )}
        {isLive ? (
          <span className="font-medium text-primary truncate">
            {TOOL_LABELS[lastCall?.name] || lastCall?.name}...
          </span>
        ) : (
          <span className="font-medium text-foreground">
            {calls.length} 个工具调用
          </span>
        )}
        <span className="text-muted-foreground ml-auto flex items-center gap-1.5 flex-shrink-0">
          {successCount > 0 && <span className="flex items-center gap-0.5 text-green-600"><Check className="w-2.5 h-2.5" />{successCount}</span>}
          {failCount > 0 && <span className="flex items-center gap-0.5 text-red-500"><X className="w-2.5 h-2.5" />{failCount}</span>}
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
      </button>
      {/* Expanded tool list */}
      {expanded && (
        <div className="border-t border-border/30">
          {calls.map((call, i) => {
            const isExecutionTool = ['execute_node', 'batch_execute'].includes(call.name)
            const isLastAndLive = isLive && i === calls.length - 1
            return (
              <div key={i} className={`flex items-start gap-2 px-3 py-1.5 text-[11px] ${
                isLastAndLive ? 'bg-primary/5' : i % 2 === 0 ? 'bg-transparent' : 'bg-muted/20'
              }`}>
                <div className="flex-shrink-0 mt-0.5">
                  {isLastAndLive ? (
                    <Loader2 className="w-3 h-3 animate-spin text-primary" />
                  ) : call.success ? (
                    <CheckCircle2 className={`w-3 h-3 ${isExecutionTool ? 'text-emerald-500' : 'text-green-500'}`} />
                  ) : (
                    <XCircle className="w-3 h-3 text-red-500" />
                  )}
                </div>
                <span className={`font-mono text-[10px] min-w-[90px] flex-shrink-0 ${
                  isExecutionTool ? 'text-emerald-600 font-semibold' : 'text-primary/70'
                }`}>
                  {TOOL_LABELS[call.name] || call.name}
                </span>
                <span className={`truncate flex-1 ${call.success ? 'text-muted-foreground' : 'text-red-400'}`}>{call.result.slice(0, 120)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Inline Task Plan (renders inside message flow, not global) ──
function InlineTaskPlan() {
  const plan = useAgentMemoryStore(s => s.currentPlan)
  if (!plan) return null

  const doneCount = plan.steps.filter(s => s.status === 'done').length
  const total = plan.steps.length
  const progress = total > 0 ? Math.round((doneCount / total) * 100) : 0
  const isCompleted = !!plan.completedAt

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <ListChecks className="w-3.5 h-3.5 text-primary flex-shrink-0" />
        <span className="text-xs font-medium truncate">{plan.goal}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">{doneCount}/{total}</span>
      </div>
      <div className="mx-3 mb-2 h-1 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${isCompleted ? 'bg-green-500' : 'bg-primary'}`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="px-3 pb-2 space-y-1">
        {plan.steps.map((step, i) => (
          <div key={step.id} className="flex items-start gap-1.5 text-[11px]">
            {step.status === 'done' ? (
              <CheckCircle2 className="w-3 h-3 text-green-500 mt-0.5 flex-shrink-0" />
            ) : step.status === 'failed' ? (
              <XCircle className="w-3 h-3 text-red-500 mt-0.5 flex-shrink-0" />
            ) : step.status === 'in_progress' ? (
              <Loader2 className="w-3 h-3 text-primary animate-spin mt-0.5 flex-shrink-0" />
            ) : (
              <Circle className="w-3 h-3 text-muted-foreground/40 mt-0.5 flex-shrink-0" />
            )}
            <span className={step.status === 'done' ? 'text-muted-foreground' : step.status === 'in_progress' ? 'text-foreground' : 'text-muted-foreground/60'}>
              {step.description}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Memory Indicator (compact, in header) ──
function MemoryBadge() {
  const memCount = useAgentMemoryStore(s => s.memories.length)
  if (memCount === 0) return null

  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
      <Database className="w-2.5 h-2.5" />
      {memCount}
    </span>
  )
}

// ── Live Agent Stats Bar (Claude Code inspired) ──
function LiveStatsBar({ stats }: { stats: AgentStats }) {
  const elapsed = Math.round(stats.elapsed / 1000)
  const min = Math.floor(elapsed / 60)
  const sec = elapsed % 60
  const timeStr = min > 0 ? `${min}:${sec.toString().padStart(2, '0')}` : `${sec}s`
  const tokensK = stats.tokensUsed > 1000 ? `${(stats.tokensUsed / 1000).toFixed(1)}k` : `${stats.tokensUsed}`
  const contextPct = Math.min(Math.round((stats.tokensUsed / 120000) * 100), 100)
  const layerNames = ['', 'MC', 'AC', 'FC']

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-primary/5 border-b border-primary/10 text-[10px] text-muted-foreground">
      <span className="flex items-center gap-1"><Timer className="w-3 h-3" />{timeStr}</span>
      <span className="flex items-center gap-1"><Zap className="w-3 h-3" />R{stats.rounds}</span>
      <span className="flex items-center gap-1"><Wrench className="w-3 h-3" />{stats.toolCallCount}</span>
      <div className="flex items-center gap-1 flex-1 min-w-0">
        <Layers className="w-3 h-3 flex-shrink-0" />
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              contextPct > 85 ? 'bg-red-500' : contextPct > 60 ? 'bg-amber-500' : 'bg-primary'
            }`}
            style={{ width: `${contextPct}%` }}
          />
        </div>
        <span className="flex-shrink-0">{tokensK}</span>
        {stats.contextLayer > 0 && (
          <span className="text-primary font-medium">{layerNames[stats.contextLayer]}</span>
        )}
      </div>
    </div>
  )
}

// ── Message footer: duration + token usage (for completed assistant messages) ──
function MessageFooter({ msg }: { msg: ChatMessage }) {
  if (msg.role !== 'assistant' || !msg.duration) return null
  const sec = (msg.duration / 1000).toFixed(1)
  const tokensK = msg.tokenUsage && msg.tokenUsage > 1000
    ? `${(msg.tokenUsage / 1000).toFixed(1)}k tokens`
    : msg.tokenUsage ? `${msg.tokenUsage} tokens` : ''
  const layerNames = ['', 'MicroCompact', 'AutoCompact', 'FullCompact']
  const layerStr = msg.contextLayer ? layerNames[msg.contextLayer] : ''

  return (
    <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground/60">
      <span>{sec}s</span>
      {tokensK && <span>{tokensK}</span>}
      {layerStr && <span className="text-primary/50">{layerStr}</span>}
    </div>
  )
}

// ── Contextual Quick Actions ──
function QuickActions({ isProcessing, processUserMessage, setInput }: {
  isProcessing: boolean
  processUserMessage: (msg: string) => void
  setInput: (v: string) => void
}) {
  const lastMsg = useChatStore(s => s.messages[s.messages.length - 1])
  const hasFailures = lastMsg?.toolCalls?.some(tc => !tc.success)

  const defaultActions = ['创建角色', '添加场景', '图片生成', '视频生成', '生成工作流', '分镜脚本']
  const failureActions = ['重试生成', '检查画布状态', '优化分镜', '重写旁白']

  const actions = hasFailures ? failureActions : defaultActions

  return (
    <div className="flex gap-1.5 mt-2 flex-wrap">
      {actions.map((cmd) => (
        <button
          key={cmd}
          onClick={() => {
            if (isProcessing) return
            setInput('')
            processUserMessage(cmd)
          }}
          disabled={isProcessing}
          className={`px-2 py-1 text-[10px] rounded-md border transition-colors
            disabled:opacity-50 disabled:cursor-not-allowed ${
            hasFailures && cmd === '重试生成'
              ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20'
              : 'border-border bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground'
          }`}
        >
          {cmd}
        </button>
      ))}
    </div>
  )
}

const MAX_IMAGES = 10
const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5 MB

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function AgentChat() {
  const [input, setInput] = useState('')
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const [showRoleMenu, setShowRoleMenu] = useState(false)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [flashedMessageId, setFlashedMessageId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const {
    messages, isProcessing, activeRole, chatModel, streamingMessageId,
    agentStats, processUserMessage, clearMessages, setActiveRole, setChatModel,
    cancelProcessing,
  } = useChatStore()
  const setHighlight = useFlowStore((s) => s.setHighlight)
  const useBackendRuntime = useSettingsStore((s) => s.useBackendRuntime)
  const currentRole = ALL_ROLES.find(r => r.id === activeRole) || ALL_ROLES[0]
  const { models: backendLLMModels } = useBackendModels('text')
  const llmModels = backendLLMModels.map(m => ({ id: m.model_id, name: m.name }))
  const currentModelLabel = llmModels.find(m => m.id === chatModel)?.name || '默认模型'

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Hover binding: highlight referenced canvas nodes (D-9).
  const handleMessageHover = useCallback((msg: ChatMessage) => {
    if (msg.nodeRefs && msg.nodeRefs.length > 0) {
      setHighlight(msg.nodeRefs)
    }
  }, [setHighlight])
  const handleMessageLeave = useCallback(() => {
    setHighlight(null)
  }, [setHighlight])

  // Anchor: scroll to the earliest message referencing a given node when the
  // user Ctrl+Clicks on the canvas.
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ nodeId: string }>).detail
      if (!detail?.nodeId) return
      const msg = messages.find((m) => m.nodeRefs?.includes(detail.nodeId))
      if (!msg) return
      const el = messageRefs.current.get(msg.id)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setFlashedMessageId(msg.id)
        window.setTimeout(() => setFlashedMessageId(null), 800)
      }
    }
    window.addEventListener('agent:anchor-to-node', handler)
    return () => window.removeEventListener('agent:anchor-to-node', handler)
  }, [messages])

  const handleImageFiles = async (files: FileList | File[]) => {
    const validFiles = Array.from(files).filter(f => {
      if (!f.type.startsWith('image/')) return false
      if (f.size > MAX_IMAGE_SIZE) return false
      return true
    })
    const remaining = MAX_IMAGES - pendingImages.length
    const toProcess = validFiles.slice(0, remaining)
    if (toProcess.length === 0) return
    const dataUrls = await Promise.all(toProcess.map(readFileAsDataURL))
    setPendingImages(prev => [...prev, ...dataUrls])
  }

  const removePendingImage = (index: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== index))
  }

  const handleSend = () => {
    const trimmed = input.trim()
    if ((!trimmed && pendingImages.length === 0) || isProcessing) return
    const text = trimmed || (pendingImages.length > 0 ? `[用户上传了 ${pendingImages.length} 张图片]` : '')
    processUserMessage(text, pendingImages.length > 0 ? pendingImages : undefined)
    setInput('')
    setPendingImages([])
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const imageFiles: File[] = []
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile()
        if (file) imageFiles.push(file)
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault()
      handleImageFiles(imageFiles)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer?.files) {
      handleImageFiles(e.dataTransfer.files)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = () => {
    setIsDragOver(false)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-border space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
              <RoleIcon iconId={currentRole.icon} className="w-3.5 h-3.5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-sm">{currentRole.name}</h2>
                <MemoryBadge />
              </div>
              <p className="text-[10px] text-muted-foreground">{currentRole.description}</p>
            </div>
          </div>
          <button
            onClick={clearMessages}
            className="p-1.5 rounded-md hover:bg-muted transition-colors"
            title="清空对话"
          >
            <Trash2 className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Role + Model selectors */}
        <div className="flex gap-2">
          {/* Role */}
          <div className="relative flex-1">
            <button
              onClick={() => { setShowRoleMenu(!showRoleMenu); setShowModelMenu(false) }}
              className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] rounded-md border border-border bg-muted/30 hover:bg-muted transition-colors"
            >
              <span className="flex items-center gap-1.5 truncate">
                <RoleIcon iconId={currentRole.icon} className="w-3 h-3" />
                <span>{currentRole.name}</span>
              </span>
              <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
            </button>
            {showRoleMenu && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-md shadow-lg z-50 overflow-hidden">
                {ALL_ROLES.map(role => (
                  <button
                    key={role.id}
                    onClick={() => { setActiveRole(role.id); setShowRoleMenu(false) }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted transition-colors text-left ${
                      role.id === activeRole ? 'bg-primary/10 font-medium' : ''
                    }`}
                  >
                    <RoleIcon iconId={role.icon} className="w-3.5 h-3.5" />
                    <div>
                      <div className="font-medium">{role.name}</div>
                      <div className="text-[10px] text-muted-foreground">{role.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Model */}
          <div className="relative flex-1">
            <button
              onClick={() => { setShowModelMenu(!showModelMenu); setShowRoleMenu(false) }}
              className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] rounded-md border border-border bg-muted/30 hover:bg-muted transition-colors"
            >
              <span className="truncate">{currentModelLabel}</span>
              <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
            </button>
            {showModelMenu && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-md shadow-lg z-50 overflow-hidden max-h-60 overflow-y-auto">
                <button
                  onClick={() => { setChatModel(''); setShowModelMenu(false) }}
                  className={`w-full px-3 py-2 text-xs hover:bg-muted transition-colors text-left ${
                    !chatModel ? 'bg-primary/10 font-medium' : ''
                  }`}
                >
                  默认模型（跟随设置）
                </button>
                {llmModels.map(model => (
                  <button
                    key={model.id}
                    onClick={() => { setChatModel(model.id); setShowModelMenu(false) }}
                    className={`w-full px-3 py-2 text-xs hover:bg-muted transition-colors text-left ${
                      chatModel === model.id ? 'bg-primary/10 font-medium' : ''
                    }`}
                  >
                    {model.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Live stats bar during execution */}
      {isProcessing && agentStats && <LiveStatsBar stats={agentStats} />}

      {/* Progress timeline (backend-runtime sessions only) */}
      {useBackendRuntime && <ProgressTimeline />}

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg: ChatMessage) => {
          const isStreaming = msg.id === streamingMessageId
          const isThinking = isStreaming && msg.thinking
          const hasToolCalls = msg.toolCalls && msg.toolCalls.length > 0

          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="flex gap-2.5 flex-row-reverse">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                  <UserIcon className="w-3.5 h-3.5 text-primary" />
                </div>
                <div className="max-w-[85%] space-y-2">
                  {msg.images && msg.images.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 justify-end">
                      {msg.images.map((img, i) => (
                        <img
                          key={i}
                          src={img}
                          alt={`上传图片 ${i + 1}`}
                          className="w-16 h-16 object-cover rounded-lg border border-primary-foreground/20"
                        />
                      ))}
                    </div>
                  )}
                  <div className="rounded-xl px-3.5 py-2.5 text-sm leading-relaxed bg-primary text-primary-foreground">
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              </div>
            )
          }

          const isFlashed = flashedMessageId === msg.id
          return (
            <div
              key={msg.id}
              ref={(el) => {
                if (el) messageRefs.current.set(msg.id, el)
                else messageRefs.current.delete(msg.id)
              }}
              className={`flex gap-2.5 transition-colors rounded-lg ${
                isFlashed ? 'bg-primary/10 -mx-2 px-2' : ''
              }`}
              onMouseEnter={() => handleMessageHover(msg)}
              onMouseLeave={handleMessageLeave}
            >
              <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                isStreaming ? 'bg-primary/10' : 'bg-muted'
              }`}>
                {isThinking ? (
                  <Brain className="w-3.5 h-3.5 animate-pulse text-primary" />
                ) : isStreaming ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                ) : (
                  <Bot className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                {/* Thinking/execution status - Cursor style phase indicator */}
                {isThinking && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/10">
                    <div className="relative flex-shrink-0">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                    </div>
                    <span className="text-xs text-primary font-medium">{msg.thinking}</span>
                  </div>
                )}

                {/* Inline task plan (shows during execution) */}
                {isStreaming && <InlineTaskPlan />}

                {/* Live tool call progress (during streaming) */}
                {isStreaming && hasToolCalls && (
                  <ToolCallSection calls={msg.toolCalls!} isLive={true} />
                )}

                {/* Streaming content (shows while still streaming, after tools complete) */}
                {isStreaming && msg.content && (
                  <div className="rounded-xl px-3.5 py-2.5 text-sm leading-relaxed bg-muted/60 text-foreground border border-primary/10">
                    <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none prose-p:my-1 prose-li:my-0.5 prose-headings:my-2 prose-pre:my-1 prose-code:text-xs prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-muted/80 prose-pre:p-2 prose-pre:rounded-md prose-table:text-xs">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    </div>
                    <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5 align-middle" />
                  </div>
                )}

                {/* Final content (after streaming completes) */}
                {!isStreaming && msg.content && (
                  <div className="rounded-xl px-3.5 py-2.5 text-sm leading-relaxed bg-muted text-foreground">
                    <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none prose-p:my-1 prose-li:my-0.5 prose-headings:my-2 prose-pre:my-1 prose-code:text-xs prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-muted/80 prose-pre:p-2 prose-pre:rounded-md prose-table:text-xs">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    </div>
                    {/* Completed tool calls (collapsible) */}
                    {hasToolCalls && (
                      <div className="mt-2">
                        <ToolCallSection calls={msg.toolCalls!} />
                      </div>
                    )}
                  </div>
                )}

                {/* Duration/token footer for completed messages */}
                {!isStreaming && <MessageFooter msg={msg} />}

                {/* Loading state (no thinking, no content yet) */}
                {isStreaming && !isThinking && !msg.content && !hasToolCalls && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border/30">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span className="text-xs text-muted-foreground">思考中...</span>
                  </div>
                )}
              </div>
            </div>
          )
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div
        className={`p-3 border-t transition-colors ${isDragOver ? 'border-primary bg-primary/5' : 'border-border'}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files) handleImageFiles(e.target.files); e.target.value = '' }}
        />

        {/* Drag overlay hint */}
        {isDragOver && (
          <div className="flex items-center justify-center gap-2 py-3 mb-2 rounded-lg border-2 border-dashed border-primary/50 bg-primary/5">
            <ImageIcon className="w-4 h-4 text-primary" />
            <span className="text-xs text-primary font-medium">拖放图片到此处</span>
          </div>
        )}

        {/* Pending image preview strip */}
        {pendingImages.length > 0 && (
          <div className="flex gap-1.5 mb-2 flex-wrap">
            {pendingImages.map((img, i) => (
              <div key={i} className="relative group">
                <img
                  src={img}
                  alt={`待发送 ${i + 1}`}
                  className="w-14 h-14 object-cover rounded-lg border border-border"
                />
                <button
                  onClick={() => removePendingImage(i)}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-destructive text-destructive-foreground
                    flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
            <span className="self-end text-[10px] text-muted-foreground mb-1">
              {pendingImages.length}/{MAX_IMAGES}
            </span>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing || pendingImages.length >= MAX_IMAGES}
            className="self-end p-2.5 rounded-lg border border-input bg-background
              hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="上传图片（支持拖拽/粘贴）"
          >
            <Paperclip className="w-4 h-4 text-muted-foreground" />
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={pendingImages.length > 0 ? '描述图片用途...' : '告诉我你想做什么...'}
            rows={2}
            className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm
              placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {isProcessing ? (
            <button
              onClick={cancelProcessing}
              className="self-end p-2.5 rounded-lg bg-red-500/80 text-white
                hover:bg-red-500 transition-colors animate-pulse"
              title="停止执行"
            >
              <Square className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() && pendingImages.length === 0}
              className="self-end p-2.5 rounded-lg bg-primary text-primary-foreground
                hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
        <QuickActions isProcessing={isProcessing} processUserMessage={processUserMessage} setInput={setInput} />
      </div>
    </div>
  )
}

export default AgentChat
