/**
 * NodeShell — LibTV-style node container.
 *
 * Provides the outer frame for every "content node": label row, body slot,
 * optional ghost + connect buttons on the sides, and an executing/selected
 * state overlay.
 *
 * Intentional choices:
 *  - No heavy card chrome: transparent border, only a hairline outline that
 *    intensifies on hover/select (handled in index.css .libtv-node).
 *  - Label is a single inline row ABOVE the node body, not a standalone header.
 *  - Ghost + buttons are optional and render outside the node bounds (left/right)
 *    so the user can click-to-connect without learning Handle drag.
 */

import { type ReactNode, type MouseEvent, useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'

export interface NodeShellProps {
  /** Small icon before the label (e.g. <Play size={12} />). */
  icon?: ReactNode
  /** Node label shown as small muted text above the body. */
  label: string
  /** Extra inline content right of the label (badges, counters). */
  labelRight?: ReactNode
  /** Node body (preview / input / toolbar composed by the caller). */
  children: ReactNode
  /** Fixed pixel width for the node. Defaults to 460px. */
  width?: number
  /** If true, show a subtle executing glow ring. */
  executing?: boolean
  /** Node execution status — drives transient success/error animations. */
  status?: 'idle' | 'pending' | 'running' | 'success' | 'error' | string
  /** Optional side buttons for ghost-style click-to-connect. */
  ghostConnect?: {
    left?: boolean
    right?: boolean
  }
  /** Called when the user clicks a ghost + button (side = 'left' | 'right'). */
  onGhostConnect?: (side: 'left' | 'right', ev: MouseEvent<HTMLButtonElement>) => void
  /** Extra className forwarded to the node root. */
  className?: string
}

export default function NodeShell({
  icon,
  label,
  labelRight,
  children,
  width = 460,
  executing,
  status,
  ghostConnect,
  onGhostConnect,
  className = '',
}: NodeShellProps) {
  // ── Mount animation (run once on first render) ──
  const mountedRef = useRef(false)
  useEffect(() => { mountedRef.current = true }, [])

  // ── Transient status animation (success flash / error shake) ──
  // We watch the status prop; on transitions we set a one-shot class that
  // expires after the animation finishes. Avoids layout reflow by only
  // animating transform.
  const [transientAnim, setTransientAnim] = useState<string>('')
  const lastStatusRef = useRef<string | undefined>(status)
  useEffect(() => {
    const prev = lastStatusRef.current
    lastStatusRef.current = status
    if (prev === status) return
    if (status === 'success' && prev && prev !== 'success') {
      setTransientAnim('anim-success-flash')
      const t = window.setTimeout(() => setTransientAnim(''), 450)
      return () => window.clearTimeout(t)
    }
    if (status === 'error' && prev && prev !== 'error') {
      setTransientAnim('anim-error-shake')
      const t = window.setTimeout(() => setTransientAnim(''), 450)
      return () => window.clearTimeout(t)
    }
  }, [status])

  const mountClass = mountedRef.current ? '' : 'anim-node-mount'

  return (
    <div
      className={`libtv-node-wrapper relative ${mountClass} ${transientAnim} ${className}`}
      style={{ width }}
    >
      {/* Label row — sits OUTSIDE the node card, LibTV-style */}
      <div className="flex items-center gap-1.5 mb-1.5 px-1 text-[11px] font-medium">
        {icon && (
          <span className="inline-flex items-center text-[var(--libtv-muted)]" aria-hidden>
            {icon}
          </span>
        )}
        <span className="text-[hsl(var(--libtv-muted))] tracking-wide">{label}</span>
        {labelRight && <span className="ml-auto">{labelRight}</span>}
      </div>

      {/* Card body — React Flow interaction classes:
         `nowheel` → scroll wheel won't zoom canvas (lets lists/textareas scroll)
         `nopan`   → pointer moves won't pan canvas (lets text selection & sliders work)
         NO `nodrag` on the card itself — blank areas of the card should
         trigger a node drag (LibTV behavior). `nodrag` is applied *only* to
         concrete interactive children (buttons, inputs, sliders, popovers). */}
      <div
        className={`libtv-node nowheel nopan ${executing ? 'libtv-node--executing' : ''}`}
      >
        {/* Ghost + connect buttons (hover reveal) */}
        {ghostConnect?.left && (
          <button
            type="button"
            className="libtv-ghost-plus libtv-ghost-plus--left nodrag"
            onClick={(e) => onGhostConnect?.('left', e)}
            aria-label="Connect upstream node"
          >
            <Plus size={14} strokeWidth={2} />
          </button>
        )}
        {ghostConnect?.right && (
          <button
            type="button"
            className="libtv-ghost-plus libtv-ghost-plus--right nodrag"
            onClick={(e) => onGhostConnect?.('right', e)}
            aria-label="Connect downstream node"
          >
            <Plus size={14} strokeWidth={2} />
          </button>
        )}
        {children}
      </div>
    </div>
  )
}
