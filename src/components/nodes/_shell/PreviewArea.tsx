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
  const hasContent = !loading && !!children

  return (
    <div
      className={`libtv-preview w-full ${className}`}
      style={{ aspectRatio: aspect }}
    >
      {hasContent ? (
        children
      ) : loading ? (
        <div className="w-full h-full flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-[hsl(var(--libtv-muted)/0.15)] animate-pulse" />
        </div>
      ) : (
        /* Empty guided state — LibTV signature "尝试：XXX" hint */
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4 gap-4">
          {PlaceholderIcon && (
            <div className="w-14 h-14 rounded-xl bg-[hsl(var(--libtv-muted)/0.08)] flex items-center justify-center">
              <PlaceholderIcon
                className="w-7 h-7 text-[hsl(var(--libtv-muted)/0.55)]"
                strokeWidth={1.5}
              />
            </div>
          )}
          {suggestions && suggestions.length > 0 && (
            <div className="flex flex-col items-start gap-1">
              <div className="text-[10px] text-[hsl(var(--libtv-muted)/0.8)] mb-0.5 pl-5 self-start">
                尝试：
              </div>
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={s.onClick}
                  className="flex items-center gap-2 text-[11px] text-[hsl(var(--libtv-chip-fg))] hover:text-[hsl(var(--libtv-accent))] transition-colors pl-1 pr-2 py-1 rounded"
                >
                  <s.icon size={13} strokeWidth={1.75} />
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          )}
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
