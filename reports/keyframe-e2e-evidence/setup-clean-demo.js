/**
 * 清空 canvas 后只创建 1 个节点 + 模拟用户输入，方便截图
 */
async page => {
  return await page.evaluate(async () => {
    const flowMod = await import('/src/store/flowStore.ts')
    const toolMod = await import('/src/providers/agentTools.ts')
    const { useFlowStore } = flowMod
    const { executeToolCall } = toolMod

    useFlowStore.setState({
      nodes: [], edges: [], selectedNodeId: null,
      _history: [], _historyIndex: -1, _clipboard: null,
    })

    const res = await executeToolCall('create_keyframe_grid', {
      shotName: '决战时刻',
      shotDescription: '英雄在雨夜中举枪对峙，闪电划过天际，主角脸上的雨水与决意',
      subType: 'time-progression',
      layout: '2x3',
      style: 'noir',
      mood: 'tense',
    })

    return { ok: res.success, msg: res.message, count: useFlowStore.getState().nodes.length }
  })
}
