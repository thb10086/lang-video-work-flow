/**
 * CameraPicker — LibTV "运镜 / 视角" selector.
 *
 * Two tabs:
 *   1. 运镜 (camera MOVEMENT) — push / pull / pan / orbit / follow / crane ...
 *   2. 视角 (camera ANGLE)    — front / side / top / low / 45° ...
 *
 * Each option renders with a tiny pictogram (SVG) so users recognise the motion
 * at a glance, matching LibTV's visual style. Picking an option toggles its
 * keyword in the selection list and calls `onChange` with the full new list.
 */

import { useState } from 'react'

// ── Presets ──

export interface CameraPreset {
  id: string
  label: string
  keyword: string
  /** Simple SVG pictogram (24x24 viewBox). */
  svg: string
}

export const CAMERA_MOVEMENTS: CameraPreset[] = [
  { id: 'static',   label: '静止',   keyword: 'static shot, no camera movement',
    svg: '<rect x="6" y="6" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="2" fill="currentColor"/>' },
  { id: 'push-in',  label: '推镜',   keyword: 'camera push in, dolly in, zooming closer',
    svg: '<path d="M4 12 L20 12 M14 6 L20 12 L14 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'pull-out', label: '拉镜',   keyword: 'camera pull back, dolly out, zooming wider',
    svg: '<path d="M20 12 L4 12 M10 6 L4 12 L10 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'pan-left', label: '左摇',   keyword: 'camera pan left',
    svg: '<path d="M12 4 L12 20 M6 10 L12 4 L18 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" transform="rotate(-90 12 12)"/>' },
  { id: 'pan-right',label: '右摇',   keyword: 'camera pan right',
    svg: '<path d="M12 4 L12 20 M6 10 L12 4 L18 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" transform="rotate(90 12 12)"/>' },
  { id: 'tilt-up',  label: '仰摇',   keyword: 'camera tilt up',
    svg: '<path d="M12 20 L12 4 M6 10 L12 4 L18 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'tilt-down',label: '俯摇',   keyword: 'camera tilt down',
    svg: '<path d="M12 4 L12 20 M6 14 L12 20 L18 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'crane-up', label: '升镜',   keyword: 'crane shot upward, rising camera',
    svg: '<path d="M4 20 L12 6 L20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 4 L12 6 L14 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'crane-dn', label: '降镜',   keyword: 'crane shot downward, descending camera',
    svg: '<path d="M4 4 L12 18 L20 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 20 L12 18 L14 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'orbit',    label: '环绕',   keyword: '360 orbit shot around subject',
    svg: '<ellipse cx="12" cy="12" rx="8" ry="4" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><path d="M16 10 L20 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' },
  { id: 'follow',   label: '跟随',   keyword: 'tracking shot, follow subject',
    svg: '<circle cx="7" cy="12" r="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M11 12 L18 12 M14 8 L18 12 L14 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'handheld', label: '手持',   keyword: 'handheld camera, shaky, documentary',
    svg: '<path d="M5 10 Q7 8 9 10 T13 10 T17 10 T21 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M5 14 Q7 16 9 14 T13 14 T17 14 T21 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' },
]

export const CAMERA_ANGLES: CameraPreset[] = [
  { id: 'eye-level', label: '平视',   keyword: 'eye-level shot',
    svg: '<circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M4 12 L20 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2"/>' },
  { id: 'low',       label: '仰视',   keyword: 'low angle shot, looking up',
    svg: '<path d="M4 18 L20 18 M12 18 L6 6 M12 18 L18 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'high',      label: '俯视',   keyword: 'high angle shot, looking down',
    svg: '<path d="M4 6 L20 6 M12 6 L6 18 M12 6 L18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'topdown',   label: '俯拍',   keyword: 'top-down bird\'s eye view',
    svg: '<rect x="6" y="6" width="12" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="2" fill="currentColor"/>' },
  { id: 'dutch',     label: '倾斜',   keyword: 'dutch angle, tilted camera',
    svg: '<rect x="6" y="6" width="12" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.5" transform="rotate(15 12 12)"/>' },
  { id: 'over',      label: '过肩',   keyword: 'over the shoulder shot',
    svg: '<circle cx="8" cy="10" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 16 Q8 14 10 14 L14 14 M14 10 L18 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' },
  { id: 'pov',       label: 'POV',    keyword: 'point-of-view shot, first person',
    svg: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="3" fill="currentColor"/>' },
  { id: '3qtr',      label: '3/4 侧面', keyword: 'three-quarter view',
    svg: '<circle cx="10" cy="10" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 18 Q10 14 13 14 L15 14 Q17 14 17 16 L17 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' },
]

// ── Component ──

export type CameraCategory = 'movement' | 'angle'

export interface CameraPickerProps {
  /** Currently active keywords (selected presets). */
  activeIds?: string[]
  onPick: (preset: CameraPreset, category: CameraCategory) => void
  title?: string
  /** Default tab to show. */
  defaultCategory?: CameraCategory
}

export default function CameraPicker({
  activeIds = [],
  onPick,
  title = '摄像机',
  defaultCategory = 'movement',
}: CameraPickerProps) {
  const [tab, setTab] = useState<CameraCategory>(defaultCategory)
  const presets = tab === 'movement' ? CAMERA_MOVEMENTS : CAMERA_ANGLES

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium text-[hsl(var(--libtv-chip-fg))] pl-0.5">
          {title}
        </div>
        <div className="flex gap-0.5 rounded-md bg-[hsl(var(--libtv-chip-bg))] p-0.5">
          <button
            type="button"
            onClick={() => setTab('movement')}
            className={`nodrag px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${
              tab === 'movement'
                ? 'bg-[hsl(var(--libtv-accent)/0.18)] text-[hsl(var(--libtv-accent))]'
                : 'text-[hsl(var(--libtv-muted))]'
            }`}
          >
            运镜
          </button>
          <button
            type="button"
            onClick={() => setTab('angle')}
            className={`nodrag px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${
              tab === 'angle'
                ? 'bg-[hsl(var(--libtv-accent)/0.18)] text-[hsl(var(--libtv-accent))]'
                : 'text-[hsl(var(--libtv-muted))]'
            }`}
          >
            视角
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {presets.map((p) => {
          const active = activeIds.includes(p.id)
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p, tab)}
              title={p.keyword}
              aria-pressed={active}
              className={`nodrag flex flex-col items-center justify-center gap-1 px-1.5 py-2 rounded-lg transition-colors ${
                active
                  ? 'bg-[hsl(var(--libtv-accent)/0.15)] text-[hsl(var(--libtv-accent))] ring-1 ring-[hsl(var(--libtv-accent)/0.6)] ring-inset'
                  : 'bg-[hsl(var(--libtv-chip-bg))] text-[hsl(var(--libtv-chip-fg))] hover:bg-[hsl(var(--libtv-chip-bg-hover))]'
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                className="shrink-0"
                dangerouslySetInnerHTML={{ __html: p.svg }}
              />
              <span className="text-[10px] font-medium truncate max-w-full">{p.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
