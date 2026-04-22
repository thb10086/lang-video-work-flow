/**
 * NodeToolbar — bottom strip of a LibTV node.
 *
 * Layout: `left` row on the left (model chip, param summary chip, etc.),
 * `right` row on the right (language, count, credits, submit button).
 * Both sides flex and wrap gracefully on narrow nodes.
 */

import { type ReactNode } from 'react'

export interface NodeToolbarProps {
  left?: ReactNode
  right?: ReactNode
  className?: string
}

export default function NodeToolbar({ left, right, className = '' }: NodeToolbarProps) {
  return (
    <div className={`flex items-center justify-between gap-2 ${className}`}>
      <div className="flex items-center gap-1.5 flex-wrap">{left}</div>
      <div className="flex items-center gap-1.5 shrink-0">{right}</div>
    </div>
  )
}
