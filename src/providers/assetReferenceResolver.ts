/**
 * assetReferenceResolver — expand `@assetId` / `@assetId:variationId` tokens
 * in a prompt into natural language AND collect the union of all referenced
 * assets' reference images / character urls.
 *
 * Called by node executors (image/video generation) BEFORE the backend
 * submission. Output feeds `modelReferenceAdapter` which then maps the
 * capability-agnostic payload into model-specific fields.
 *
 * Unresolved tokens are left intact and logged as warnings — we never block
 * execution on a missing asset, so the user can still fire a degraded prompt.
 */

import type { AssetDTO, VariationDTO } from '@/api/backend'
import type { AssetStoreState } from '@/store/assetStore'

export interface ResolveResult {
  /** Prompt with tokens replaced by resolved appearance text. */
  expandedPrompt: string
  /** Union of reference images across all resolved assets (de-duplicated, order preserved). */
  referenceImages: string[]
  /** Character URLs for Sora (from characterExtract metadata, if any). */
  characterUrls: string[]
  /** Default timestamps window for Sora character injection. */
  timestamps: string | null
  /** Asset ids that were successfully resolved (for analytics + chip rendering). */
  refs: string[]
  /** Tokens the resolver could not match against the library. */
  unresolved: string[]
}

/** Matches `@char_abc` or `@char_abc:var_xyz` tokens. */
const TOKEN_RE = /@([a-zA-Z]+_[A-Za-z0-9]+(?::[A-Za-z0-9_]+)?)/g

function resolveOne(token: string, store: AssetStoreState) {
  return store.resolve(token)
}

function pickCharacterUrl(asset: AssetDTO, variation: VariationDTO | null): string | null {
  // Sora character_url lives in metadata.sora_character_url (populated by characterExtract node)
  const fromVar = variation && (variation as unknown as { metadata?: Record<string, unknown> }).metadata
  if (fromVar && typeof fromVar === 'object') {
    const v = (fromVar as Record<string, unknown>).sora_character_url
    if (typeof v === 'string' && v) return v
  }
  const assetMeta = asset.metadata || {}
  const v2 = assetMeta.sora_character_url
  if (typeof v2 === 'string' && v2) return v2
  return null
}

function pickTimestamps(asset: AssetDTO): string | null {
  const meta = asset.metadata || {}
  const ts = meta.sora_timestamps
  if (typeof ts === 'string' && ts) return ts
  return null
}

/**
 * Resolve every `@asset[:variation]` token in the prompt against the live
 * asset store. Returns the expanded prompt + aggregated refs. Never throws.
 *
 * `extraAssetRefs` is merged into the result even if those ids are not in
 * the prompt text — used when the node stores `assetRefs` on its own data
 * (e.g. drag-to-canvas without a prompt edit yet).
 */
export function resolvePromptRefs(
  prompt: string,
  store: AssetStoreState,
  extraAssetRefs: string[] = [],
): ResolveResult {
  const refs: string[] = []
  const unresolved: string[] = []
  const referenceImagesSet = new Set<string>()
  const characterUrls: string[] = []
  let timestamps: string | null = null

  // Replace tokens in-place while collecting refs
  const expandedPrompt = (prompt || '').replace(TOKEN_RE, (match, tokenBody: string) => {
    const resolved = resolveOne(tokenBody, store)
    if (!resolved) {
      console.warn('[assetResolver] unresolved token:', match)
      unresolved.push(tokenBody)
      return match  // leave raw token in place
    }
    refs.push(resolved.asset.asset_id)
    for (const img of resolved.reference_images || []) {
      if (img) referenceImagesSet.add(img)
    }
    const curl = pickCharacterUrl(resolved.asset, resolved.variation)
    if (curl) characterUrls.push(curl)
    const ts = pickTimestamps(resolved.asset)
    if (ts && !timestamps) timestamps = ts
    return resolved.appearance || match
  })

  // Merge extraAssetRefs (may include items not in the prompt at all)
  for (const id of extraAssetRefs || []) {
    if (!id) continue
    const resolved = resolveOne(id, store)
    if (!resolved) {
      if (!unresolved.includes(id)) unresolved.push(id)
      continue
    }
    if (!refs.includes(resolved.asset.asset_id)) refs.push(resolved.asset.asset_id)
    for (const img of resolved.reference_images || []) {
      if (img) referenceImagesSet.add(img)
    }
    const curl = pickCharacterUrl(resolved.asset, resolved.variation)
    if (curl && !characterUrls.includes(curl)) characterUrls.push(curl)
    const ts = pickTimestamps(resolved.asset)
    if (ts && !timestamps) timestamps = ts
  }

  // Sora default timestamp window when character URLs are present but no explicit timestamps
  if (characterUrls.length > 0 && !timestamps) {
    timestamps = '1,3'
  }

  return {
    expandedPrompt,
    referenceImages: Array.from(referenceImagesSet),
    characterUrls,
    timestamps,
    refs,
    unresolved,
  }
}
