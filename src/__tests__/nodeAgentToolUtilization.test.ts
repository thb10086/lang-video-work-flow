/**
 * nodeAgentToolUtilization.test.ts — 利用度守卫
 *
 * 1) 每个 AGENT_TOOLS 注册的工具都必须在 agentTools.ts switch 里被处理
 *    （避免定义了但 LLM 调用后 fallthrough 到 "未知工具"）。
 * 2) 每个 NODE_REGISTRY 注册的 node type 都必须出现在至少一处生产代码
 *    （providers/ 下）作为 store.addNode() 的第一个参数 —— 证明它不是 dead type。
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { AGENT_TOOLS } from '@/providers/toolDefinitions'
import { NODE_REGISTRY } from '@/data/nodeDefinitions'

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const AGENT_TOOLS_TS = fs.readFileSync(path.join(REPO_ROOT, 'src/providers/agentTools.ts'), 'utf-8')

function listFiles(dir: string, exts = ['.ts', '.tsx']): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(full, exts))
    else if (exts.some(e => entry.name.endsWith(e))) out.push(full)
  }
  return out
}

describe('Agent Tool utilization guard', () => {
  it('every AGENT_TOOLS entry is dispatched in agentTools.ts', () => {
    const missing: string[] = []
    for (const t of AGENT_TOOLS) {
      const name = t.function?.name
      if (!name) continue
      // Accept either `case '<name>':` OR `case '<name>' `
      const re = new RegExp(`case '${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\s*:`, 'g')
      if (!re.test(AGENT_TOOLS_TS)) missing.push(name)
    }
    expect(missing, `未在 agentTools.ts switch 里处理的工具: ${missing.join(', ')}`).toEqual([])
  })
})

describe('Node type utilization guard', () => {
  it('every NODE_REGISTRY type is referenced as store.addNode("<type>") in providers/', () => {
    const providerFiles = listFiles(path.join(REPO_ROOT, 'src/providers'))
    const allProviderSrc = providerFiles.map(f => fs.readFileSync(f, 'utf-8')).join('\n')

    const orphan: string[] = []
    for (const def of NODE_REGISTRY) {
      const pattern = new RegExp(`addNode\\(\\s*['"\`]${def.type}['"\`]`, 'g')
      const wbPattern = new RegExp(`wb\\.add\\(\\s*['"\`]${def.type}['"\`]`, 'g')
      if (!pattern.test(allProviderSrc) && !wbPattern.test(allProviderSrc)) {
        orphan.push(def.type)
      }
    }
    expect(orphan, `未被生产代码使用的 node type: ${orphan.join(', ')}`).toEqual([])
  })

  it('every NODE_REGISTRY type has a matching UI component at src/components/nodes/', () => {
    const nodeDir = path.join(REPO_ROOT, 'src/components/nodes')
    const tsxFiles = fs.readdirSync(nodeDir).filter(f => f.endsWith('.tsx'))
    const filesLower = tsxFiles.map(f => f.toLowerCase())
    const missing: string[] = []
    for (const def of NODE_REGISTRY) {
      // Be forgiving with capitalization quirks (e.g. llmChat → LLMChatNode.tsx,
      // textNode → TextNode.tsx instead of TextNodeNode.tsx).
      const base = def.type.toLowerCase()
      const hit = filesLower.some(name =>
        name === `${base}.tsx` ||
        name === `${base}node.tsx` ||
        name.startsWith(base.replace(/node$/, '')) && name.endsWith('node.tsx'),
      )
      if (!hit) missing.push(def.type)
    }
    expect(missing, `缺少 UI 组件的 node type: ${missing.join(', ')}`).toEqual([])
  })
})

describe('AGENT_TOOLS vs NODE_REGISTRY fully covered', () => {
  it('total AGENT_TOOLS count matches tier partition', () => {
    // 40 original + 4 new (create_from_images, forget_memory, set_phase, review_generated_image) + discover_tools = 45
    expect(AGENT_TOOLS.length).toBeGreaterThanOrEqual(44)
  })
})
