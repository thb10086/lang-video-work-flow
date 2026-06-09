/**
 * discoverTools.test.ts — 验证 discover_tools 元工具按 spec 行为
 * 符合 spec `agent-tool-tiering` 的 Tool Discovery Self-Service requirement。
 */

import { describe, it, expect } from 'vitest'
import { executeToolCall } from '@/providers/agentTools'

describe('discover_tools meta-tool', () => {
  it('empty query returns a non-empty index across all tiers', async () => {
    const res = await executeToolCall('discover_tools', {})
    expect(res.success).toBe(true)
    expect(res.message).toMatch(/发现 \d+ 个工具/)
    expect(res.message).toMatch(/Tier1=\d+/)
    expect(res.message).toMatch(/Tier2=\d+/)
    expect(res.message).toMatch(/Tier3=\d+/)
  })

  it('query by keyword filters by name/description substring', async () => {
    const res = await executeToolCall('discover_tools', { query: '资产' })
    expect(res.success).toBe(true)
    const msg = String(res.message)
    expect(msg).toMatch(/list_assets|create_asset/)
    // Verify unrelated tools NOT listed by parsing the JSON block
    const jsonMatch = msg.match(/\[[\s\S]*\]/)
    expect(jsonMatch).not.toBeNull()
    const rows = JSON.parse(jsonMatch![0]) as Array<{ name: string }>
    const names = rows.map(r => r.name)
    expect(names.some(n => n.startsWith('list_assets') || n.startsWith('create_asset'))).toBe(true)
    expect(names).not.toContain('generate_workflow')
  })

  it('query tier=3 returns every Tier 3 tool', async () => {
    const res = await executeToolCall('discover_tools', { tier: 3 })
    expect(res.success).toBe(true)
    const rows = JSON.parse(String(res.message).match(/\[[\s\S]*\]/)![0]) as Array<{ name: string; tier: string }>
    for (const r of rows) expect(r.tier).toBe('tier3')
    const names = rows.map(r => r.name)
    expect(names).toContain('save_memory')
    expect(names).toContain('plan_task')
    expect(names).toContain('optimize_prompt')
  })

  it('query tier=1 returns core tools only', async () => {
    const res = await executeToolCall('discover_tools', { tier: 1 })
    expect(res.success).toBe(true)
    const rows = JSON.parse(String(res.message).match(/\[[\s\S]*\]/)![0]) as Array<{ name: string; tier: string }>
    const names = rows.map(r => r.name)
    expect(names).toContain('generate_workflow')
    expect(names).toContain('verify_task')
    expect(names).toContain('discover_tools')
    expect(names).not.toContain('create_video_node')
  })

  it('unmatched query returns success=false with helpful hint', async () => {
    const res = await executeToolCall('discover_tools', { query: 'absolutelyNoSuchToolZZZ' })
    expect(res.success).toBe(false)
    expect(res.message).toMatch(/未找到|tier=/)
  })
})
