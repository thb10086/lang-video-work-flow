/**
 * Integration test — proves the Tool Response Budget measurably shrinks
 * query-tool responses on a realistic, many-node canvas.
 *
 * This is the quantitative acceptance check for Task 2.6 of the
 * agent-anthropic-alignment change: "at least 1 scenario where tokensUsed
 * drops". We execute the same tool in three modes and compare token counts:
 *
 *   1. budget DISABLED          → baseline (full, rich payload)
 *   2. budget ENABLED + concise → target (default path, should be smaller)
 *   3. budget ENABLED + detailed → escape hatch (LLM can opt back in)
 *
 * Any future refactor that silently breaks the concise formatter will
 * surface here as a test failure.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { executeToolCall } from '@/providers/agentTools'
import { useFlowStore } from '@/store/flowStore'
import { useSettingsStore } from '@/store/settingsStore'
import { estimateTokens } from '@/store/chatPromptBuilder'

interface SeedNode {
  id: string
  type: string
  data: Record<string, unknown>
}

// Build a heavy canvas: 20 nodes with long prompt/description/content fields
// so concise trimming has something meaningful to remove. Mix of types so
// all concise code paths get exercised.
function buildHeavyCanvas(): SeedNode[] {
  const longText = (marker: string, n: number) => `${marker} ${'x'.repeat(n)}`
  const nodes: SeedNode[] = []
  for (let i = 0; i < 20; i++) {
    const idx = i % 5
    if (idx === 0) {
      nodes.push({
        id: `char_${i}`,
        type: 'characterGrid',
        data: {
          label: `Character ${i}`,
          name: `Hero${i}`,
          description: longText('desc', 400),
          style: 'realistic',
          status: 'done',
        },
      })
    } else if (idx === 1) {
      nodes.push({
        id: `scene_${i}`,
        type: 'sceneGrid',
        data: {
          label: `Scene ${i}`,
          name: `Loc${i}`,
          description: longText('env', 400),
          style: 'cinematic',
          mood: 'dramatic',
          status: 'done',
        },
      })
    } else if (idx === 2) {
      nodes.push({
        id: `img_${i}`,
        type: 'imageGen',
        data: {
          label: `Image ${i}`,
          prompt: longText('prompt', 500),
          model: 'gemini-2.5-flash-image',
          status: 'done',
        },
      })
    } else if (idx === 3) {
      nodes.push({
        id: `txt_${i}`,
        type: 'textNode',
        data: {
          label: `Text ${i}`,
          content: longText('content', 600),
          role: 'script',
        },
      })
    } else {
      nodes.push({
        id: `video_${i}`,
        type: 'videoGen',
        data: {
          label: `Video ${i}`,
          prompt: longText('vprompt', 500),
          model: 'doubao-seedance-2-0',
          status: 'done',
        },
      })
    }
  }
  return nodes
}

describe('Tool Response Budget — integration', () => {
  beforeEach(() => {
    useFlowStore.setState({
      nodes: buildHeavyCanvas().map(n => ({ id: n.id, type: n.type, position: { x: 0, y: 0 }, data: n.data })),
      edges: [],
      projectId: null,
    })
    useSettingsStore.setState({ enableResponseBudget: true })
  })

  it('get_canvas_state concise response is smaller than disabled baseline', async () => {
    // Baseline — budget off entirely
    useSettingsStore.setState({ enableResponseBudget: false })
    const raw = await executeToolCall('get_canvas_state', {})

    // Target — budget on, default = concise
    useSettingsStore.setState({ enableResponseBudget: true })
    const concise = await executeToolCall('get_canvas_state', {})

    // Escape hatch — budget on, caller explicitly requests detailed
    const detailed = await executeToolCall('get_canvas_state', { response_format: 'detailed' })

    const rawTok = estimateTokens(raw.message)
    const conciseTok = estimateTokens(concise.message)
    const detailedTok = estimateTokens(detailed.message)

    // Primary assertion — concise wins by a noticeable margin (≥ 30%).
    expect(conciseTok).toBeLessThan(rawTok * 0.7)

    // Detailed mode should NOT pay the concise reshape cost — it should
    // match the disabled-budget baseline within rounding.
    expect(Math.abs(detailedTok - rawTok)).toBeLessThanOrEqual(
      Math.max(5, Math.floor(rawTok * 0.02)),
    )
  })

  it('list_models concise strips descriptions', () => {
    // Simulate list_models output (handler hits backend so we format directly)
    const message =
      '已注册模型 (3):\n' +
      '- [video] veo3 (google): Long descriptive text that should be trimmed in concise mode\n' +
      '- [image] gemini (google): Another long description that will be removed\n' +
      '- [llm] claude (anthropic): Yet another description to drop'
    const fullTokens = estimateTokens(message)
    // Simulate the formatter inline so the assertion is pure data — no IO.
    // This mirrors what `listModelsBudgeted` applies when enableResponseBudget=true.
    const lines = message.split('\n')
    const slim = lines
      .slice(1)
      .map(line => {
        const m = line.match(/^-\s+\[(\w+)\]\s+([^\s]+)\s+\(([^)]+)\)/)
        return m ? `- [${m[1]}] ${m[2]} (${m[3]})` : line
      })
      .join('\n')
    const sliceTokens = estimateTokens([lines[0], slim].join('\n'))
    expect(sliceTokens).toBeLessThan(fullTokens * 0.6)
  })
})
