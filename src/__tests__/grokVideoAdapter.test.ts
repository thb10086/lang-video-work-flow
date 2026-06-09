/**
 * grokVideoAdapter — modelReferenceAdapter grok 分支回归测试
 *
 * 覆盖 spec agent-grok-driver "modelReferenceAdapter 把多端口图汇集到 images 数组"
 * 的所有 Scenarios + 7.1 / 7.2 / 7.3。
 */
import { describe, it, expect } from 'vitest'
import { injectVideoReferences } from '@/providers/modelReferenceAdapter'

const SCHEMA = [
  { key: 'seconds', type: 'select', default: '10', options: [{ value: '10', label: '10s' }] },
  { key: 'aspect_ratio', type: 'select', default: '16:9', options: [{ value: '16:9', label: '16:9' }] },
] as const

describe('grok-video-3 / modelReferenceAdapter', () => {
  it('合并 firstFrame + characterRefs + styleRefs 到 images（顺序：existing → ref → character）', () => {
    const result = injectVideoReferences(
      'grok-video-3',
      SCHEMA as any,
      {
        existingImages: ['https://cos/first.png'],
        referenceImages: ['https://cos/character-A.png', 'https://cos/style-1.png'],
        characterUrls: ['https://cos/sora-char-X.png'],
        timestamps: null,
      },
    )
    // 顺序：existing 最优先，然后 reference，最后 characterUrls
    expect(result.images).toEqual([
      'https://cos/first.png',
      'https://cos/character-A.png',
      'https://cos/style-1.png',
    ])
    // 第 4 张（characterUrls）被截断
    expect(result.images).toHaveLength(3)
    expect(result.notes.length).toBeGreaterThan(0)
    expect(result.notes[0]).toMatch(/最多接受 3 张|丢弃 1/)
    // grok 不主动注入 seconds / aspect_ratio（让 schema default 接管）
    expect(result.params).toEqual({})
  })

  it('超过 3 张时按优先级保留前 3（首帧最优先）', () => {
    const result = injectVideoReferences(
      'grok-video-3',
      SCHEMA as any,
      {
        existingImages: ['https://cos/F.png'],
        referenceImages: ['https://cos/A.png', 'https://cos/B.png', 'https://cos/C.png', 'https://cos/D.png'],
        characterUrls: [],
        timestamps: null,
      },
    )
    expect(result.images).toEqual([
      'https://cos/F.png',
      'https://cos/A.png',
      'https://cos/B.png',
    ])
    expect(result.notes.some(n => /丢弃 2/.test(n))).toBe(true)
  })

  it('只有 characterUrls 时也可以使用（grok 不识别 sora character API，把 URL 当 reference）', () => {
    const result = injectVideoReferences(
      'grok-video-3',
      SCHEMA as any,
      {
        existingImages: [],
        referenceImages: [],
        characterUrls: ['https://cos/sora-1.png', 'https://cos/sora-2.png'],
        timestamps: '1,3',
      },
    )
    // grok 把 character URL 当普通 reference 图（不像 sora 用 character_url 字段）
    expect(result.images).toEqual([
      'https://cos/sora-1.png',
      'https://cos/sora-2.png',
    ])
    // 不应出现 characterUrl / characterTimestamps（这俩是 sora 字段）
    expect(result.params).not.toHaveProperty('characterUrl')
    expect(result.params).not.toHaveProperty('characterTimestamps')
  })

  it('去重：相同 URL 在 existing / reference / characterUrls 多次出现只保留一次', () => {
    const sameUrl = 'https://cos/dup.png'
    const result = injectVideoReferences(
      'grok-video-3',
      SCHEMA as any,
      {
        existingImages: [sameUrl],
        referenceImages: [sameUrl, 'https://cos/extra.png'],
        characterUrls: [sameUrl],
        timestamps: null,
      },
    )
    expect(result.images).toEqual([sameUrl, 'https://cos/extra.png'])
  })

  it('空输入时返回空 images（grok 也支持文生视频，不强制要图）', () => {
    const result = injectVideoReferences(
      'grok-video-3',
      SCHEMA as any,
      {
        existingImages: [],
        referenceImages: [],
        characterUrls: [],
        timestamps: null,
      },
    )
    expect(result.images).toEqual([])
    expect(result.notes).toEqual([])
  })

  it('detectVideoStrategy 把 grok-video-3 路由到 grok 分支（不是 fallback）', () => {
    // 间接测试：grok 应该接受 3 张图，fallback 限制 2 张
    const result = injectVideoReferences(
      'grok-video-3',
      SCHEMA as any,
      {
        existingImages: ['https://cos/1.png'],
        referenceImages: ['https://cos/2.png', 'https://cos/3.png'],
        characterUrls: [],
        timestamps: null,
      },
    )
    // 如果走 fallback（slots = 2 - 1 = 1），结果是 2 张；走 grok 是 3 张
    expect(result.images).toHaveLength(3)
  })
})
