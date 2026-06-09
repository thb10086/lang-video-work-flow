/**
 * ShotPicker — LibTV "景别" (shot size / framing) selector.
 *
 * A row of labeled cards with a small figure pictogram that shrinks the
 * character as the shot gets wider, matching LibTV's visual metaphor.
 *
 * Unlike CameraPicker, this is single-select — a scene has exactly one
 * dominant shot size at a time.
 */

export interface ShotPreset {
  id: string
  label: string
  keyword: string
  /** Relative figure height 0..1 (smaller = wider shot). */
  figureHeight: number
  /** Short English tag for hover tooltip. */
  tag: string
}

export const DEFAULT_SHOTS: ShotPreset[] = [
  { id: 'extreme-wide', label: '远景',   keyword: 'extreme wide shot, establishing shot, landscape',
    tag: 'EWS', figureHeight: 0.18 },
  { id: 'wide',         label: '全景',   keyword: 'wide shot, full body in frame',
    tag: 'WS',  figureHeight: 0.70 },
  { id: 'medium-wide',  label: '中全景', keyword: 'medium wide shot, knees up',
    tag: 'MWS', figureHeight: 0.85 },
  { id: 'medium',       label: '中景',   keyword: 'medium shot, waist up',
    tag: 'MS',  figureHeight: 1.00 },
  { id: 'medium-close', label: '中近景', keyword: 'medium close-up, chest up',
    tag: 'MCU', figureHeight: 1.20 },
  { id: 'close',        label: '近景',   keyword: 'close-up shot, shoulders up',
    tag: 'CU',  figureHeight: 1.45 },
  { id: 'extreme-close',label: '特写',   keyword: 'extreme close-up, face only',
    tag: 'ECU', figureHeight: 1.80 },
]

export interface ShotPickerProps {
  value: string
  onChange: (preset: ShotPreset) => void
  title?: string
  presets?: ShotPreset[]
}

export default function ShotPicker({
  value,
  onChange,
  title = '景别',
  presets = DEFAULT_SHOTS,
}: ShotPickerProps) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium text-[hsl(var(--libtv-chip-fg))] pl-0.5">
        {title}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {presets.map((s) => {
          const active = value === s.id
          // Figure: simple head+body silhouette scaled by figureHeight
          const size = 44
          const figPx = Math.min(size * 0.95, size * 0.4 * s.figureHeight + 8)
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onChange(s)}
              title={s.keyword}
              aria-pressed={active}
              className={`nodrag flex flex-col items-center gap-1 p-1.5 rounded-lg transition-all ${
                active
                  ? 'bg-[hsl(var(--libtv-accent)/0.15)] ring-1 ring-[hsl(var(--libtv-accent)/0.7)] ring-inset'
                  : 'bg-[hsl(var(--libtv-chip-bg))] hover:bg-[hsl(var(--libtv-chip-bg-hover))]'
              }`}
            >
              {/* Frame with scaled figure */}
              <div
                className="relative rounded border border-[hsl(var(--libtv-line))] bg-[hsl(var(--libtv-panel-bg)/0.3)] overflow-hidden flex items-end justify-center"
                style={{ width: size, height: size * 0.72 }}
                aria-hidden
              >
                {/* Head */}
                <div
                  className={`absolute rounded-full ${active ? 'bg-[hsl(var(--libtv-accent))]' : 'bg-[hsl(var(--libtv-chip-fg))]'}`}
                  style={{
                    width: figPx * 0.32,
                    height: figPx * 0.32,
                    bottom: figPx * 0.7,
                  }}
                />
                {/* Body */}
                <div
                  className={`absolute ${active ? 'bg-[hsl(var(--libtv-accent))]' : 'bg-[hsl(var(--libtv-chip-fg))]'} rounded-t-md`}
                  style={{
                    width: figPx * 0.5,
                    height: figPx * 0.7,
                    bottom: 0,
                  }}
                />
              </div>
              <div className={`text-[10px] font-medium leading-tight text-center ${active ? 'text-[hsl(var(--libtv-accent))]' : 'text-[hsl(var(--libtv-chip-fg))]'}`}>
                {s.label}
              </div>
              <div className="text-[8px] text-[hsl(var(--libtv-muted))] leading-none">
                {s.tag}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
