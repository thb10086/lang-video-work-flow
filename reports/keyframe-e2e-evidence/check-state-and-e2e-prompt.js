/**
 * P6 + P7 — chip 切换状态 + 端到端 prompt 生成
 *
 * 验证：
 *   ✓ updateNodeData(id, { subType: 'X' }) 后 store 反映新值
 *   ✓ updateNodeData 改 layout 也生效
 *   ✓ 用户填入 shotName / shotDescription 后，调用 buildKeyframePrompt
 *     生成的 prompt 包含这些用户输入（端到端）
 *   ✓ 切换 subType 会改变 prompt 体（不同子类型 prompt 不同）
 */
async page => {
  return await page.evaluate(async () => {
    const flowMod = await import('/src/store/flowStore.ts')
    const promptMod = await import('/src/prompts/templates/keyframeSheet.ts')
    const toolMod = await import('/src/providers/agentTools.ts')

    const { useFlowStore } = flowMod
    const { buildKeyframePrompt } = promptMod
    const { executeToolCall } = toolMod

    // Reset
    useFlowStore.setState({
      nodes: [], edges: [], selectedNodeId: null,
      _history: [], _historyIndex: -1, _clipboard: null,
    })

    // 创建 1 个节点，作为测试目标
    await executeToolCall('create_keyframe_grid', {
      shotName: 'init',
      shotDescription: 'init desc',
      subType: 'time-progression',
    })
    const id = useFlowStore.getState().nodes[0].id

    // 1) chip 切换 subType
    useFlowStore.getState().updateNodeData(id, { subType: 'multi-camera' })
    const after1 = useFlowStore.getState().nodes[0].data.subType

    // 2) chip 切换 layout
    useFlowStore.getState().updateNodeData(id, { layout: '3x3' })
    const after2 = useFlowStore.getState().nodes[0].data.layout

    // 3) chip 切换 style + mood
    useFlowStore.getState().updateNodeData(id, { style: 'anime', mood: 'romantic' })
    const after3 = {
      style: useFlowStore.getState().nodes[0].data.style,
      mood: useFlowStore.getState().nodes[0].data.mood,
    }

    // 4) 用户输入（模拟 input/textarea onChange）
    useFlowStore.getState().updateNodeData(id, {
      shotName: '决战时刻',
      shotDescription: '英雄在雨夜中举枪对峙，闪电划过天际',
    })
    const finalNode = useFlowStore.getState().nodes[0].data

    // 5) 端到端：用最终 store data 拼成 prompt（这就是 handleGenerate 调用路径）
    const finalPrompt = buildKeyframePrompt({
      subType: finalNode.subType,
      layout: finalNode.layout,
      shotName: finalNode.shotName,
      shotDescription: finalNode.shotDescription,
      style: finalNode.style,
      mood: finalNode.mood,
    })

    // 端到端断言
    const e2eChecks = {
      contains_user_shot_name:  finalPrompt.includes('决战时刻'),
      contains_user_shot_desc:  finalPrompt.includes('英雄在雨夜中举枪对峙'),
      contains_anime_style:     finalPrompt.includes('STYLE: anime'),
      contains_romantic_mood:   finalPrompt.includes('MOOD: romantic'),
      contains_3x3_grid:        finalPrompt.includes('3x3 grid'),
      contains_9_panels:        finalPrompt.includes('9 panels'),
      contains_multicam_marker: /MULTI-CAMERA/.test(finalPrompt),
      // 互斥：之前是 time-progression，切到 multi-camera 后不应再有 time-progression 标记
      no_time_progression:      !/TIME PROGRESSION|time advances/.test(finalPrompt),
    }

    // 6) 切回 time-progression，确认 prompt 体真的换了
    useFlowStore.getState().updateNodeData(id, { subType: 'time-progression' })
    const swapped = useFlowStore.getState().nodes[0].data
    const swappedPrompt = buildKeyframePrompt({
      subType: swapped.subType,
      layout: swapped.layout,
      shotName: swapped.shotName,
      shotDescription: swapped.shotDescription,
      style: swapped.style,
      mood: swapped.mood,
    })
    const swap_changed_body = (
      /TIME PROGRESSION/.test(swappedPrompt) &&
      !/MULTI-CAMERA/.test(swappedPrompt)
    )
    const swap_kept_user_text = (
      swappedPrompt.includes('决战时刻') &&
      swappedPrompt.includes('英雄在雨夜中举枪对峙')
    )

    return {
      chip_subtype_switch_ok: after1 === 'multi-camera',
      chip_layout_switch_ok:  after2 === '3x3',
      chip_style_mood_ok:     after3.style === 'anime' && after3.mood === 'romantic',
      e2e_checks: e2eChecks,
      e2e_all_pass: Object.values(e2eChecks).every(Boolean),
      swap_changed_body,
      swap_kept_user_text,
      sample_prompt_length: finalPrompt.length,
      sample_prompt_head: finalPrompt.split('\n').slice(0, 4).join(' | '),
    }
  })
}
