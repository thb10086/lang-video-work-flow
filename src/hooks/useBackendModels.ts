/**
 * useBackendModels — 从后端获取模型列表（带缓存）
 *
 * 后端 DB 是模型 + param_schema 的唯一数据源 (Single Source of Truth)。
 * 前端不维护任何静态 schema 回退 — 如果后端不可用，返回空列表 + error。
 *
 * The hook exposes a `retry()` action which drops the per-capability cache
 * entry and re-fetches. Node UIs surface this so the user can recover from
 * a backend restart without reloading the whole page.
 */

import { useCallback, useEffect, useState } from 'react'
import { backendApi, type AiModelResponse } from '@/api/backend'

const modelCache: Map<string, AiModelResponse[]> = new Map()

// In-flight request dedup: when N components mount simultaneously and the
// cache is still cold, the cache check + write is async — without dedup, all
// N components fire their own GET /api/models?capability=X request before
// the first response lands. On a fresh template import (e.g. 10 nodes) that
// produced ~25 redundant fetches in QA testing. We stash the in-flight
// promise per cache-key so all callers await the same fetch, then drop the
// entry when settled (success or fail) so retries can re-issue.
const inflightCache: Map<string, Promise<AiModelResponse[]>> = new Map()

function fetchModelsDeduped(capability: string | undefined, key: string): Promise<AiModelResponse[]> {
  const existing = inflightCache.get(key)
  if (existing) return existing
  const promise = backendApi.listModels(capability).then(res => res.items)
  inflightCache.set(key, promise)
  promise.finally(() => {
    // Always drop the in-flight entry once settled so a future retry() / cold
    // re-mount can fire a fresh request when the user wants one.
    inflightCache.delete(key)
  })
  return promise
}

export function useBackendModels(capability?: string): {
  models: AiModelResponse[]
  loading: boolean
  error: string | null
  retry: () => void
} {
  const [models, setModels] = useState<AiModelResponse[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refetchKey, setRefetchKey] = useState(0)

  useEffect(() => {
    const key = capability || '__all__'
    const cached = modelCache.get(key)
    if (cached) {
      setModels(cached)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    fetchModelsDeduped(capability, key)
      .then(items => {
        modelCache.set(key, items)
        setModels(items)
      })
      .catch(err => {
        console.warn('[useBackendModels] fetch failed:', err)
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setLoading(false))
  }, [capability, refetchKey])

  const retry = useCallback(() => {
    const key = capability || '__all__'
    modelCache.delete(key)
    inflightCache.delete(key)
    setRefetchKey(k => k + 1)
  }, [capability])

  return { models, loading, error, retry }
}

/** Invalidate cache (call after model CRUD) */
export function invalidateModelCache(): void {
  modelCache.clear()
  inflightCache.clear()
}
