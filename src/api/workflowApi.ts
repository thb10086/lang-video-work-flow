/**
 * Workflow CRUD API.
 */

import { api } from './client'
import type {
  WorkflowCreate,
  WorkflowUpdate,
  WorkflowResponse,
  WorkflowListResponse,
} from './types'

export const workflowApi = {
  save: (projectId: number, data: WorkflowCreate) =>
    api.post<WorkflowResponse>(`/api/projects/${projectId}/workflows`, data),

  list: (projectId: number) =>
    api.get<WorkflowListResponse>(`/api/projects/${projectId}/workflows`),

  getCurrent: (projectId: number) =>
    api.get<WorkflowResponse>(`/api/projects/${projectId}/workflows/current`),

  update: (workflowId: number, data: WorkflowUpdate) =>
    api.put<WorkflowResponse>(`/api/workflows/${workflowId}`, data),
}
