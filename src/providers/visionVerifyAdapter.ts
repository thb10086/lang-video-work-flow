/**
 * Vision Verifier Adapter Registry
 *
 * Pluggable adapter layer for vision-based semantic verification. The Agent
 * does not know which provider executes the check — it always calls the
 * verifier returned by `getActiveVerifier()`. Switching provider is a
 * settings change (`settings.visionVerifyModel`); no code change required.
 *
 * Design mirrors the image-classifier adapter pattern (imageClassifier.ts):
 *   - `VisionVerifier` interface: id + async verify(imageUrl, criteria)
 *   - Module-level registry keyed by `id`
 *   - `getActiveVerifier()` reads the current settings and returns the match
 *     with graceful fallback (first registered) + warn log
 *
 * No hardcoding of Gemini/Claude/GPT — those live in sibling adapter files
 * and self-register on import.
 */

import { useSettingsStore } from '@/store/settingsStore'

// ============================================================
// Shared constants
// ============================================================
//
// Single source of truth for Vision QC numbers. Previously these lived as
// magic literals in three separate files (toolVerify.ts, geminiVisionAdapter.ts,
// the backend Python). Import from here instead of re-declaring.

/** Default pass threshold on the 0-100 matchScore scale. Below this the
 *  verifier recommends retry/edit_prompt. Mirrors the backend default in
 *  `server/app/services/vision_verify_service.py:DEFAULT_THRESHOLD`. */
export const DEFAULT_VISION_THRESHOLD = 70

/** Soft score ceiling used when converting average matchScore to the 20-pt
 *  dimension-4 contribution in `verify_task`'s vision path. Rewarding at 80
 *  (not 100) gives the verifier headroom so minor imperfections don't
 *  collapse the grade. See `computeVisionDimensionPoints` in toolVerify.ts. */
export const VISION_SCORE_REWARD_CEILING = 80

/** Minimum average matchScore across all vision targets to be labeled a
 *  "pass" in the verify_task summary (feeds into the passed/issues split). */
export const VISION_PASS_AVG = 70

// ============================================================
// Types
// ============================================================

export interface VerifyCriteria {
  /** Subjects the image MUST depict (English). */
  subjects?: string[]
  /** Style / aesthetics the image MUST match (English). */
  style?: string
  /** Reject below this match score (0-100). Default {@link DEFAULT_VISION_THRESHOLD}. */
  threshold?: number
}

/** Actionable recommendation the verifier returns to the Agent. */
export type VerifyRecommendation = 'accept' | 'retry' | 'edit_prompt'

export interface VerifyResult {
  /** 0-100 similarity between expected and actual. */
  matchScore: number
  /** Subjects the verifier believes are present in the image. */
  detectedSubjects: string[]
  /** Expected subjects the verifier could NOT find. */
  missingElements: string[]
  /** Extra / unwanted subjects the verifier spotted. */
  unexpectedElements: string[]
  /** What the Agent should do next. */
  recommendation: VerifyRecommendation
  /** Short Chinese explanation (≤120 chars) to show the user. */
  reasoning: string
}

export interface VisionVerifier {
  /** Adapter identifier. Match against `settings.visionVerifyModel`. */
  id: string
  /** Run the verify against a remote image URL. Must not throw on provider error — wrap in VerifyResult. */
  verify(imageUrl: string, criteria: VerifyCriteria): Promise<VerifyResult>
}

// ============================================================
// Registry
// ============================================================

const registry = new Map<string, VisionVerifier>()

/** Register an adapter. Idempotent — re-registering with the same id overwrites. */
export function registerVerifier(verifier: VisionVerifier): void {
  if (!verifier.id) {
    throw new Error('[visionVerify] Adapter must have a non-empty id')
  }
  registry.set(verifier.id, verifier)
}

/** Remove all registered adapters. Intended for tests only. */
export function __resetRegistry(): void {
  registry.clear()
}

/** Snapshot the set of currently registered adapter ids. */
export function listVerifierIds(): string[] {
  return [...registry.keys()]
}

/**
 * Return the adapter matching `settings.visionVerifyModel`. If the declared
 * model is unknown, fall back to the first registered adapter and log a warn
 * — prevents hard crashes when a user typo-sets a non-existent model.
 */
export function getActiveVerifier(): VisionVerifier {
  const desired = useSettingsStore.getState().visionVerifyModel
  const match = desired ? registry.get(desired) : undefined
  if (match) return match

  const firstId = registry.keys().next().value
  if (!firstId) {
    // Deliberate hard error — having zero adapters means no adapter file
    // has been imported yet. Caller should import geminiVisionAdapter.ts.
    throw new Error(
      '[visionVerify] No verifier registered. Ensure at least one adapter ' +
        'module (e.g. geminiVisionAdapter.ts) is imported at app boot.',
    )
  }
  const fallback = registry.get(firstId)!
  if (desired) {
    console.warn(
      `[visionVerify] Unknown adapter "${desired}", falling back to "${fallback.id}". ` +
        `Registered: ${listVerifierIds().join(', ')}`,
    )
  }
  return fallback
}
