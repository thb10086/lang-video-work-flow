/**
 * Unified Environment Configuration
 *
 * 前端仅保留后端地址和 Agent 行为参数。
 * 所有密钥（API Key / COS / 渠道 Key / 默认模型）由后端管理。
 *
 * 使用方式：
 *   import { ENV } from '@/lib/env'
 *   const url = ENV.BACKEND_URL
 */

// ── Core reader ──

function read(name: string, fallback = ''): string {
  return (import.meta.env[name] as string) || fallback
}

function readNumber(name: string, fallback: number): number {
  const raw = read(name)
  const n = Number(raw)
  return raw && !isNaN(n) ? n : fallback
}

function readFloat(name: string, fallback: number): number {
  const raw = read(name)
  const n = parseFloat(raw)
  return raw && !isNaN(n) ? n : fallback
}

// ── Exported constants ──

export const ENV = {
  // ── Backend (唯一外部地址) ──
  BACKEND_URL: read('VITE_BACKEND_URL', 'http://localhost:8000'),

  // ── Agent behavior ──
  AGENT_MAX_TOOL_ROUNDS:       readNumber('VITE_AGENT_MAX_TOOL_ROUNDS', 25),
  AGENT_TEMPERATURE:           readFloat('VITE_AGENT_TEMPERATURE', 0.3),
  AGENT_MAX_TOKENS:            readNumber('VITE_AGENT_MAX_TOKENS', 16384),
  CONTEXT_COMPACTION_WINDOW:   readNumber('VITE_CONTEXT_COMPACTION_WINDOW', 10),
  AGENT_REFLECTION_THRESHOLD:  readNumber('VITE_AGENT_REFLECTION_THRESHOLD', 3),

  // ── UI defaults ──
  POLL_INTERVAL: readNumber('VITE_POLL_INTERVAL', 5000),
} as const
