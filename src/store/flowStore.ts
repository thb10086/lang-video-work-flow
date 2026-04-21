import { create } from 'zustand'
import {
  type Edge,
  type Node,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Connection,
} from '@xyflow/react'
import { generateId } from '@/lib/utils'
import { ENV } from '@/lib/env'
import { workflowApi } from '@/api/workflowApi'

// ── History snapshot for undo/redo ──
interface HistorySnapshot {
  nodes: Node[]
  edges: Edge[]
}

const MAX_HISTORY = 50

const BACKEND_ENABLED = Boolean(ENV.BACKEND_URL)
const AUTO_SAVE_DELAY = 5000
let _autoSaveTimer: ReturnType<typeof setTimeout> | null = null

export interface FlowState {
  nodes: Node[]
  edges: Edge[]
  selectedNodeId: string | null

  // Character appearance registry (name → English appearance description)
  characterAppearances: Record<string, string>

  // Remote persistence
  projectId: number | null
  workflowId: number | null
  isSaving: boolean
  lastSavedAt: number | null

  // History
  _history: HistorySnapshot[]
  _historyIndex: number
  _clipboard: { nodes: Node[]; edges: Edge[] } | null

  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange
  onConnect: OnConnect

  addNode: (type: string, position: { x: number; y: number }, data: Record<string, unknown>) => string
  removeNode: (id: string) => void
  updateNodeData: (id: string, data: Partial<Record<string, unknown>>) => void
  selectNode: (id: string | null) => void
  clearAll: () => void
  exportWorkflow: () => string
  importWorkflow: (json: string) => void

  // Character appearance registry
  setCharacterAppearance: (name: string, description: string) => void
  getCharacterAppearances: () => Record<string, string>

  // Undo / Redo
  pushHistory: () => void
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean

  // Copy / Paste / Duplicate / Delete / Select All
  copySelected: () => void
  paste: () => void
  duplicateSelected: () => void
  deleteSelected: () => void
  selectAll: () => void

  // Remote persistence
  setProject: (projectId: number) => void
  saveToRemote: () => Promise<void>
  loadFromRemote: (projectId: number) => Promise<void>
  scheduleAutoSave: () => void
}

