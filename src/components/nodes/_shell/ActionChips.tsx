/**
 * ActionChips — row of small rounded icon+label chips (标记 / 运镜 / 角色库 / 风格).
 *
 * Shown under the mode tabs in LibTV video/image nodes. Each chip is a
 * quick-action that can pop a menu or open an external picker. Chips come
 * in two flavours: regular (soft filled) and ghost (transparent until hover).
 */

import { type LucideIcon } from 'lucide-react'

export interface ActionChipItem {
  key: string
  icon: LucideIcon
  label: string
  onClick?: () => void
  /** If true, draw with soft-filled bg; else ghost. */
  variant?: 'solid' | 'ghost'
  /** Shown as a small dot/badge in the top-right of the chip (e.g. active count). */
  badge?: string | number
  disabled?: boolean
  active?: boolean
}

export interface ActionChipsProps {
  actions: ActionChipItem[]
  className?: string
}

export default function ActionChips({ actions, className = '' }: ActionChipsProps) {
  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${className}`}>
      {actions.map((a) => (
        <button
          key={a.key}
          type="button"
          disabled={a.disabled}
          onClick={a.onClick}
          className={`libtv-chip nodrag ${
            a.active ? 'libtv-chip--active' : a.variant === 'ghost' ? 'libtv-chip--ghost' : ''
          } ${a.disabled ? 'opacity-40 cursor-not-allowed' : ''} relative`}
        >
          <a.icon size={12} strokeWidth={1.75} />
          <span>{a.label}</span>
          {a.badge !== undefined && a.badge !== null && (
            <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-[hsl(var(--libtv-accent))] text-white text-[9px] font-bold flex items-center justify-center">
              {a.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
