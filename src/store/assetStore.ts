/**
 * assetStore — Zustand store for the cross-project Asset Library
 *
 * Holds characters / scenes / styles indexed by `asset_id`. Exposes:
 *   - fetchAll() to warm the cache from backend
 *   - create / update / remove / restore / addVariation / updateVariation / removeVariation
 *   - search(text, kind?) — synchronous ranking helper
 *   - resolve(assetIdOrToken) — synchronous resolution helper (uses local cache)
 *
 * The store is independent of workflow/project selection: assets survive canvas
 * clears. Call `fetchAll()` once at app mount (see `bridgeLegacyToAssets` in
 * `flowStore`) and after every CRUD operation.
 */

import { create } from 'zustand'
import {
  backendApi,
  type AssetDTO,
  type AssetKind,
  type AssetCreateBody,
  type AssetUpdateBody,
  type VariationBody,
  type VariationDTO,
} from '@/api/backend'

// ── Helpers ──

const KINDS: AssetKind[] = ['character', 'scene', 'style']

function bucketFor(kind: AssetKind): 'characters' | 'scenes' | 'styles' {
  if (kind === 'character') return 'characters'
  if (kind === 'scene') return 'scenes'
  return 'styles'
}

function stringForSearch(a: AssetDTO): string {
  const content = a.appearance || a.environment || a.guide || ''
  return `${a.name || ''} ${a.name_en || ''} ${content}`.toLowerCase()
}

export interface ResolvedAssetRef {
  asset: AssetDTO
  variation: VariationDTO | null
  /** Merged appearance = base + ", " + variation delta (if any) */
  appearance: string
  /** Variation images first, then parent images */
  reference_images: string[]
}

// ── Store shape ──

export interface AssetStoreState {
  characters: Record<string, AssetDTO>
  scenes: Record<string, AssetDTO>
  styles: Record<string, AssetDTO>
  loading: boolean
  error: string | null
  lastFetchedAt: number | null

  // Actions
  fetchAll: () => Promise<void>
  fetchByKind: (kind: AssetKind) => Promise<void>
  create: (body: AssetCreateBody) => Promise<AssetDTO>
  /**
   * Synchronous, backend-free asset insertion. Stamps a local `asset_id`
   * and stores the DTO in the in-memory map so `generate_workflow` (and
   * other pure-frontend code paths) can create assets even when the
   * backend is offline. Server reconciliation happens on next `fetchAll`.
   */
  seedLocal: (body: AssetCreateBody) => AssetDTO
  update: (assetId: string, patch: AssetUpdateBody) => Promise<AssetDTO>
  remove: (assetId: string) => Promise<void>
  restore: (assetId: string) => Promise<AssetDTO>
  addVariation: (assetId: string, body: VariationBody) => Promise<AssetDTO>
  updateVariation: (assetId: string, variationId: string, body: VariationBody) => Promise<AssetDTO>
  removeVariation: (assetId: string, variationId: string) => Promise<AssetDTO>

  // Synchronous helpers
  get: (assetId: string) => AssetDTO | null
  search: (text: string, kind?: AssetKind, limit?: number) => AssetDTO[]
  resolve: (tokenOrAssetId: string) => ResolvedAssetRef | null
  /** Flat list across all kinds; convenient for panels. */
  all: () => AssetDTO[]
}

function upsert(record: Record<string, AssetDTO>, asset: AssetDTO): Record<string, AssetDTO> {
  return { ...record, [asset.asset_id]: asset }
}

function drop(record: Record<string, AssetDTO>, assetId: string): Record<string, AssetDTO> {
  const { [assetId]: _removed, ...rest } = record
  return rest
}

