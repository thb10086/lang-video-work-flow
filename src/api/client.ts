/**
 * Unified HTTP client for Prism AI backend.
 * Handles base URL, error parsing, and retry logic.
 */

import { ENV } from '@/lib/env'

const BACKEND_URL = ENV.BACKEND_URL

interface ApiResponse<T> {
  code: number
  data: T
  message: string
}

class ApiError extends Error {
  constructor(
    public status: number,
    public code: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${BACKEND_URL}${path}`
  const method = options.method || 'GET'
  console.debug(`[API] ${method} ${url}`, options.body ? JSON.parse(options.body as string) : '')

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!res.ok) {
    let msg = res.statusText
    try {
      const body = await res.json()
      msg = body.message || body.detail || msg
    } catch { /* ignore parse error */ }
    throw new ApiError(res.status, -1, msg)
  }

  const body: ApiResponse<T> = await res.json()
  if (body.code !== 0) {
    throw new ApiError(res.status, body.code, body.message)
  }
  return body.data
}

/**
 * Raw POST — 直接返回 JSON body，不走 {code, data, message} 解包。
 * 用于 /api/agent/chat 等透传端点（返回 OpenAI 原始格式）。
 */
async function rawPost<T = Record<string, unknown>>(
  path: string,
  data?: unknown,
): Promise<T> {
  const url = `${BACKEND_URL}${path}`
  console.debug(`[API] POST ${url}`, data || '')
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: data ? JSON.stringify(data) : undefined,
  })
  if (!res.ok) {
    let msg = res.statusText
    try {
      const body = await res.json()
      msg = body.detail || body.message || msg
    } catch { /* ignore */ }
    throw new ApiError(res.status, -1, msg)
  }
  return res.json()
}

export const api = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),

  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PUT', body: data ? JSON.stringify(data) : undefined }),

  delete: <T>(path: string) =>
    request<T>(path, { method: 'DELETE' }),

  rawPost,
}

export { ApiError }
export type { ApiResponse }
