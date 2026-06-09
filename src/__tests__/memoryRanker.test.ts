/**
 * memoryRanker.test.ts — rankMemories relevance scoring 测试
 */

import { describe, it, expect } from 'vitest'
import { rankMemories, type MemoryEntry } from '@/store/agentMemoryStore'

const NOW = Date.now()

function mem(overrides: Partial<MemoryEntry> & { title: string; tags: string[] }): MemoryEntry {
  return {
    id: `mem-${overrides.title}`,
    type: 'project_preference',
    title: overrides.title,
    content: overrides.content || '',
    tags: overrides.tags,
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
    lastAccessedAt: overrides.lastAccessedAt ?? NOW,
    scope: overrides.scope ?? 'global',
    pinned: overrides.pinned,
  }
}

describe('rankMemories: tag overlap scoring', () => {
  it('ranks entries with matching tags higher', () => {
    const memories = [
      mem({ title: 'Style warm', tags: ['style', 'warm'] }),
      mem({ title: 'Character hero', tags: ['character', 'hero'] }),
      mem({ title: 'Plot twist', tags: ['plot'] }),
    ]
    const ranked = rankMemories('warm style', memories, { now: NOW })
    expect(ranked[0].title).toBe('Style warm')
  })

  it('returns up to k entries', () => {
    const memories = Array.from({ length: 10 }, (_, i) =>
      mem({ title: `M${i}`, tags: [`tag${i}`] })
    )
    const ranked = rankMemories('tag0 tag1 tag2', memories, { k: 3, now: NOW })
    expect(ranked.length).toBeLessThanOrEqual(3)
  })
})

describe('rankMemories: recency half-life', () => {
  it('recent entries score higher than old ones (same tags)', () => {
    const recent = mem({ title: 'Recent', tags: ['style'], updatedAt: NOW, lastAccessedAt: NOW })
    const old = mem({ title: 'Old', tags: ['style'], updatedAt: NOW - 30 * 86400_000, lastAccessedAt: NOW - 30 * 86400_000 })
    const ranked = rankMemories('style', [old, recent], { now: NOW })
    expect(ranked[0].title).toBe('Recent')
  })
})

describe('rankMemories: pinned boost', () => {
  it('pinned entries always appear first regardless of tag match', () => {
    const pinned = mem({ title: 'Pinned', tags: [], pinned: true })
    const matched = mem({ title: 'Matched', tags: ['query', 'keyword'] })
    const ranked = rankMemories('query keyword', [matched, pinned], { now: NOW })
    expect(ranked[0].title).toBe('Pinned')
  })

  it('multiple pinned entries are all included', () => {
    const p1 = mem({ title: 'Pin1', tags: [], pinned: true })
    const p2 = mem({ title: 'Pin2', tags: [], pinned: true })
    const normal = mem({ title: 'Normal', tags: ['x'] })
    const ranked = rankMemories('x', [normal, p1, p2], { k: 5, now: NOW })
    const pinnedResults = ranked.filter(m => m.pinned)
    expect(pinnedResults.length).toBe(2)
  })
})

describe('rankMemories: title token overlap', () => {
  it('title keywords boost scoring', () => {
    const m1 = mem({ title: '角色设定 赵四', tags: [] })
    const m2 = mem({ title: '风景参考', tags: [] })
    const ranked = rankMemories('赵四 角色', [m2, m1], { now: NOW })
    expect(ranked[0].title).toContain('赵四')
  })
})

describe('rankMemories: empty message', () => {
  it('returns entries with only recency score > 0.2 threshold', () => {
    const recent = mem({ title: 'Recent', tags: [], lastAccessedAt: NOW })
    const ancient = mem({ title: 'Ancient', tags: [], lastAccessedAt: NOW - 365 * 86400_000, updatedAt: NOW - 365 * 86400_000 })
    const ranked = rankMemories('', [recent, ancient], { k: 10, now: NOW })
    // Recent should be included (recency ~1.0); ancient might be filtered out
    expect(ranked.some(m => m.title === 'Recent')).toBe(true)
  })
})
