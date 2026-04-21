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
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, DEFAULT_LLM_MODEL } from '@/providers/modelDefaults'

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
      partialize: (state) => ({
        pollInterval: state.pollInterval,
        canvasBackground: state.canvasBackground,
        canvasBackgroundColor: state.canvasBackgroundColor,
        canvasGridGap: state.canvasGridGap,
        canvasSnapToGrid: state.canvasSnapToGrid,
        defaultImageModel: state.defaultImageModel,
        defaultVideoModel: state.defaultVideoModel,
        defaultLLMModel: state.defaultLLMModel,
        theme: state.theme,
      }),
    }
  )
)
