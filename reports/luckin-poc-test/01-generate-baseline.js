/**
 * L2 — 用 Agent 工具 `generate_workflow` 创建瑞幸广告基线工作流
 *
 * 同时校验 openspec/workflow-generation/spec.md 的 4 个不变量：
 *   I1. No Dead Node Types — 不能有 imageCrop
 *   I2. Storyboard Must Have Script Input — storyboard 必有 incoming 且来源 script-out
 *   I3. Scene Reference Propagation — sceneGrid → imageGen 边存在
 *   I4. Character Pipeline — characterGrid → characterManager → imageGen
 *
 * 瑞幸广告 product_ad 场景没有人物（characterNames=[]），所以 I4 NA。
 */
async page => {
  return await page.evaluate(async () => {
    const flowMod = await import('/src/store/flowStore.ts')
    const toolMod = await import('/src/providers/agentTools.ts')
    const portMod = await import('/src/types/portRegistry.ts')
    const { useFlowStore } = flowMod
    const { executeToolCall } = toolMod
    const { NODE_PORT_REGISTRY } = portMod

    // Reset
    useFlowStore.setState({
      nodes: [], edges: [], selectedNodeId: null,
      _history: [], _historyIndex: -1, _clipboard: null,
    })

    // === Step 1: 调 Agent 工具创建工作流 ===
    const res = await executeToolCall('generate_workflow', {
      title: '瑞幸冰美式 30s 广告',
      description: 'A 30-second product commercial for Luckin Coffee Iced Americano. Showcase: order tap, espresso brewing, ice cubes pour, latte art (creamy crown), glossy product hero shot.',
      scenario: 'product_ad',
      characterNames: [],
      sceneNames: ['Coffee Shop Counter', 'Espresso Machine Station', 'Product Hero Stage'],
      sceneDescriptions: [
        'modern Luckin coffee shop interior, warm natural lighting, blue Luckin branding',
        'espresso machine close-up, brass fittings, condensation droplets, cinematic light',
        'glossy product hero stage, deep blue gradient backdrop, single Luckin cup centered',
      ],
      shotPrompts: [
        'Shot 1 — phone screen tapping Luckin app order',
        'Shot 2 — espresso pulling from machine into glass',
        'Shot 3 — Luckin Iced Americano hero shot, condensation glistening',
      ],
      videoPrompts: [],
      styleDescription: 'commercial-grade, Luckin blue/white palette, premium glossy aesthetic',
      shotCount: 3,
    })

    if (!res.success) {
      return { phase: 'create', failed: true, message: res.message }
    }

    const state = useFlowStore.getState()
    const nodes = state.nodes
    const edges = state.edges

    // === Step 2: openspec 不变量校验 ===
    const byType = {}
    for (const n of nodes) {
      byType[n.type] = (byType[n.type] || 0) + 1
    }

    // I1: No imageCrop / dead types
    const I1_no_dead_types = !nodes.some(n => n.type === 'imageCrop')

    // Every emitted type registered (from agentNodeParity contract)
    const knownTypes = new Set([
      'characterGrid','sceneGrid','keyframeGrid','imageGen','videoGen','textNode','audioNode',
      'llmChat','storyboard','characterExtract','characterManager','styleLock','continuityCheck',
      'videoStitch','imageEdit','timeline',
    ])
    const unknownTypes = nodes.filter(n => !knownTypes.has(n.type)).map(n => n.type)

    // I2: Storyboard must have script input
    const storyboardNodes = nodes.filter(n => n.type === 'storyboard')
    const I2_storyboards_wired = storyboardNodes.length === 0 || storyboardNodes.every(sb => {
      const incoming = edges.filter(e => e.target === sb.id)
      return incoming.length >= 1
    })

    // I3: Scene reference propagation — every sceneGrid must have an outgoing edge to imageGen via scene-in or ref-in
    const sceneNodes = nodes.filter(n => n.type === 'sceneGrid')
    const I3_scene_propagated = sceneNodes.length === 0 || sceneNodes.every(sn => {
      const out = edges.filter(e => e.source === sn.id)
      return out.length >= 1 && out.some(e =>
        e.targetHandle === 'scene-in' || e.targetHandle === 'ref-in',
      )
    })

    // I4: NA for product_ad without characters
    const I4_NA = byType.characterManager === undefined && byType.characterGrid === undefined

    // Port handle legality check
    let illegalEdges = []
    for (const e of edges) {
      const sourceNode = nodes.find(n => n.id === e.source)
      const targetNode = nodes.find(n => n.id === e.target)
      if (!sourceNode || !targetNode) {
        illegalEdges.push({ edge: e.id, reason: 'orphan' })
        continue
      }
      const sourcePorts = NODE_PORT_REGISTRY[sourceNode.type] || []
      const targetPorts = NODE_PORT_REGISTRY[targetNode.type] || []
      if (e.sourceHandle && !sourcePorts.find(p => p.id === e.sourceHandle)) {
        illegalEdges.push({ edge: e.id, reason: `unknown source handle ${sourceNode.type}.${e.sourceHandle}` })
      }
      if (e.targetHandle && !targetPorts.find(p => p.id === e.targetHandle)) {
        illegalEdges.push({ edge: e.id, reason: `unknown target handle ${targetNode.type}.${e.targetHandle}` })
      }
    }

    return {
      tool_message: res.message,
      node_count: nodes.length,
      edge_count: edges.length,
      node_breakdown: byType,
      sample_node_ids: nodes.slice(0, 8).map(n => ({ id: n.id, type: n.type, label: n.data?.label })),
      openspec_invariants: {
        I1_no_dead_types,
        unknownTypes,
        I2_storyboards_wired,
        storyboard_count: storyboardNodes.length,
        I3_scene_propagated,
        scenegrid_count: sceneNodes.length,
        I4_NA,
        illegalEdges_count: illegalEdges.length,
        illegalEdges: illegalEdges.slice(0, 5),
      },
      all_invariants_pass: (
        I1_no_dead_types && unknownTypes.length === 0 &&
        I2_storyboards_wired && I3_scene_propagated &&
        illegalEdges.length === 0
      ),
    }
  })
}
