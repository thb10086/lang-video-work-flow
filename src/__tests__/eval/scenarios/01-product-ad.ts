/**
 * Scenario 01 — Product Ad One-Shot
 *
 * User flow: uploads a product image, asks for a short ad. Agent is expected
 * to classify the image, detect the scenario, fire generate_workflow once,
 * then verify.
 *
 * Measures: tool sequence, workflow node fan-out, verify_task score
 */

import {
  roundCall,
  roundCalls,
  roundFinish,
} from '../mockLLM'
import type { Scenario } from '../types'

const scenario: Scenario = {
  id: '01-product-ad',
  name: 'Product Ad One-Shot',
  userMessage:
    '我要做一个 15 秒的护肤品广告，主打补水修护，画面要清新、极简，最后带品牌 logo。',
  userImages: [
    // 1x1 transparent PNG in data-url form (keeps fixture inline)
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
  ],
  expectedToolCalls: ['classify_image', 'detect_scenario', 'generate_workflow', 'verify_task'],
  toolCallOrder: 'ordered',
  budget: {
    maxToolCalls: 8,
    maxTokens: 50_000,
    maxElapsedMs: 5_000,
  },
  mockLLMScript: [
    roundCall('classify_image', { imageIndex: 0 }),
    roundCall('detect_scenario', {
      description: '15 秒护肤品广告，补水修护，清新极简，带 logo',
    }),
    roundCall('generate_workflow', {
      title: '护肤品广告',
      description: '15s 补水修护护肤品广告，清新极简风格，结尾品牌 Logo',
      scenario: 'product_ad',
      characterNames: [],
      characterDescriptions: [],
      sceneNames: ['产品特写', 'Logo 收尾'],
      sceneDescriptions: [
        'Close-up of the skincare bottle on a marble counter with soft natural light, minimalistic aesthetic',
        'Clean white background with brand logo centered',
      ],
      shotCount: 3,
      shotPrompts: [
        'Skincare bottle close-up, soft natural lighting, minimal composition, cinematic 4k',
        'Water droplet hitting skin surface, slow motion, hydration shot, macro lens',
        'Brand logo on clean white background, elegant typography',
      ],
      videoPrompts: [
        'Slow dolly-in on bottle. Natural light. Clean and calm. Cinematic 4K. No morphing.',
        'Macro slow motion of water droplet. Ultra smooth. Cinematic 4K.',
        'Static hold on logo. Clean. 4K.',
      ],
      styleDescription: 'Clean minimalistic skincare commercial, soft natural light, calm atmosphere',
    }),
    roundCall('verify_task', { checkConnections: true }),
    roundFinish('已为护肤品广告创建完整工作流，共 3 个镜头，请确认后执行。'),
  ],
  verifier: ({ canvas, toolLog }) => {
    const issues: string[] = []

    // 1. Expected tool sequence all succeeded
    const calls = new Map(toolLog.map(t => [t.tool, t]))
    for (const t of ['classify_image', 'detect_scenario', 'generate_workflow', 'verify_task']) {
      const rec = calls.get(t)
      if (!rec) issues.push(`Expected tool "${t}" was not called`)
      else if (!rec.success) issues.push(`Tool "${t}" reported failure: ${rec.message.slice(0, 80)}`)
    }

    // 2. Canvas should contain imageGen/videoGen nodes — product_ad builder
    // creates 2 hero imageGen (product shot + lifestyle) + shotCount extra via
    // addShots helper. With shotCount=3 we expect 2+3=5 imageGen total.
    const imageGenCount = canvas.nodes.filter(n => n.type === 'imageGen').length
    const videoGenCount = canvas.nodes.filter(n => n.type === 'videoGen').length
    if (imageGenCount < 2) issues.push(`Expected >=2 imageGen nodes, got ${imageGenCount}`)
    if (videoGenCount < 2) issues.push(`Expected >=2 videoGen nodes, got ${videoGenCount}`)

    // 3. styleLock present
    if (!canvas.nodes.some(n => n.type === 'styleLock')) issues.push('Missing styleLock node')

    // 4. Score: base 100, -15 per issue
    const score = Math.max(0, 100 - issues.length * 15)
    return { passed: issues.length === 0, score, issues }
  },
}

export default scenario
// Silence unused-warn for imports kept for author ergonomics
void roundCalls
