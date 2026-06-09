/**
 * StylePicker — LibTV-style visual style library.
 *
 * A grid of preset art-style cards (写实 / 国漫 / 皮克斯 / 赛博朋克 / ...).
 * Selecting a card appends its prompt-keyword to the caller's onPick callback.
 * Cards are represented by a colored gradient thumbnail + Chinese label +
 * English keyword (what actually gets injected into the prompt).
 *
 * The caller decides what to do on pick — typical use is to append the keyword
 * to a PromptInput value and close the popover.
 */

export interface StylePreset {
  /** Short id used for de-dup. */
  id: string
  /** Chinese display name. */
  label: string
  /** English/tag keyword that gets inserted into the prompt. */
  keyword: string
  /** CSS gradient string used as the thumbnail background. */
  gradient: string
  /** Optional extra description shown on hover. */
  hint?: string
}

export const DEFAULT_STYLE_PRESETS: StylePreset[] = [
  { id: 'realistic',  label: '写实',       keyword: 'photorealistic, hyper-detailed',            gradient: 'linear-gradient(135deg, #6b7280 0%, #1f2937 100%)',           hint: '真实摄影质感' },
  { id: 'cinematic',  label: '电影感',     keyword: 'cinematic, anamorphic, film grain',          gradient: 'linear-gradient(135deg, #78350f 0%, #1c1917 100%)',           hint: '胶片电影感' },
  { id: 'cyberpunk',  label: '赛博朋克',   keyword: 'cyberpunk, neon lights, rain, futuristic',   gradient: 'linear-gradient(135deg, #ec4899 0%, #6366f1 50%, #06b6d4 100%)', hint: '霓虹未来' },
  { id: 'pixar',      label: '皮克斯 3D',  keyword: 'pixar 3d style, soft lighting, chubby',      gradient: 'linear-gradient(135deg, #fbbf24 0%, #f97316 100%)',           hint: '3D 动画电影' },
  { id: 'anime',      label: '日系动漫',   keyword: 'anime style, cel shaded, studio ghibli',     gradient: 'linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%)',           hint: '日系赛璐珞' },
  { id: 'ghibli',     label: '吉卜力',     keyword: 'ghibli style, hayao miyazaki, soft watercolor', gradient: 'linear-gradient(135deg, #86efac 0%, #60a5fa 100%)',        hint: '宫崎骏水彩' },
  { id: 'ink',        label: '国漫水墨',   keyword: 'chinese ink painting, traditional, xieyi',   gradient: 'linear-gradient(135deg, #fef3c7 0%, #292524 100%)',           hint: '水墨写意' },
  { id: 'oil',        label: '油画',       keyword: 'oil painting, thick brushstrokes, renaissance', gradient: 'linear-gradient(135deg, #92400e 0%, #451a03 100%)',        hint: '古典油画' },
  { id: 'watercolor', label: '水彩',       keyword: 'watercolor, soft gradient, paper texture',   gradient: 'linear-gradient(135deg, #fde68a 0%, #bae6fd 100%)',           hint: '水彩晕染' },
  { id: 'bw',         label: '黑白',       keyword: 'black and white, high contrast, noir',       gradient: 'linear-gradient(135deg, #f3f4f6 0%, #111827 100%)',           hint: '黑白胶片' },
  { id: 'vintage',    label: '复古',       keyword: '1970s vintage, film photo, faded colors',    gradient: 'linear-gradient(135deg, #d97706 0%, #78350f 100%)',           hint: '70 年代复古' },
  { id: 'neon',       label: '霓虹',       keyword: 'neon glow, synthwave, retro 80s',            gradient: 'linear-gradient(135deg, #f472b6 0%, #a855f7 50%, #38bdf8 100%)', hint: '合成波浪' },
]

export interface StylePickerProps {
  /** Currently active style ids (for visual selected state). */
  activeIds?: string[]
  /** Called when a preset is picked. */
  onPick: (preset: StylePreset) => void
  /** Optional custom preset list. */
  presets?: StylePreset[]
  /** Title shown above the grid. */
  title?: string
  /** Columns count (defaults to 4). */
  cols?: number
}

export default function StylePicker({
  activeIds = [],
  onPick,
  presets = DEFAULT_STYLE_PRESETS,
  title = '风格',
  cols = 4,
}: StylePickerProps) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium text-[hsl(var(--libtv-chip-fg))] pl-0.5">
        {title}
      </div>
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {presets.map((p) => {
          const active = activeIds.includes(p.id)
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p)}
              title={p.hint}
              aria-pressed={active}
              className={`nodrag group relative rounded-lg overflow-hidden transition-all ${
                active
                  ? 'ring-2 ring-[hsl(var(--libtv-accent))] ring-offset-1 ring-offset-[hsl(var(--libtv-panel-bg))]'
                  : 'ring-1 ring-[hsl(var(--libtv-line))] hover:ring-[hsl(var(--libtv-accent)/0.5)]'
              }`}
            >
              {/* Thumbnail */}
              <div
                className="w-full aspect-[4/3]"
                style={{ background: p.gradient }}
                aria-hidden
              />
              {/* Label */}
              <div className="px-1.5 py-1 bg-[hsl(var(--libtv-chip-bg))] text-[hsl(var(--libtv-chip-fg))] text-[10px] font-medium truncate text-center">
                {p.label}
              </div>
              {active && (
                <span
                  className="absolute top-1 right-1 w-3 h-3 rounded-full bg-[hsl(var(--libtv-accent))] flex items-center justify-center text-white text-[9px] font-bold shadow-sm"
                  aria-hidden
                >
                  ✓
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
