/**
 * CharacterAssetNode — unified character asset node (task 2.4.1).
 *
 * Replaces three legacy nodes (`characterGrid`, `characterExtract`,
 * `characterManager`) with a single canvas type whose behaviour is
 * driven by `data.mode`:
 *
 *   - `'design'`   → 3×3 reference sheet generation (CharacterGridNode)
 *   - `'extract'`  → pull a character anchor out of an upstream video
 *                    (CharacterExtractNode)
 *   - `'registry'` → manual list/registry of reusable characters
 *                    (CharacterManagerNode)
 *
 * 2.4.1 strategy — thin dispatcher, NOT a copy:
 *   The three existing node components already carry the LibTV visual
 *   treatment, store wiring, executors, and ghost-connect handling.
 *   Re-implementing all of that inline would duplicate ~600 lines and
 *   immediately drift from the legacy nodes (which still ship in this
 *   release per `nodeDefinitions.ts`). Instead, this file is a
 *   ≤20-line dispatcher that delegates to the legacy component for
 *   the chosen mode.
 *
 *   Subsequent 2.4 tasks then:
 *     - 2.4.2 add a workflowMigrations function that rewrites legacy
 *       canvas JSON into `{type: 'characterAsset', data: {mode, ...}}`.
 *     - 2.4.3 register `characterAsset` in `nodeDefinitions.ts` and
 *       point the canvas `nodeTypes` map at this component, retaining
 *       the legacy types as aliases for one release.
 *     - 2.4.4 unify propagation logic in `nodeExecutor.ts`.
 *
 *   By landing 2.4.1 as a *behaviour-preserving* wrapper we get the
 *   new union type into the codebase with zero regression risk to the
 *   ~600 existing vitest cases that exercise the legacy components.
 *
 * Why a dedicated `selectCharacterAssetVariant` export:
 *   The repo's vitest config uses `environment: 'happy-dom'` and only
 *   collects `src/__tests__` files matching the `.test.ts` extension —
 *   it is set up for headless logic tests, not React component
 *   rendering, and there is no `@testing-library/react` dependency.
 *   Exposing the mode→component mapping as a pure function lets us
 *   fully test the dispatcher in `.test.ts` without a renderer.
 */

import { memo, type ComponentType } from 'react'
import type { NodeProps } from '@xyflow/react'

import CharacterGridNode from '@/components/nodes/CharacterGridNode'
import CharacterExtractNode from '@/components/nodes/CharacterExtractNode'
import CharacterManagerNode from '@/components/nodes/CharacterManagerNode'

/**
 * The exhaustive list of supported modes. Exposed as a tuple so callers
 * can iterate (e.g. picker UIs, migration code) without re-typing the
 * literals. Order is meaningful: `design` is the default mode for new
 * nodes since it covers the most common authoring path.
 */
export const CHARACTER_ASSET_MODES = ['design', 'extract', 'registry'] as const
export type CharacterAssetMode = typeof CHARACTER_ASSET_MODES[number]

/** Default mode applied when `data.mode` is missing or unrecognised. */
export const DEFAULT_CHARACTER_ASSET_MODE: CharacterAssetMode = 'design'

/**
 * Maps a mode value (possibly `undefined`/unknown) to the React
 * component that should render the node.
 *
 * Defensive: any value not listed in `CHARACTER_ASSET_MODES` falls
 * back to the default `'design'` variant. This means a corrupted /
 * partially-migrated canvas still renders something useful instead of
 * blanking out, while the migration code in 2.4.2 owns proper
 * normalisation on the data side.
 */
export function selectCharacterAssetVariant(
  mode: unknown,
): ComponentType<NodeProps> {
  if (mode === 'extract') return CharacterExtractNode
  if (mode === 'registry') return CharacterManagerNode
  // 'design' or anything else (undefined, null, typo, future-only mode).
  return CharacterGridNode
}

/**
 * Type-guard for `CharacterAssetMode`. Useful to migration / picker
 * code that has a `string` from the wire and wants narrow access.
 */
export function isCharacterAssetMode(v: unknown): v is CharacterAssetMode {
  return (
    v === 'design' || v === 'extract' || v === 'registry'
  )
}

function CharacterAssetNode(props: NodeProps) {
  const mode = (props.data as { mode?: unknown } | undefined)?.mode
  const Variant = selectCharacterAssetVariant(mode)
  return <Variant {...props} />
}

export default memo(CharacterAssetNode)
