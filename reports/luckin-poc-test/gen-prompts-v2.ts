/**
 * gen-prompts-v2.ts — 用 keyframeSheet v0.2 重新生成 4 个瑞幸 keyframeGrid prompt
 *
 * Run: npx tsx reports/luckin-poc-test/gen-prompts-v2.ts
 *
 * Inputs frozen to match v0.1 baseline (same shotName / subType / layout /
 * style / mood / shotDescription) so the only delta is the prompt body
 * produced by buildKeyframePrompt.
 *
 * NOTE on shot 4 (成品展示):
 *   v0.1 shotDescription embedded camera angles ("top-down, eye-level front,
 *   45-degree hero, side profile") which v0.1 prompt body did not amplify,
 *   producing 4 near-identical front views. v0.2 moves angle enumeration
 *   into the per-panel blueprint, so shotDescription stays scene-only here
 *   to avoid double-spec and let the blueprint drive panel divergence.
 */
import {
  buildKeyframePrompt,
  KEYFRAME_LAYOUTS,
  type KeyframeSubType,
  type KeyframeLayout,
} from '../../src/prompts/templates/keyframeSheet'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface ShotInput {
  shotName: string
  subType: KeyframeSubType
  layout: KeyframeLayout
  style: string
  mood: string
  shotDescription: string
}

const SHOTS: ShotInput[] = [
  {
    shotName: '点单流程',
    subType: 'time-progression',
    layout: '2x3',
    style: 'cinematic',
    mood: 'peaceful',
    shotDescription:
      'Asian male customer in his 20s wearing white linen shirt, sitting in a modern Luckin Coffee shop, holding smartphone in one hand. Navigates the Luckin app: opens app, browses iced beverages menu, selects Iced Americano, confirms order, sees order confirmation screen, then waits for pickup. Warm interior lighting, blue Luckin deer logo softly visible in background.',
  },
  {
    shotName: '咖啡萃取',
    subType: 'scene-evolution',
    layout: '2x3',
    style: 'cinematic',
    mood: 'dramatic',
    shotDescription:
      'Single brass-fitted commercial espresso machine portafilter extracting a fresh shot of espresso into a heat-resistant clear glass cup. Warm cinematic backlight, shallow depth of field, condensation slowly forming on the glass exterior. Same close-up framing of cup + portafilter spout across all panels.',
  },
  {
    shotName: '拉花动作',
    subType: 'action-breakdown',
    layout: '2x3',
    style: 'realistic',
    mood: 'peaceful',
    shotDescription:
      'Asian male barista in dark apron over black t-shirt, performing latte art on the milk-foam surface of an iced americano in a translucent plastic cup. Steel milk pitcher tilted in his right hand, left hand cradling the cup. Soft natural daylight from a window behind, blurred coffee-bar background. Same camera angle (chest-level, slight 3/4 over the action) and framing across all panels.',
  },
  {
    shotName: '成品展示',
    subType: 'multi-camera',
    layout: '2x2',
    style: 'cinematic',
    mood: 'epic',
    shotDescription:
      'Luckin Iced Americano hero product, frozen at the same instant: a glossy translucent plastic Luckin cup with white deer-head logo, full of dark espresso over crystal-clear ice cubes, condensation droplets on the cup surface, sitting on a dark wet slate stone. Deep navy-blue radial gradient backdrop with subtle volumetric mist. Premium commercial advertising lighting (soft key + cool rim).',
  },
]

const out = SHOTS.map((s, i) => ({
  id: `v2-${Date.now()}-${i}`,
  shotName: s.shotName,
  subType: s.subType,
  layout: s.layout,
  n_panels: KEYFRAME_LAYOUTS[s.layout].n,
  style: s.style,
  mood: s.mood,
  prompt: buildKeyframePrompt(s),
}))

const outFile = join(__dirname, '03-prompts.v2.json')
writeFileSync(
  outFile,
  JSON.stringify({ count: out.length, prompts: out }, null, 2),
  'utf-8',
)

console.log(`Generated ${out.length} v0.2 prompts -> ${outFile}`)
for (const p of out) {
  console.log(
    `  [${p.subType.padEnd(18)}] "${p.shotName}" ${p.layout} (${p.n_panels} panels) - ${p.prompt.length} chars`,
  )
}
