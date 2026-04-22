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
    backendApi.listModels(capability)
      .then(res => {
        modelCache.set(key, res.items)
        setModels(res.items)
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
    setRefetchKey(k => k + 1)
  }, [capability])

  return { models, loading, error, retry }
}

/** Invalidate cache (call after model CRUD) */
export function invalidateModelCache(): void {
  modelCache.clear()
}
