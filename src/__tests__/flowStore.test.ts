/**
 * flowStore 单元测试
 *
 * 覆盖：addNode / removeNode / updateNodeData / clearAll
 *      exportWorkflow (base64 剥离) / importWorkflow
 *      undo / redo / pushHistory
 *      copySelected / paste / duplicateSelected / deleteSelected
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useFlowStore } from '@/store/flowStore'

// ── 每条测试前重置 store ──
function resetStore() {
  useFlowStore.setState({
    nodes: [],
    edges: [],
    selectedNodeId: null,
    _history: [],
    _historyIndex: -1,
    _clipboard: null,
  })
}

// ── 辅助：向 store 添加节点 ──
function addTestNode(type: string, label: string, extraData: Record<string, unknown> = {}) {
  return useFlowStore.getState().addNode(type, { x: 0, y: 0 }, { label, ...extraData })
}

// ── 辅助：连接两个节点 ──
function connectNodes(sourceId: string, targetId: string, sourceHandle = 'out', targetHandle = 'in') {
  useFlowStore.getState().onConnect({ source: sourceId, target: targetId, sourceHandle, targetHandle })
}

// ────────────────────────────────────────────────────────────
describe('addNode', () => {
  beforeEach(resetStore)

  it('returns a unique string ID', () => {
    const id1 = addTestNode('imageGen', 'Gen A')
    const id2 = addTestNode('imageGen', 'Gen B')
    expect(typeof id1).toBe('string')
    expect(id1.length).toBeGreaterThan(0)
    expect(id1).not.toBe(id2)
  })

  it('stores node with correct type, label and position', () => {
    const id = useFlowStore.getState().addNode('videoGen', { x: 10, y: 20 }, { label: 'My Video' })
    const node = useFlowStore.getState().nodes.find(n => n.id === id)
    expect(node).toBeDefined()
    expect(node!.type).toBe('videoGen')
    expect(node!.data.label).toBe('My Video')
    expect(node!.position).toEqual({ x: 10, y: 20 })
  })

  it('defaults label to type when not provided', () => {
    const id = useFlowStore.getState().addNode('textNode', { x: 0, y: 0 }, {})
    const node = useFlowStore.getState().nodes.find(n => n.id === id)
    expect(node!.data.label).toBe('textNode')
  })

  it('pushes a history snapshot', () => {
    const beforeLen = useFlowStore.getState()._history.length
    addTestNode('imageGen', 'X')
    expect(useFlowStore.getState()._history.length).toBe(beforeLen + 1)
  })
})

// ────────────────────────────────────────────────────────────
describe('removeNode', () => {
  beforeEach(resetStore)

  it('removes the node', () => {
    const id = addTestNode('imageGen', 'A')
    useFlowStore.getState().removeNode(id)
    expect(useFlowStore.getState().nodes.find(n => n.id === id)).toBeUndefined()
  })

  it('removes connected edges', () => {
    const a = addTestNode('imageGen', 'A')
    const b = addTestNode('videoGen', 'B')
    connectNodes(a, b, 'image-out', 'first-frame')
    expect(useFlowStore.getState().edges).toHaveLength(1)
    useFlowStore.getState().removeNode(a)
    expect(useFlowStore.getState().edges).toHaveLength(0)
  })

  it('clears selectedNodeId when removed node was selected', () => {
    const id = addTestNode('textNode', 'T')
    useFlowStore.getState().selectNode(id)
    useFlowStore.getState().removeNode(id)
    expect(useFlowStore.getState().selectedNodeId).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────
describe('updateNodeData', () => {
  beforeEach(resetStore)

  it('merges data without losing existing fields', () => {
    const id = addTestNode('imageGen', 'Gen', { prompt: 'original' })
    useFlowStore.getState().updateNodeData(id, { status: 'done' })
    const node = useFlowStore.getState().nodes.find(n => n.id === id)!
    expect(node.data.prompt).toBe('original')
    expect(node.data.status).toBe('done')
  })

  it('overwrites specific field', () => {
    const id = addTestNode('imageGen', 'Gen', { prompt: 'old' })
    useFlowStore.getState().updateNodeData(id, { prompt: 'new' })
    const node = useFlowStore.getState().nodes.find(n => n.id === id)!
    expect(node.data.prompt).toBe('new')
  })

  it('does not affect other nodes', () => {
    const a = addTestNode('imageGen', 'A', { value: 1 })
    const b = addTestNode('imageGen', 'B', { value: 2 })
    useFlowStore.getState().updateNodeData(a, { value: 99 })
    const nodeB = useFlowStore.getState().nodes.find(n => n.id === b)!
    expect(nodeB.data.value).toBe(2)
  })
})

// ────────────────────────────────────────────────────────────
describe('clearAll', () => {
  beforeEach(resetStore)

  it('removes all nodes, edges and selection', () => {
    const a = addTestNode('imageGen', 'A')
    const b = addTestNode('videoGen', 'B')
    connectNodes(a, b, 'out', 'in')
    useFlowStore.getState().selectNode(a)
    useFlowStore.getState().clearAll()
    const state = useFlowStore.getState()
    expect(state.nodes).toHaveLength(0)
    expect(state.edges).toHaveLength(0)
    expect(state.selectedNodeId).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────
describe('exportWorkflow — base64 剥离', () => {
  beforeEach(resetStore)

  it('strips base64 outputImage from exported nodes', () => {
    const id = addTestNode('imageGen', 'Gen', {
      outputImage: 'data:image/png;base64,AAAA',
      prompt: 'test',
    })
    const json = useFlowStore.getState().exportWorkflow()
    const data = JSON.parse(json)
    const node = data.nodes.find((n: { id: string }) => n.id === id)
    expect(node.data.outputImage).toBeNull()
    expect(node.data.prompt).toBe('test')
  })

  it('strips base64 entries from referenceImages array', () => {
    const id = addTestNode('imageGen', 'Gen', {
      referenceImages: ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB'],
    })
    const json = useFlowStore.getState().exportWorkflow()
    const data = JSON.parse(json)
    const node = data.nodes.find((n: { id: string }) => n.id === id)
    expect(node.data.referenceImages).toBeNull()
  })

  it('preserves COS URLs in referenceImages array', () => {
    const id = addTestNode('imageGen', 'Gen', {
      referenceImages: [
        'https://cos.example.com/img1.png',
        'https://cos.example.com/img2.png',
      ],
    })
    const json = useFlowStore.getState().exportWorkflow()
    const data = JSON.parse(json)
    const node = data.nodes.find((n: { id: string }) => n.id === id)
    expect(node.data.referenceImages).toHaveLength(2)
    expect(node.data.referenceImages[0]).toBe('https://cos.example.com/img1.png')
  })

  it('strips croppedImage and firstFrameImage', () => {
    const id = addTestNode('imageEdit', 'Edit', {
      croppedImage: 'data:image/png;base64,CROP',
      firstFrameImage: 'data:image/jpeg;base64,FRAME',
    })
    const json = useFlowStore.getState().exportWorkflow()
    const data = JSON.parse(json)
    const node = data.nodes.find((n: { id: string }) => n.id === id)
    expect(node.data.croppedImage).toBeNull()
    expect(node.data.firstFrameImage).toBeNull()
  })

  it('preserves COS URL outputImageUrl', () => {
    const id = addTestNode('imageGen', 'Gen', {
      outputImage: 'data:image/png;base64,AAAA',
      outputImageUrl: 'https://cos.example.com/img.png',
    })
    const json = useFlowStore.getState().exportWorkflow()
    const data = JSON.parse(json)
    const node = data.nodes.find((n: { id: string }) => n.id === id)
    expect(node.data.outputImageUrl).toBe('https://cos.example.com/img.png')
  })
})

// ────────────────────────────────────────────────────────────
describe('importWorkflow', () => {
  beforeEach(resetStore)

  it('restores nodes and edges from JSON', () => {
    const a = addTestNode('imageGen', 'A', { prompt: 'hello' })
    const b = addTestNode('videoGen', 'B')
    connectNodes(a, b, 'image-out', 'first-frame')
    const json = useFlowStore.getState().exportWorkflow()
    useFlowStore.getState().clearAll()
    expect(useFlowStore.getState().nodes).toHaveLength(0)

    useFlowStore.getState().importWorkflow(json)
    const state = useFlowStore.getState()
    expect(state.nodes).toHaveLength(2)
    expect(state.edges).toHaveLength(1)
    const nodeA = state.nodes.find(n => n.id === a)
    expect(nodeA?.data.prompt).toBe('hello')
  })

  it('does nothing for invalid JSON', () => {
    addTestNode('textNode', 'T')
    useFlowStore.getState().importWorkflow('not-valid-json')
    expect(useFlowStore.getState().nodes).toHaveLength(1)
  })

  it('does nothing for JSON without nodes/edges keys', () => {
    addTestNode('textNode', 'T')
    useFlowStore.getState().importWorkflow(JSON.stringify({ foo: 'bar' }))
    expect(useFlowStore.getState().nodes).toHaveLength(1)
  })
})

// ────────────────────────────────────────────────────────────
describe('undo / redo', () => {
  beforeEach(resetStore)

  it('canUndo returns false on empty history', () => {
    expect(useFlowStore.getState().canUndo()).toBe(false)
  })

  it('canUndo returns true after addNode', () => {
    addTestNode('imageGen', 'A')
    expect(useFlowStore.getState().canUndo()).toBe(true)
  })

  it('undo restores previous state', () => {
    addTestNode('imageGen', 'A')
    expect(useFlowStore.getState().nodes).toHaveLength(1)
    useFlowStore.getState().undo()
    expect(useFlowStore.getState().nodes).toHaveLength(0)
  })

  it('redo restores undone state', () => {
    addTestNode('imageGen', 'A')
    useFlowStore.getState().undo()
    expect(useFlowStore.getState().nodes).toHaveLength(0)
    useFlowStore.getState().redo()
    expect(useFlowStore.getState().nodes).toHaveLength(1)
  })

  it('canRedo returns false initially', () => {
    expect(useFlowStore.getState().canRedo()).toBe(false)
  })

  it('canRedo returns false after no undo', () => {
    addTestNode('imageGen', 'A')
    expect(useFlowStore.getState().canRedo()).toBe(false)
  })

  it('multiple undos then multiple redos', () => {
    addTestNode('imageGen', 'A')
    addTestNode('imageGen', 'B')
    addTestNode('imageGen', 'C')
    useFlowStore.getState().undo()
    useFlowStore.getState().undo()
    expect(useFlowStore.getState().nodes).toHaveLength(1)
    useFlowStore.getState().redo()
    useFlowStore.getState().redo()
    expect(useFlowStore.getState().nodes).toHaveLength(3)
  })

  it('pushHistory truncates redo history after new action', () => {
    addTestNode('imageGen', 'A')
    addTestNode('imageGen', 'B')
    useFlowStore.getState().undo()
    addTestNode('imageGen', 'C') // adds a new action; should truncate redo future
    expect(useFlowStore.getState().canRedo()).toBe(false)
    expect(useFlowStore.getState().nodes).toHaveLength(2) // A + C
  })
})

// ────────────────────────────────────────────────────────────
describe('copySelected / paste / deleteSelected', () => {
  beforeEach(resetStore)

  it('paste duplicates selected nodes with new IDs', () => {
    const id = addTestNode('imageGen', 'Gen', { prompt: 'hello' })
    // manually mark as selected
    useFlowStore.setState({
      nodes: useFlowStore.getState().nodes.map(n => ({ ...n, selected: true })),
    })
    useFlowStore.getState().copySelected()
    useFlowStore.getState().paste()
    const nodes = useFlowStore.getState().nodes
    expect(nodes).toHaveLength(2)
    const copy = nodes.find(n => n.id !== id)!
    expect(copy.data.label).toBe('Gen')
    expect(copy.data.prompt).toBe('hello')
  })

  it('deleteSelected removes selected nodes and their edges', () => {
    const a = addTestNode('imageGen', 'A')
    const b = addTestNode('videoGen', 'B')
    connectNodes(a, b, 'out', 'in')
    useFlowStore.setState({
      nodes: useFlowStore.getState().nodes.map(n => n.id === a ? { ...n, selected: true } : n),
    })
    useFlowStore.getState().deleteSelected()
    expect(useFlowStore.getState().nodes).toHaveLength(1)
    expect(useFlowStore.getState().nodes[0].id).toBe(b)
    expect(useFlowStore.getState().edges).toHaveLength(0)
  })
})
