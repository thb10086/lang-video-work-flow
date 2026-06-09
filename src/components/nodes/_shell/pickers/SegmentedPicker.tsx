/**
 * SegmentedPicker — LibTV-style segmented button group.
 *
 * Used for discrete small sets (分辨率 1K/2K/4K, 清晰度 480P/720P/1080P, 生成音频 开/关).
 * Controlled. Minimum visual weight — no shadows, just a pill background.
 */

export interface SegmentOption<V extends string = string> {
  value: V
  label: string
  disabled?: boolean
  disabledReason?: string
}

export interface SegmentedPickerProps<V extends string = string> {
  options: SegmentOption<V>[]
  value: V
  onChange: (value: V) => void
  title?: string
  className?: string
  /**
   * If set, arranges the buttons in a CSS grid with this many columns
   * (good for 5+ options that would overflow horizontally). When omitted,
   * buttons stretch equally on one row.
   */
  cols?: number
}

export default function SegmentedPicker<V extends string = string>({
  options,
  value,
  onChange,
  title,
  className = '',
  cols,
}: SegmentedPickerProps<V>) {
  const containerCls = cols
    ? 'grid gap-1'
    : 'flex items-center gap-1'
  const gridStyle = cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined
  const btnCls = cols ? 'min-w-0' : 'flex-1 min-w-0'

  return (
    <div className={`space-y-2 ${className}`}>
      {title && (
        <div className="text-[11px] font-medium text-[hsl(var(--libtv-chip-fg))] pl-0.5">{title}</div>
      )}
      <div className={containerCls} style={gridStyle}>
        {options.map((o) => {
          const active = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              disabled={o.disabled}
              title={o.disabled ? o.disabledReason : undefined}
              onClick={() => !o.disabled && onChange(o.value)}
              className={`${btnCls} nodrag px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                active
                  ? 'bg-[hsl(var(--libtv-accent)/0.18)] text-[hsl(var(--libtv-accent))] ring-1 ring-[hsl(var(--libtv-accent)/0.7)] ring-inset'
                  : 'bg-[hsl(var(--libtv-chip-bg))] text-[hsl(var(--libtv-chip-fg))] hover:bg-[hsl(var(--libtv-chip-bg-hover))]'
              } ${o.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              aria-pressed={active}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