export const useAssetStore = create<AssetStoreState>((set, get) => ({
  characters: {},
  scenes: {},
  styles: {},
  loading: false,
  error: null,
  lastFetchedAt: null,

  fetchAll: async () => {
    set({ loading: true, error: null })
    try {
      const results = await Promise.all(
        KINDS.map(k => backendApi.listAssets({ kind: k, limit: 500 })),
      )
      const by: Partial<Record<AssetKind, Record<string, AssetDTO>>> = {}
      for (let i = 0; i < KINDS.length; i++) {
        by[KINDS[i]] = Object.fromEntries(results[i].items.map(a => [a.asset_id, a]))
      }
      set({
        characters: by.character || {},
        scenes: by.scene || {},
        styles: by.style || {},
        lastFetchedAt: Date.now(),
      })
    } catch (err) {
      console.warn('[assetStore] fetchAll failed:', err)
      set({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      set({ loading: false })
    }
  },

  fetchByKind: async (kind) => {
    set({ loading: true, error: null })
    try {
      const res = await backendApi.listAssets({ kind, limit: 500 })
      const map = Object.fromEntries(res.items.map(a => [a.asset_id, a]))
      set({ [bucketFor(kind)]: map } as Partial<AssetStoreState>)
    } catch (err) {
      console.warn('[assetStore] fetchByKind failed:', err)
      set({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      set({ loading: false })
    }
  },

  create: async (body) => {
    const asset = await backendApi.createAsset(body)
    const bucket = bucketFor(asset.kind)
    set(state => ({ [bucket]: upsert(state[bucket], asset) } as Partial<AssetStoreState>))
    return asset
  },

  seedLocal: (body) => {
    // Mint a client-only asset_id using the same prefix scheme as the backend
    // (`char_/scene_/style_`) + 8 alnum chars. Short collision probability.
    const prefix = body.kind === 'character' ? 'char' : body.kind === 'scene' ? 'scene' : 'style'
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let rand = ''
    for (let i = 0; i < 8; i++) rand += alphabet[Math.floor(Math.random() * alphabet.length)]
    const assetId = `${prefix}_${rand}`
    const now = new Date().toISOString()
    const asset: AssetDTO = {
      id: -Math.floor(Math.random() * 1_000_000),  // negative => client-minted sentinel
      asset_id: assetId,
      kind: body.kind,
      user_id: 0,
      project_id: body.project_id ?? null,
      name: body.name,
      name_en: body.name_en ?? null,
      appearance: body.appearance,
      environment: body.environment,
      guide: body.guide,
      reference_images: body.reference_images || [],
      variations: (body.variations || []).map(v => ({
        id: v.id || `var_${Math.random().toString(36).slice(2, 8)}`,
        label: v.label,
        appearance_delta: v.appearance_delta || '',
        reference_images: v.reference_images || [],
      })),
      appearance_version: 1,
      metadata: body.metadata || {},
      created_at: now,
      updated_at: now,
    }
    const bucket = bucketFor(asset.kind)
    set(state => ({ [bucket]: upsert(state[bucket], asset) } as Partial<AssetStoreState>))
    return asset
  },

  update: async (assetId, patch) => {
    const asset = await backendApi.updateAsset(assetId, patch)
    const bucket = bucketFor(asset.kind)
    set(state => ({ [bucket]: upsert(state[bucket], asset) } as Partial<AssetStoreState>))
    return asset
  },

  remove: async (assetId) => {
    const existing = get().get(assetId)
    if (!existing) {
      // still issue the delete so backend cleans up; ignore not-found locally
      await backendApi.deleteAsset(assetId).catch(() => {})
      return
    }
    await backendApi.deleteAsset(assetId)
    const bucket = bucketFor(existing.kind)
    set(state => ({ [bucket]: drop(state[bucket], assetId) } as Partial<AssetStoreState>))
  },

  restore: async (assetId) => {
    const asset = await backendApi.restoreAsset(assetId)
    const bucket = bucketFor(asset.kind)
    set(state => ({ [bucket]: upsert(state[bucket], asset) } as Partial<AssetStoreState>))
    return asset
  },

  addVariation: async (assetId, body) => {
    const asset = await backendApi.createVariation(assetId, body)
    const bucket = bucketFor(asset.kind)
    set(state => ({ [bucket]: upsert(state[bucket], asset) } as Partial<AssetStoreState>))
    return asset
  },

  updateVariation: async (assetId, variationId, body) => {
    const asset = await backendApi.updateVariation(assetId, variationId, body)
    const bucket = bucketFor(asset.kind)
    set(state => ({ [bucket]: upsert(state[bucket], asset) } as Partial<AssetStoreState>))
    return asset
  },

  removeVariation: async (assetId, variationId) => {
    const asset = await backendApi.deleteVariation(assetId, variationId)
    const bucket = bucketFor(asset.kind)
    set(state => ({ [bucket]: upsert(state[bucket], asset) } as Partial<AssetStoreState>))
    return asset
  },

  get: (assetId) => {
    const state = get()
    return (
      state.characters[assetId] ||
      state.scenes[assetId] ||
      state.styles[assetId] ||
      null
    )
  },

  search: (text, kind, limit = 8) => {
    const state = get()
    const pool: AssetDTO[] = kind
      ? Object.values(state[bucketFor(kind)])
      : [
          ...Object.values(state.characters),
          ...Object.values(state.scenes),
          ...Object.values(state.styles),
        ]
    const needle = (text || '').trim().toLowerCase()
    if (!needle) {
      // no search text: most-recently-updated first
      return pool
        .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
        .slice(0, limit)
    }
    const scored: [number, AssetDTO][] = []
    for (const a of pool) {
      const hay = stringForSearch(a)
      const idx = hay.indexOf(needle)
      if (idx >= 0) {
        // Higher score for matches at word start
        const score = -idx + (hay.startsWith(needle) ? 1000 : 0)
        scored.push([score, a])
      }
    }
    scored.sort((x, y) => y[0] - x[0])
    return scored.slice(0, limit).map(([, a]) => a)
  },

  resolve: (tokenOrAssetId) => {
    // Accept either "char_abc" or "char_abc:var_xyz"
    const raw = tokenOrAssetId.startsWith('@') ? tokenOrAssetId.slice(1) : tokenOrAssetId
    const [assetId, variationId] = raw.split(':')
    const asset = get().get(assetId)
    if (!asset) return null

    const baseContent = asset.appearance || asset.environment || asset.guide || ''
    if (!variationId) {
      return {
        asset,
        variation: null,
        appearance: baseContent,
        reference_images: [...(asset.reference_images || [])],
      }
    }
    const variation = (asset.variations || []).find(v => v.id === variationId)
    if (!variation) {
      return {
        asset,
        variation: null,
        appearance: baseContent,
        reference_images: [...(asset.reference_images || [])],
      }
    }
    const delta = variation.appearance_delta || ''
    const appearance = delta ? `${baseContent}, ${delta}`.replace(/^,\s*/, '') : baseContent
    const variationImages = variation.reference_images || []
    const parentImages = asset.reference_images || []
    const mergedImages = [
      ...variationImages,
      ...parentImages.filter(img => !variationImages.includes(img)),
    ]
    return {
      asset,
      variation,
      appearance,
      reference_images: mergedImages,
    }
  },

  all: () => {
    const s = get()
    return [
      ...Object.values(s.characters),
      ...Object.values(s.scenes),
      ...Object.values(s.styles),
    ]
  },
}))
