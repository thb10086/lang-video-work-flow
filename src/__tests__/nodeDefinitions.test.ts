/**
 * nodeDefinitions 单元测试
 *
 * 覆盖：NODE_REGISTRY 完整性、getNodeDef、renderNodeIcon、NODE_CATEGORIES
 */

import { describe, it, expect } from 'vitest'
import { NODE_REGISTRY, getNodeDef, renderNodeIcon, NODE_CATEGORIES } from '@/data/nodeDefinitions'

describe('NODE_REGISTRY', () => {
  it('contains at least 10 node definitions', () => {
    expect(NODE_REGISTRY.length).toBeGreaterThanOrEqual(10)
  })

  it('each definition has required fields', () => {
    for (const def of NODE_REGISTRY) {
      expect(def.type).toBeTruthy()
      expect(def.label).toBeTruthy()
      expect(def.description).toBeTruthy()
      expect(def.icon).toBeDefined()
      expect(['生成', '设计', '工具']).toContain(def.category)
      expect(def.cardColor).toBeTruthy()
      expect(def.keywords.length).toBeGreaterThan(0)
      expect(def.defaultData).toBeDefined()
      expect(def.defaultData.label).toBeTruthy()
    }
  })

  it('has unique types', () => {
    const types = NODE_REGISTRY.map((d) => d.type)
    expect(new Set(types).size).toBe(types.length)
  })

  it('includes core node types', () => {
    const types = NODE_REGISTRY.map((d) => d.type)
    expect(types).toContain('imageGen')
    expect(types).toContain('videoGen')
    expect(types).toContain('textNode')
    expect(types).toContain('characterGrid')
    expect(types).toContain('storyboard')
  })
})

describe('getNodeDef', () => {
  it('returns definition for known type', () => {
    const def = getNodeDef('imageGen')
    expect(def).toBeDefined()
    expect(def!.label).toBe('图片生成')
  })

  it('returns undefined for unknown type', () => {
    expect(getNodeDef('nonExistentType')).toBeUndefined()
  })
})

describe('renderNodeIcon', () => {
  it('returns a React element', () => {
    const el = renderNodeIcon(NODE_REGISTRY[0])
    expect(el).toBeDefined()
    expect(el).toHaveProperty('type')
    expect(el).toHaveProperty('props')
  })

  it('applies custom className', () => {
    const el = renderNodeIcon(NODE_REGISTRY[0], 'w-8 h-8')
    expect(el.props.className).toBe('w-8 h-8')
  })
})

describe('NODE_CATEGORIES', () => {
  it('contains 全部 and all categories from registry', () => {
    expect(NODE_CATEGORIES).toContain('全部')
    const registryCategories = new Set(NODE_REGISTRY.map((d) => d.category))
    for (const cat of registryCategories) {
      expect(NODE_CATEGORIES).toContain(cat)
    }
  })
})
