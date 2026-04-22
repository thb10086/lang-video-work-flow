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

import { type ReactNode, type MouseEvent } from 'react'
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
  ghostConnect,
  onGhostConnect,
  className = '',
}: NodeShellProps) {
  return (
    <div
      className={`libtv-node-wrapper relative ${className}`}
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

      {/* Card body */}
      <div
        className={`libtv-node ${executing ? 'libtv-node--executing' : ''}`}
      >
        {/* Ghost + connect buttons (hover reveal) */}
        {ghostConnect?.left && (
          <button
            type="button"
            className="libtv-ghost-plus libtv-ghost-plus--left"
            onClick={(e) => onGhostConnect?.('left', e)}
            aria-label="Connect upstream node"
          >
            <Plus size={14} strokeWidth={2} />
          </button>
        )}
        {ghostConnect?.right && (
          <button
            type="button"
            className="libtv-ghost-plus libtv-ghost-plus--right"
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
