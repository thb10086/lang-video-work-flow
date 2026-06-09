/**
 * Agent 工具调度端到端验证（在浏览器里，等价 Agent chat 的实际路径）
 *
 * 验证：
 *   ✓ executeToolCall('create_keyframe_grid', ...) 创建 1 个 keyframeGrid 节点
 *   ✓ 节点 data 字段全对（shotName / shotDescription / subType / layout / style / mood / status）
 *   ✓ invalid subType / layout 强制 fallback
 *   ✓ 4 个 subType + 3 个 layout 组合都能创建（共 4×3 = 12 个节点）
 *   ✓ 创建后 flowStore.nodes.length 增量正确
 */
async page => {
  return await page.evaluate(async () => {
    const flowMod = await import('/src/store/flowStore.ts')
    const toolMod = await import('/src/providers/agentTools.ts')

    const { useFlowStore } = flowMod
    const { executeToolCall } = toolMod

    // 测试前清空 canvas
    useFlowStore.setState({
      nodes: [], edges: [], selectedNodeId: null,
      _history: [], _historyIndex: -1, _clipboard: null,
    })

    const subTypes = ['time-progression', 'scene-evolution', 'action-breakdown', 'multi-camera']
    const layouts = ['2x2', '2x3', '3x3']

    const created = []
    let invalidFallbackOk = null
    let normalCreateOk = null

    // 1) Normal create (canonical case)
    const normalRes = await executeToolCall('create_keyframe_grid', {
      shotName: '决战',
      shotDescription: '主角与反派在天台对峙',
      subType: 'multi-camera',
      layout: '2x3',
      style: 'noir',
      mood: 'tense',
    })
    const nodes1 = useFlowStore.getState().nodes
    const lastNode = nodes1[nodes1.length - 1]
    normalCreateOk = {
      ok: normalRes.success === true,
      message: normalRes.message,
      type_correct: lastNode?.type === 'keyframeGrid',
      label: lastNode?.data?.label,
      shotName: lastNode?.data?.shotName,
      subType: lastNode?.data?.subType,
      layout: lastNode?.data?.layout,
      style: lastNode?.data?.style,
      mood: lastNode?.data?.mood,
      status: lastNode?.data?.status,
      output_initially_null: lastNode?.data?.outputImage === null,
    }

    // 2) Invalid sanitize
    await executeToolCall('create_keyframe_grid', {
      shotName: 'badtest',
      shotDescription: 'test',
      subType: 'INVALID-VALUE',
      layout: 'WHO-KNOWS',
    })
    const nodes2 = useFlowStore.getState().nodes
    const lastBad = nodes2[nodes2.length - 1]
    invalidFallbackOk = {
      subType_fallback: lastBad?.data?.subType === 'time-progression',
      layout_fallback:  lastBad?.data?.layout === '2x3',
    }

    // 3) Matrix: 4 × 3 = 12 nodes, all distinct
    const before = useFlowStore.getState().nodes.length
    for (const subType of subTypes) {
      for (const layout of layouts) {
        const res = await executeToolCall('create_keyframe_grid', {
          shotName: `matrix-${subType}-${layout}`,
          shotDescription: 'matrix-test',
          subType, layout,
        })
        created.push({
          subType, layout,
          ok: res.success,
          msg_has_n: res.message.includes(layout === '2x2' ? '4格' : layout === '2x3' ? '6格' : '9格'),
          msg_has_subtype: res.message.includes(subType),
        })
      }
    }
    const after = useFlowStore.getState().nodes.length

    return {
      normal_create: normalCreateOk,
      invalid_fallback: invalidFallbackOk,
      matrix_size_grew_by: after - before,
      matrix_all_pass: created.every(c => c.ok && c.msg_has_n && c.msg_has_subtype),
      matrix_failures: created.filter(c => !c.ok || !c.msg_has_n || !c.msg_has_subtype),
      total_nodes_now: useFlowStore.getState().nodes.length,
    }
  })
}
