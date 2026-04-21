/// <reference types="vite/client" />

interface ImportMetaEnv {
  // ── Backend (唯一外部地址) ──
  readonly VITE_BACKEND_URL: string

  // ── Agent behavior ──
  readonly VITE_AGENT_MAX_TOOL_ROUNDS: string
  readonly VITE_AGENT_TEMPERATURE: string
  readonly VITE_AGENT_MAX_TOKENS: string
  readonly VITE_CONTEXT_COMPACTION_WINDOW: string
  readonly VITE_AGENT_REFLECTION_THRESHOLD: string

  // ── UI defaults ──
  readonly VITE_POLL_INTERVAL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
