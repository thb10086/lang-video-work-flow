/**
 * Tests for the Vision Verify stack:
 *   - visionVerifyAdapter registry behaviour (register / switch / fallback)
 *   - geminiVisionAdapter response coercion
 *   - toolVisionVerify handler (node resolution + accept/retry/missing paths)
 *   - toolVerify.handleVerifyTask useVisionVerify integration + fallback
 *
 * No real network — we monkey-patch `backendApi.verifyImage` + use the
 * adapter registry directly.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFlowStore } from '@/store/flowStore'
import { useSettingsStore } from '@/store/settingsStore'
import { backendApi, type VerifyImageResponse } from '@/api/backend'
import {
  __resetRegistry,
  DEFAULT_VISION_THRESHOLD,
  VISION_PASS_AVG,
  VISION_SCORE_REWARD_CEILING,
  getActiveVerifier,
  listVerifierIds,
  registerVerifier,
  type VerifyCriteria,
  type VerifyResult,
  type VisionVerifier,
} from '@/providers/visionVerifyAdapter'
import { handleVerifyImageSemantic } from '@/providers/toolVisionVerify'
import { handleVerifyTask } from '@/providers/toolVerify'

// Import the default Gemini adapter so it self-registers. We also fully
// reset the registry between describe blocks to keep tests independent.
import { geminiVisionAdapter } from '@/providers/geminiVisionAdapter'

function resetFlowStore() {
  useFlowStore.setState({ nodes: [], edges: [], projectId: null })
}

function setModel(id: string) {
  useSettingsStore.setState({ visionVerifyModel: id })
}

function reregisterGeminiDefault() {
  // Re-import to force the self-registration to run if __resetRegistry
  // emptied the map. A dynamic re-import gives us a fresh module.
  __resetRegistry()
  registerVerifier({
    id: 'gemini-vision',
    async verify(_url: string, criteria: VerifyCriteria): Promise<VerifyResult> {
      void criteria
      return {
        matchScore: 90,
        detectedSubjects: [],
        missingElements: [],
        unexpectedElements: [],
        recommendation: 'accept',
        reasoning: 'mock',
      }
    },
  })
}

// ============================================================
// Registry tests — Task 4.1 verification
// ============================================================

// ============================================================
// Shared constants (regression for hardcoded-value cleanup)
// ============================================================

describe('visionVerifyAdapter shared constants', () => {
  it('DEFAULT_VISION_THRESHOLD is 70 and within valid range', () => {
    expect(DEFAULT_VISION_THRESHOLD).toBe(70)
    expect(DEFAULT_VISION_THRESHOLD).toBeGreaterThan(0)
    expect(DEFAULT_VISION_THRESHOLD).toBeLessThanOrEqual(100)
  })

  it('VISION_SCORE_REWARD_CEILING is 80 and above default threshold', () => {
    expect(VISION_SCORE_REWARD_CEILING).toBe(80)
    // Ceiling < 100 creates the reward headroom described in the docstring
    expect(VISION_SCORE_REWARD_CEILING).toBeLessThan(100)
    // Must be >= threshold so passing score doesn't rate below full credit
    expect(VISION_SCORE_REWARD_CEILING).toBeGreaterThanOrEqual(DEFAULT_VISION_THRESHOLD)
  })

  it('VISION_PASS_AVG aligns with DEFAULT_VISION_THRESHOLD', () => {
    // Keeping them equal means an average-at-threshold is considered passing.
    expect(VISION_PASS_AVG).toBe(DEFAULT_VISION_THRESHOLD)
  })
})

describe('visionVerifyAdapter registry', () => {
  beforeEach(() => {
    __resetRegistry()
    resetFlowStore()
  })

  it('register + getActiveVerifier returns the declared model', () => {
    const a: VisionVerifier = {
      id: 'gemini-vision',
      verify: async () => ({
        matchScore: 0, detectedSubjects: [], missingElements: [], unexpectedElements: [],
        recommendation: 'retry', reasoning: '',
      }),
    }
    const b: VisionVerifier = { ...a, id: 'gpt5-vision' }
    registerVerifier(a)
    registerVerifier(b)
    setModel('gemini-vision')
    expect(getActiveVerifier().id).toBe('gemini-vision')
    setModel('gpt5-vision')
    expect(getActiveVerifier().id).toBe('gpt5-vision')
  })

  it('unknown model falls back to the first registered adapter', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const first: VisionVerifier = {
      id: 'gemini-vision',
      verify: async () => ({
        matchScore: 0, detectedSubjects: [], missingElements: [], unexpectedElements: [],
        recommendation: 'retry', reasoning: '',
      }),
    }
    registerVerifier(first)
    registerVerifier({ ...first, id: 'another' })
    setModel('nonexistent-xyz')
    expect(getActiveVerifier().id).toBe('gemini-vision')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('nonexistent-xyz'))
    warnSpy.mockRestore()
  })

  it('throws when no adapter is registered at all', () => {
    setModel('gemini-vision')
    expect(() => getActiveVerifier()).toThrow(/No verifier registered/)
  })

  it('register requires a non-empty id', () => {
    expect(() =>
      registerVerifier({
        id: '',
        verify: async () => ({
          matchScore: 0, detectedSubjects: [], missingElements: [], unexpectedElements: [],
          recommendation: 'retry', reasoning: '',
        }),
      }),
    ).toThrow()
  })

  it('listVerifierIds reflects live state', () => {
    expect(listVerifierIds()).toEqual([])
    registerVerifier({
      id: 'a',
      verify: async () => ({
        matchScore: 0, detectedSubjects: [], missingElements: [], unexpectedElements: [],
        recommendation: 'retry', reasoning: '',
      }),
    })
    registerVerifier({
      id: 'b',
      verify: async () => ({
        matchScore: 0, detectedSubjects: [], missingElements: [], unexpectedElements: [],
        recommendation: 'retry', reasoning: '',
      }),
    })
    expect(listVerifierIds()).toEqual(['a', 'b'])
  })
})

// ============================================================
// geminiVisionAdapter response coercion — Task 4.2 verification
// ============================================================

describe('geminiVisionAdapter', () => {
  beforeEach(() => {
    reregisterGeminiDefault()
    resetFlowStore()
    setModel('gemini-vision')
  })

  it('parses a happy-path backend response', async () => {
    const mockResp: VerifyImageResponse = {
      match_score: 88,
      detected_subjects: ['cat'],
      missing_elements: [],
      unexpected_elements: ['dog'],
      recommendation: 'accept',
      reasoning: '猫清晰可见',
    }
    const spy = vi.spyOn(backendApi, 'verifyImage').mockResolvedValue(mockResp)
    const result = await geminiVisionAdapter.verify('https://x/1.png', {
      subjects: ['cat'],
      threshold: 70,
    })
    expect(result.matchScore).toBe(88)
    expect(result.recommendation).toBe('accept')
    expect(result.detectedSubjects).toEqual(['cat'])
    expect(result.unexpectedElements).toEqual(['dog'])
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-vision',
      criteria: expect.objectContaining({ subjects: ['cat'], threshold: 70 }),
    }))
    spy.mockRestore()
  })

  it('network failure produces a degraded VerifyResult, not a throw', async () => {
    const spy = vi.spyOn(backendApi, 'verifyImage').mockRejectedValue(new Error('network down'))
    const result = await geminiVisionAdapter.verify('https://x/1.png', {
      subjects: ['cat'],
    })
    expect(result.matchScore).toBe(0)
    expect(result.recommendation).toBe('retry')
    expect(result.reasoning).toMatch(/Vision 验证调用失败/)
    expect(result.missingElements).toEqual(['cat'])
    spy.mockRestore()
  })

  it('derives recommendation from score when backend omits it', async () => {
    const spy = vi.spyOn(backendApi, 'verifyImage').mockResolvedValue({
      match_score: 30,
      detected_subjects: [],
      missing_elements: [],
      unexpected_elements: [],
      // Empty string → coerceResult falls through to derivation logic
      recommendation: '' as unknown as 'accept',
      reasoning: '',
    } as VerifyImageResponse)
    const result = await geminiVisionAdapter.verify('https://x/1.png', { threshold: 70 })
    // 30 < (70 - 20) = 50 → edit_prompt per derivation table
    expect(result.recommendation).toBe('edit_prompt')
    spy.mockRestore()
  })
})

// ============================================================
// handleVerifyImageSemantic handler — Task 4.8 verification
// ============================================================

describe('handleVerifyImageSemantic', () => {
  beforeEach(() => {
    reregisterGeminiDefault()
    resetFlowStore()
    setModel('gemini-vision')
  })

  it('returns success + accept when verifier reports high score', async () => {
    __resetRegistry()
    registerVerifier({
      id: 'gemini-vision',
      async verify(): Promise<VerifyResult> {
        return {
          matchScore: 92,
          detectedSubjects: ['cat'],
          missingElements: [],
          unexpectedElements: [],
          recommendation: 'accept',
          reasoning: '主体清晰',
        }
      },
    })
    useFlowStore.setState({
      nodes: [
        { id: 'img_1', type: 'imageGen', position: { x: 0, y: 0 }, data: { label: '镜头1 关键帧', outputImage: 'https://cdn/x.png' } },
      ],
      edges: [],
      projectId: null,
    })
    const res = await handleVerifyImageSemantic({ nodeId: 'img_1', expectedSubjects: ['cat'] })
    expect(res.success).toBe(true)
    expect(res.message).toContain('通过')
    expect(res.message).toContain('matchScore=92')
    const body = JSON.parse(res.message.slice(res.message.indexOf('{')))
    expect(body.recommendation).toBe('accept')
    expect(body.matchScore).toBe(92)
  })

  it('returns success + retry when score is below threshold', async () => {
    __resetRegistry()
    registerVerifier({
      id: 'gemini-vision',
      async verify(): Promise<VerifyResult> {
        return {
          matchScore: 45,
          detectedSubjects: ['daylight countryside'],
          missingElements: ['cyberpunk street at night'],
          unexpectedElements: [],
          recommendation: 'retry',
          reasoning: '场景与预期相反',
        }
      },
    })
    useFlowStore.setState({
      nodes: [
        { id: 'img_2', type: 'imageGen', position: { x: 0, y: 0 }, data: { label: '镜头1 关键帧', outputImage: 'https://cdn/y.png' } },
      ],
      edges: [],
      projectId: null,
    })
    const res = await handleVerifyImageSemantic({
      nodeId: 'img_2',
      expectedSubjects: ['cyberpunk street at night'],
    })
    expect(res.success).toBe(true)
    expect(res.message).toContain('需重试')
    const body = JSON.parse(res.message.slice(res.message.indexOf('{')))
    expect(body.recommendation).toBe('retry')
    expect(body.missingElements).toContain('cyberpunk street at night')
  })

  it('returns failure with node-not-found message when nodeId is bogus', async () => {
    useFlowStore.setState({ nodes: [], edges: [], projectId: null })
    const res = await handleVerifyImageSemantic({ nodeId: 'does-not-exist' })
    expect(res.success).toBe(false)
    expect(res.message).toMatch(/未找到.*does-not-exist/)
  })

  it('returns failure when node has no outputImage yet', async () => {
    useFlowStore.setState({
      nodes: [
        { id: 'img_3', type: 'imageGen', position: { x: 0, y: 0 }, data: { label: '未生成节点' } },
      ],
      edges: [],
      projectId: null,
    })
    const res = await handleVerifyImageSemantic({ nodeId: 'img_3' })
    expect(res.success).toBe(false)
    expect(res.message).toMatch(/尚无 outputImage/)
  })

  it('falls through to firstFrameImage for videoGen nodes', async () => {
    __resetRegistry()
    registerVerifier({
      id: 'gemini-vision',
      async verify(url: string): Promise<VerifyResult> {
        return {
          matchScore: 75,
          detectedSubjects: [url.includes('first') ? 'first-frame' : 'unknown'],
          missingElements: [],
          unexpectedElements: [],
          recommendation: 'accept',
          reasoning: '首帧通过',
        }
      },
    })
    useFlowStore.setState({
      nodes: [
        { id: 'vid_1', type: 'videoGen', position: { x: 0, y: 0 }, data: { label: '镜头1 视频', firstFrameImage: 'https://cdn/first.png' } },
      ],
      edges: [],
      projectId: null,
    })
    const res = await handleVerifyImageSemantic({ nodeId: 'vid_1' })
    expect(res.success).toBe(true)
    const body = JSON.parse(res.message.slice(res.message.indexOf('{')))
    expect(body.detectedSubjects).toContain('first-frame')
  })
})

// ============================================================
// handleVerifyTask useVisionVerify integration — Task 4.9 verification
// ============================================================

describe('handleVerifyTask useVisionVerify integration', () => {
  beforeEach(() => {
    __resetRegistry()
    resetFlowStore()
    setModel('gemini-vision')
  })

  it('default behaviour is unchanged when useVisionVerify is omitted', async () => {
    // No adapter registered → should NOT invoke vision path; runs heuristic.
    useFlowStore.setState({
      nodes: [
        { id: 'img', type: 'imageGen', position: { x: 0, y: 0 }, data: { label: 'x', prompt: 'a cat', outputImage: 'https://cdn/c.png' } },
      ],
      edges: [],
      projectId: null,
    })
    const res = await handleVerifyTask({})
    expect(res.success).toBe(true)
    expect(res.message).not.toContain('vision fallback')
    expect(res.message).not.toContain('Vision QC')
  })

  it('useVisionVerify=true with 2 imageGen calls the verifier 2 times and scores from results', async () => {
    let calls = 0
    registerVerifier({
      id: 'gemini-vision',
      async verify(): Promise<VerifyResult> {
        calls++
        return {
          matchScore: 85,
          detectedSubjects: ['cat'],
          missingElements: [],
          unexpectedElements: [],
          recommendation: 'accept',
          reasoning: '通过',
        }
      },
    })
    useFlowStore.setState({
      nodes: [
        { id: 'img_a', type: 'imageGen', position: { x: 0, y: 0 }, data: { label: '镜头1', prompt: 'cat', outputImage: 'https://cdn/1.png' } },
        { id: 'img_b', type: 'imageGen', position: { x: 0, y: 0 }, data: { label: '镜头2', prompt: 'cat', outputImage: 'https://cdn/2.png' } },
      ],
      edges: [
        { id: 'e1', source: 'img_a', target: 'img_b' },
      ],
      projectId: null,
    })
    const res = await handleVerifyTask({ useVisionVerify: true })
    expect(res.success).toBe(true)
    expect(calls).toBe(2)
    expect(res.message).toContain('Vision QC: 2 张图')
    expect(res.message).not.toContain('vision fallback')
  })

  it('Vision failure → falls back to heuristic and appends [vision fallback] marker', async () => {
    registerVerifier({
      id: 'gemini-vision',
      async verify(): Promise<VerifyResult> {
        // Simulate the degraded reply shape returned by the real adapter on
        // network errors — score=0, reasoning starts with "Vision …".
        return {
          matchScore: 0,
          detectedSubjects: [],
          missingElements: ['cat'],
          unexpectedElements: [],
          recommendation: 'retry',
          reasoning: 'Vision 验证调用失败: network down',
        }
      },
    })
    useFlowStore.setState({
      nodes: [
        { id: 'img_c', type: 'imageGen', position: { x: 0, y: 0 }, data: { label: '镜头1', prompt: 'a cat', outputImage: 'https://cdn/3.png' } },
      ],
      edges: [],
      projectId: null,
    })
    const res = await handleVerifyTask({ useVisionVerify: true })
    expect(res.success).toBe(true)
    expect(res.message).toContain('[vision fallback]')
    expect(res.message).toContain('Vision 校验失败')
  })

  it('skips Vision when flag is on but no imageGen has outputImage', async () => {
    registerVerifier({
      id: 'gemini-vision',
      async verify(): Promise<VerifyResult> {
        throw new Error('should not be called')
      },
    })
    useFlowStore.setState({
      nodes: [
        // No outputImage — node not yet executed
        { id: 'img_empty', type: 'imageGen', position: { x: 0, y: 0 }, data: { label: 'idle', prompt: 'cat' } },
      ],
      edges: [],
      projectId: null,
    })
    const res = await handleVerifyTask({ useVisionVerify: true })
    expect(res.success).toBe(true)
    expect(res.message).toContain('无 outputImage 可校验')
    expect(res.message).not.toContain('[vision fallback]')
  })

  // ── Regression: vision calls must be parallel (Promise.allSettled),
  //    not sequential — otherwise handleVerifyTask takes N× the single-call
  //    latency and blocks the Agent loop. ──
  it('runs vision verify calls in parallel (total latency ≈ single call, not N×)', async () => {
    const SINGLE_CALL_LATENCY_MS = 60
    let concurrentCalls = 0
    let maxConcurrent = 0
    registerVerifier({
      id: 'gemini-vision',
      async verify(): Promise<VerifyResult> {
        concurrentCalls++
        maxConcurrent = Math.max(maxConcurrent, concurrentCalls)
        await new Promise(r => setTimeout(r, SINGLE_CALL_LATENCY_MS))
        concurrentCalls--
        return {
          matchScore: 85,
          detectedSubjects: ['cat'],
          missingElements: [],
          unexpectedElements: [],
          recommendation: 'accept',
          reasoning: 'ok',
        }
      },
    })
    // 4 imageGen nodes → serial would take ≥240ms, parallel should take ≈60ms
    useFlowStore.setState({
      nodes: [
        { id: 'a', type: 'imageGen', position: { x: 0, y: 0 }, data: { label: 'A', prompt: 'cat', outputImage: 'https://cdn/a.png' } },
        { id: 'b', type: 'imageGen', position: { x: 0, y: 0 }, data: { label: 'B', prompt: 'cat', outputImage: 'https://cdn/b.png' } },
        { id: 'c', type: 'imageGen', position: { x: 0, y: 0 }, data: { label: 'C', prompt: 'cat', outputImage: 'https://cdn/c.png' } },
        { id: 'd', type: 'imageGen', position: { x: 0, y: 0 }, data: { label: 'D', prompt: 'cat', outputImage: 'https://cdn/d.png' } },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'c' },
        { id: 'e3', source: 'c', target: 'd' },
      ],
      projectId: null,
    })
    const t0 = Date.now()
    const res = await handleVerifyTask({ useVisionVerify: true })
    const elapsed = Date.now() - t0
    expect(res.success).toBe(true)
    expect(maxConcurrent).toBe(4) // all 4 calls ran concurrently
    // Parallel elapsed ≈ 60ms + JS overhead. Serial would be 4×60 = 240ms.
    // Budget 180ms gives ample margin for slow CI machines without
    // masking a regression (anything ≥ 3× single is definitely serial).
    expect(elapsed).toBeLessThan(SINGLE_CALL_LATENCY_MS * 3)
  })

  // ── Regression: verbose output labels must correspond to the right node
  //    even when some targets failed (previously relied on results[idx]
  //    aligning with visionTargets[idx] — broken as soon as any failed). ──
  it('verbose output emits correct labels regardless of result order', async () => {
    // Deterministic responses — all succeed, with distinguishable scores
    const scoreByLabel: Record<string, number> = { A: 81, B: 82, C: 83 }
    registerVerifier({
      id: 'gemini-vision',
      async verify(url: string): Promise<VerifyResult> {
        const label = url.includes('a.png') ? 'A' : url.includes('b.png') ? 'B' : 'C'
        return {
          matchScore: scoreByLabel[label],
          detectedSubjects: [label],
          missingElements: [],
          unexpectedElements: [],
          recommendation: 'accept',
          reasoning: label,
        }
      },
    })
    useFlowStore.setState({
      nodes: [
        { id: 'a', type: 'imageGen', position: { x: 0, y: 0 }, data: { label: 'A', prompt: 'cat', outputImage: 'https://cdn/a.png' } },
        { id: 'b', type: 'imageGen', position: { x: 0, y: 0 }, data: { label: 'B', prompt: 'cat', outputImage: 'https://cdn/b.png' } },
        { id: 'c', type: 'imageGen', position: { x: 0, y: 0 }, data: { label: 'C', prompt: 'cat', outputImage: 'https://cdn/c.png' } },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'c' },
      ],
      projectId: null,
    })
    const res = await handleVerifyTask({ useVisionVerify: true, verbose: true })
    // Each label must appear next to its exact matchScore, not permuted.
    expect(res.message).toContain('「A」matchScore=81')
    expect(res.message).toContain('「B」matchScore=82')
    expect(res.message).toContain('「C」matchScore=83')
  })
})
