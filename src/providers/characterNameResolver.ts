/**
 * characterNameResolver — expands `@角色名` tokens against the live
 * CharacterManager registry on the canvas.
 *
 * Complements `assetReferenceResolver` which only knows about `@asset_id`
 * tokens in ASCII format. The LibTV-style CharacterPicker instead inserts
 * human-readable `@角色名` tokens, so we need a name-based resolver that:
 *
 *   1. Scans every `characterManager` node in the flow for characters.
 *   2. For each `@角色名` token in the prompt, finds the matching character.
 *   3. Returns the character's URL + description so the generator can:
 *        - Inject the URL into `referenceImages` / `characterUrls`
 *        - Replace the token with the character's description (so the AI
 *          model receives a textual description rather than a dangling @)
 *
 * Unresolved tokens (no CharacterManager has a matching name) are left in
 * place and reported so the node UI can surface a warning, matching the
 * behaviour of `assetReferenceResolver`.
 */

import type { Node } from '@xyflow/react'

// Matches `@name` where name is any run of non-space, non-punctuation chars.
// Supports CJK, letters, numbers, underscore, dash. Stops at whitespace or
// standard ASCII punctuation so we don't swallow trailing commas / periods.
const NAME_TOKEN_RE = /@([^\s,.!?;:"'()[\]{}<>]+)/g

export interface CharacterMatch {
  /** Name that was matched (raw text after the @). */
  name: string
  /** Owning CharacterManager node id (for tracing). */
  sourceNodeId: string
  /** Display thumbnail — shown in chips. */
  thumbnailUrl?: string
  /** Canonical character URL (passed to video models as ref image). */
  characterUrl?: string
  /** Sora character_id, if the character was extracted via Sora pipeline. */
  characterId?: string
  /** Natural-language description (inserted into expanded prompt). */
  description?: string
}

export interface ResolveNamesResult {
  /** Prompt with resolved `@角色名` replaced by that character's description. */
  expandedPrompt: string
  /** CharacterUrls / reference image URLs discovered across all resolved names. */
  referenceImages: string[]
  /** Sora character_url list (same semantics as assetReferenceResolver). */
  characterUrls: string[]
  /** Successfully matched character names (for analytics / chip rendering). */
  matched: CharacterMatch[]
  /** Names that could not be resolved — surface these as warnings. */
  unresolved: string[]
}

interface CharacterEntry {
  id: string
  name: string
  description?: string
  characterId?: string
  characterUrl?: string
  thumbnailUrl?: string
}

/** Collect every character defined in every CharacterManager node on the canvas. */
function collectCharacters(nodes: Node[]): Map<string, CharacterMatch> {
  const byName = new Map<string, CharacterMatch>()
  for (const n of nodes) {
    if (n.type !== 'characterManager') continue
    const chars = (n.data?.characters as CharacterEntry[] | undefined) || []
    for (const c of chars) {
      if (!c?.name) continue
      const key = c.name.trim()
      if (!key || byName.has(key)) continue  // first-wins to keep stable behaviour
      byName.set(key, {
        name: key,
        sourceNodeId: n.id,
        thumbnailUrl: c.thumbnailUrl,
        characterUrl: c.characterUrl,
        characterId: c.characterId,
        description: c.description,
      })
    }
  }
  return byName
}

/**
 * Resolve `@角色名` tokens in `prompt` against CharacterManager nodes.
 * Never throws; unresolved tokens remain in place.
 */
export function resolveCharacterNames(
  prompt: string,
  nodes: Node[],
): ResolveNamesResult {
  const registry = collectCharacters(nodes)
  const matched: CharacterMatch[] = []
  const unresolved: string[] = []
  const referenceImagesSet = new Set<string>()
  const characterUrls: string[] = []

  const expandedPrompt = (prompt || '').replace(NAME_TOKEN_RE, (fullMatch, rawName: string) => {
    // rawName may include trailing underscores/hyphens etc; keep as-is for lookup.
    const name = rawName.trim()
    if (!name) return fullMatch

    // Skip ASCII asset-id pattern (let assetReferenceResolver handle those).
    // `char_abc123` / `scene_xyz` → owned by assetStore, not CharacterManager.
    if (/^[a-z]+_[a-zA-Z0-9]+$/.test(name)) return fullMatch

    const match = registry.get(name)
    if (!match) {
      unresolved.push(name)
      return fullMatch
    }

    matched.push(match)
    if (match.characterUrl) {
      referenceImagesSet.add(match.characterUrl)
      characterUrls.push(match.characterUrl)
    } else if (match.thumbnailUrl) {
      referenceImagesSet.add(match.thumbnailUrl)
    }

    // Replace `@角色名` with the character's description (if any) so the model
    // has something textual to work with; otherwise keep the plain name.
    return match.description ? `${name} (${match.description})` : name
  })

  return {
    expandedPrompt,
    referenceImages: Array.from(referenceImagesSet),
    characterUrls,
    matched,
    unresolved,
  }
}
