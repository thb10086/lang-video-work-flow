/**
 * luckinAdE2E.test.ts — TDD RED for Luckin × Erke 1-min ad workflow
 *
 * Drives `executeToolCall('generate_workflow', ...)` with the parameters
 * a real Agent would emit after `classify_image` + `detect_scenario` for
 * the Luckin product photo, and asserts the canvas wiring guarantees the
 * coherence requirements:
 *
 *   1. >= 8 imageGen + >= 8 videoGen (≈60s @ default 6-8s/clip)
 *   2. The product reference image is the ref-in upstream of EVERY imageGen
 *   3. The character "林溪" exists exactly once and is registered as a
 *      character anchor in characterAppearances
 *   4. Shots 1-2 (product-only) do NOT carry character asset refs
 *   5. Shots 3-8 (with character) DO carry character asset refs
 *   6. styleLock fans out to every imageGen via style-out → style-in
 *   7. videoStitch collects every videoGen via video-out → video-in
 *   8. videoGen first-frame is wired from each shot's imageGen
 *
 * Some assertions are expected to RED initially because the current
 * `generate_workflow` schema has neither a `productImage` parameter nor
 * a `shotsWithCharacters` parameter. Those gaps will be filled in GREEN.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/env', () => ({
  ENV: {
    BACKEND_ENABLED: false,
    BACKEND_URL: 'http://localhost:8000',
    API_KEY: '', API_BASE_URL: 'https://yunwu.ai',
    VIDEO_CHANNEL_PRIORITY: 'puyo,apimart',
    PUYO_API_KEY: '', PUYO_API_URL: '',
    APIMART_API_KEY: '', APIMART_API_URL: '',
    COS_SECRET_ID: '', COS_SECRET_KEY: '', COS_REGION: 'ap-guangzhou', COS_BUCKET: '',
    DEFAULT_IMAGE_MODEL: '', DEFAULT_VIDEO_MODEL: '', DEFAULT_LLM_MODEL: '',
    DEFAULT_VIDEO_DURATION: 8, DEFAULT_ASPECT_RATIO: '16:9',
    DEFAULT_IMAGE_SIZE: '2k', DEFAULT_IMAGE_ASPECT_RATIO: '16:9',
    POLL_INTERVAL: 5000, TASK_MAX_CONCURRENT: 1, TASK_MAX_RETRIES: 3,
    TASK_RETRY_DELAYS: [3000, 8000, 15000],
    AGENT_MAX_TOOL_ROUNDS: 25, AGENT_TEMPERATURE: 0.3, AGENT_MAX_TOKENS: 4096,
    CONTEXT_COMPACTION_WINDOW: 10, AGENT_REFLECTION_THRESHOLD: 3,
  },
  getEnv: (_name: string, fallback = '') => fallback,
}))

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: vi.fn().mockReturnValue({
      apiKey: 'test-key', defaultLLMModel: 'test-model',
      cosSecretId: '', cosSecretKey: '', cosBucket: '', cosRegion: '',
    }),
  },
}))

vi.mock('@/providers/cosUploader', () => ({
  cosUploader: { ensureUrl: vi.fn().mockResolvedValue(null), upload: vi.fn(), initialize: vi.fn() },
}))

import { useFlowStore } from '@/store/flowStore'
import { executeToolCall } from '@/providers/agentTools'

function reset() {
  useFlowStore.setState({
    nodes: [], edges: [], selectedNodeId: null,
    _history: [], _historyIndex: -1, _clipboard: null,
    characterAppearances: {},
  })
}

// Standin for the Luckin product photo. In the real run-luckin-ad-e2e.ts
// script this is `image/1778657723_f411dd72.png` uploaded to COS as a URL.
// For the unit test we keep it as an opaque string so equality checks are
// robust without needing real image bytes.
const PRODUCT_IMAGE = 'https://example.cos.com/luckin-erke-iced-latte.png'

const CHARACTER_NAME = '林溪'
const CHARACTER_DESC =
  '25-year-old Asian female, shoulder-length straight black hair, thin metal-frame round glasses, beige trench coat, blue jeans, white sneakers'

// Shot 1-2 are product-only; shots 3-8 include 林溪. This mirrors the
// real script the Agent would emit after parsing the user request.
const PRODUCT_ONLY_SHOTS = [1, 2]
const WITH_CHARACTER_SHOTS = [3, 4, 5, 6, 7, 8]

const SHOT_PROMPTS = [
  // 1. product hero
  'Luckin Erke iced latte hero shot. Translucent plastic cup with deer-head logo + red runner stir-stick figurine. Soft cream foam top. Studio natural light, white background, vase + books on the side. Cinematic, ultra-detailed, 8K commercial photography.',
  // 2. on the cafe bar (still product-only)
  'Same Luckin Erke iced latte sitting on a wood cafe bar. Background: blurred Luckin counter with subtle deer-head logo on a blue tile wall. Warm afternoon natural light from a side window. No people in frame.',
  // 3. character enters cafe (wide)
  '@林溪 pushes open the glass door of a Luckin Coffee shop, viewed from inside. Wide cinematic shot. Warm afternoon light streaming in from outside. Asian commercial aesthetic.',
  // 4. character at self-order kiosk
  '@林溪 stands at the Luckin self-order kiosk, scanning her phone QR code. Same Luckin Erke iced latte sits on the counter beside her. Mid shot, eye-level.',
  // 5. character sips at window seat
  '@林溪 sits at a wooden window-side table, both hands cradling the Luckin Erke iced latte. Soft smile. Afternoon natural light from the side. Close-up.',
  // 6. character takes a sip
  '@林溪 slowly tilts her head, taking a sip from the Luckin Erke iced latte through the red runner stirrer. Eyes closed in enjoyment. Tight close-up.',
  // 7. character outside, sunset
  '@林溪 stands on the street outside the Luckin shop, holding the iced latte up to the camera against a soft sunset cityscape. Half-body, side-back lit silhouette.',
  // 8. logo end card
  'Final logo card. The Luckin Erke iced latte sits on a clean light surface. Luckin deer-head logo + Erke runner mascot side by side. Tagline area at the bottom. Clean studio composition.',
]

describe('Luckin Ad E2E — TDD coherence contract', () => {
  beforeEach(reset)

  it('GAP-1: generate_workflow accepts a productImage parameter (RED until implemented)', async () => {
    const res = await executeToolCall('generate_workflow', {
      title: '瑞幸×鸿星尔克 联名冰拿铁广告',
      description: '60-second product ad with 林溪 enjoying the limited-edition Luckin Erke iced latte across a Beijing afternoon.',
      scenario: 'product_ad',
      productImage: PRODUCT_IMAGE,
      characterNames: [CHARACTER_NAME],
      characterDescriptions: [CHARACTER_DESC],
      shotCount: 8,
      shotPrompts: SHOT_PROMPTS,
      productOnlyShots: PRODUCT_ONLY_SHOTS,
      styleDescription: 'Cinematic Asian commercial aesthetic, warm afternoon natural light, shallow depth of field, brand-consistent palette',
    })
    expect(res.success).toBe(true)
    // After GREEN, the success message should mention the product anchor
    // so a downstream Agent / human can verify the wiring took effect.
    expect(res.message).toMatch(/产品|product/i)
  })

  it('GAP-2: every imageGen has the productImage as a referenceImage', async () => {
    await executeToolCall('generate_workflow', {
      title: '瑞幸广告', description: '60s product ad',
      scenario: 'product_ad',
      productImage: PRODUCT_IMAGE,
      characterNames: [CHARACTER_NAME],
      characterDescriptions: [CHARACTER_DESC],
      shotCount: 8, shotPrompts: SHOT_PROMPTS,
      productOnlyShots: PRODUCT_ONLY_SHOTS,
    })
    const { nodes } = useFlowStore.getState()
    const imageGens = nodes.filter(n => n.type === 'imageGen')
    expect(imageGens.length).toBeGreaterThanOrEqual(8)
    for (const ig of imageGens) {
      const refs = (ig.data.referenceImages as string[] | undefined) || []
      const single = ig.data.referenceImage as string | undefined
      const has = refs.includes(PRODUCT_IMAGE) || single === PRODUCT_IMAGE
      expect(has, `imageGen "${ig.data.label}" missing product anchor`).toBe(true)
    }
  })

  it('character is created exactly once and registered in characterAppearances', async () => {
    await executeToolCall('generate_workflow', {
      title: '瑞幸广告', description: '60s product ad',
      scenario: 'product_ad',
      productImage: PRODUCT_IMAGE,
      characterNames: [CHARACTER_NAME],
      characterDescriptions: [CHARACTER_DESC],
      shotCount: 8, shotPrompts: SHOT_PROMPTS,
      productOnlyShots: PRODUCT_ONLY_SHOTS,
    })
    const state = useFlowStore.getState()
    const charNodes = state.nodes.filter(
      n => n.type === 'characterGrid' || n.type === 'characterAsset',
    )
    expect(charNodes).toHaveLength(1)
    expect(charNodes[0].data.name).toBe(CHARACTER_NAME)
    expect(state.characterAppearances[CHARACTER_NAME]).toBe(CHARACTER_DESC)
  })

  it('GAP-3: shots 1-2 (product-only) do NOT carry the character asset ref', async () => {
    await executeToolCall('generate_workflow', {
      title: '瑞幸广告', description: '60s product ad',
      scenario: 'product_ad',
      productImage: PRODUCT_IMAGE,
      characterNames: [CHARACTER_NAME],
      characterDescriptions: [CHARACTER_DESC],
      shotCount: 8, shotPrompts: SHOT_PROMPTS,
      productOnlyShots: PRODUCT_ONLY_SHOTS,
    })
    const { nodes, edges } = useFlowStore.getState()
    const charNode = nodes.find(
      n => n.type === 'characterGrid' || n.type === 'characterAsset',
    )!
    const charAssetId = String(charNode.data.assetId || '')
    expect(charAssetId).toMatch(/^char_/)

    const imageGens = nodes
      .filter(n => n.type === 'imageGen')
      .sort((a, b) => a.position.y - b.position.y)

    for (const idx of PRODUCT_ONLY_SHOTS) {
      const ig = imageGens[idx - 1]
      expect(ig, `shot ${idx} imageGen missing`).toBeDefined()

      // (a) assetRefs must NOT include the character asset
      const refs = (ig.data.assetRefs as string[] | undefined) || []
      expect(refs, `shot ${idx} should not have character ref`).not.toContain(charAssetId)

      // (b) and there must be NO incoming edge from the characterGrid node
      const fromCharEdge = edges.find(
        e => e.source === charNode.id && e.target === ig.id,
      )
      expect(fromCharEdge, `shot ${idx} should not be wired to character node`).toBeUndefined()
    }
  })

  it('shots 3-8 (with character) DO carry the character asset ref AND wire from characterGrid', async () => {
    await executeToolCall('generate_workflow', {
      title: '瑞幸广告', description: '60s product ad',
      scenario: 'product_ad',
      productImage: PRODUCT_IMAGE,
      characterNames: [CHARACTER_NAME],
      characterDescriptions: [CHARACTER_DESC],
      shotCount: 8, shotPrompts: SHOT_PROMPTS,
      productOnlyShots: PRODUCT_ONLY_SHOTS,
    })
    const { nodes, edges } = useFlowStore.getState()
    const charNode = nodes.find(
      n => n.type === 'characterGrid' || n.type === 'characterAsset',
    )!
    const charAssetId = String(charNode.data.assetId || '')
    const imageGens = nodes
      .filter(n => n.type === 'imageGen')
      .sort((a, b) => a.position.y - b.position.y)

    for (const idx of WITH_CHARACTER_SHOTS) {
      const ig = imageGens[idx - 1]
      expect(ig, `shot ${idx} imageGen missing`).toBeDefined()

      const refs = (ig.data.assetRefs as string[] | undefined) || []
      expect(refs, `shot ${idx} should reference character asset`).toContain(charAssetId)

      const fromCharEdge = edges.find(
        e => e.source === charNode.id && e.target === ig.id,
      )
      expect(fromCharEdge, `shot ${idx} should be wired from character node`).toBeDefined()
    }
  })

  it('styleLock fans out to every imageGen', async () => {
    await executeToolCall('generate_workflow', {
      title: '瑞幸广告', description: '60s product ad',
      scenario: 'product_ad',
      productImage: PRODUCT_IMAGE,
      characterNames: [CHARACTER_NAME],
      characterDescriptions: [CHARACTER_DESC],
      shotCount: 8, shotPrompts: SHOT_PROMPTS,
      productOnlyShots: PRODUCT_ONLY_SHOTS,
      styleDescription: 'Cinematic Asian commercial aesthetic, warm afternoon natural light',
    })
    const { nodes, edges } = useFlowStore.getState()
    const styleLock = nodes.find(n => n.type === 'styleLock')
    expect(styleLock).toBeDefined()
    const imageGens = nodes.filter(n => n.type === 'imageGen')
    for (const ig of imageGens) {
      const e = edges.find(
        ed => ed.source === styleLock!.id && ed.target === ig.id && ed.targetHandle === 'style-in',
      )
      expect(e, `imageGen "${ig.data.label}" missing style-in from styleLock`).toBeDefined()
    }
  })

  it('videoStitch collects every videoGen', async () => {
    await executeToolCall('generate_workflow', {
      title: '瑞幸广告', description: '60s product ad',
      scenario: 'product_ad',
      productImage: PRODUCT_IMAGE,
      characterNames: [CHARACTER_NAME],
      characterDescriptions: [CHARACTER_DESC],
      shotCount: 8, shotPrompts: SHOT_PROMPTS,
      productOnlyShots: PRODUCT_ONLY_SHOTS,
    })
    const { nodes, edges } = useFlowStore.getState()
    const stitch = nodes.find(n => n.type === 'videoStitch')
    expect(stitch).toBeDefined()
    const videoGens = nodes.filter(n => n.type === 'videoGen')
    expect(videoGens.length).toBeGreaterThanOrEqual(8)
    for (const v of videoGens) {
      const e = edges.find(
        ed => ed.source === v.id && ed.target === stitch!.id && ed.targetHandle === 'video-in',
      )
      expect(e, `videoGen "${v.data.label}" not wired to stitch`).toBeDefined()
    }
  })

  it('every videoGen has first-frame wired from its paired imageGen', async () => {
    await executeToolCall('generate_workflow', {
      title: '瑞幸广告', description: '60s product ad',
      scenario: 'product_ad',
      productImage: PRODUCT_IMAGE,
      characterNames: [CHARACTER_NAME],
      characterDescriptions: [CHARACTER_DESC],
      shotCount: 8, shotPrompts: SHOT_PROMPTS,
      productOnlyShots: PRODUCT_ONLY_SHOTS,
    })
    const { edges } = useFlowStore.getState()
    const firstFrameEdges = edges.filter(e => e.targetHandle === 'first-frame')
    expect(firstFrameEdges.length).toBeGreaterThanOrEqual(8)
  })

  it('GAP-4 (RED→GREEN): generate_workflow defaults to replacing the canvas, not appending', async () => {
    // 1st call seeds 19 nodes
    await executeToolCall('generate_workflow', {
      title: '瑞幸广告 v1', description: '60s product ad v1',
      scenario: 'product_ad',
      productImage: PRODUCT_IMAGE,
      characterNames: [CHARACTER_NAME],
      characterDescriptions: [CHARACTER_DESC],
      shotCount: 8, shotPrompts: SHOT_PROMPTS,
      productOnlyShots: PRODUCT_ONLY_SHOTS,
    })
    const firstCount = useFlowStore.getState().nodes.length
    expect(firstCount).toBeGreaterThan(0)

    // 2nd call must REPLACE not append. Total node count must equal v2's
    // own footprint, not firstCount + v2 footprint.
    await executeToolCall('generate_workflow', {
      title: '瑞幸广告 v2', description: '60s product ad v2 with stronger anchors',
      scenario: 'product_ad',
      productImage: PRODUCT_IMAGE,
      characterNames: [CHARACTER_NAME],
      characterDescriptions: [CHARACTER_DESC],
      shotCount: 8, shotPrompts: SHOT_PROMPTS,
      productOnlyShots: PRODUCT_ONLY_SHOTS,
    })
    const secondCount = useFlowStore.getState().nodes.length
    expect(secondCount, 'replace mode: 2nd call must NOT double the canvas').toBe(firstCount)
  })

  // ── GAP-5 (RED): video prompts must not lead with a 200-token character
  // appearance paragraph. The builder should strip such a leading appearance
  // sentence (the imageGen first-frame and the auto-injected character anchor
  // already carry identity) so the model gives weight to the action verbs.
  it('GAP-5: video prompts are normalized to action-first (appearance prefix stripped)', async () => {
    const APPEARANCE_PREFIX =
      `${CHARACTER_NAME} is a 25-year-old Asian female with shoulder-length straight black hair, ` +
      'thin metal-frame round glasses, a beige trench coat, blue jeans, white sneakers, ' +
      'and a slim gold watch on her left wrist. '

    const RAW_VIDEO_PROMPTS = SHOT_PROMPTS.map((sp, i) => {
      const camera = ['subtle push-in', 'slow horizontal pan', 'locked-off with parallax'][i % 3]
      const action = sp
      return `${APPEARANCE_PREFIX}Camera: ${camera}. Action: ${action} Keep identity, props and brand readability consistent. Avoid: warped fingers, face distortion, logo flicker, frame stutter.`
    })

    await executeToolCall('generate_workflow', {
      title: '瑞幸广告', description: '60s product ad',
      scenario: 'product_ad',
      productImage: PRODUCT_IMAGE,
      characterNames: [CHARACTER_NAME],
      characterDescriptions: [CHARACTER_DESC],
      shotCount: 8,
      shotPrompts: SHOT_PROMPTS,
      videoPrompts: RAW_VIDEO_PROMPTS,
      productOnlyShots: PRODUCT_ONLY_SHOTS,
    })

    const videoGens = useFlowStore.getState().nodes.filter(n => n.type === 'videoGen')
    expect(videoGens.length).toBeGreaterThanOrEqual(8)

    for (const vg of videoGens) {
      const prompt = String(vg.data.prompt || '')
      // The appearance prefix must be stripped — Sora / VEO should see action
      // verbs first, not a wall of identity description.
      expect(prompt, `videoGen "${vg.data.label}" still leads with character appearance`)
        .not.toMatch(/^[^.]*shoulder-length straight black hair/i)
      // Action-first: prompt should start with Camera: or Action: directive.
      expect(prompt.trim(), `videoGen "${vg.data.label}" should start with Camera: or Action:`)
        .toMatch(/^(Camera|Action):/i)
    }
  })

  it('GAP-4: generate_workflow with replaceCanvas=false explicitly appends', async () => {
    await executeToolCall('generate_workflow', {
      title: '瑞幸广告 v1', description: '60s product ad v1',
      scenario: 'product_ad',
      productImage: PRODUCT_IMAGE,
      characterNames: [CHARACTER_NAME],
      characterDescriptions: [CHARACTER_DESC],
      shotCount: 8, shotPrompts: SHOT_PROMPTS,
      productOnlyShots: PRODUCT_ONLY_SHOTS,
    })
    const firstCount = useFlowStore.getState().nodes.length

    await executeToolCall('generate_workflow', {
      title: '瑞幸广告 v2', description: '60s product ad v2',
      scenario: 'product_ad',
      productImage: PRODUCT_IMAGE,
      characterNames: [CHARACTER_NAME],
      characterDescriptions: [CHARACTER_DESC],
      shotCount: 8, shotPrompts: SHOT_PROMPTS,
      productOnlyShots: PRODUCT_ONLY_SHOTS,
      replaceCanvas: false,
    })
    const secondCount = useFlowStore.getState().nodes.length
    expect(secondCount, 'append mode: explicit opt-in must add on top of v1').toBe(firstCount * 2)
  })
})
