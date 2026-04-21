/**
 * API type definitions — mirrors backend Pydantic schemas.
 */

// ── Projects ──

export interface ProjectCreate {
  name: string
  description?: string
  scenario?: string
  style?: string
  settings_json?: Record<string, unknown>
}

export interface ProjectUpdate {
  name?: string
  description?: string
  cover_url?: string
  scenario?: string
  style?: string
  status?: string
  settings_json?: Record<string, unknown>
}

export interface ProjectResponse {
  id: number
  name: string
  description: string | null
  cover_url: string | null
  scenario: string
  style: string
  status: string
  settings_json: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface ProjectListResponse {
  items: ProjectResponse[]
  total: number
  page: number
  page_size: number
}

// ── Workflows ──

export interface WorkflowCreate {
  name: string
  nodes_json: Record<string, unknown>[]
  edges_json: Record<string, unknown>[]
  metadata_json?: Record<string, unknown>
  thumbnail_url?: string
}

export interface WorkflowUpdate {
  name?: string
  nodes_json?: Record<string, unknown>[]
  edges_json?: Record<string, unknown>[]
  metadata_json?: Record<string, unknown>
  thumbnail_url?: string
}

export interface WorkflowResponse {
  id: number
  project_id: number
  name: string
  version: number
  is_current: boolean
  nodes_json: Record<string, unknown>[]
  edges_json: Record<string, unknown>[]
  metadata_json: Record<string, unknown> | null
  thumbnail_url: string | null
  created_at: string
  updated_at: string
}

export interface WorkflowListResponse {
  items: WorkflowResponse[]
  total: number
}

// ── Templates ──

export interface TemplateResponse {
  id: number
  name: string
  description: string | null
  category: string
  scenario: string
  icon: string
  tags_json: string[] | null
  nodes_json: Record<string, unknown>[]
  edges_json: Record<string, unknown>[]
  config_json: Record<string, unknown> | null
  is_builtin: boolean
  is_public: boolean
  use_count: number
  created_at: string
  updated_at: string
}

export interface TemplateListResponse {
  items: TemplateResponse[]
  total: number
}
