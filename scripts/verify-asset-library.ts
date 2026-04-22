#!/usr/bin/env tsx
/**
 * verify-asset-library — smoke test for the asset library pipeline.
 *
 * Exercises the FULL chain without a running server by mocking the asset
 * store state, then for each of the 4 registered video models:
 *   1. Calls resolvePromptRefs with a synthetic prompt
 *   2. Feeds the resolved refs into injectVideoReferences
 *   3. Prints the final (images, params, notes) payload shape
 *   4. Asserts the expected field locations per model family
 *
 * Usage:
 *   npx tsx scripts/verify-asset-library.ts
 *
 * Exits non-zero if any assertion fails so it can be wired into CI.
 */

import { resolvePromptRefs } from '../src/providers/assetReferenceResolver'
import { injectVideoReferences } from '../src/providers/modelReferenceAdapter'
import type { AssetKind, AssetDTO } from '../src/api/backend'
import type { ParamField } from '../src/providers/types'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

function ok(label: string) { console.log(`${GREEN}  ✓${RESET} ${label}`) }
function fail(label: string): never {
  console.error(`${RED}  ✗${RESET} ${label}`)
  process.exit(1)
}

function makeChar(partial: Partial<AssetDTO>): AssetDTO {
  return {
    id: 1,
    asset_id: partial.asset_id || 'char_test',
    kind: 'character',
    user_id: 1,
    project_id: null,
    name: partial.name || 'Test',
    name_en: null,
    appearance: partial.appearance || 'default appearance',
    reference_images: partial.reference_images || [],
    variations: partial.variations || [],
    appearance_version: 1,
    metadata: partial.metadata || {},
    ...partial,
  }
}

// ── Fixture asset store state ──────────────────────────────────
const FIXTURE_STATE = {
  characters: {
    char_sarah: makeChar({
      asset_id: 'char_sarah',
      name: 'Sarah',
      appearance: 'red hair, trench coat',
      reference_images: ['https://fixture/sarah-1.png', 'https://fixture/sarah-2.png'],
    }),
    char_sora: makeChar({
      asset_id: 'char_sora',
      name: 'SoraSubject',
      appearance: 'sora-managed subject',
      reference_images: ['https://fixture/backup.png'],
      metadata: {
        sora_character_url: 'https://sora/characters/abc',
        sora_timestamps: '1,4',
      },
    }),
  },
  scenes: {
    scene_newsroom: makeChar({
      asset_id: 'scene_newsroom',
      kind: 'scene',
      name: 'Newsroom',
      appearance: 'neon-lit cyberpunk newsroom',
      reference_images: ['https://fixture/newsroom.png'],
    }),
  },
  styles: {
    style_cinematic: makeChar({
      asset_id: 'style_cinematic',
      kind: 'style',
      name: 'Cinematic',
      appearance: 'shallow depth of field, film grain, volumetric fog',
      reference_images: [],
    }),
  },
}

// Stub store object matching `ResolvedAssetRef` shape the resolver reads.
const stubStore = {
  ...FIXTURE_STATE,
  resolve: (token: string) => {
    const cleaned = token.startsWith('@') ? token.slice(1) : token
    const [assetId] = cleaned.split(':')
    const asset =
      (FIXTURE_STATE.characters as Record<string, AssetDTO>)[assetId] ||
      (FIXTURE_STATE.scenes as Record<string, AssetDTO>)[assetId] ||
      (FIXTURE_STATE.styles as Record<string, AssetDTO>)[assetId]
    if (!asset) return null
    return {
      asset,
      variation: null,
      appearance: asset.appearance || asset.environment || asset.guide || '',
      reference_images: [...(asset.reference_images || [])],
    }
  },
} as never

// ── Minimal schema definitions to match backend DB fixtures ─────
function f(key: string, type: ParamField['type'] = 'select'): ParamField {
  return { key, label: key, type, required: false }
}
const SCHEMAS: Record<string, ParamField[]> = {
  'doubao-seedance-2-0': [f('duration'), f('size'), f('resolution')],
  'veo3.1-fast':         [f('duration'), f('aspect_ratio'), f('image_mode')],
  'sora-2-vip':          [f('duration'), f('aspect_ratio'), f('style')],
  'kling-v3':            [f('duration'), f('aspect_ratio'), f('mode')],
}

// ── Scenarios ───────────────────────────────────────────────────
interface Scenario {
  model: keyof typeof SCHEMAS
  prompt: string
  existingImages: string[]
  assert: (payload: { images: string[]; params: Record<string, unknown>; notes: string[] }, expanded: string) => void
}

const SCENARIOS: Scenario[] = [
  {
    model: 'doubao-seedance-2-0',
    prompt: 'A scene of @char_sarah in @scene_newsroom',
    existingImages: [],
    assert: (p, exp) => {
      if (!exp.includes('red hair, trench coat')) fail('Seedance: appearance not expanded')
      if (!p.images.includes('https://fixture/sarah-1.png')) fail('Seedance: missing sarah-1 ref')
      if (!p.images.includes('https://fixture/newsroom.png')) fail('Seedance: missing newsroom ref')
      ok(`Seedance → ${p.images.length} images, params=${JSON.stringify(p.params)}`)
    },
  },
  {
    model: 'veo3.1-fast',
    prompt: '@char_sarah close up',
    existingImages: [],
    assert: (p) => {
      if (p.params.image_mode !== 'reference') fail('VEO: expected image_mode=reference')
      if (p.images.length > 2) fail(`VEO: expected ≤2 images, got ${p.images.length}`)
      ok(`VEO → image_mode=${p.params.image_mode}, ${p.images.length} images`)
    },
  },
  {
    model: 'sora-2-vip',
    prompt: '@char_sora on stage',
    existingImages: ['https://fixture/first-frame.png'],
    assert: (p) => {
      if (p.params.characterUrl !== 'https://sora/characters/abc') fail('Sora: missing characterUrl')
      if (p.params.characterTimestamps !== '1,4') fail('Sora: missing timestamps')
      if (p.images.includes('https://fixture/backup.png')) fail('Sora: should NOT include asset ref images when character URL is used')
      ok(`Sora → characterUrl=${p.params.characterUrl}, timestamps=${p.params.characterTimestamps}, ${p.images.length} images`)
    },
  },
  {
    model: 'kling-v3',
    prompt: '@char_sarah action',
    existingImages: ['https://fixture/first-frame.png', 'https://fixture/last-frame.png'],
    assert: (p) => {
      if (p.images.length !== 2) fail(`Kling: expected exactly 2 (first/last) frames, got ${p.images.length}`)
      if (!p.notes.some(n => n.includes('Kling'))) fail('Kling: expected a truncation note')
      ok(`Kling → ${p.images.length} frames, notes="${p.notes[0]}"`)
    },
  },
]

// ── Run ─────────────────────────────────────────────────────────
console.log(`${DIM}Running asset-library verification…${RESET}\n`)

for (const s of SCENARIOS) {
  console.log(`[${s.model}]`)
  const resolved = resolvePromptRefs(s.prompt, stubStore)
  const adapted = injectVideoReferences(s.model, SCHEMAS[s.model], {
    referenceImages: resolved.referenceImages,
    characterUrls: resolved.characterUrls,
    timestamps: resolved.timestamps,
    existingImages: s.existingImages,
  })
  s.assert(adapted, resolved.expandedPrompt)
  console.log()
}

console.log(`${GREEN}All asset-library scenarios passed.${RESET}`)
