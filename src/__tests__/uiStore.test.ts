/**
 * uiStore 单元测试
 *
 * 覆盖：toggle / set 系列 action、width clamp、pendingConnection 生命周期
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '@/store/uiStore'

function reset() {
  useUIStore.setState({
    leftPanelOpen: false,
    leftPanelWidth: 240,
    agentDrawerOpen: false,
    agentDrawerWidth: 380,
    rightTab: 'chat',
    quickNodePanelOpen: false,
    templatePanelOpen: false,
    fullscreenMode: false,
    pendingConnection: null,
  })
}

beforeEach(reset)

describe('leftPanel', () => {
  it('toggleLeftPanel flips state', () => {
    expect(useUIStore.getState().leftPanelOpen).toBe(false)
    useUIStore.getState().toggleLeftPanel()
    expect(useUIStore.getState().leftPanelOpen).toBe(true)
    useUIStore.getState().toggleLeftPanel()
    expect(useUIStore.getState().leftPanelOpen).toBe(false)
  })

  it('setLeftPanelOpen sets explicitly', () => {
    useUIStore.getState().setLeftPanelOpen(true)
    expect(useUIStore.getState().leftPanelOpen).toBe(true)
  })

  it('setLeftPanelWidth clamps between 200-400', () => {
    useUIStore.getState().setLeftPanelWidth(100)
    expect(useUIStore.getState().leftPanelWidth).toBe(200)
    useUIStore.getState().setLeftPanelWidth(999)
    expect(useUIStore.getState().leftPanelWidth).toBe(400)
    useUIStore.getState().setLeftPanelWidth(300)
    expect(useUIStore.getState().leftPanelWidth).toBe(300)
  })
})

describe('agentDrawer', () => {
  it('toggleAgentDrawer flips state', () => {
    useUIStore.getState().toggleAgentDrawer()
    expect(useUIStore.getState().agentDrawerOpen).toBe(true)
  })

  it('setAgentDrawerWidth clamps between 280-700', () => {
    useUIStore.getState().setAgentDrawerWidth(100)
    expect(useUIStore.getState().agentDrawerWidth).toBe(280)
    useUIStore.getState().setAgentDrawerWidth(999)
    expect(useUIStore.getState().agentDrawerWidth).toBe(700)
    useUIStore.getState().setAgentDrawerWidth(500)
    expect(useUIStore.getState().agentDrawerWidth).toBe(500)
  })

  it('setRightTab switches tab', () => {
    useUIStore.getState().setRightTab('settings')
    expect(useUIStore.getState().rightTab).toBe('settings')
    useUIStore.getState().setRightTab('chat')
    expect(useUIStore.getState().rightTab).toBe('chat')
  })
})

describe('quickNodePanel', () => {
  it('toggleQuickNodePanel flips state', () => {
    useUIStore.getState().toggleQuickNodePanel()
    expect(useUIStore.getState().quickNodePanelOpen).toBe(true)
    useUIStore.getState().toggleQuickNodePanel()
    expect(useUIStore.getState().quickNodePanelOpen).toBe(false)
  })

  it('setQuickNodePanelOpen sets explicitly', () => {
    useUIStore.getState().setQuickNodePanelOpen(true)
    expect(useUIStore.getState().quickNodePanelOpen).toBe(true)
  })
})

describe('templatePanel', () => {
  it('setTemplatePanelOpen sets state', () => {
    useUIStore.getState().setTemplatePanelOpen(true)
    expect(useUIStore.getState().templatePanelOpen).toBe(true)
  })
})

describe('fullscreen', () => {
  it('toggleFullscreen flips state', () => {
    useUIStore.getState().toggleFullscreen()
    expect(useUIStore.getState().fullscreenMode).toBe(true)
    useUIStore.getState().toggleFullscreen()
    expect(useUIStore.getState().fullscreenMode).toBe(false)
  })
})

describe('pendingConnection', () => {
  it('starts as null', () => {
    expect(useUIStore.getState().pendingConnection).toBeNull()
  })

  it('setPendingConnection sets and clears', () => {
    const conn = { sourceNodeId: 'n1', sourceHandleId: 'h1', position: { x: 100, y: 200 } }
    useUIStore.getState().setPendingConnection(conn)
    expect(useUIStore.getState().pendingConnection).toEqual(conn)

    useUIStore.getState().setPendingConnection(null)
    expect(useUIStore.getState().pendingConnection).toBeNull()
  })
})
