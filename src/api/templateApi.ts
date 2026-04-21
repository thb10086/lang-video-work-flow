/**
 * Template API.
 */

import { api } from './client'
import type { TemplateResponse, TemplateListResponse } from './types'

export const templateApi = {
  list: (params?: { category?: string; scenario?: string }) => {
    const qs = new URLSearchParams()
    if (params?.category) qs.set('category', params.category)
    if (params?.scenario) qs.set('scenario', params.scenario)
    const query = qs.toString()
    return api.get<TemplateListResponse>(`/api/templates${query ? `?${query}` : ''}`)
  },

  get: (id: number) =>
    api.get<TemplateResponse>(`/api/templates/${id}`),
}
