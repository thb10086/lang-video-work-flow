/**
 * L4-prep — 取 4 个 keyframeGrid 节点 data，生成最终 prompt 导出 JSON
 */
async page => {
  return await page.evaluate(async () => {
    const flowMod = await import('/src/store/flowStore.ts')
    const promptMod = await import('/src/prompts/templates/keyframeSheet.ts')
    const { useFlowStore } = flowMod
    const { buildKeyframePrompt } = promptMod

    const nodes = useFlowStore.getState().nodes.filter(n => n.type === 'keyframeGrid')

    const prompts = nodes.map(n => ({
      id: n.id,
      shotName: n.data.shotName,
      subType: n.data.subType,
      layout: n.data.layout,
      n_panels: n.data.layout === '2x2' ? 4 : n.data.layout === '2x3' ? 6 : 9,
      style: n.data.style,
      mood: n.data.mood,
      prompt: buildKeyframePrompt({
        subType: n.data.subType,
        layout: n.data.layout,
        shotName: n.data.shotName || 'shot',
        shotDescription: n.data.shotDescription || 'a cinematic moment',
        style: n.data.style,
        mood: n.data.mood,
      }),
    }))

    return { count: prompts.length, prompts }
  })
}
