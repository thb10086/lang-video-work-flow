/**
 * Gemini Vision adapter — default `VisionVerifier` implementation.
 *
 * Translates the `(imageUrl, criteria)` input into a backend POST
 * `/api/verify/image` request and normalises the response into a
 * `VerifyResult`. All model-specific prompting lives on the backend
 * (`services/vision_verify_service.py`) — this adapter is purposely thin so
 * new adapters (Claude Vision / GPT-5 Vision) only need to swap the
 * `model` field sent to the same endpoint.
 *
 * Self-registers on import; bootstrap code should import this module once
 * during app start (see `src/main.tsx`).
 */

import { backendApi } from '@/api/backend'
import {
  registerVerifier,
  DEFAULT_VISION_THRESHOLD,
  type VerifyCriteria,
  type VerifyRecommendation,
  type VerifyResult,
  type VisionVerifier,
} from './visionVerifyAdapter'

/** Stable adapter id. Matches `settings.visionVerifyModel` default. */
export const GEMINI_VISION_ID = 'gemini-vision'

/** Normalise any backend payload into a strict VerifyResult. */
function coerceResult(raw: Record<string, unknown>, threshold: number): VerifyResult {
  const scoreRaw = Number(raw.match_score ?? raw.matchScore ?? 0)
  const matchScore = Math.max(0, Math.min(100, Math.round(scoreRaw)))

  const asArr = (k1: string, k2: string): string[] => {
    const v = raw[k1] ?? raw[k2]
    return Array.isArray(v) ? v.map(String) : []
  }
  const detectedSubjects = asArr('detected_subjects', 'detectedSubjects')
  const missingElements = asArr('missing_elements', 'missingElements')
  const unexpectedElements = asArr('unexpected_elements', 'unexpectedElements')

  const recRaw = String(raw.recommendation ?? '').toLowerCase() as VerifyRecommendation
  const recommendation: VerifyRecommendation =
    recRaw === 'accept' || recRaw === 'retry' || recRaw === 'edit_prompt'
      ? recRaw
      : matchScore >= threshold
        ? 'accept'
        : matchScore >= threshold - 20
          ? 'retry'
          : 'edit_prompt'

  const reasoning = String(raw.reasoning ?? '').slice(0, 120)

  return {
    matchScore,
    detectedSubjects,
    missingElements,
    unexpectedElements,
    recommendation,
    reasoning,
  }
}

export const geminiVisionAdapter: VisionVerifier = {
  id: GEMINI_VISION_ID,
  async verify(imageUrl: string, criteria: VerifyCriteria): Promise<VerifyResult> {
    const threshold = criteria.threshold ?? DEFAULT_VISION_THRESHOLD
    try {
      const resp = await backendApi.verifyImage({
        image_url: imageUrl,
        model: GEMINI_VISION_ID,
        criteria: {
          subjects: criteria.subjects,
          style: criteria.style,
          threshold,
        },
      })
      return coerceResult(resp as unknown as Record<string, unknown>, threshold)
    } catch (err) {
      // Network / provider errors surface as a degraded VerifyResult rather
      // than throwing — verify_task and the handler decide how to react
      // (fallback to heuristic scoring or retry).
      const msg = err instanceof Error ? err.message : String(err)
      return {
        matchScore: 0,
        detectedSubjects: [],
        missingElements: criteria.subjects ?? [],
        unexpectedElements: [],
        recommendation: 'retry',
        reasoning: `Vision 验证调用失败: ${msg.slice(0, 80)}`,
      }
    }
  },
}

// Self-register on import — apps that import this file get the adapter
// available in the registry. Safe to call multiple times (idempotent).
registerVerifier(geminiVisionAdapter)
