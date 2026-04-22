/**
 * ModeTabs — LibTV-style mode switcher (文生视频 / 图生视频 / 首尾帧 / 图片参考).
 *
 * Sits at the top of the input area. Unused tabs are dimmed. Active tab has
 * a soft filled background. Tabs can be disabled if prerequisites aren't met
 * (e.g. "图生视频" needs at least one reference image).
 */

import { type ReactNode } from 'react'

export interface ModeTabItem<V extends string = string> {
  value: V
  label: string
  /** Optional right-aligned hint (e.g. NEW badge, count). */
  badge?: ReactNode
  disabled?: boolean
  disabledReason?: string
}

export interface ModeTabsProps<V extends string = string> {
  tabs: ModeTabItem<V>[]
  value: V
  onChange: (next: V) => void
  /** Right-aligned content (e.g. fullscreen button). */
  trailing?: ReactNode
  className?: string
}

export default function ModeTabs<V extends string = string>({
  tabs,
  value,
  onChange,
  trailing,
  className = '',
}: ModeTabsProps<V>) {
  return (
    <div className={`flex items-center gap-0.5 ${className}`}>
      <div className="flex-1 flex items-center gap-0.5 overflow-x-auto no-scrollbar">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            disabled={tab.disabled}
            onClick={() => !tab.disabled && onChange(tab.value)}
            title={tab.disabled ? tab.disabledReason : undefined}
            className={`libtv-tab ${tab.value === value ? 'libtv-tab--active' : ''} ${
              tab.disabled ? 'opacity-40 cursor-not-allowed' : ''
            }`}
          >
            {tab.label}
            {tab.badge && <span className="ml-1">{tab.badge}</span>}
          </button>
        ))}
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  )
}
