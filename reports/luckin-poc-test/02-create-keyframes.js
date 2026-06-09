/**
 * L3 — 注入 4 个 keyframeGrid 节点（瑞幸 4 个真实场景 × 4 subType）
 *
 * 仅创建节点和写入 prompt，不触发生图（生图在 03 脚本中并行做）。
 */
async page => {
  return await page.evaluate(async () => {
    const flowMod = await import('/src/store/flowStore.ts')
    const toolMod = await import('/src/providers/agentTools.ts')
    const { useFlowStore } = flowMod
    const { executeToolCall } = toolMod

    // 4 个真实瑞幸广告需要的复杂镜头（imageGen 单帧无法满足）
    const luckinShots = [
      {
        shotName: '点单流程',
        shotDescription: 'Customer hand tapping Luckin app, browsing menu, selecting Iced Americano, confirming order, then phone showing order confirmation. Customer in white shirt, modern Luckin shop interior.',
        subType: 'time-progression',
        layout: '2x3',
        style: 'cinematic',
        mood: 'peaceful',
      },
      {
        shotName: '咖啡萃取',
        shotDescription: 'Espresso machine extracting fresh shot into glass — from empty glass, to first golden drops, dark espresso filling halfway, crema forming on top, glass nearly full, condensation on glass surface. Brass-fitted machine, warm cinematic backlight.',
        subType: 'scene-evolution',
        layout: '2x3',
        style: 'cinematic',
        mood: 'dramatic',
      },
      {
        shotName: '拉花动作',
        shotDescription: 'Barista performing latte art on iced americano milk top — pouring stream descending, milk hitting surface, swirling pattern emerging, leaf shape forming, finishing flick, completed art. Hands and pitcher visible, natural light.',
        subType: 'action-breakdown',
        layout: '2x3',
        style: 'realistic',
        mood: 'peaceful',
      },
      {
        shotName: '成品展示',
        shotDescription: 'Luckin Iced Americano hero product shot from 4 camera angles simultaneously: top-down, eye-level front, 45-degree hero, side profile. Glossy cup with condensation, deep blue Luckin gradient backdrop, premium commercial lighting.',
        subType: 'multi-camera',
        layout: '2x2',
        style: 'cinematic',
        mood: 'epic',
      },
    ]

    const created = []
    for (const shot of luckinShots) {
      const res = await executeToolCall('create_keyframe_grid', shot)
      created.push({
        ok: res.success,
        shotName: shot.shotName,
        subType: shot.subType,
        layout: shot.layout,
        message: res.message,
      })
    }

    // 收集所有 keyframeGrid 节点 ID 给下个脚本用
    const state = useFlowStore.getState()
    const keyframeNodes = state.nodes
      .filter(n => n.type === 'keyframeGrid')
      .map(n => ({
        id: n.id,
        shotName: n.data?.shotName,
        subType: n.data?.subType,
        layout: n.data?.layout,
      }))

    return {
      created,
      total_keyframe_nodes: keyframeNodes.length,
      keyframe_nodes: keyframeNodes,
      total_canvas_nodes: state.nodes.length,
    }
  })
}
