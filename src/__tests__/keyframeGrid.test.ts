/**
 * keyframeGrid.test.ts — PoC v0.1 单元测试
 *
 * 覆盖：
 *   1. keyframeSheet 模板：4 个 subType 的 prompt 包含正确关键词
 *   2. KEYFRAME_LAYOUTS 表数据正确
 *   3. buildKeyframePrompt 变量替换正确（含异常值 fallback）
 *   4. executeToolCall('create_keyframe_grid', ...) 工具创建节点
 *      - 各 subType / layout 正确写入 node.data
 *      - invalid 值强制 fallback 到默认
 *      - return message 含格数 + subType
 *   5. portRegistry 注册了 keyframeGrid 的 4 个端口
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useFlowStore } from '@/store/flowStore'
import { executeToolCall } from '@/providers/agentTools'
import {
  buildKeyframePrompt,
  keyframeSheetTemplates,
  KEYFRAME_LAYOUTS,
  SUBTYPE_LABELS,
  type KeyframeSubType,
  type KeyframeLayout,
} from '@/prompts/templates/keyframeSheet'
import { NODE_PORT_REGISTRY } from '@/types/portRegistry'
import { TIER_2_CREATION } from '@/providers/toolTiers'
import { AGENT_TOOLS } from '@/providers/toolDefinitions'

function reset() {
  useFlowStore.setState({
    nodes: [], edges: [], selectedNodeId: null,
    _history: [], _historyIndex: -1, _clipboard: null,
  })
}

// ════════════════════════════════════════════════════════════
// 1. keyframeSheet 模板
// ════════════════════════════════════════════════════════════
describe('keyframeSheet templates', () => {
  it('exposes 4 sub-types with stable IDs', () => {
    const keys = Object.keys(keyframeSheetTemplates).sort()
    expect(keys).toEqual([
      'action-breakdown',
      'multi-camera',
      'scene-evolution',
      'time-progression',
    ])
  })

  it('time-progression template emphasises temporal advance', () => {
    const tpl = keyframeSheetTemplates['time-progression'].template
    expect(tpl).toMatch(/time advances|TIME PROGRESSION/i)
    expect(tpl).toMatch(/consistent|consistency/i)
  })

  it('scene-evolution template emphasises state change', () => {
    const tpl = keyframeSheetTemplates['scene-evolution'].template
    expect(tpl).toMatch(/EVOLUTION|state|atmospheric/i)
  })

  it('action-breakdown template emphasises motion sequence', () => {
    const tpl = keyframeSheetTemplates['action-breakdown'].template
    expect(tpl).toMatch(/ACTION BREAKDOWN|motion arc|pose/i)
  })

  it('multi-camera template emphasises angle variation', () => {
    const tpl = keyframeSheetTemplates['multi-camera'].template
    expect(tpl).toMatch(/MULTI-CAMERA|camera angle|perspective/i)
    expect(tpl).toMatch(/frozen moment|same.*time/i)
  })

  it('all templates declare composite-image + grid layout intent', () => {
    for (const subType of Object.keys(keyframeSheetTemplates) as KeyframeSubType[]) {
      const tpl = keyframeSheetTemplates[subType].template
      expect(tpl).toMatch(/single composite image/i)
      expect(tpl).toMatch(/grid layout/i)
      expect(tpl).toMatch(/Thin .* dividing lines/i)
    }
  })
})

// ════════════════════════════════════════════════════════════
// 2. KEYFRAME_LAYOUTS 表
// ════════════════════════════════════════════════════════════
describe('KEYFRAME_LAYOUTS', () => {
  it('maps 2x2 → 4 panels', () => {
    expect(KEYFRAME_LAYOUTS['2x2']).toEqual({ rows: 2, cols: 2, n: 4, zhLabel: '四宫格' })
  })

  it('maps 2x3 → 6 panels', () => {
    expect(KEYFRAME_LAYOUTS['2x3']).toEqual({ rows: 2, cols: 3, n: 6, zhLabel: '六宫格' })
  })

  it('maps 3x3 → 9 panels', () => {
    expect(KEYFRAME_LAYOUTS['3x3']).toEqual({ rows: 3, cols: 3, n: 9, zhLabel: '九宫格' })
  })

  it('SUBTYPE_LABELS has Chinese label for every subtype', () => {
    expect(SUBTYPE_LABELS['time-progression']).toBe('剧情推演')
    expect(SUBTYPE_LABELS['scene-evolution']).toBe('画面演进')
    expect(SUBTYPE_LABELS['action-breakdown']).toBe('动作分解')
    expect(SUBTYPE_LABELS['multi-camera']).toBe('多机位')
  })
})

// ════════════════════════════════════════════════════════════
// 3. buildKeyframePrompt 变量替换
// ════════════════════════════════════════════════════════════
describe('buildKeyframePrompt', () => {
  it('substitutes shot_name / shot_description / style / mood / n / rows / cols', () => {
    const out = buildKeyframePrompt({
      subType: 'time-progression',
      layout: '2x3',
      shotName: 'shot-test',
      shotDescription: 'A cat jumps over a fence',
      style: 'noir',
      mood: 'tense',
    })
    expect(out).toContain('shot-test')
    expect(out).toContain('A cat jumps over a fence')
    expect(out).toContain('STYLE: noir')
    expect(out).toContain('MOOD: tense')
    expect(out).toContain('6 panels arranged in a 2x3 grid')
  })

  it('falls back to cinematic / dramatic when style/mood missing', () => {
    const out = buildKeyframePrompt({
      subType: 'multi-camera',
      layout: '3x3',
      shotName: 'fight',
      shotDescription: 'epic battle',
    })
    expect(out).toContain('STYLE: cinematic')
    expect(out).toContain('MOOD: dramatic')
    expect(out).toContain('9 panels arranged in a 3x3 grid')
  })

  it('embeds 4-panel hint for 2x2', () => {
    const out = buildKeyframePrompt({
      subType: 'action-breakdown',
      layout: '2x2',
      shotName: 'spin',
      shotDescription: 'character does a 360 turn',
    })
    expect(out).toContain('4 panels arranged in a 2x2 grid')
  })

  it('subType determines instruction body', () => {
    const evolution = buildKeyframePrompt({
      subType: 'scene-evolution', layout: '2x3',
      shotName: 's', shotDescription: 'storm rolls in',
    })
    const action = buildKeyframePrompt({
      subType: 'action-breakdown', layout: '2x3',
      shotName: 's', shotDescription: 'storm rolls in',
    })
    // Two different instruction bodies, but same shot description
    expect(evolution).not.toBe(action)
    expect(evolution).toMatch(/SCENE EVOLUTION/i)
    expect(action).toMatch(/ACTION BREAKDOWN/i)
  })
})

// ════════════════════════════════════════════════════════════
// 4. Agent 工具调度
// ════════════════════════════════════════════════════════════
describe('create_keyframe_grid tool dispatch', () => {
  beforeEach(reset)

  it('creates a keyframeGrid node with correct defaults', async () => {
    const res = await executeToolCall('create_keyframe_grid', {
      shotName: 'shot-1',
      shotDescription: 'character runs through the rain',
      subType: 'time-progression',
    })
    expect(res.success).toBe(true)
    const nodes = useFlowStore.getState().nodes
    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe('keyframeGrid')
    const data = nodes[0].data
    expect(data.shotName).toBe('shot-1')
    expect(data.shotDescription).toBe('character runs through the rain')
    expect(data.subType).toBe('time-progression')
    expect(data.layout).toBe('2x3')          // default
    expect(data.style).toBe('cinematic')     // default
    expect(data.mood).toBe('dramatic')       // default
    expect(data.status).toBe('idle')
    expect(data.outputImage).toBeNull()
  })

  it.each([
    ['time-progression', '2x2', 4],
    ['scene-evolution',  '2x3', 6],
    ['action-breakdown', '3x3', 9],
    ['multi-camera',     '2x2', 4],
  ] as const)('creates node for subType=%s layout=%s (%i panels)', async (subType, layout, n) => {
    const res = await executeToolCall('create_keyframe_grid', {
      shotName: 'shot-x',
      shotDescription: 'desc',
      subType,
      layout,
    })
    expect(res.success).toBe(true)
    expect(res.message).toContain(`${n}格`)
    expect(res.message).toContain(subType)
    const node = useFlowStore.getState().nodes[0]
    expect(node.data.subType).toBe(subType)
    expect(node.data.layout).toBe(layout)
  })

  it('sanitizes invalid subType to default time-progression', async () => {
    await executeToolCall('create_keyframe_grid', {
      shotName: 'shot-x',
      shotDescription: 'desc',
      subType: 'definitely-not-valid',
    })
    expect(useFlowStore.getState().nodes[0].data.subType).toBe('time-progression')
  })

  it('sanitizes invalid layout to default 2x3', async () => {
    await executeToolCall('create_keyframe_grid', {
      shotName: 'shot-x',
      shotDescription: 'desc',
      subType: 'multi-camera',
      layout: '99x99',
    })
    expect(useFlowStore.getState().nodes[0].data.layout).toBe('2x3')
  })

  it('label is auto-prefixed with 分镜:', async () => {
    await executeToolCall('create_keyframe_grid', {
      shotName: '决战',
      shotDescription: '主角与反派对峙',
      subType: 'multi-camera',
    })
    expect(useFlowStore.getState().nodes[0].data.label).toBe('分镜: 决战')
  })

  it('preserves caller-supplied style/mood', async () => {
    await executeToolCall('create_keyframe_grid', {
      shotName: 'shot-x',
      shotDescription: 'desc',
      subType: 'time-progression',
      style: 'anime',
      mood: 'romantic',
    })
    const data = useFlowStore.getState().nodes[0].data
    expect(data.style).toBe('anime')
    expect(data.mood).toBe('romantic')
  })
})

// ════════════════════════════════════════════════════════════
// 5. Prompt quality v0.2 — 显式 PANEL N: blueprint + DIFFERENCE ENFORCEMENT
//    根因：v0.1 抽象指令导致 toapis/gpt-image-2 输出 4-9 个近乎一样的 panel。
//    业界顶尖（Higgsfield Shots / LibTV /storyboard / Midjourney --panels /
//    Sora storyboard）均显式枚举每 panel 内容 + 强制差异。
// ════════════════════════════════════════════════════════════
describe('keyframeSheet v0.2 — explicit per-panel blueprint', () => {
  it('emits numbered PANEL 1..N: blueprint in final prompt', () => {
    const out = buildKeyframePrompt({
      subType: 'multi-camera',
      layout: '2x2',
      shotName: 'product hero',
      shotDescription: 'iced americano cup on rock',
    })
    expect(out).toMatch(/PANEL 1:/)
    expect(out).toMatch(/PANEL 2:/)
    expect(out).toMatch(/PANEL 3:/)
    expect(out).toMatch(/PANEL 4:/)
    expect(out).not.toContain('{{panel_blueprint}}')
  })

  it('emits 9 numbered PANEL lines for 3x3 layout', () => {
    const out = buildKeyframePrompt({
      subType: 'time-progression',
      layout: '3x3',
      shotName: 's',
      shotDescription: 'd',
    })
    for (let i = 1; i <= 9; i++) {
      expect(out).toMatch(new RegExp(`PANEL ${i}:`))
    }
  })

  it('multi-camera blueprint enumerates concrete distinct camera angles', () => {
    const out = buildKeyframePrompt({
      subType: 'multi-camera',
      layout: '3x3',
      shotName: 's',
      shotDescription: 'd',
    })
    // At least three categorically distinct camera vocabularies must appear.
    expect(out).toMatch(/top-down|overhead|90.{0,3} from above/i)
    expect(out).toMatch(/eye-level|front view|frontal/i)
    expect(out).toMatch(/profile|side view/i)
    expect(out).toMatch(/close-?up|macro/i)
  })

  it('action-breakdown blueprint enumerates motion phases', () => {
    const out = buildKeyframePrompt({
      subType: 'action-breakdown',
      layout: '2x3',
      shotName: 's',
      shotDescription: 'd',
    })
    expect(out).toMatch(/preparation|windup|anticipation/i)
    expect(out).toMatch(/peak|apex|maximum extension/i)
    expect(out).toMatch(/follow-?through|settle|recoil|resolution/i)
  })

  it('time-progression blueprint enumerates narrative beats', () => {
    const out = buildKeyframePrompt({
      subType: 'time-progression',
      layout: '2x3',
      shotName: 's',
      shotDescription: 'd',
    })
    expect(out).toMatch(/opening beat|setup|introduce/i)
    expect(out).toMatch(/climax|peak moment|turning point/i)
    expect(out).toMatch(/resolution|aftermath|final|outcome/i)
  })

  it('scene-evolution blueprint enumerates state stages', () => {
    const out = buildKeyframePrompt({
      subType: 'scene-evolution',
      layout: '2x2',
      shotName: 's',
      shotDescription: 'd',
    })
    expect(out).toMatch(/initial state|baseline|untouched|pre-event/i)
    expect(out).toMatch(/peak|climactic|maximum/i)
    expect(out).toMatch(/final state|equilibrium|settled/i)
  })

  it('emits DIFFERENCE ENFORCEMENT block forbidding repeated panels', () => {
    const out = buildKeyframePrompt({
      subType: 'action-breakdown',
      layout: '2x3',
      shotName: 's',
      shotDescription: 'd',
    })
    expect(out).toMatch(/DIFFERENCE ENFORCEMENT/i)
    expect(out).toMatch(/visually[\w\s]{0,30}distinct/i)
    expect(out).toMatch(/forbidden|never|must not.{0,30}repeat|no.{0,20}copy/i)
  })

  it('caller-supplied panelDescriptions override default blueprint exactly', () => {
    const out = buildKeyframePrompt({
      subType: 'time-progression',
      layout: '2x2',
      shotName: 's',
      shotDescription: 'd',
      panelDescriptions: [
        'Custom panel A',
        'Custom panel B',
        'Custom panel C',
        'Custom panel D',
      ],
    })
    expect(out).toMatch(/PANEL 1: Custom panel A/)
    expect(out).toMatch(/PANEL 4: Custom panel D/)
    // Default-blueprint-only keyword (must not bleed in when caller overrides).
    // "Inciting moment" appears ONLY in DEFAULT_BLUEPRINTS, never in the
    // PANEL_INSTRUCTIONS body, so it cleanly indicates blueprint substitution.
    expect(out).not.toMatch(/Inciting moment/i)
  })

  it('ignores panelDescriptions with wrong length and falls back to default', () => {
    const out = buildKeyframePrompt({
      subType: 'multi-camera',
      layout: '2x2',
      shotName: 's',
      shotDescription: 'd',
      panelDescriptions: ['only one'],
    })
    expect(out).not.toMatch(/PANEL 1: only one/)
    expect(out).toMatch(/top-down|overhead/i)
  })

  it('keyframeSheetTemplates still contain {{panel_blueprint}} placeholder', () => {
    // Static template still uses the placeholder; buildKeyframePrompt is what
    // expands it. This protects the renderer contract.
    for (const k of Object.keys(keyframeSheetTemplates) as KeyframeSubType[]) {
      expect(keyframeSheetTemplates[k].template).toContain('{{panel_blueprint}}')
    }
  })

  it('on-image text / number overlays remain forbidden in TECHNICAL footer', () => {
    const out = buildKeyframePrompt({
      subType: 'multi-camera',
      layout: '2x2',
      shotName: 's',
      shotDescription: 'd',
    })
    expect(out).toMatch(/no text/i)
    expect(out).toMatch(/no watermark/i)
  })
})

// ════════════════════════════════════════════════════════════
// 6. portRegistry + Tier registration
// ════════════════════════════════════════════════════════════
describe('keyframeGrid registration', () => {
  it('registers 4 ports on keyframeGrid (prompt-in / ref-in / grid-out / frames-out)', () => {
    const ports = NODE_PORT_REGISTRY['keyframeGrid']
    expect(ports).toBeDefined()
    expect(ports).toHaveLength(4)
    const ids = ports!.map(p => p.id).sort()
    expect(ids).toEqual(['frames-out', 'grid-out', 'prompt-in', 'ref-in'])
  })

  it('is registered in Tier 2 Creation', () => {
    expect(TIER_2_CREATION).toContain('create_keyframe_grid')
  })

  it('is registered in AGENT_TOOLS with required params', () => {
    const tool = AGENT_TOOLS.find(t => t.function.name === 'create_keyframe_grid')
    expect(tool).toBeDefined()
    expect(tool!.function.parameters.required).toEqual([
      'shotName', 'shotDescription', 'subType',
    ])
    const props = tool!.function.parameters.properties as Record<string, { enum?: string[] }>
    expect(props.subType.enum).toEqual([
      'time-progression', 'scene-evolution', 'action-breakdown', 'multi-camera',
    ])
    expect(props.layout.enum).toEqual(['2x2', '2x3', '3x3'])
  })
})
