/**
 * Mock Backend — In-memory replacement for `backendApi.*` calls
 *
 * Installs a scenario-scoped sandbox over the real backend client so
 * scenario runs never touch the network. Every service is independently
 * configurable via `MockBackendConfig`.
 *
 * Design principles:
 *  - No global mutable state: controller owns all counters
 *  - Restore after use: `install()` returns a disposer that restores originals
 *  - Side-effect-free defaults: unconfigured services return deterministic
 *    success responses so minimal scenarios don't need to wire everything
 */

import { backendApi } from '@/api/backend'
import type {
  MockBackendConfig,
  MockServiceConfig,
  MockImageResponse,
  MockVideoResponse,
  MockVerifyResponse,
  MockUploadResponse,
} from './types'

// ============================================================
// Default responses (conservative, reusable)
// ============================================================

const DEFAULT_IMAGE: MockImageResponse = {
  images: [{
    url: 'mock://image/default.png',
    mime_type: 'image/png',
  }],
}

const DEFAULT_VIDEO: MockVideoResponse = {
  task_id: 'mock_task_default',
  status: 'succeeded',
  output_url: 'mock://video/default.mp4',
}

export const DEFAULT_VERIFY: MockVerifyResponse = {
  matchScore: 85,
  detectedSubjects: ['subject'],
  missingElements: [],
  unexpectedElements: [],
  recommendation: 'accept',
  reasoning: 'mock verify success',
}

const DEFAULT_UPLOAD: MockUploadResponse = {
  url: 'mock://cos/default.png',
  key: 'mock/default.png',
}

// ============================================================
// Controller
// ============================================================

export class MockBackendController {
  private readonly config: MockBackendConfig
  private readonly callCounts: Record<string, number> = {}
  private originals: Partial<typeof backendApi> = {}
  private installed = false

  constructor(config: MockBackendConfig = {}) {
    this.config = config
  }

  /**
   * Patch `backendApi.*` methods. Returns a disposer that restores them.
   * Calling `install()` twice without disposing throws.
   */
  install(): () => void {
    if (this.installed) {
      throw new Error('MockBackendController already installed — dispose first')
    }
    this.installed = true

    this.originals = {
      generateImage: backendApi.generateImage,
      submitVideo: backendApi.submitVideo,
      queryTask: backendApi.queryTask,
      chat: backendApi.chat,
      uploadImage: backendApi.uploadImage,
      uploadBatch: backendApi.uploadBatch,
      listModels: backendApi.listModels,
      getModel: backendApi.getModel,
      getModelParams: backendApi.getModelParams,
      listAssets: backendApi.listAssets,
      verifyImage: backendApi.verifyImage,
    }

    // ── model registry (avoid ECONNREFUSED noise in tests) ──
    backendApi.listModels = (async () => ({ items: [], total: 0 })) as typeof backendApi.listModels
    backendApi.getModel = (async () => {
      throw new Error('[MockBackend] getModel not configured for this scenario')
    }) as typeof backendApi.getModel
    backendApi.getModelParams = (async () => ({
      model_id: 'mock',
      schema: [],
      schema_version: 1,
    })) as typeof backendApi.getModelParams
    backendApi.listAssets = (async () => ({ items: [], total: 0 })) as typeof backendApi.listAssets

    // ── image generation ──
    backendApi.generateImage = (async () => {
      // Map to backend's ImageGenerateResponse shape (images + usage)
      const payload = await this.dispatch('image', this.config.image, DEFAULT_IMAGE)
      return {
        images: payload.images.map(img => ({
          data: img.data ?? '',
          mime_type: img.mime_type ?? 'image/png',
          url: img.url,
        })),
        text: payload.text,
      }
    }) as typeof backendApi.generateImage

    // ── video submission ──
    backendApi.submitVideo = (async () => {
      const payload = await this.dispatch('video', this.config.video, DEFAULT_VIDEO)
      return {
        task_id: payload.task_id,
        status: payload.status,
      }
    }) as typeof backendApi.submitVideo

    // ── task status (always returns succeeded unless video.customResponse says otherwise) ──
    backendApi.queryTask = (async (taskId: string) => {
      const videoPayload = await this.dispatch('video', this.config.video, DEFAULT_VIDEO)
      return {
        task_id: taskId,
        status: videoPayload.status,
        output_url: videoPayload.output_url,
        error: videoPayload.error,
      }
    }) as typeof backendApi.queryTask

    // ── LLM chat (used by llm_node — always returns mock text) ──
    backendApi.chat = (async () => ({
      text: 'mock llm output',
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    })) as typeof backendApi.chat

    // ── upload (reuses upload config) ──
    backendApi.uploadImage = (async () => {
      return this.dispatch('upload', this.config.upload, DEFAULT_UPLOAD)
    }) as typeof backendApi.uploadImage

    backendApi.uploadBatch = (async (images: { data: string; filename?: string }[]) => {
      const results = await Promise.all(
        images.map(() => this.dispatch('upload', this.config.upload, DEFAULT_UPLOAD)),
      )
      return { results }
    }) as typeof backendApi.uploadBatch

    // ── vision verify (`POST /api/verify/image`) ──
    // Scenario authors specify MockVerifyResponse in camelCase (matches the
    // frontend VerifyResult DSL). The real backend returns snake_case — we
    // translate here so the adapter's coerceResult sees the expected shape.
    backendApi.verifyImage = (async () => {
      const payload = await this.dispatch('verify', this.config.verify, DEFAULT_VERIFY)
      return {
        match_score: payload.matchScore,
        detected_subjects: payload.detectedSubjects,
        missing_elements: payload.missingElements,
        unexpected_elements: payload.unexpectedElements,
        recommendation: payload.recommendation,
        reasoning: payload.reasoning,
        cached: false,
      }
    }) as typeof backendApi.verifyImage

    return () => this.dispose()
  }

  private dispose(): void {
    if (!this.installed) return
    Object.assign(backendApi, this.originals)
    this.originals = {}
    this.installed = false
  }

  /** Total calls to a specific service (image / video / upload / audio / verify) */
  getCallCount(service: string): number {
    return this.callCounts[service] ?? 0
  }

  /**
   * Runs one "invocation" against a service config, applying latency + first-N-failure
   * semantics + customResponse/response precedence.
   */
  private async dispatch<T>(
    service: string,
    cfg: MockServiceConfig<T> | undefined,
    fallback: T,
  ): Promise<T> {
    const callIndex = this.callCounts[service] ?? 0
    this.callCounts[service] = callIndex + 1

    if (cfg?.latencyMs && cfg.latencyMs > 0) {
      await sleep(cfg.latencyMs)
    }

    if (cfg?.failFirstNCalls && callIndex < cfg.failFirstNCalls) {
      // Throw a synthetic error that mirrors what the real api client would do
      throw new Error(`[MockBackend] simulated failure on ${service} call ${callIndex + 1}`)
    }

    if (cfg?.customResponse) {
      return await cfg.customResponse(callIndex)
    }
    if (cfg?.response !== undefined) {
      return cfg.response
    }
    return fallback
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
