/**
 * ParamPopover — the drawer that opens above a toolbar chip when clicked.
 *
 * Handles:
 *   - positioning (rises from the trigger, centered to viewport width)
 *   - open/close state via controlled `open` + onOpenChange
 *   - click-outside to close
 *   - Escape to close
 *
 * Trigger + content are provided by the caller.
 *
 * Example:
 *   <ParamPopover
 *     trigger={({ open, toggle }) => (
 *       <button onClick={toggle}>16:9 · 720P · 5s</button>
 *     )}
 *   >
 *     <AspectRatioPicker ... />
 *     <ResolutionPicker ... />
 *   </ParamPopover>
 */

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export interface ParamPopoverTriggerArgs {
  open: boolean
  toggle: () => void
  close: () => void
}

export interface ParamPopoverProps {
  trigger: (args: ParamPopoverTriggerArgs) => ReactNode
  children: ReactNode
  /** Max width of the popover (px). Defaults to 320. */
  width?: number
  /** Initial open state (uncontrolled mode). */
  defaultOpen?: boolean
  /** Where the popover sits relative to the trigger. Defaults to 'top'. */
  placement?: 'top' | 'bottom'
  /** Alignment of the popover relative to the trigger. */
  align?: 'start' | 'center' | 'end'
}

export default function ParamPopover({
  trigger,
  children,
  width = 320,
  defaultOpen = false,
  placement = 'top',
  align = 'center',
}: ParamPopoverProps) {
  const [open, setOpen] = useState(defaultOpen)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const toggle = () => setOpen((v) => !v)
  const close = () => setOpen(false)

  // Click-outside
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const positionClasses = (() => {
    const vertical = placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
    const horizontal =
      align === 'start' ? 'left-0'
      : align === 'end' ? 'right-0'
      : 'left-1/2 -translate-x-1/2'
    return `${vertical} ${horizontal}`
  })()

  return (
    <div ref={rootRef} className="relative inline-flex">
      {trigger({ open, toggle, close })}
      {open && (
        <div
          className={`libtv-popover nodrag nowheel nopan ${positionClasses}`}
          style={{ width, transformOrigin: placement === 'top' ? 'bottom center' : 'top center' }}
        >
          {children}
        </div>
      )}
    </div>
  )
}
