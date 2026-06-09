/**
 * SubmitButton — LibTV-style circular upload/submit arrow.
 *
 * Shown at the far right of a node's toolbar. Disabled state dims the icon.
 * If `loading` is true, shows a spinner instead of the arrow.
 */

import { ArrowUp, Loader2, Square } from 'lucide-react'

export interface SubmitButtonProps {
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  /** When loading, show a stop button instead of a spinner if this callback is provided. */
  onStop?: () => void
  title?: string
}

export default function SubmitButton({
  onClick,
  disabled,
  loading,
  onStop,
  title,
}: SubmitButtonProps) {
  if (loading) {
    if (onStop) {
      return (
        <button
          type="button"
          onClick={onStop}
          className="libtv-submit nodrag"
          title={title || '停止'}
          aria-label="Stop"
        >
          <Square size={12} strokeWidth={2.5} fill="currentColor" />
        </button>
      )
    }
    return (
      <div className="libtv-submit nodrag" aria-label="Loading">
        <Loader2 size={14} className="animate-spin" strokeWidth={2.5} />
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="libtv-submit nodrag"
      title={title || '生成'}
      aria-label="Submit"
    >
      <ArrowUp size={14} strokeWidth={2.5} />
    </button>
  )
}
