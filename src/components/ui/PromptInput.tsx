/**
 * PromptInput — drop-in textarea replacement with `@asset` autocomplete +
 * chip row showing currently referenced assets.
 *
 * Designed to plug into nodes (VideoGen / ImageGen / CharacterGrid / etc.) with
 * the same API as a native <textarea>.
 *
 * Signals:
 *  - onChange(value): standard textarea change, matches existing API.
 *  - Optional `extraRefs` + `onExtraRefsChange`: UI-side "linked assets" that
 *    don't live in the prompt text (e.g. dragged-from-panel). When provided,
 *    the chip row merges them with `@` tokens parsed from the prompt.
 */

import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import type { TextareaHTMLAttributes } from 'react'
import AssetPicker from './AssetPicker'
import AssetChip from './AssetChip'
import { useAssetStore } from '@/store/assetStore'
import { useAssetAutocomplete } from '@/hooks/useAssetAutocomplete'

// Parse `@assetId` (optionally `:variation`) tokens from prompt text.
// Matches the resolver's regex so chip row stays in sync.
const TOKEN_RE = /@([a-z0-9_-]+)(?::([a-z0-9_-]+))?/gi

interface ChipRefItem {
  assetId: string
  variation?: string
  /** `inline` = mentioned in prompt text; `linked` = extraRefs (drag-in). */
  origin: 'inline' | 'linked'
}

function parseTokens(value: string): ChipRefItem[] {
  const items: ChipRefItem[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  const re = new RegExp(TOKEN_RE.source, TOKEN_RE.flags)
  while ((m = re.exec(value)) !== null) {
    const key = `${m[1]}::${m[2] || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push({ assetId: m[1], variation: m[2], origin: 'inline' })
  }
  return items
}

export interface PromptInputProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> {
  value: string
  onChange: (value: string) => void
  /** Additional linked assets (ids) that aren't in the prompt body. */
  extraRefs?: string[]
  onExtraRefsChange?: (refs: string[]) => void
  /** Hide the chip row entirely (for compact UIs). */
  hideChips?: boolean
  /** Optional className merged into the textarea. */
  className?: string
}

export interface PromptInputHandle {
  focus: () => void
  getElement: () => HTMLTextAreaElement | null
}

const PromptInput = forwardRef<PromptInputHandle, PromptInputProps>(function PromptInput(
  {
    value,
    onChange,
    extraRefs = [],
    onExtraRefsChange,
    placeholder,
    rows = 3,
    className,
    hideChips,
    onKeyDown,
    onBlur,
    ...textareaProps
  },
  ref,
) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const resolve = useAssetStore(s => s.resolve)

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
    getElement: () => taRef.current,
  }))

  const { state, close, insertToken, handlers } = useAssetAutocomplete(value, onChange, {})

  // Chips = inline tokens + extraRefs (de-duplicated)
  const chips = useMemo((): ChipRefItem[] => {
    const inline = parseTokens(value)
    const seen = new Set(inline.map(c => c.assetId))
    const extras: ChipRefItem[] = extraRefs
      .filter(id => !seen.has(id))
      .map(id => ({ assetId: id, origin: 'linked' as const }))
    return [...inline, ...extras]
  }, [value, extraRefs])

  const removeExtraRef = (id: string) => {
    if (!onExtraRefsChange) return
    onExtraRefsChange(extraRefs.filter(r => r !== id))
  }

  return (
    <div className="flex flex-col gap-1 w-full">
      {!hideChips && chips.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {chips.map((chip, idx) => {
            const resolved = resolve(chip.assetId)
            return (
              <AssetChip
                key={`${chip.origin}-${chip.assetId}-${chip.variation || ''}-${idx}`}
                asset={resolved?.asset}
                assetId={chip.assetId}
                variation={chip.variation}
                onRemove={chip.origin === 'linked' ? () => removeExtraRef(chip.assetId) : undefined}
              />
            )
          })}
        </div>
      )}
      <textarea
        ref={taRef}
        {...textareaProps}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          handlers.onInput(e)
        }}
        onKeyDown={(e) => {
          handlers.onKeyDown(e)
          onKeyDown?.(e)
        }}
        onBlur={(e) => {
          handlers.onBlur()
          onBlur?.(e)
        }}
        onCompositionStart={handlers.onCompositionStart}
        onCompositionEnd={handlers.onCompositionEnd}
        rows={rows}
        placeholder={placeholder}
        className={className}
      />
      <AssetPicker
        visible={state.visible}
        query={state.query}
        anchorX={state.anchorX}
        anchorY={state.anchorY}
        onSelect={(asset) => insertToken(asset.asset_id)}
        onClose={close}
      />
    </div>
  )
})

export default PromptInput
