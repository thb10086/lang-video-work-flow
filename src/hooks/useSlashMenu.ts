/**
 * useSlashMenu — 在 textarea/input 中检测 "/" 输入并触发 SlashMenu
 *
 * 返回:
 * - slashState: { visible, anchorX, anchorY }
 * - handleKeyDown: 绑定到 textarea 的 onKeyDown
 * - closeSlash: 关闭菜单
 */

import { useState, useCallback, useRef } from 'react'

interface SlashState {
  visible: boolean
  anchorX: number
  anchorY: number
}

export function useSlashMenu() {
  const [slashState, setSlashState] = useState<SlashState>({
    visible: false, anchorX: 0, anchorY: 0,
  })
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const textarea = e.currentTarget
      textareaRef.current = textarea

      // Get caret position for menu anchoring
      const rect = textarea.getBoundingClientRect()
      // Approximate caret position (use textarea bottom-left as anchor)
      const anchorX = rect.left + 8
      const anchorY = rect.bottom

      // Only trigger if "/" is at the start of a line or the field is empty
      const value = textarea.value
      const selStart = textarea.selectionStart || 0
      const beforeCaret = value.substring(0, selStart)
      const lastNewline = beforeCaret.lastIndexOf('\n')
      const lineStart = beforeCaret.substring(lastNewline + 1).trim()

      if (lineStart === '' || lineStart === '/') {
        // Delay to let "/" char be inserted, then show menu
        setTimeout(() => {
          setSlashState({ visible: true, anchorX, anchorY })
        }, 50)
      }
    }

    if (e.key === 'Escape' && slashState.visible) {
      e.stopPropagation()
      setSlashState((s) => ({ ...s, visible: false }))
    }
  }, [slashState.visible])

  const closeSlash = useCallback(() => {
    setSlashState((s) => ({ ...s, visible: false }))
    // Remove the "/" character that triggered the menu
    if (textareaRef.current) {
      const textarea = textareaRef.current
      const value = textarea.value
      const selStart = textarea.selectionStart || 0
      // Find and remove the last "/" before caret
      const before = value.substring(0, selStart)
      const lastSlash = before.lastIndexOf('/')
      if (lastSlash >= 0) {
        const after = value.substring(selStart)
        const lineStart = before.substring(before.lastIndexOf('\n') + 1, lastSlash).trim()
        if (lineStart === '') {
          textarea.value = before.substring(0, lastSlash) + after
          textarea.selectionStart = textarea.selectionEnd = lastSlash
          // Trigger React onChange
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
          )?.set
          nativeInputValueSetter?.call(textarea, before.substring(0, lastSlash) + after)
          textarea.dispatchEvent(new Event('input', { bubbles: true }))
        }
      }
    }
  }, [])

  return {
    slashState,
    handleSlashKeyDown: handleKeyDown,
    closeSlash,
  }
}
