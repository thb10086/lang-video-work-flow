/**
 * Backend Generation API — 前端 ↔ 后端生成/上传/任务代理
 *
 * 所有 AI 生成调用走后端 API 处理，
 * 前端不再直接调用外部 AI 服务。
 */

import { api } from './client'

// ── Types (mirrors backend Pydantic schemas) ──

export interface GeneratedImage {
  data: string
  mime_type: string
  url?: string
}

export interface ImageGenerateResponse {
  images: GeneratedImage[]
  text?: string
  usage?: Record<string, number>
}

export interface VideoTaskResponse {
  task_id: string
  status: string
}

export interface TaskStatusResponse {
  task_id: string
  status: string
  progress?: number
  output_url?: string
  output_urls?: string[]
  error?: string
}

export interface LLMChatResponse {
  text: string
  usage?: Record<string, number>
}

export interface ImageUploadResponse {
  url: string
  key: string
}

export interface BatchUploadResponse {
  results: ImageUploadResponse[]
}

export interface AiModelResponse {
  id: number
  model_id: string
  name: string
  provider: string
  capability: string
  description?: string
  param_schema: ParamFieldDTO[]
  schema_version?: number
  is_enabled: number
  sort_order: number
  created_at: string
  updated_at: string
}

export interface ModelParamsResponse {
  model_id: string
  schema: ParamFieldDTO[]
  schema_version: number
}

export interface ParamFieldDTO {
  key: string
  label: string
  type: string
  required?: boolean
  default?: unknown
  options?: { label: string; value: string | number }[]
  min?: number
  max?: number
  step?: number
  placeholder?: string
  description?: string
}

export interface AiModelListResponse {
  items: AiModelResponse[]
  total: number
}

// ── Asset Library DTOs ──

export type AssetKind = 'character' | 'scene' | 'style'

export interface VariationDTO {
  id: string
  label: string
  appearance_delta: string
  reference_images: string[]
}

/** Variation payload for CREATE/UPDATE body (id optional — server stamps it). */
export interface VariationInput {
  id?: string
  label: string
  appearance_delta?: string
  reference_images?: string[]
}

