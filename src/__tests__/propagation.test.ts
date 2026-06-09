/**
 * 数据传播引擎 单元测试
 *
 * 覆盖：propagateNodeOutput (所有 handle 类型)
 *       pullFromUpstream (referenceImages[] 收集)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useFlowStore } from '@/store/flowStore'
import { _testPropagateNodeOutput, _testPullFromUpstream } from '@/providers/nodeExecutor'

// ── 重置 store ──
function reset() {
  useFlowStore.setState({ nodes: [], edges: [], selectedNodeId: null, _history: [], _historyIndex: -1, _clipboard: null })
}

// ── 直接向 store 注入节点（跳过 history，快速建立测试场景）──
function injectNode(id: string, type: string, data: Record<string, unknown>) {
  useFlowStore.setState(s => ({
    nodes: [...s.nodes, { id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }],
  }))
}

// ── 直接向 store 注入边 ──
function injectEdge(sourceId: string, targetId: string, sourceHandle: string, targetHandle: string) {
  useFlowStore.setState(s => ({
    edges: [...s.edges, {
      id: `${sourceId}-${targetId}-${sourceHandle}-${targetHandle}`,
      source: sourceId, target: targetId, sourceHandle, targetHandle, animated: true,
    }],
  }))
}

// ────────────────────────────────────────────────────────────
describe('propagateNodeOutput — grid-in', () => {
  beforeEach(reset)

  it('sends bestImage to target.inputImage via grid-in', () => {
    injectNode('src', 'characterGrid', { outputImage: 'data:image/png;base64,CHARIMG', label: 'Char' })
    injectNode('tgt', 'imageEdit', { label: 'Edit' })
    injectEdge('src', 'tgt', 'grid-out', 'grid-in')

    _testPropagateNodeOutput('src')

    const tgt = useFlowStore.getState().nodes.find(n => n.id === 'tgt')!
    expect(tgt.data.inputImage).toBe('data:image/png;base64,CHARIMG')
  })

  it('prefers COS URL as bestImage', () => {
    injectNode('src', 'characterGrid', {
      outputImage: 'data:image/png;base64,CHARIMG',
      outputImageUrl: 'https://cos.example.com/char.png',
      label: 'Char',
    })
    injectNode('tgt', 'imageEdit', { label: 'Edit' })
    injectEdge('src', 'tgt', 'grid-out', 'grid-in')

    _testPropagateNodeOutput('src')

    const tgt = useFlowStore.getState().nodes.find(n => n.id === 'tgt')!
    expect(tgt.data.inputImage).toBe('https://cos.example.com/char.png')
  })
})

// ────────────────────────────────────────────────────────────
describe('propagateNodeOutput — first-frame', () => {
  beforeEach(reset)

  it('sends bestImage to firstFrameImage', () => {
    injectNode('src', 'imageGen', { outputImage: 'data:image/png;base64,FRAME', label: 'IMG' })
    injectNode('tgt', 'videoGen', { label: 'VID' })
    injectEdge('src', 'tgt', 'image-out', 'first-frame')

    _testPropagateNodeOutput('src')

    const tgt = useFlowStore.getState().nodes.find(n => n.id === 'tgt')!
    expect(tgt.data.firstFrameImage).toBe('data:image/png;base64,FRAME')
  })

  it('also sets firstFrameImageUrl when COS URL available', () => {
    injectNode('src', 'imageGen', {
      outputImage: 'data:image/png;base64,FRAME',
      outputImageUrl: 'https://cos.example.com/frame.png',
      label: 'IMG',
    })
    injectNode('tgt', 'videoGen', { label: 'VID' })
    injectEdge('src', 'tgt', 'image-out', 'first-frame')

    _testPropagateNodeOutput('src')

    const tgt = useFlowStore.getState().nodes.find(n => n.id === 'tgt')!
    expect(tgt.data.firstFrameImageUrl).toBe('https://cos.example.com/frame.png')
  })
})

// ────────────────────────────────────────────────────────────
describe('propagateNodeOutput — ref-in (人物一致性关键路径)', () => {
  beforeEach(reset)

  it('characterGrid base64 outputImage 传播到 referenceImages[]', () => {
    injectNode('src', 'characterGrid', {
      outputImage: 'data:image/png;base64,GRID',
      label: 'Char',
    })
    injectNode('tgt', 'imageGen', { label: 'Gen' })
    injectEdge('src', 'tgt', 'grid-out', 'ref-in')

    _testPropagateNodeOutput('src')

    const tgt = useFlowStore.getState().nodes.find(n => n.id === 'tgt')!
    expect(Array.isArray(tgt.data.referenceImages)).toBe(true)
    expect((tgt.data.referenceImages as string[])[0]).toBe('data:image/png;base64,GRID')
    expect(tgt.data.referenceImage).toBe('data:image/png;base64,GRID')
  })

  it('fallback to COS URL when base64 not available (reload scenario)', () => {
    injectNode('src', 'characterGrid', {
      outputImageUrl: 'https://cos.example.com/char.png',
      label: 'Char',
    })
    injectNode('tgt', 'imageGen', { label: 'Gen' })
    injectEdge('src', 'tgt', 'grid-out', 'ref-in')

    _testPropagateNodeOutput('src')

    const tgt = useFlowStore.getState().nodes.find(n => n.id === 'tgt')!
    expect((tgt.data.referenceImages as string[])[0]).toBe('https://cos.example.com/char.png')
  })

  it('多角色: 2 个 characterGrid 各自传播到同一 imageGen, 无重复', () => {
    injectNode('c1', 'characterGrid', { outputImage: 'data:image/png;base64,C1', label: '角色A' })
    injectNode('c2', 'characterGrid', { outputImage: 'data:image/png;base64,C2', label: '角色B' })
    injectNode('tgt', 'imageGen', { label: 'Gen' })
    injectEdge('c1', 'tgt', 'grid-out', 'ref-in')
    injectEdge('c2', 'tgt', 'grid-out', 'ref-in')

    _testPropagateNodeOutput('c1')
    _testPropagateNodeOutput('c2')

    const refs = useFlowStore.getState().nodes.find(n => n.id === 'tgt')!.data.referenceImages as string[]
    expect(refs).toHaveLength(2)
    expect(refs).toContain('data:image/png;base64,C1')
    expect(refs).toContain('data:image/png;base64,C2')
  })

  it('重复传播不产生重复引用图', () => {
    injectNode('src', 'characterGrid', { outputImage: 'data:image/png;base64,CHAR', label: 'C' })
    injectNode('tgt', 'imageGen', { label: 'Gen' })
    injectEdge('src', 'tgt', 'grid-out', 'ref-in')

    _testPropagateNodeOutput('src')
    _testPropagateNodeOutput('src')

    const refs = useFlowStore.getState().nodes.find(n => n.id === 'tgt')!.data.referenceImages as string[]
    expect(refs).toHaveLength(1)
  })
})

// ────────────────────────────────────────────────────────────
describe('propagateNodeOutput — style-in', () => {
  beforeEach(reset)

  it('sends extractedStyle to target.stylePrompt', () => {
    injectNode('src', 'styleLock', { extractedStyle: 'cinematic, warm tones, 4K', label: 'Style' })
    injectNode('tgt', 'imageGen', { label: 'Gen' })
    injectEdge('src', 'tgt', 'style-out', 'style-in')

    _testPropagateNodeOutput('src')

    const tgt = useFlowStore.getState().nodes.find(n => n.id === 'tgt')!
    expect(tgt.data.stylePrompt).toBe('cinematic, warm tones, 4K')
  })

  it('does not send when extractedStyle is empty', () => {
    injectNode('src', 'styleLock', { extractedStyle: '', label: 'Style' })
    injectNode('tgt', 'imageGen', { label: 'Gen', stylePrompt: 'existing' })
    injectEdge('src', 'tgt', 'style-out', 'style-in')

    _testPropagateNodeOutput('src')

    const tgt = useFlowStore.getState().nodes.find(n => n.id === 'tgt')!
    expect(tgt.data.stylePrompt).toBe('existing') // 保持原有值
  })
})

// ────────────────────────────────────────────────────────────
describe('propagateNodeOutput — script-in / text-in', () => {
  beforeEach(reset)

  it('sends content to target.script via script-in', () => {
    injectNode('src', 'textNode', { content: '第一集剧本内容', label: 'Script' })
    injectNode('tgt', 'storyboard', { label: 'SB' })
    injectEdge('src', 'tgt', 'text-out', 'script-in')

    _testPropagateNodeOutput('src')

    const tgt = useFlowStore.getState().nodes.find(n => n.id === 'tgt')!
    expect(tgt.data.script).toBe('第一集剧本内容')
  })

  it('sends content to target.text via text-in', () => {
    injectNode('src', 'textNode', { content: '旁白文字', label: 'Text' })
    injectNode('tgt', 'audioNode', { label: 'Audio' })
    injectEdge('src', 'tgt', 'text-out', 'text-in')

    _testPropagateNodeOutput('src')

    const tgt = useFlowStore.getState().nodes.find(n => n.id === 'tgt')!
    expect(tgt.data.text).toBe('旁白文字')
  })
})

// ────────────────────────────────────────────────────────────
describe('pullFromUpstream', () => {
  beforeEach(reset)

  it('pulls grid-out → inputImage for downstream node', () => {
    injectNode('src', 'characterGrid', { outputImage: 'data:image/png;base64,GRID', label: 'Char' })
    injectNode('tgt', 'imageEdit', { label: 'Edit' })
    injectEdge('src', 'tgt', 'grid-out', 'grid-in')

    _testPullFromUpstream('tgt')

    const tgt = useFlowStore.getState().nodes.find(n => n.id === 'tgt')!
    expect(tgt.data.inputImage).toBe('data:image/png;base64,GRID')
  })

  it('pullFromUpstream: 2 characterGrid ref-in 并收到 referenceImages[]', () => {
    injectNode('c1', 'characterGrid', { outputImage: 'data:image/png;base64,C1', label: '角色A' })
    injectNode('c2', 'characterGrid', { outputImage: 'data:image/png;base64,C2', label: '角色B' })
    injectNode('tgt', 'imageGen', { label: 'Gen' })
    injectEdge('c1', 'tgt', 'grid-out', 'ref-in')
    injectEdge('c2', 'tgt', 'grid-out', 'ref-in')

    _testPullFromUpstream('tgt')

    const refs = useFlowStore.getState().nodes.find(n => n.id === 'tgt')!.data.referenceImages as string[]
    expect(refs).toHaveLength(2)
    expect(refs).toContain('data:image/png;base64,C1')
    expect(refs).toContain('data:image/png;base64,C2')
  })

  it('pulls style-in → stylePrompt', () => {
    injectNode('s', 'styleLock', { extractedStyle: 'noir, dramatic', label: 'Style' })
    injectNode('g', 'imageGen', { label: 'Gen' })
    injectEdge('s', 'g', 'style-out', 'style-in')

    _testPullFromUpstream('g')

    const gen = useFlowStore.getState().nodes.find(n => n.id === 'g')!
    expect(gen.data.stylePrompt).toBe('noir, dramatic')
  })

  it('pulls first-frame → firstFrameImage from imageGen', () => {
    injectNode('img', 'imageGen', { outputImage: 'data:image/png;base64,FRAME', label: 'Img' })
    injectNode('vid', 'videoGen', { label: 'Vid' })
    injectEdge('img', 'vid', 'image-out', 'first-frame')

    _testPullFromUpstream('vid')

    const vid = useFlowStore.getState().nodes.find(n => n.id === 'vid')!
    expect(vid.data.firstFrameImage).toBe('data:image/png;base64,FRAME')
  })
})

// ────────────────────────────────────────────────────────────
describe('propagateNodeOutput — character-in (LibTV character flow)', () => {
  beforeEach(reset)

  it('characterExtract → videoGen: surfaces characterUrl + characterImage', () => {
    injectNode('ext', 'characterExtract', {
      characterUrl: 'https://cos.example.com/char.png',
      characterId: 'char_abc',
      label: '提取',
    })
    injectNode('vid', 'videoGen', { label: 'Vid' })
    injectEdge('ext', 'vid', 'character-out', 'character-in')

    _testPropagateNodeOutput('ext')

    const vid = useFlowStore.getState().nodes.find(n => n.id === 'vid')!
    expect(vid.data.characterUrl).toBe('https://cos.example.com/char.png')
    expect(vid.data.characterImage).toBe('https://cos.example.com/char.png')
    expect(vid.data.characterId).toBe('char_abc')
  })

  it('characterExtract → characterManager: appends to characters[] (de-dup)', () => {
    injectNode('ext', 'characterExtract', {
      characterUrl: 'https://cos.example.com/char.png',
      characterId: 'char_abc',
      name: '小红',
      description: '红色连衣裙',
      label: '提取',
    })
    injectNode('mgr', 'characterManager', { characters: [], label: '库' })
    injectEdge('ext', 'mgr', 'character-out', 'character-in')

    _testPropagateNodeOutput('ext')

    const mgr = useFlowStore.getState().nodes.find(n => n.id === 'mgr')!
    const chars = mgr.data.characters as Array<Record<string, unknown>>
    expect(chars).toHaveLength(1)
    expect(chars[0].name).toBe('小红')
    expect(chars[0].characterUrl).toBe('https://cos.example.com/char.png')
    expect(chars[0].characterId).toBe('char_abc')

    // Second propagation is a no-op (de-dup on characterId)
    _testPropagateNodeOutput('ext')
    const mgr2 = useFlowStore.getState().nodes.find(n => n.id === 'mgr')!
    expect((mgr2.data.characters as unknown[]).length).toBe(1)
  })

  it('characterManager → videoGen: pulls characters[] registry via pullFromUpstream', () => {
    injectNode('mgr', 'characterManager', {
      characters: [
        { id: 'c1', name: '小红', characterUrl: 'https://cos.example.com/a.png' },
        { id: 'c2', name: '小明', characterUrl: 'https://cos.example.com/b.png' },
      ],
      label: '库',
    })
    injectNode('vid', 'videoGen', { label: 'Vid' })
    injectEdge('mgr', 'vid', 'character-out', 'character-in')

    _testPullFromUpstream('vid')

    const vid = useFlowStore.getState().nodes.find(n => n.id === 'vid')!
    const chars = vid.data.characters as Array<Record<string, unknown>>
    expect(chars).toHaveLength(2)
    expect(chars[0].name).toBe('小红')
  })
})
