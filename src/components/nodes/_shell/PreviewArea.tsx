/**
 * PreviewArea — LibTV-style big preview block.
 *
 * This is the visual centerpiece of any generation node. Occupies ~60% of
 * the node height, contains ONE of:
 *   - actual output (image/video) passed via children
 *   - guided empty state with suggested actions
 *   - loading skeleton (pulsing)
 *
 * Sizing: aspect is controlled via CSS `aspect-ratio`, not fixed height, so
 * the node adapts when the user switches 16:9 ↔ 9:16 ↔ 1:1.
 */

import { type ReactNode } from 'react'
import { type LucideIcon } from 'lucide-react'

export interface PreviewSuggestion {
  icon: LucideIcon
  label: string
  onClick?: () => void
}

export interface PreviewAreaProps {
  /** Aspect ratio of the preview box. Accepts CSS values like '16/9', '1/1'. */
  aspect?: string
  /** If set, renders the child content (video/image). Otherwise shows empty guide. */
  children?: ReactNode
  /** Center placeholder icon shown in the empty/loading state. */
  placeholderIcon?: LucideIcon
  /** Suggested quick-actions listed below the placeholder icon. */
  suggestions?: PreviewSuggestion[]
  /** If true, draw pulsing skeleton instead of the empty guide. */
  loading?: boolean
  /** Optional corner overlay (e.g. progress %, status chip). */
  cornerOverlay?: ReactNode
  /** Override className on the preview wrapper (rarely needed). */
  className?: string
}

export default function PreviewArea({
  aspect = '16/9',
  children,
  placeholderIcon: PlaceholderIcon,
  suggestions,
  loading,
  cornerOverlay,
  className = '',
}: PreviewAreaProps) {
  const hasChildren = !!children
  // 关键：loading 时如果 children 存在（如首帧图、角色图），仍渲染 children 并叠加
  // 半透明蒙层 + 大转圈，让用户清楚知道"正在用这张图生成"。
  // 旧实现把 children 隐藏只显示一个小圆点 → 用户体验被掏空，是已知 UX bug。
  return (
    <div
      className={`libtv-preview w-full nowheel nopan ${className}`}
      style={{ aspectRatio: aspect }}
    >
      {hasChildren ? (
        <>
          {children}
          {loading && (
            <div className="absolute inset-0 z-[5] bg-black/45 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
              <div className="flex flex-col items-center gap-1.5">
                <div className="w-9 h-9 rounded-full border-2 border-white/30 border-t-white/90 animate-spin" />
                <div className="text-[10px] text-white/85 font-mono tracking-wide">生成中…</div>
              </div>
            </div>
          )}
        </>
      ) : loading ? (
        /* No children — show a clean skeleton in the center */
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-full border-2 border-[hsl(var(--libtv-muted)/0.2)] border-t-[hsl(var(--libtv-accent))] animate-spin" />
            <div className="text-[10px] text-[hsl(var(--libtv-muted))] font-mono">生成中…</div>
          </div>
        </div>
      ) : (
        /* Empty guided state — LibTV signature "尝试：XXX" hint. */
        <div className="absolute inset-0 flex items-center justify-center p-3">
          <div className="flex flex-col items-center gap-2 max-w-full">
            {PlaceholderIcon && (
              <div className="w-10 h-10 rounded-xl bg-[hsl(var(--libtv-muted)/0.08)] flex items-center justify-center shrink-0">
                <PlaceholderIcon
                  className="w-5 h-5 text-[hsl(var(--libtv-muted)/0.55)]"
                  strokeWidth={1.5}
                />
              </div>
            )}
            {suggestions && suggestions.length > 0 && (
              <div className="flex flex-col items-start gap-0 min-w-0">
                <div className="text-[10px] text-[hsl(var(--libtv-muted)/0.7)] mb-0.5 self-start">
                  尝试：
                </div>
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={s.onClick}
                    className="flex items-center gap-1.5 text-[11px] text-[hsl(var(--libtv-chip-fg))] hover:text-[hsl(var(--libtv-accent))] transition-colors py-0.5 rounded whitespace-nowrap"
                  >
                    <s.icon size={13} strokeWidth={1.75} />
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {cornerOverlay && (
        <div className="absolute top-2 right-2 z-10">
          {cornerOverlay}
        </div>
      )}
    </div>
  )
}
