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
  is_enabled: number
  sort_order: number
  created_at: string
  updated_at: string
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
}
