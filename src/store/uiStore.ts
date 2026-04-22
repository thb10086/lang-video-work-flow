/**
 * UI Store
 *
 * 管理全局 UI 状态：侧栏展开/折叠、Agent 抽屉、浮动面板、快捷键。
 * 与 settingsStore 分离——settingsStore 管持久化偏好，uiStore 管运行时 UI 状态。
 */

import { create } from 'zustand'

export interface UIState {
  // 左侧 NodePanel
  leftPanelOpen: boolean
  leftPanelWidth: number

  // 右侧 Agent 抽屉
  agentDrawerOpen: boolean
  agentDrawerWidth: number
  rightTab: 'chat' | 'settings'

  // 浮动节点面板 (Ctrl+K)
  quickNodePanelOpen: boolean

  // 模板面板
  templatePanelOpen: boolean

  // 素材库面板 (Ctrl+Shift+A)
  assetPanelOpen: boolean

  // 全屏模式
  fullscreenMode: boolean

  // Edge-to-Node: pending connection from a drag
  pendingConnection: {
    sourceNodeId: string
    sourceHandleId: string
    position: { x: number; y: number }
  } | null

  // Actions
  toggleLeftPanel: () => void
  setLeftPanelOpen: (open: boolean) => void
  setLeftPanelWidth: (width: number) => void
  toggleAgentDrawer: () => void
  setAgentDrawerOpen: (open: boolean) => void
  setAgentDrawerWidth: (width: number) => void
  setRightTab: (tab: 'chat' | 'settings') => void
  toggleQuickNodePanel: () => void
  setQuickNodePanelOpen: (open: boolean) => void
  setTemplatePanelOpen: (open: boolean) => void
  toggleAssetPanel: () => void
  setAssetPanelOpen: (open: boolean) => void
  toggleFullscreen: () => void
  setPendingConnection: (conn: UIState['pendingConnection']) => void
}

export const useUIStore = create<UIState>()((set) => ({
  // 默认：左侧折叠，Agent 隐藏
  leftPanelOpen: false,
  leftPanelWidth: 240,
  agentDrawerOpen: false,
  agentDrawerWidth: 380,
  rightTab: 'chat',
  quickNodePanelOpen: false,
  templatePanelOpen: false,
  assetPanelOpen: false,
  fullscreenMode: false,
  pendingConnection: null,

  toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),
  setLeftPanelOpen: (open) => set({ leftPanelOpen: open }),
  setLeftPanelWidth: (width) => set({ leftPanelWidth: Math.max(200, Math.min(400, width)) }),
  toggleAgentDrawer: () => set((s) => ({ agentDrawerOpen: !s.agentDrawerOpen })),
  setAgentDrawerOpen: (open) => set({ agentDrawerOpen: open }),
  setAgentDrawerWidth: (width) => set({ agentDrawerWidth: Math.max(280, Math.min(700, width)) }),
  setRightTab: (tab) => set({ rightTab: tab }),
  toggleQuickNodePanel: () => set((s) => ({ quickNodePanelOpen: !s.quickNodePanelOpen })),
  setQuickNodePanelOpen: (open) => set({ quickNodePanelOpen: open }),
  setTemplatePanelOpen: (open) => set({ templatePanelOpen: open }),
  toggleAssetPanel: () => set((s) => ({ assetPanelOpen: !s.assetPanelOpen })),
  setAssetPanelOpen: (open) => set({ assetPanelOpen: open }),
  toggleFullscreen: () => set((s) => ({ fullscreenMode: !s.fullscreenMode })),
  setPendingConnection: (conn) => set({ pendingConnection: conn }),
}))
