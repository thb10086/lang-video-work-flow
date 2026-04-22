/**
 * useAssetAutocomplete — detect `@query` typing in a textarea/input and
 * drive an asset-picker popover.
 *
 * Design:
 *  - Pure hook, no Zustand subscription. Caller decides the data source.
 *  - Tracks an "active token" span (start..caret) when the character just before
 *    the caret run is `@`.
 *  - Respects IME composition (Chinese input) — detection is suspended while
 *    composing, re-evaluated on composition end.
 *  - Returns handlers to spread on the <textarea>, plus an `insertToken`
 *    action the picker calls when the user chooses an asset.
 */

import { useCallback, useRef, useState } from 'react'

export interface AutocompleteState {
  visible: boolean
  query: string
  /** Caret column (px) at the moment of the latest match. */
  anchorX: number
  /** Caret baseline (px). */
  anchorY: number
  /** Char index in `value` where the `@` lives. */
  tokenStart: number
  /** Char index in `value` immediately after the last query char (== caret). */
  tokenEnd: number
}

const INITIAL: AutocompleteState = {
  visible: false,
  query: '',
  anchorX: 0,
  anchorY: 0,
  tokenStart: -1,
  tokenEnd: -1,
}

/** Find `@` on the current token-run before `caret`. Returns -1 if no match. */
function findTokenStart(value: string, caret: number): number {
  // Walk backwards from caret until whitespace, newline, other `@`, or string start
  for (let i = caret - 1; i >= 0; i--) {
    const ch = value[i]
    if (ch === '@') return i
    if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') return -1
  }
  return -1
}

/** Derive caret screen coords. Approximate: use textarea bottom-left. */
function getCaretAnchor(el: HTMLTextAreaElement | HTMLInputElement): { x: number; y: number } {
  const rect = el.getBoundingClientRect()
  return { x: rect.left + 16, y: rect.bottom + 4 }
}

export interface UseAssetAutocompleteOptions {
  /** Called when the hook wants to commit a token substitution. */
  onInsert?: (newValue: string, newCaret: number) => void
  /** Called when the popover should become invisible (escape / blur / bad token). */
  onDismiss?: () => void
}

export function useAssetAutocomplete(
  value: string,
  onChange: (v: string) => void,
  opts: UseAssetAutocompleteOptions = {},
) {
  const [state, setState] = useState<AutocompleteState>(INITIAL)
  const composingRef = useRef(false)
  const targetRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)

  const close = useCallback(() => {
    setState(s => (s.visible ? { ...s, visible: false } : s))
    opts.onDismiss?.()
  }, [opts])

  /**
   * Evaluate the text around the caret: if it looks like an `@query`, open /
   * update the popover. Otherwise close it.
   */
  const evaluate = useCallback((el: HTMLTextAreaElement | HTMLInputElement) => {
    if (composingRef.current) return
    const caret = el.selectionStart ?? 0
    const at = findTokenStart(el.value, caret)
    if (at < 0) {
      close()
      return
    }
    const query = el.value.slice(at + 1, caret)
    // Allow empty query (just typed `@`) — show all; but block weird chars like newline
    if (/[\n\r]/.test(query)) {
      close()
      return
    }
    const { x, y } = getCaretAnchor(el)
    targetRef.current = el
    setState({
      visible: true,
      query,
      anchorX: x,
      anchorY: y,
      tokenStart: at,
      tokenEnd: caret,
    })
  }, [close])

  const onInput = useCallback((e: React.FormEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    const el = e.currentTarget
    evaluate(el)
  }, [evaluate])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (composingRef.current) return
    if (state.visible) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        close()
      }
      // Arrow + Enter are handled by the picker, which calls insertToken on pick.
    }
  }, [state.visible, close])

  const onBlur = useCallback(() => {
    // Delay so that clicks on the picker still fire
    setTimeout(() => close(), 120)
  }, [close])

  const onCompositionStart = useCallback(() => {
    composingRef.current = true
  }, [])

  const onCompositionEnd = useCallback((e: React.CompositionEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    composingRef.current = false
    evaluate(e.currentTarget)
  }, [evaluate])

  /**
   * Called by the picker when the user selects an asset.
   *
   * Replaces `@query` in the current value with `@<assetId> `, repositions caret
   * to just after the trailing space, closes popover, and notifies parent.
   */
  const insertToken = useCallback((assetId: string) => {
    if (state.tokenStart < 0) return
    const before = value.slice(0, state.tokenStart)
    const after = value.slice(state.tokenEnd)
    const insertion = `@${assetId} `
    const newValue = before + insertion + after
    const newCaret = (before + insertion).length
    onChange(newValue)
    opts.onInsert?.(newValue, newCaret)
    // Restore caret asynchronously — React may re-render before we can set it
    const el = targetRef.current
    if (el) {
      requestAnimationFrame(() => {
        try {
          el.focus()
          el.setSelectionRange(newCaret, newCaret)
        } catch { /* element detached */ }
      })
    }
    close()
  }, [state.tokenStart, state.tokenEnd, value, onChange, opts, close])

  return {
    state,
    close,
    insertToken,
    handlers: {
      onInput,
      onKeyDown,
      onBlur,
      onCompositionStart,
      onCompositionEnd,
    },
  }
}
