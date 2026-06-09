/**
 * workflowMigrations — spec tests for startup migrations applied to persisted
 * workflow state.
 *
 * Specifically covers `dropRemovedNodeTypes()` which strips `imageCrop` nodes
 * (and any future removed types) + their incident edges.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useFlowStore } from '@/store/flowStore'
import { dropRemovedNodeTypes } from '@/store/workflowMigrations'

function reset() {
  useFlowStore.setState({
    nodes: [],
    edges: [],
    selectedNodeId: null,
    _history: [],
    _historyIndex: -1,
    _clipboard: null,
  })
}

function injectNode(id: string, type: string, data: Record<string, unknown> = {}) {
  useFlowStore.setState(s => ({
    nodes: [...s.nodes, { id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }],
  }))
}

function injectEdge(id: string, source: string, target: string) {
  useFlowStore.setState(s => ({
    edges: [...s.edges, { id, source, target, animated: false }],
  }))
}

describe('workflowMigrations.dropRemovedNodeTypes', () => {
  beforeEach(reset)
  afterEach(() => vi.restoreAllMocks())

  it('removes imageCrop nodes and logs a warning', () => {
    injectNode('n1', 'imageGen')
    injectNode('crop1', 'imageCrop')
    injectNode('crop2', 'imageCrop')
    injectNode('n2', 'videoGen')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const removed = dropRemovedNodeTypes()

    expect(removed).toBe(2)
    expect(warn).toHaveBeenCalledTimes(1)
    const { nodes } = useFlowStore.getState()
    expect(nodes.map(n => n.id)).toEqual(['n1', 'n2'])
    warn.mockRestore()
  })

  it('also removes edges that touch a removed node', () => {
    injectNode('img', 'imageGen')
    injectNode('crop', 'imageCrop')
    injectNode('vid', 'videoGen')
    injectEdge('e1', 'img', 'crop')   // edge into removed node
    injectEdge('e2', 'crop', 'vid')   // edge out of removed node
    injectEdge('e3', 'img', 'vid')    // untouched edge
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    dropRemovedNodeTypes()

    const { edges } = useFlowStore.getState()
    expect(edges.map(e => e.id)).toEqual(['e3'])
  })

  it('is a silent no-op for clean workflows', () => {
    injectNode('n1', 'imageGen')
    injectNode('n2', 'videoGen')
    injectEdge('e1', 'n1', 'n2')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const removed = dropRemovedNodeTypes()

    expect(removed).toBe(0)
    expect(warn).not.toHaveBeenCalled()
    const { nodes, edges } = useFlowStore.getState()
    expect(nodes).toHaveLength(2)
    expect(edges).toHaveLength(1)
    warn.mockRestore()
  })
})
