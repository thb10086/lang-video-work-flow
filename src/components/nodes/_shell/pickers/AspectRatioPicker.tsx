/**
 * AspectRatioPicker — visual icon-grid ratio selector (LibTV "比例" section).
 *
 * Each cell shows a small rectangle whose dimensions represent the ratio so
 * the user can grasp the shape at a glance. Selection is controlled.
 *
 * The list of ratios is configurable because video and image models support
 * different subsets (e.g. video rarely supports 3:2, image rarely supports
 * 21:9).
 */

export interface AspectRatio {
  value: string            // canonical form used in the model API: '16:9', '9:16', '1:1', 'auto', ...
  label: string            // display text
  /** visual box dimensions (in px) used to render the preview shape */
  shape: { w: number; h: number }
}

export const DEFAULT_VIDEO_RATIOS: AspectRatio[] = [
  { value: 'auto',  label: 'Auto',  shape: { w: 18, h: 14 } },
  { value: '16:9',  label: '16:9',  shape: { w: 22, h: 12 } },
  { value: '4:3',   label: '4:3',   shape: { w: 20, h: 15 } },
  { value: '1:1',   label: '1:1',   shape: { w: 16, h: 16 } },
  { value: '3:4',   label: '3:4',   shape: { w: 15, h: 20 } },
  { value: '9:16',  label: '9:16',  shape: { w: 12, h: 22 } },
  { value: '21:9',  label: '21:9',  shape: { w: 26, h: 11 } },
]

export const DEFAULT_IMAGE_RATIOS: AspectRatio[] = [
  { value: 'auto',  label: '自适应', shape: { w: 18, h: 14 } },
  { value: '1:1',   label: '1:1',   shape: { w: 16, h: 16 } },
  { value: '9:16',  label: '9:16',  shape: { w: 12, h: 22 } },
  { value: '16:9',  label: '16:9',  shape: { w: 22, h: 12 } },
  { value: '3:4',   label: '3:4',   shape: { w: 15, h: 20 } },
  { value: '4:3',   label: '4:3',   shape: { w: 20, h: 15 } },
  { value: '3:2',   label: '3:2',   shape: { w: 20, h: 14 } },
  { value: '2:3',   label: '2:3',   shape: { w: 14, h: 20 } },
  { value: '4:5',   label: '4:5',   shape: { w: 16, h: 20 } },
  { value: '5:4',   label: '5:4',   shape: { w: 20, h: 16 } },
  { value: '21:9',  label: '21:9',  shape: { w: 26, h: 11 } },
]

export interface AspectRatioPickerProps {
  ratios: AspectRatio[]
  value: string
  onChange: (value: string) => void
  title?: string
  /** Number of columns in the grid. Defaults to 5. */
  cols?: number
}

export default function AspectRatioPicker({
  ratios,
  value,
  onChange,
  title = '比例',
  cols = 5,
}: AspectRatioPickerProps) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium text-[hsl(var(--libtv-chip-fg))] pl-0.5">{title}</div>
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {ratios.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => onChange(r.value)}
            className={`libtv-ratio-cell ${value === r.value ? 'libtv-ratio-cell--active' : ''}`}
            aria-pressed={value === r.value}
          >
            <span
              className="libtv-ratio-shape"
              style={{ width: r.shape.w, height: r.shape.h }}
              aria-hidden
            />
            <span className="libtv-ratio-cell__label">{r.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