export interface AssetDTO {
  id: number
  asset_id: string
  kind: AssetKind
  user_id: number
  project_id: number | null
  name: string
  name_en: string | null
  /** kind=character */
  appearance?: string
  /** kind=scene */
  environment?: string
  /** kind=style */
  guide?: string
  reference_images: string[]
  variations: VariationDTO[]
  appearance_version: number
  metadata: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

export interface AssetListResponse {
  items: AssetDTO[]
  total: number
}

export interface ResolvedAssetResponse {
  asset_id: string
  kind: AssetKind
  appearance: string
  reference_images: string[]
  variation_id: string | null
}

export interface AssetCreateBody {
  kind: AssetKind
  name: string
  name_en?: string | null
  /** kind=character */
  appearance?: string
  /** kind=scene */
  environment?: string
  /** kind=style */
  guide?: string
  reference_images?: string[]
  variations?: VariationInput[]
  metadata?: Record<string, unknown>
  project_id?: number | null
}

export interface AssetUpdateBody {
  name?: string
  name_en?: string | null
  appearance?: string
  environment?: string
  guide?: string
  reference_images?: string[]
  variations?: VariationInput[]
  metadata?: Record<string, unknown>
  project_id?: number | null
}

export interface VariationBody {
  label: string
  appearance_delta?: string
  reference_images?: string[]
}

// ── Agent Config (from backend) ──

export interface AgentConfigResponse {
  default_llm_model: string
  default_image_model: string
  default_video_model: string
  llm_models: string[]
  backend_version: string
}

// ── API Functions ──

export const backendApi = {
  // ── Agent Chat (OpenAI-compatible passthrough) ──
  agentChat: async (params: {
    model?: string
    messages: Array<Record<string, unknown>>
    temperature?: number
    max_tokens?: number
    tools?: Array<Record<string, unknown>>
    tool_choice?: string
  }): Promise<Record<string, unknown>> => {
    return api.rawPost('/api/agent/chat', params)
  },

  agentConfig: () => api.get<AgentConfigResponse>('/api/agent/config'),

  // ── Models ──
  listModels: (capability?: string) => {
    const qs = capability ? `?capability=${capability}` : ''
    return api.get<AiModelListResponse>(`/api/models${qs}`)
  },

  getModel: (modelId: string) =>
    api.get<AiModelResponse>(`/api/models/${modelId}`),

  getModelSchema: (modelId: string) =>
    api.get<ParamFieldDTO[]>(`/api/models/${modelId}/schema`),

  getModelParams: (modelId: string) =>
    api.get<ModelParamsResponse>(`/api/models/${modelId}/params`),

  // ── Image Generation ──
  generateImage: (params: {
    model_id: string
    prompt: string
    reference_images?: string[]
    params?: Record<string, unknown>
  }) => api.post<ImageGenerateResponse>('/api/generate/image', params),

  // ── Video Generation (async) ──
  submitVideo: (params: {
    model_id: string
    prompt: string
    images?: string[]
    params?: Record<string, unknown>
  }) => api.post<VideoTaskResponse>('/api/generate/video', params),

  // ── Task Query ──
  queryTask: (taskId: string) =>
    api.get<TaskStatusResponse>(`/api/tasks/${taskId}`),

  // ── LLM Chat ──
  chat: (params: {
    model_id: string
    prompt: string
    system_prompt?: string
    temperature?: number
    max_tokens?: number
    params?: Record<string, unknown>
  }) => api.post<LLMChatResponse>('/api/generate/chat', params),

  // ── COS Upload ──
  uploadImage: (data: string, filename?: string) =>
    api.post<ImageUploadResponse>('/api/upload/image', { data, filename }),

  uploadBatch: (images: { data: string; filename?: string }[]) =>
    api.post<BatchUploadResponse>('/api/upload/batch', { images }),

  // ── Asset Library ──
  listAssets: (params: {
    kind: AssetKind
    q?: string
    project_id?: number | null
    include_global?: boolean
    limit?: number
    offset?: number
  }) => {
    const qs = new URLSearchParams()
    qs.set('kind', params.kind)
    if (params.q) qs.set('q', params.q)
    if (params.project_id != null) qs.set('project_id', String(params.project_id))
    if (params.include_global === false) qs.set('include_global', 'false')
    if (params.limit != null) qs.set('limit', String(params.limit))
    if (params.offset != null) qs.set('offset', String(params.offset))
    return api.get<AssetListResponse>(`/api/assets?${qs.toString()}`)
  },

  getAsset: (assetId: string) =>
    api.get<AssetDTO>(`/api/assets/${assetId}`),

  resolveAsset: (assetId: string, variation?: string) => {
    const qs = variation ? `?variation=${encodeURIComponent(variation)}` : ''
    return api.get<ResolvedAssetResponse>(`/api/assets/${assetId}/resolve${qs}`)
  },

  createAsset: (body: AssetCreateBody) =>
    api.post<AssetDTO>('/api/assets', body),

  updateAsset: (assetId: string, body: AssetUpdateBody) =>
    api.patch<AssetDTO>(`/api/assets/${assetId}`, body),

  deleteAsset: (assetId: string) =>
    api.delete<{ message?: string }>(`/api/assets/${assetId}`),

  restoreAsset: (assetId: string) =>
    api.post<AssetDTO>(`/api/assets/${assetId}/restore`, {}),

  listTrash: (kind?: AssetKind) => {
    const qs = kind ? `?kind=${kind}` : ''
    return api.get<AssetDTO[]>(`/api/assets/trash${qs}`)
  },

  createVariation: (assetId: string, body: VariationBody) =>
    api.post<AssetDTO>(`/api/assets/${assetId}/variations`, body),

  updateVariation: (assetId: string, variationId: string, body: VariationBody) =>
    api.patch<AssetDTO>(`/api/assets/${assetId}/variations/${variationId}`, body),

  deleteVariation: (assetId: string, variationId: string) =>
    api.delete<AssetDTO>(`/api/assets/${assetId}/variations/${variationId}`),
}