export const useFlowStore = create<FlowState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  characterAppearances: {},
  projectId: null,
  workflowId: null,
  isSaving: false,
  lastSavedAt: null,
  _history: [],
  _historyIndex: -1,
  _clipboard: null,

  // ── Push current state to history (call before mutations) ──
  pushHistory: () => {
    const { nodes, edges, _history, _historyIndex } = get()
    const snapshot: HistorySnapshot = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    }
    // Truncate any redo history beyond current index
    const newHistory = _history.slice(0, _historyIndex + 1)
    newHistory.push(snapshot)
    // Cap history size
    if (newHistory.length > MAX_HISTORY) newHistory.shift()
    set({ _history: newHistory, _historyIndex: newHistory.length - 1 })
  },

  undo: () => {
    const { _history, _historyIndex, nodes, edges } = get()
    if (_historyIndex < 0) return
    // If at tip, save current state so redo can restore it
    if (_historyIndex === _history.length - 1) {
      const current: HistorySnapshot = {
        nodes: JSON.parse(JSON.stringify(nodes)),
        edges: JSON.parse(JSON.stringify(edges)),
      }
      const newHistory = [..._history, current]
      const snapshot = _history[_historyIndex]
      set({
        nodes: snapshot.nodes,
        edges: snapshot.edges,
        _history: newHistory,
        _historyIndex: _historyIndex - 1,
      })
      return
    }
    if (_historyIndex >= 0) {
      const snapshot = _history[_historyIndex]
      set({
        nodes: snapshot.nodes,
        edges: snapshot.edges,
        _historyIndex: _historyIndex - 1,
      })
    }
  },

  redo: () => {
    const { _history, _historyIndex } = get()
    const nextIndex = _historyIndex + 2
    if (nextIndex >= _history.length) return
    const snapshot = _history[nextIndex]
    set({
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      _historyIndex: _historyIndex + 1,
    })
  },

  canUndo: () => get()._historyIndex >= 0,
  canRedo: () => get()._historyIndex + 2 < get()._history.length,

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) })
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) })
  },

  onConnect: (connection: Connection) => {
    get().pushHistory()
    set({ edges: addEdge({ ...connection, animated: true }, get().edges) })
  },

  addNode: (type, position, data) => {
    get().pushHistory()
    const id = generateId()
    const newNode: Node = {
      id,
      type,
      position,
      data: { ...data, label: data.label || type },
    }
    set({ nodes: [...get().nodes, newNode] })
    return id
  },

  removeNode: (id) => {
    get().pushHistory()
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
    })
  },

  updateNodeData: (id, data) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...data } } : n
      ),
    })
  },

  selectNode: (id) => {
    set({ selectedNodeId: id })
  },

  clearAll: () => {
    get().pushHistory()
    set({ nodes: [], edges: [], selectedNodeId: null, characterAppearances: {} })
  },

  setCharacterAppearance: (name: string, description: string) => {
    const current = get().characterAppearances
    set({ characterAppearances: { ...current, [name]: description } })
  },

  getCharacterAppearances: () => get().characterAppearances,

  exportWorkflow: () => {
    const { nodes, edges } = get()
    // 剔除 base64 图片数据，只保留 COS URL 和结构信息
    // 防止导出文件过大（base64 图片可达 5MB+）
    const STRIP_KEYS = new Set([
      'outputImage', 'inputImage', 'referenceImage', 'croppedImage',
      'firstFrameImage', 'lastFrameImage', 'imageA', 'imageB',
      'styleReferenceImage',
    ])
    const sanitizedNodes = nodes.map(n => {
      const data = { ...(n.data as Record<string, unknown>) }
      for (const key of STRIP_KEYS) {
        const val = data[key]
        if (typeof val === 'string' && val.startsWith('data:')) {
          data[key] = null  // 剔除 base64，保留 null 占位
        }
      }
      // referenceImages[] 可能包含 base64 字符串，全部剥除
      if (Array.isArray(data.referenceImages)) {
        const cleaned = (data.referenceImages as string[]).filter(v => !v.startsWith('data:'))
        data.referenceImages = cleaned.length > 0 ? cleaned : null
      }
      return { ...n, data }
    })
    return JSON.stringify({ nodes: sanitizedNodes, edges }, null, 2)
  },

  importWorkflow: (json: string) => {
    try {
      const data = JSON.parse(json)
      if (data.nodes && data.edges) {
        get().pushHistory()
        set({ nodes: data.nodes, edges: data.edges, selectedNodeId: null })
      }
    } catch (e) {
      console.error('Failed to import workflow:', e)
    }
  },

  // ── Copy selected nodes to clipboard ──
  copySelected: () => {
    const { nodes, edges } = get()
    const selected = nodes.filter(n => n.selected)
    if (selected.length === 0) return
    const selectedIds = new Set(selected.map(n => n.id))
    const relatedEdges = edges.filter(e => selectedIds.has(e.source) && selectedIds.has(e.target))
    set({
      _clipboard: {
        nodes: JSON.parse(JSON.stringify(selected)),
        edges: JSON.parse(JSON.stringify(relatedEdges)),
      },
    })
  },

  // ── Paste from clipboard with offset ──
  paste: () => {
    const { _clipboard } = get()
    if (!_clipboard || _clipboard.nodes.length === 0) return
    get().pushHistory()
    const idMap = new Map<string, string>()
    const offset = 50

    const newNodes: Node[] = _clipboard.nodes.map(n => {
      const newId = generateId()
      idMap.set(n.id, newId)
      return {
        ...n,
        id: newId,
        position: { x: n.position.x + offset, y: n.position.y + offset },
        selected: true,
        data: { ...n.data },
      }
    })

    const newEdges: Edge[] = _clipboard.edges.map(e => ({
      ...e,
      id: generateId(),
      source: idMap.get(e.source) || e.source,
      target: idMap.get(e.target) || e.target,
    }))

    // Deselect existing nodes
    const deselectedNodes = get().nodes.map(n => ({ ...n, selected: false }))
    set({
      nodes: [...deselectedNodes, ...newNodes],
      edges: [...get().edges, ...newEdges],
    })
  },

  // ── Duplicate = copy + paste in one step ──
  duplicateSelected: () => {
    get().copySelected()
    get().paste()
  },

  // ── Delete all selected nodes and their edges ──
  deleteSelected: () => {
    const { nodes, edges } = get()
    const selected = nodes.filter(n => n.selected)
    if (selected.length === 0) return
    get().pushHistory()
    const selectedIds = new Set(selected.map(n => n.id))
    set({
      nodes: nodes.filter(n => !n.selected),
      edges: edges.filter(e => !selectedIds.has(e.source) && !selectedIds.has(e.target)),
      selectedNodeId: null,
    })
  },

  // ── Select all nodes ──
  selectAll: () => {
    set({
      nodes: get().nodes.map(n => ({ ...n, selected: true })),
    })
  },

  // ── Remote persistence ──
  setProject: (projectId: number) => {
    set({ projectId })
  },

  saveToRemote: async () => {
    if (!BACKEND_ENABLED) return
    const { projectId, nodes, edges, isSaving } = get()
    if (!projectId || isSaving) return

    set({ isSaving: true })
    try {
      const exportJson = get().exportWorkflow()
      const parsed = JSON.parse(exportJson)
      const result = await workflowApi.save(projectId, {
        name: 'Auto Save',
        nodes_json: parsed.nodes,
        edges_json: parsed.edges,
      })
      set({ workflowId: result.id, lastSavedAt: Date.now() })
    } catch (err) {
      console.error('[flowStore] saveToRemote failed:', err)
    } finally {
      set({ isSaving: false })
    }
  },

  loadFromRemote: async (projectId: number) => {
    if (!BACKEND_ENABLED) return
    try {
      const workflow = await workflowApi.getCurrent(projectId)
      set({
        projectId,
        workflowId: workflow.id,
        nodes: workflow.nodes_json as unknown as Node[],
        edges: workflow.edges_json as unknown as Edge[],
        selectedNodeId: null,
        lastSavedAt: new Date(workflow.updated_at).getTime(),
      })
    } catch (err) {
      console.error('[flowStore] loadFromRemote failed:', err)
    }
  },

  scheduleAutoSave: () => {
    if (!BACKEND_ENABLED) return
    if (_autoSaveTimer) clearTimeout(_autoSaveTimer)
    _autoSaveTimer = setTimeout(() => {
      get().saveToRemote()
    }, AUTO_SAVE_DELAY)
  },
}))
