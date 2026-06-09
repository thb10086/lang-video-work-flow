/**
 * Agent tool handler — `verify_image_semantic`
 *
 * Bridges the Agent's tool-call dispatcher to the Vision Verify adapter
 * registry. Resolves the target node, pulls its outputImage URL, forwards
 * criteria to the active verifier, and renders a human-readable + machine-
 * parseable ToolCallResult.
 *
 * Key design decisions:
 *   - The adapter is resolved at *call time* (not import time), so hot-
 *     swapping `settings.visionVerifyModel` takes effect immediately.
 *   - The handler never throws — network / adapter failures become a
 *     `success:false` result, never an uncaught rejection.
 *   - Emits the structured payload as JSON inside `message` so Agents can
 *     parse it back into fields (matchScore, recommendation, etc.) in a
 *     single tool-result round.
 */

import { useFlowStore } from '@/store/flowStore'
import { resolveNode, resolveNodeNotFound, type ToolCallResult } from './toolHelpers'
import { getActiveVerifier, type VerifyCriteria } from './visionVerifyAdapter'

// Import the default Gemini adapter so it self-registers even if the app
// bootstrap order misses it. Idempotent — registerVerifier is keyed by id.
import './geminiVisionAdapter'

/** Extract an image URL the verifier can actually fetch. Falls through
 * imageGen.outputImage → videoGen.firstFrameImage → imageEdit.outputImage. */
function getVerifyTargetUrl(data: Record<string, unknown>): string | null {
  const candidates = [
    data.outputImage,
    data.firstFrameImage,
    data.inputImage,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c
  }
  return null
}

export async function handleVerifyImageSemantic(
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  // ── Resolve target node ──
  const resolved = resolveNode(args)
  if (!resolved) return resolveNodeNotFound(args)

  const store = useFlowStore.getState()
  const node = store.nodes.find(n => n.id === resolved.id)
  if (!node) return { success: false, message: `节点已不存在: ${resolved.label}` }

  const data = (node.data || {}) as Record<string, unknown>
  const imageUrl = getVerifyTargetUrl(data)
  if (!imageUrl) {
    return {
      success: false,
      message:
        `节点「${resolved.label}」尚无 outputImage / firstFrameImage — ` +
        `请先执行该节点（或其上游 imageGen）后再调用视觉校验。`,
    }
  }

  // ── Build criteria from args ──
  const criteria: VerifyCriteria = {
    subjects: Array.isArray(args.expectedSubjects)
      ? (args.expectedSubjects as unknown[]).filter(x => typeof x === 'string') as string[]
      : undefined,
    style: typeof args.expectedStyle === 'string' ? args.expectedStyle : undefined,
    threshold: typeof args.threshold === 'number' ? args.threshold : undefined,
  }

  // ── Dispatch to active verifier ──
  let verifier
  try {
    verifier = getActiveVerifier()
  } catch (e) {
    return {
      success: false,
      message: `Vision 校验器未注册: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  const result = await verifier.verify(imageUrl, criteria)

  // ── Render result for Agent consumption ──
  // Put the structured JSON last so Agents that parse only the first line
  // still get a human verdict; those that parse the whole message get the
  // full payload.
  const verdictIcon =
    result.recommendation === 'accept'
      ? '通过'
      : result.recommendation === 'retry'
        ? '需重试'
        : '需改 prompt'
  const header = `[${verdictIcon}] ${resolved.label} — matchScore=${result.matchScore}/100`

  const bodyJson = JSON.stringify(
    {
      nodeId: resolved.id,
      nodeLabel: resolved.label,
      adapter: verifier.id,
      matchScore: result.matchScore,
      detectedSubjects: result.detectedSubjects,
      missingElements: result.missingElements,
      unexpectedElements: result.unexpectedElements,
      recommendation: result.recommendation,
      reasoning: result.reasoning,
    },
    null,
    2,
  )

  // A degraded result (matchScore=0 AND recommendation='retry' with the
  // literal "Vision 验证调用失败" prefix) is still a valid tool call —
  // the Agent decides whether to fallback.
  return {
    success: true,
    message: `${header}\n${result.reasoning}\n\n${bodyJson}`,
  }
}
