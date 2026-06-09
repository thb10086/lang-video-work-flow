/**
 * Prompt 质量端到端验证脚本（在 playwright-cli 浏览器内执行）
 *
 * 验证矩阵：
 *   4 subType × 3 layout = 12 组 prompt
 *   每组校验：
 *     ✓ 必须含变量替换（shotName / shotDescription / style / mood）
 *     ✓ 必须含正确的 N panels 数字（2x2→4 / 2x3→6 / 3x3→9）
 *     ✓ 必须含子类型独有标识词（time advances / EVOLUTION / ACTION BREAKDOWN / MULTI-CAMERA）
 *     ✓ 必须含 single composite image / grid layout 锚定
 *     ✓ 子类型间互斥：A 子类型 prompt 不应含 B 子类型独有标识词
 *
 * 此脚本运行在浏览器主线程，输出 JSON 给 playwright-cli。
 */
async page => {
  return await page.evaluate(async () => {
    const m = await import('/src/prompts/templates/keyframeSheet.ts')
    const { buildKeyframePrompt, KEYFRAME_LAYOUTS, keyframeSheetTemplates } = m

    const subTypes = ['time-progression', 'scene-evolution', 'action-breakdown', 'multi-camera']
    const layouts = ['2x2', '2x3', '3x3']

    // 子类型独有标识词
    const SUBTYPE_MARKERS = {
      'time-progression': /TIME PROGRESSION|time advances/,
      'scene-evolution':  /SCENE EVOLUTION|atmospheric/,
      'action-breakdown': /ACTION BREAKDOWN|motion arc/,
      'multi-camera':     /MULTI-CAMERA|frozen moment/,
    }

    const FIXED_VARS = {
      shotName: 'shot-revenge-3',
      shotDescription: 'protagonist confronts antagonist on rooftop at sunset',
      style: 'noir',
      mood: 'tense',
    }

    const results = []

    for (const subType of subTypes) {
      for (const layout of layouts) {
        const prompt = buildKeyframePrompt({ subType, layout, ...FIXED_VARS })
        const layoutSpec = KEYFRAME_LAYOUTS[layout]

        // === 断言矩阵 ===
        const checks = {
          // 变量替换
          has_shot_name:        prompt.includes('shot-revenge-3'),
          has_shot_desc:        prompt.includes('protagonist confronts antagonist'),
          has_style:            prompt.includes('STYLE: noir'),
          has_mood:             prompt.includes('MOOD: tense'),
          // 布局
          has_n_panels:         prompt.includes(`${layoutSpec.n} panels`),
          has_grid_layout:      prompt.includes(`${layout} grid`),
          // 锚定词
          has_composite_anchor: /single composite image/i.test(prompt),
          has_grid_anchor:      /grid layout/i.test(prompt),
          has_consistency:      /consistent|consistency/i.test(prompt),
          // 子类型独有
          has_subtype_marker:   SUBTYPE_MARKERS[subType].test(prompt),
          // 互斥（其他 3 个子类型的标识词不应出现）
          mutex_ok: subTypes.filter(s => s !== subType)
                            .every(otherSub => !SUBTYPE_MARKERS[otherSub].test(prompt)),
        }

        const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k)
        results.push({
          subType, layout, n: layoutSpec.n,
          length: prompt.length,
          all_pass: failed.length === 0,
          failed,
        })
      }
    }

    const summary = {
      total: results.length,
      passed: results.filter(r => r.all_pass).length,
      failed: results.filter(r => !r.all_pass),
      sample_prompt_2x3_action: buildKeyframePrompt({
        subType: 'action-breakdown', layout: '2x3', ...FIXED_VARS,
      }),
    }

    return summary
  })
}
