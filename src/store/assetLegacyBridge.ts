/**
 * assetLegacyBridge — one-way sync from Asset Library → legacy
 * `flowStore.characterAppearances`.
 *
 * The legacy registry is still consumed by `buildCharacterAnchorPrefix`
 * (`@d:/PythonProject/lang-video-work-flow/src/providers/executors/generationExecutors.ts`)
 * to auto-prepend `[Character Anchor]` lines to prompts. Rather than rip that
 * machinery out, we keep it populated by mirroring every character asset into
 * the registry whenever the asset library changes.
 *
 * Call `mirrorAssetsToLegacyRegistry(assetStore, flowStore)` after every
 * `fetchAll` / `create` / `update` / `remove` that touches a character asset.
 */

import { useAssetStore } from './assetStore'
import { useFlowStore } from './flowStore'

export function mirrorAssetsToLegacyRegistry(): void {
  const characters = useAssetStore.getState().characters
  const setAppearance = useFlowStore.getState().setCharacterAppearance
  for (const asset of Object.values(characters)) {
    const key = asset.name_en || asset.name
    const appearance = asset.appearance || ''
    if (key && appearance) {
      setAppearance(key, appearance)
    }
  }
}

/** Subscribe once at app init to auto-mirror on every asset change. */
export function startLegacyBridge(): () => void {
  // Initial sync
  mirrorAssetsToLegacyRegistry()

  // Subscribe to asset changes
  const unsubscribe = useAssetStore.subscribe((state, prev) => {
    if (state.characters !== prev.characters) {
      mirrorAssetsToLegacyRegistry()
    }
  })
  return unsubscribe
}

/**
 * Detect legacy characters (in flowStore.characterAppearances) that do NOT
 * have a corresponding asset in the library. Used by the import banner in the
 * Asset Library panel.
 */
export function collectLegacyCandidatesForImport(): Array<{ name: string; appearance: string }> {
  const { characters } = useAssetStore.getState()
  const libraryNames = new Set(
    Object.values(characters).map(a => (a.name_en || a.name).toLowerCase()),
  )
  const legacyRegistry = useFlowStore.getState().getCharacterAppearances()
  const out: Array<{ name: string; appearance: string }> = []
  for (const [name, appearance] of Object.entries(legacyRegistry)) {
    if (!name || !appearance) continue
    if (libraryNames.has(name.toLowerCase())) continue
    out.push({ name, appearance })
  }
  return out
}
