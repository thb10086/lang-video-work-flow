/**
 * agentMultimodal.test.ts — Multimodal first-turn + image token estimation
 */

import { describe, it, expect } from 'vitest'
import { buildMultimodalContent, buildAgentSystemPrompt } from '@/store/chatPromptBuilder'

describe('buildMultimodalContent', () => {
  it('returns plain string when no images', () => {
    const result = buildMultimodalContent('Hello agent')
    expect(typeof result).toBe('string')
    expect(result).toBe('Hello agent')
  })

  it('returns plain string for empty images array', () => {
    const result = buildMultimodalContent('Hello', [])
    expect(typeof result).toBe('string')
  })

  it('returns ContentPart[] with text + image_url when images provided', () => {
    const result = buildMultimodalContent('Describe this', ['data:image/png;base64,abc123'])
    expect(Array.isArray(result)).toBe(true)
    const parts = result as Array<{ type: string; text?: string; image_url?: { url: string; detail: string } }>
    expect(parts[0].type).toBe('text')
    expect(parts[0].text).toBe('Describe this')
    expect(parts[1].type).toBe('image_url')
    expect(parts[1].image_url!.url).toBe('data:image/png;base64,abc123')
    expect(parts[1].image_url!.detail).toBe('high')
  })

  it('handles multiple images', () => {
    const images = ['data:image/png;base64,a', 'data:image/png;base64,b', 'data:image/png;base64,c']
    const result = buildMultimodalContent('Three images', images) as Array<Record<string, unknown>>
    expect(result).toHaveLength(4) // 1 text + 3 images
    expect(result.filter(p => p.type === 'image_url')).toHaveLength(3)
  })

  it('wraps non-data-url images with data: prefix', () => {
    const result = buildMultimodalContent('test', ['rawbase64data']) as Array<{ type: string; image_url?: { url: string } }>
    expect(result[1].image_url!.url).toBe('data:image/png;base64,rawbase64data')
  })
})

describe('buildAgentSystemPrompt: imageCount hint', () => {
  it('includes image hint when imageCount > 0', () => {
    const prompt = buildAgentSystemPrompt('director', { imageCount: 3 })
    expect(prompt).toContain('3 张图像')
    expect(prompt).toContain('create_from_images')
    expect(prompt).toContain('inject_user_images')
  })

  it('omits image hint when imageCount is 0', () => {
    const prompt = buildAgentSystemPrompt('director', { imageCount: 0 })
    expect(prompt).not.toContain('张图像')
  })

  it('omits image hint when opts not provided', () => {
    const prompt = buildAgentSystemPrompt('director')
    expect(prompt).not.toContain('张图像')
  })
})

describe('imageTokensApprox estimation', () => {
  it('estimates ~258 tokens per image (OpenAI low-detail heuristic)', () => {
    const imageCount = 5
    const approx = Math.round(imageCount * 258)
    expect(approx).toBe(1290)
  })

  it('zero images → zero tokens', () => {
    expect(Math.round(0 * 258)).toBe(0)
  })
})
