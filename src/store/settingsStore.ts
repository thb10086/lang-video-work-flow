/**
 * Settings Store
 *
 * 所有密钥/模型列表由后端管理。
 * 此 Store 仅管理用户偏好：画布设置、默认模型选择、轮询间隔、Agent 行为。
 * 初始化时从后端 /api/agent/config 获取默认模型配置。
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ENV } from '@/lib/env'
import { backendApi } from '@/api/backend'
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, DEFAULT_LLM_MODEL, DEFAULT_VISION_ADAPTER } from '@/providers/modelDefaults'

export interface SettingsState {
  // 任务轮询
  pollInterval: number

  // 画布设置
  canvasBackground: 'dots' | 'lines' | 'cross' | 'none'
  canvasBackgroundColor: string
  canvasGridGap: number
  canvasSnapToGrid: boolean

  // 默认模型选择（从后端 /api/agent/config 获取）
  defaultImageModel: string
  defaultVideoModel: string
  defaultLLMModel: string

  // 后端可用 LLM 模型列表
  availableLLMModels: string[]

  // Agent 行为配置（从 .env 读取）
  agentMaxToolRounds: number
  agentTemperature: number
  agentMaxTokens: number
  contextCompactionWindow: number
  agentReflectionThreshold: number

  // 工具响应预算：query 类工具（get_canvas_state 等）返回 concise 格式，
  // LLM 显式传 response_format='detailed' 才返回完整字段，节省上下文 token。
  enableResponseBudget: boolean

  // 提示词缓存：将 system prompt 拆为多个 content 块，对 stable/semi-stable
  // 块附加 cache_control（Anthropic 原生支持）。默认关闭以避免上游 provider
  // 不支持时返回 400；启用后后端会对非 Anthropic 模型自动扁平化回字符串。
  enablePromptCaching: boolean

  // Vision verify 适配器 id（对应 visionVerifyAdapter.ts 注册的适配器）。
  // 默认 DEFAULT_VISION_ADAPTER（见 modelDefaults.ts）。切换该值立即反映到 getActiveVerifier()。
  visionVerifyModel: string

  // Phase 0 feature flag — 切换前端 chatStore 主循环 → 后端 SSE runtime。
  // 默认 false（保持当前行为）。Phase 1 灰度通过后会在 settings 默认值改为 true。
  // 不持久化到 localStorage 后会从 ENV 重读，确保 dogfood 切换可控。
  useBackendRuntime: boolean

  // 主题
  theme: 'light' | 'dark' | 'system'

  // 初始化状态
  initialized: boolean

  // Actions
  setTheme: (theme: 'light' | 'dark' | 'system') => void
  setPollInterval: (interval: number) => void
  setCanvasSettings: (settings: Partial<{
    canvasBackground: 'dots' | 'lines' | 'cross' | 'none'
    canvasBackgroundColor: string
    canvasGridGap: number
    canvasSnapToGrid: boolean
  }>) => void
  setDefaultModels: (models: Partial<{
    defaultImageModel: string
    defaultVideoModel: string
    defaultLLMModel: string
  }>) => void
  setEnableResponseBudget: (value: boolean) => void
  setEnablePromptCaching: (value: boolean) => void
  setVisionVerifyModel: (modelId: string) => void
  setUseBackendRuntime: (value: boolean) => void
  initialize: () => void
}

// ── Theme helper ──

function applyTheme(theme: 'light' | 'dark' | 'system') {
  const root = document.documentElement
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.toggle('dark', prefersDark)
  } else {
    root.classList.toggle('dark', theme === 'dark')
  }
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      pollInterval: ENV.POLL_INTERVAL,

      canvasBackground: 'dots',
      canvasBackgroundColor: '#0f0f23',
      canvasGridGap: 20,
      canvasSnapToGrid: true,

      defaultImageModel: DEFAULT_IMAGE_MODEL,
      defaultVideoModel: DEFAULT_VIDEO_MODEL,
      defaultLLMModel: DEFAULT_LLM_MODEL,
      availableLLMModels: [],

      agentMaxToolRounds: ENV.AGENT_MAX_TOOL_ROUNDS,
      agentTemperature: ENV.AGENT_TEMPERATURE,
      agentMaxTokens: ENV.AGENT_MAX_TOKENS,
      contextCompactionWindow: ENV.CONTEXT_COMPACTION_WINDOW,
      agentReflectionThreshold: ENV.AGENT_REFLECTION_THRESHOLD,

      enableResponseBudget: true,
      enablePromptCaching: false,
      visionVerifyModel: DEFAULT_VISION_ADAPTER,
      useBackendRuntime: false,

      theme: 'dark',

      initialized: false,

      setTheme: (theme) => {
        set({ theme })
        applyTheme(theme)
      },

      setPollInterval: (interval) => {
        set({ pollInterval: interval })
      },

      setCanvasSettings: (settings) => {
        set((state) => ({ ...state, ...settings }))
      },

      setDefaultModels: (models) => {
        set((state) => ({ ...state, ...models }))
      },

      setEnableResponseBudget: (value) => {
        set({ enableResponseBudget: value })
      },

      setEnablePromptCaching: (value) => {
        set({ enablePromptCaching: value })
      },

      setVisionVerifyModel: (modelId) => {
        set({ visionVerifyModel: modelId })
      },

      setUseBackendRuntime: (value) => {
        set({ useBackendRuntime: value })
      },

      initialize: () => {
        const state = get()
        if (state.initialized) return

        applyTheme(state.theme)
        set({ initialized: true })

        // 从后端获取 Agent 配置（默认模型、可用模型列表）
        backendApi.agentConfig().then(config => {
          set({
            defaultImageModel: config.default_image_model || state.defaultImageModel,
            defaultVideoModel: config.default_video_model || state.defaultVideoModel,
            defaultLLMModel: config.default_llm_model || state.defaultLLMModel,
            availableLLMModels: config.llm_models || [],
          })
          console.info('[Settings] Agent config loaded from backend:', config)
        }).catch(err => {
          console.warn('[Settings] Failed to load agent config from backend:', err)
        })
      },
    }),
    {
      name: 'ai-workflow-settings',
      // ── 版本管理 ──
      // 每次修改默认模型/常量时递增 version，migrate 自动清除 localStorage 中的旧值。
      // 这样改 modelDefaults.ts 就够了，不会被 localStorage 缓存覆盖。
      version: 4,
      migrate: (persisted: any, version: number) => {
        if (version < 2) {
          // v0/v1 → v2: 重置模型默认值到当前常量（清除旧持久化缓存）
          persisted = {
            ...persisted,
            defaultImageModel: DEFAULT_IMAGE_MODEL,
            defaultVideoModel: DEFAULT_VIDEO_MODEL,
            defaultLLMModel: DEFAULT_LLM_MODEL,
          }
        }
        if (version < 3) {
          // v2 → v3: agent-experience-overhaul Phase 0 — 新增 useBackendRuntime
          // 默认 false，保持当前行为；用户可在 SettingsPanel 切换开关。
          persisted = {
            ...persisted,
            useBackendRuntime: false,
          }
        }
        if (version < 4) {
          // v3 → v4: 默认视频模型从 veo3.1-fast 切到 sora-2-vvip
          // （toapis 平台上 sora-2-vvip 30 积分/次性价比最高，i2v/r2v 模式一致性最好）
          persisted = {
            ...persisted,
            defaultImageModel: DEFAULT_IMAGE_MODEL,
            defaultVideoModel: DEFAULT_VIDEO_MODEL,
            defaultLLMModel: DEFAULT_LLM_MODEL,
          }
        }
        return persisted as SettingsState
      },
      partialize: (state) => ({
        pollInterval: state.pollInterval,
        canvasBackground: state.canvasBackground,
        canvasBackgroundColor: state.canvasBackgroundColor,
        canvasGridGap: state.canvasGridGap,
        canvasSnapToGrid: state.canvasSnapToGrid,
        defaultImageModel: state.defaultImageModel,
        defaultVideoModel: state.defaultVideoModel,
        defaultLLMModel: state.defaultLLMModel,
        enableResponseBudget: state.enableResponseBudget,
        enablePromptCaching: state.enablePromptCaching,
        visionVerifyModel: state.visionVerifyModel,
        useBackendRuntime: state.useBackendRuntime,
        theme: state.theme,
      }),
    }
  )
)
