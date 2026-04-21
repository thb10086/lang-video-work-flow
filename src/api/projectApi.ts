/**
 * Project CRUD API.
 */

import { api } from './client'
import type {
  ProjectCreate,
  ProjectUpdate,
  ProjectResponse,
  ProjectListResponse,
} from './types'

export const projectApi = {
  create: (data: ProjectCreate) =>
    api.post<ProjectResponse>('/api/projects', data),

  list: (params?: { status?: string; scenario?: string; page?: number; page_size?: number }) => {
    const qs = new URLSearchParams()
    if (params?.status) qs.set('status', params.status)
    if (params?.scenario) qs.set('scenario', params.scenario)
    if (params?.page) qs.set('page', String(params.page))
    if (params?.page_size) qs.set('page_size', String(params.page_size))
    const query = qs.toString()
    return api.get<ProjectListResponse>(`/api/projects${query ? `?${query}` : ''}`)
  },

  get: (id: number) =>
    api.get<ProjectResponse>(`/api/projects/${id}`),

  update: (id: number, data: ProjectUpdate) =>
    api.put<ProjectResponse>(`/api/projects/${id}`, data),

  delete: (id: number) =>
    api.delete<null>(`/api/projects/${id}`),
}
