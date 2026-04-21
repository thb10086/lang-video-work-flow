/**
 * WebSocket Client — 前端↔后端双向通信
 *
 * 消息协议与 server/app/routers/chat.py 对齐。
 * 支持自动重连、心跳、消息回调。
 */

import { ENV } from '@/lib/env'

// ── Message Types ──

export interface WsMessage {
  type: string
  [key: string]: unknown
}

export interface WsUserMessage {
  type: 'user_message'
  content: string
  images?: string[]
  session_id?: string
}

export interface WsCanvasResult {
  type: 'canvas_result'
  command_id: string
  success: boolean
  data?: Record<string, unknown>
}

export type WsMessageHandler = (msg: WsMessage) => void

// ── WebSocket Manager ──

const HEARTBEAT_INTERVAL = 30_000
const RECONNECT_DELAY = 3_000
const MAX_RECONNECT_ATTEMPTS = 5

export class PrismWebSocket {
  private ws: WebSocket | null = null
  private url: string
  private handlers: Map<string, WsMessageHandler[]> = new Map()
  private reconnectAttempts = 0
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private _sessionId = ''
  private _connected = false

  constructor(url?: string) {
    const baseUrl = url || ENV.BACKEND_URL
    this.url = baseUrl.replace(/^http/, 'ws') + '/ws/chat'
  }

  get sessionId(): string { return this._sessionId }
  get connected(): boolean { return this._connected }

  /** Register a handler for a specific message type */
  on(type: string, handler: WsMessageHandler): () => void {
    const list = this.handlers.get(type) || []
    list.push(handler)
    this.handlers.set(type, list)
    return () => {
      const idx = list.indexOf(handler)
      if (idx >= 0) list.splice(idx, 1)
    }
  }

  /** Connect to the WebSocket server */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return

    try {
      this.ws = new WebSocket(this.url)

      this.ws.onopen = () => {
        this._connected = true
        this.reconnectAttempts = 0
        this._startHeartbeat()
        this._emit('_open', { type: '_open' })
      }

      this.ws.onmessage = (event) => {
        try {
          const msg: WsMessage = JSON.parse(event.data)

          if (msg.type === 'connected') {
            this._sessionId = String(msg.session_id || '')
          }

          this._emit(msg.type, msg)
          this._emit('*', msg) // Wildcard handler
        } catch {
          console.warn('[WS] Failed to parse message:', event.data)
        }
      }

      this.ws.onclose = () => {
        this._connected = false
        this._stopHeartbeat()
        this._emit('_close', { type: '_close' })
        this._attemptReconnect()
      }

      this.ws.onerror = (err) => {
        console.error('[WS] Error:', err)
        this._emit('_error', { type: '_error', error: err })
      }
    } catch (err) {
      console.error('[WS] Connection failed:', err)
    }
  }

  /** Send a message to the server */
  send(msg: WsUserMessage | WsCanvasResult | { type: string; [k: string]: unknown }): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WS] Not connected, cannot send')
      return
    }
    this.ws.send(JSON.stringify(msg))
  }

  /** Send user message */
  sendUserMessage(content: string, images?: string[]): void {
    this.send({
      type: 'user_message',
      content,
      images: images || [],
      session_id: this._sessionId,
    })
  }

  /** Report canvas command execution result */
  sendCanvasResult(commandId: string, success: boolean, data?: Record<string, unknown>): void {
    this.send({
      type: 'canvas_result',
      command_id: commandId,
      success,
      data,
    })
  }

  /** Disconnect */
  disconnect(): void {
    this.reconnectAttempts = MAX_RECONNECT_ATTEMPTS // Prevent reconnect
    this._stopHeartbeat()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this._connected = false
    this._sessionId = ''
  }

  // ── Private ──

  private _emit(type: string, msg: WsMessage): void {
    const list = this.handlers.get(type)
    if (list) {
      for (const h of list) {
        try { h(msg) } catch (e) { console.error(`[WS] Handler error (${type}):`, e) }
      }
    }
  }

  private _startHeartbeat(): void {
    this._stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping' })
    }, HEARTBEAT_INTERVAL)
  }

  private _stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private _attemptReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return
    this.reconnectAttempts++
    console.info(`[WS] Reconnecting (${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`)
    setTimeout(() => this.connect(), RECONNECT_DELAY)
  }
}

// ── Singleton ──

let _instance: PrismWebSocket | null = null

export function getWebSocket(): PrismWebSocket {
  if (!_instance) {
    _instance = new PrismWebSocket()
  }
  return _instance
}
