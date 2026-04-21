/**
 * SlashMenu — Slash "/" 快捷菜单
 *
 * 在 textarea/input 中输入 "/" 触发命令面板，
 * 支持模糊搜索，选择后执行对应操作（创建节点、执行 Agent 命令等）。
 *
 * 用法: <SlashMenu trigger={showSlash} anchor={anchorPos} onSelect={...} onClose={...} />
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  ImageIcon, Video, Music, Film, Sparkles, Grid3X3, LayoutGrid,
  UserCircle, Clapperboard, Wand2, Play, FileText, Eye,
} from 'lucide-react'

export interface SlashCommand {
  id: string
  label: string
  description: string
  icon: React.ReactNode
  category: '生成' | '分镜' | '工具' | 'AI助手'
  action: string
}

export const SLASH_COMMANDS: SlashCommand[] = [
  // ── 生成 ──
  { id: 'gen-image', label: '生成图片', description: '创建图片生成节点',
    icon: <ImageIcon className="w-3.5 h-3.5" />, category: '生成', action: 'create:imageGen' },
  { id: 'gen-video', label: '生成视频', description: '创建视频生成节点',
    icon: <Video className="w-3.5 h-3.5" />, category: '生成', action: 'create:videoGen' },
  { id: 'gen-audio', label: '生成音频', description: '创建音频生成节点',
    icon: <Music className="w-3.5 h-3.5" />, category: '生成', action: 'create:audioNode' },
  { id: 'gen-batch', label: '批量生成', description: '批量生成图片/视频',
    icon: <Play className="w-3.5 h-3.5" />, category: '生成', action: 'batch' },
  // ── 分镜 ──
  { id: 'grid-9', label: '9宫格分镜', description: '生成9张不同构图/机位方案',
    icon: <Grid3X3 className="w-3.5 h-3.5" />, category: '分镜', action: 'multigrid:9' },
  { id: 'grid-25', label: '25宫格分镜', description: '生成25张连贯分镜画面',
    icon: <LayoutGrid className="w-3.5 h-3.5" />, category: '分镜', action: 'multigrid:25' },
  { id: 'story-deduction', label: '剧情推演', description: '从参考图推演前后剧情4格',
    icon: <Film className="w-3.5 h-3.5" />, category: '分镜', action: 'storyDeduction' },
  { id: 'char-3view', label: '角色三视图', description: '正面/侧面/背面三视图',
    icon: <UserCircle className="w-3.5 h-3.5" />, category: '分镜', action: 'char3view' },
  // ── 工具 ──
  { id: 'storyboard', label: '创建分镜', description: 'AI拆解剧本为分镜脚本',
    icon: <Clapperboard className="w-3.5 h-3.5" />, category: '工具', action: 'create:storyboard' },
  { id: 'text-node', label: '文本节点', description: '脚本/对话/旁白',
    icon: <FileText className="w-3.5 h-3.5" />, category: '工具', action: 'create:textNode' },
  { id: 'continuity', label: '一致性检查', description: '检查镜头间角色/光照一致性',
    icon: <Eye className="w-3.5 h-3.5" />, category: '工具', action: 'create:continuityCheck' },
  // ── AI助手 ──
  { id: 'optimize-prompt', label: '优化提示词', description: 'AI优化当前节点提示词',
    icon: <Sparkles className="w-3.5 h-3.5" />, category: 'AI助手', action: 'agent:optimizePrompt' },
  { id: 'review-quality', label: '审查质量', description: '6维质量评审',
    icon: <Eye className="w-3.5 h-3.5" />, category: 'AI助手', action: 'agent:reviewQuality' },
  { id: 'auto-workflow', label: '一键生成工作流', description: '根据描述自动创建完整工作流',
    icon: <Wand2 className="w-3.5 h-3.5" />, category: 'AI助手', action: 'agent:generateWorkflow' },
]

const CATEGORY_ORDER: SlashCommand['category'][] = ['生成', '分镜', '工具', 'AI助手']

interface SlashMenuProps {
  visible: boolean
  anchorX: number
  anchorY: number
  onSelect: (command: SlashCommand) => void
  onClose: () => void
}

function SlashMenu({ visible, anchorX, anchorY, onSelect, onClose }: SlashMenuProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return SLASH_COMMANDS
    return SLASH_COMMANDS.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q) ||
        cmd.id.includes(q)
    )
  }, [query])

  const grouped = useMemo(() => {
    const groups: Record<string, SlashCommand[]> = {}
    for (const cmd of filtered) {
      if (!groups[cmd.category]) groups[cmd.category] = []
      groups[cmd.category].push(cmd)
    }
    return CATEGORY_ORDER
      .filter((cat) => groups[cat]?.length)
      .map((cat) => ({ category: cat, items: groups[cat] }))
  }, [filtered])

  const flatItems = useMemo(() => grouped.flatMap((g) => g.items), [grouped])

  /** Pre-compute flat index for each command id (avoids mutable let in render) */
  const flatIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    let idx = 0
    for (const g of grouped) {
      for (const cmd of g.items) {
        map.set(cmd.id, idx++)
      }
    }
    return map
  }, [grouped])

  useEffect(() => {
    if (visible) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [visible])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, flatItems.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)) }
      if (e.key === 'Enter' && flatItems[selectedIndex]) {
        e.preventDefault()
        e.stopPropagation()
        onSelect(flatItems[selectedIndex])
      }
    },
    [flatItems, selectedIndex, onSelect, onClose]
  )

  // Close on click outside
  useEffect(() => {
    if (!visible) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [visible, onClose])

  if (!visible) return null

  // Position: below and right of anchor, clamp to viewport
  const x = Math.min(anchorX, window.innerWidth - 300)
  const y = Math.min(anchorY + 4, window.innerHeight - 400)

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] floating-panel w-[280px] max-h-[360px] flex flex-col animate-scale-in overflow-hidden"
      style={{ left: x, top: y }}
      onKeyDown={handleKeyDown}
    >
      {/* Search */}
      <div className="flex items-center gap-2 px-2.5 py-2 border-b border-border">
        <span className="text-primary text-sm font-bold">/</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索命令..."
          className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
      </div>

      {/* Command list */}
      <div className="flex-1 overflow-y-auto py-1">
        {flatItems.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">无匹配命令</div>
        ) : (
          grouped.map((group) => (
            <div key={group.category}>
              <div className="px-2.5 pt-2 pb-1 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                {group.category}
              </div>
              {group.items.map((cmd) => {
                const idx = flatIndexMap.get(cmd.id) ?? 0
                return (
                  <button
                    key={cmd.id}
                    onClick={() => onSelect(cmd)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors ${
                      idx === selectedIndex ? 'bg-primary/8 text-foreground' : 'text-foreground/80 hover:bg-muted'
                    }`}
                  >
                    <span className="text-muted-foreground flex-shrink-0">{cmd.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">{cmd.label}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{cmd.description}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default SlashMenu
