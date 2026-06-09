/**
 * DurationSlider — LibTV-style slider for video duration.
 *
 * Shows current value as "5s" label on the right. Snaps to discrete steps
 * if `steps` is provided (models often only allow 5 / 10 seconds).
 */

import { useId } from 'react'

export interface DurationSliderProps {
  title?: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  /** Discrete allowed values. If provided, `min`/`max` are ignored and the
   * slider snaps between these values. */
  steps?: number[]
  /** Suffix in the label (e.g. 's' for seconds). */
  unit?: string
}

export default function DurationSlider({
  title = '视频时长',
  value,
  onChange,
  min = 1,
  max = 30,
  steps,
  unit = 's',
}: DurationSliderProps) {
  const id = useId()

  // If steps provided, map slider index ↔ value
  const useSteps = Array.isArray(steps) && steps.length > 1
  const sliderMin = useSteps ? 0 : min
  const sliderMax = useSteps ? steps!.length - 1 : max
  const sliderValue = useSteps ? Math.max(0, steps!.indexOf(value)) : value

  const handleRaw = (raw: number) => {
    if (useSteps) onChange(steps![raw])
    else onChange(raw)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between pl-0.5">
        <label htmlFor={id} className="text-[11px] font-medium text-[hsl(var(--libtv-chip-fg))]">
          {title}
        </label>
        <span className="text-[11px] font-mono text-[hsl(var(--libtv-accent))]">
          {value}{unit}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={sliderMin}
        max={sliderMax}
        value={sliderValue}
        step={1}
        onChange={(e) => handleRaw(Number(e.target.value))}
        className="nodrag nopan w-full h-1 rounded-full appearance-none bg-[hsl(var(--libtv-chip-bg))] cursor-pointer
                   accent-[hsl(var(--libtv-accent))]
                   [&::-webkit-slider-thumb]:appearance-none
                   [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
                   [&::-webkit-slider-thumb]:rounded-full
                   [&::-webkit-slider-thumb]:bg-[hsl(var(--libtv-accent))]
                   [&::-webkit-slider-thumb]:shadow-md
                   [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5
                   [&::-moz-range-thumb]:rounded-full
                   [&::-moz-range-thumb]:bg-[hsl(var(--libtv-accent))]
                   [&::-moz-range-thumb]:border-0"
      />
      {useSteps && (
        <div className="flex justify-between text-[9px] text-[hsl(var(--libtv-muted))] px-0.5">
          {steps!.map((s) => (
            <span key={s}>{s}{unit}</span>
          ))}
        </div>
      )}
    </div>
  )
}
