import { create } from 'zustand'
import { generateId } from '@/lib/utils'
import { useSettingsStore } from '@/store/settingsStore'
import { AGENT_TOOLS, executeToolCall, getAgentTools, setSessionTools, clearSessionTools } from '@/providers/agentTools'
import { useAgentMemoryStore } from '@/store/agentMemoryStore'
import {
  buildAgentSystemPrompt,
  buildAgentSystemPromptSegments,
  buildSystemContentBlocks,
  compactConversationHistory,
  smartCompress,
  estimateTotalTokens,
} from '@/store/chatPromptBuilder'
import type { LLMMessage } from '@/store/chatPromptBuilder'
import { backendApi, type AiModelResponse } from '@/api/backend'
import { getModelMaxTokens, TASK_TOKEN_BUDGETS } from '@/providers/modelDefaults'
import { createAgentLoopController, DEFAULT_LOOP_CONFIG } from '@/lib/agentLoopControl'
import { useFlowStore } from '@/store/flowStore'
import { agentSseClient, type AgentEvent } from '@/api/agentSseClient'
import { dispatchClientTool } from '@/api/clientToolBridge'
import { useAgentSessionStore } from '@/store/agentSessionStore'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  images?: string[]
  timestamp: number
  thinking?: string
  toolCalls?: { name: string; result: string; success: boolean }[]
  duration?: number
  tokenUsage?: number
  contextLayer?: number
  /** Affected canvas nodes — used by AgentChat hover/anchor binding (D-9). */
  nodeRefs?: string[]
}

export interface AgentStats {
  startTime: number
  elapsed: number
  rounds: number
  tokensUsed: number
  contextLayer: number
  toolCallCount: number
  /** Approximate extra token cost of images uploaded in the current turn. */
  imageTokensApprox?: number
}

export interface ChatState {
  messages: ChatMessage[]
  isProcessing: boolean
  activeRole: string
  chatModel: string
  streamingMessageId: string | null
  agentStats: AgentStats | null
  abortController: AbortController | null

  addMessage: (role: 'user' | 'assistant' | 'system', content: string, images?: string[]) => string
  updateMessage: (id: string, partial: Partial<ChatMessage>) => void
  setProcessing: (processing: boolean) => void
  clearMessages: () => void
  setActiveRole: (role: string) => void
  setChatModel: (model: string) => void
  processUserMessage: (message: string, images?: string[]) => void
  cancelProcessing: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [
    {
      id: 'welcome',
      role: 'assistant' as const,
      content: '我是 AI 视频工作流助手。直接告诉我你想做什么，我会立即执行。\n\n例如：「做一个赛博朋克短片」「创建图片生成节点」「帮我加一个角色」',
      timestamp: Date.now(),
    },
  ],
  isProcessing: false,
  activeRole: 'assistant',
  chatModel: '',
  streamingMessageId: null,
  agentStats: null,
  abortController: null,

  addMessage: (role, content, images?) => {
    const id = generateId()
    const msg: ChatMessage = { id, role, content, timestamp: Date.now() }
    if (images && images.length > 0) msg.images = images
    set({ messages: [...get().messages, msg] })
    return id
  },

  updateMessage: (id, partial) => {
    set({
      messages: get().messages.map(m => m.id === id ? { ...m, ...partial } : m),
    })
  },

  setProcessing: (processing) => {
    set({ isProcessing: processing })
  },

  clearMessages: () => {
    set({ messages: [] })
    useAgentMemoryStore.getState().clearPlan()
  },

  setActiveRole: (role) => {
    set({ activeRole: role })
  },

  setChatModel: (model) => {
    set({ chatModel: model })
  },

  cancelProcessing: () => {
    const ctrl = get().abortController
    if (ctrl) ctrl.abort()
    set({ isProcessing: false, abortController: null, agentStats: null })
  },

  processUserMessage: async (message, images?) => {
    const { addMessage, updateMessage, setProcessing, activeRole, chatModel } = get()

    addMessage('user', message, images)
    setProcessing(true)

    // ── Abort controller for cancel support ──
    const abortCtrl = new AbortController()
    set({ abortController: abortCtrl })
    const signal = abortCtrl.signal

    const memStore = useAgentMemoryStore.getState()
    if (memStore.currentPlan?.completedAt) {
      memStore.clearPlan()
    }

    const settings = useSettingsStore.getState()
    const modelId = chatModel || settings.defaultLLMModel

    // ── Phase 1 feature flag: route to backend SSE runtime ──
    // When `useBackendRuntime` is true, hand off to the backend Agent
    // runtime via SSE + reverse RPC. The legacy frontend loop below stays
    // in place as a fallback (selectable via the same setting) until
    // Phase 4 cleanup removes it.
    if (settings.useBackendRuntime) {
      try {
        await runViaBackendRuntime({
          message,
          images,
          activeRole,
          model: modelId,
          signal,
          updateMessage,
          addMessageId: addMessage('assistant', ''),
        })
      } finally {
        setProcessing(false)
        set({ abortController: null, streamingMessageId: null, agentStats: null })
      }
      return
    }

    if (!modelId) {
      addMessage('assistant', '默认 LLM 模型未配置，请检查后端 server/.env 文件中的 DEFAULT_LLM_MODEL 配置，并确保后端服务已启动。')
      setProcessing(false)
      set({ abortController: null })
      return
    }

    const assistantMsgId = addMessage('assistant', '')
    const startTime = Date.now()
    set({
      streamingMessageId: assistantMsgId,
      agentStats: { startTime, elapsed: 0, rounds: 0, tokensUsed: 0, contextLayer: 0, toolCallCount: 0 },
    })
    updateMessage(assistantMsgId, { thinking: '分析请求...' })

    // Stats updater (every 500ms)
    const statsInterval = setInterval(() => {
      const stats = get().agentStats
      if (stats) set({ agentStats: { ...stats, elapsed: Date.now() - startTime } })
    }, 500)

    try {
      const imageCount = images?.length ?? 0
      // Build once per turn — the segment list is reused for both the
      // legacy string payload and the cache-controlled content-block payload
      // so they stay byte-identical apart from framing.
      const promptSegments = buildAgentSystemPromptSegments(activeRole, { imageCount, userMessage: message })
      const systemPrompt = promptSegments.map(s => s.text).filter(Boolean).join('\n\n')
      const systemContentBlocks = settings.enablePromptCaching
        ? buildSystemContentBlocks(promptSegments)
        : null
      if (imageCount > 0) {
        // Per OpenAI vision-high-detail: ~258 tokens per image baseline.
        const imageTokensApprox = imageCount * 258
        const stats = get().agentStats
        if (stats) set({ agentStats: { ...stats, imageTokensApprox } })
      }

      // Fetch model registry once per processing session so we can build
      // model-aware tool schemas. Fallback to static AGENT_TOOLS on failure.
      let agentTools: Array<Record<string, unknown>> = AGENT_TOOLS as unknown as Array<Record<string, unknown>>
      try {
        const [videoRes, imageRes, audioRes] = await Promise.all([
          backendApi.listModels('video').catch(() => ({ items: [] as AiModelResponse[], total: 0 })),
          backendApi.listModels('image').catch(() => ({ items: [] as AiModelResponse[], total: 0 })),
          backendApi.listModels('audio').catch(() => ({ items: [] as AiModelResponse[], total: 0 })),
        ])
        // Progressive disclosure: hand the Agent a pruned tool set derived
        // from the user's current intent + canvas state + phase. phase gates
        // destructive / off-sequence tools (e.g. deny create_*_node while
        // planning). discover_tools is always available as an escape hatch.
        const canvasEmpty = useFlowStore.getState().nodes.length === 0
        const phase = useAgentMemoryStore.getState().currentPhase
        agentTools = getAgentTools({
          videoModels: videoRes.items,
          imageModels: imageRes.items,
          audioModels: audioRes.items,
          context: { userMessage: message, canvasEmpty },
          phase,
        }) as unknown as Array<Record<string, unknown>>
      } catch (toolErr) {
        console.warn('[chatStore] tool schema build failed, falling back to static:', toolErr)
      }

      // Expose this session's tool list so discover_tools returns the exact
      // schema (with dynamic model enums) that the LLM is reasoning against.
      setSessionTools(agentTools as unknown as typeof AGENT_TOOLS)

      const chatHistory = get().messages.filter(m => m.id !== assistantMsgId)
      const compactedHistory = compactConversationHistory(chatHistory)
      let llmMessages: LLMMessage[] = compactedHistory

      // ── Flexible loop controller (Claude Code / AutoGen inspired) ──
      // Five independent dimensions; any one can stop the loop:
      //   1. Iterations (safety net, default 50)
      //   2. Token budget (cost gate)
      //   3. Wall-clock time (latency gate)
      //   4. Tool-call count
      //   5. Loop detection (same tool+args repeated)
      //   6. Stall detection (canvas/memory unchanged for N rounds)
      const controller = createAgentLoopController({
        ...DEFAULT_LOOP_CONFIG,
        maxIterations: settings.agentMaxToolRounds || DEFAULT_LOOP_CONFIG.maxIterations,
      })
      const CONSECUTIVE_FAIL_LIMIT = 3
      let finalText = ''
      let consecutiveLlmFailures = 0
      let currentLayer = 0
      let forceSummaryMode = false
      const allToolResults: { name: string; result: string; success: boolean }[] = []

      const thinkingVerbs = [
        '分析请求...', '理解意图...', '规划步骤...',
        '推理中...', '评估方案...', '组织思路...',
        '深入分析...', '检查依赖...', '调整策略...',
      ]

      // Produce a stable signature of canvas + memory state for stall detection.
      const getProgressSignature = (): string => {
        const flowState = useFlowStore.getState()
        const memState = useAgentMemoryStore.getState()
        const nodeKey = flowState.nodes.map(n => `${n.id}:${n.data?.status ?? ''}`).sort().join(',')
        const memKey = `${memState.memories.length}|${memState.currentPhase}|${memState.currentPlan?.steps.filter(s => s.status === 'done').length ?? 0}`
        return `n=${nodeKey}|m=${memKey}|t=${allToolResults.length}`
      }

      for (let round = 0; ; round++) {
        // ── Abort check ──
        if (signal.aborted) {
          finalText = '已取消执行。'
          break
        }

        const isFirstRound = round === 0

        // ── LLM call failure circuit breaker ──
        if (consecutiveLlmFailures >= CONSECUTIVE_FAIL_LIMIT) {
          finalText = `Agent 连续 ${CONSECUTIVE_FAIL_LIMIT} 次调用 LLM 失败，已自动停止。请检查 API Key 和网络连接。`
          break
        }

        // ── Evaluate termination conditions ──
        const tokenEstimate = estimateTotalTokens(llmMessages)
        const elapsedNow = Date.now() - startTime
        if (!isFirstRound) {
          controller.observeProgress(getProgressSignature(), round)
        }
        const decision = controller.evaluate({
          round: round + 1,
          elapsedMs: elapsedNow,
          tokensUsed: tokenEstimate,
          toolCallCount: allToolResults.length,
          toolHistory: [],
          progressSignature: getProgressSignature(),
        })

        if (decision.shouldStop) {
          finalText = controller.buildStopMessage(decision)
          break
        }

        // Force-summary mode: strip tools on next LLM call so the agent wraps up.
        if (decision.escalation === 'force-summary' && !forceSummaryMode) {
          forceSummaryMode = true
          llmMessages.push({
            role: 'user',
            content: controller.buildReflection(decision),
          } as LLMMessage)
        } else if (decision.escalation === 'warn' && !isFirstRound) {
          // Soft warning — inject once per reason to avoid spam
          const warnKey = `__warn_${decision.reason}`
          if (!(controller as unknown as { [k: string]: unknown })[warnKey]) {
            ;(controller as unknown as { [k: string]: unknown })[warnKey] = true
            llmMessages.push({
              role: 'user',
              content: controller.buildReflection(decision),
            } as LLMMessage)
          }
        }

        // ── Smart context compression before each LLM call ──
        if (!isFirstRound) {
          const compressed = smartCompress(llmMessages)
          llmMessages = compressed.messages
          if (compressed.layer > currentLayer) {
            currentLayer = compressed.layer
            const layerNames = ['', 'MicroCompact', 'AutoCompact', 'FullCompact']
            updateMessage(assistantMsgId, {
              thinking: `上下文压缩 (${layerNames[compressed.layer]})...`,
            })
          }
        }

        // Update thinking state
        const thinkingText = isFirstRound
          ? '分析请求...'
          : allToolResults.length > 0
            ? `执行中... 已完成 ${allToolResults.length} 项操作`
            : thinkingVerbs[Math.min(round, thinkingVerbs.length - 1)]

        updateMessage(assistantMsgId, {
          thinking: thinkingText,
          toolCalls: allToolResults.length > 0 ? [...allToolResults] : undefined,
        })

        // Update stats (tokenEstimate computed above for controller eval)
        set({ agentStats: {
          startTime, elapsed: Date.now() - startTime, rounds: round + 1,
          tokensUsed: tokenEstimate, contextLayer: currentLayer, toolCallCount: allToolResults.length,
        }})

        // ── LLM call via backend proxy (zero secrets in frontend) ──
        // Build messages array for OpenAI-compatible format. When prompt
        // caching is enabled (settings.enablePromptCaching), ship the
        // system prompt as an array of typed text blocks with cache_control
        // markers — the backend decides whether to forward as-is
        // (Anthropic) or flatten back to a string (OpenAI-compatible).
        const systemMessage = systemContentBlocks
          ? { role: 'system', content: systemContentBlocks }
          : { role: 'system', content: systemPrompt }
        const apiMessages: Array<Record<string, unknown>> = isFirstRound
          ? [
              systemMessage,
              ...llmMessages,
              message
                ? (images && images.length > 0
                    ? { role: 'user', content: [
                        { type: 'text', text: message },
                        ...images.map(img => ({ type: 'image_url', image_url: { url: img } })),
                      ]}
                    : { role: 'user', content: message })
                : null,
            ].filter(Boolean) as Array<Record<string, unknown>>
          : llmMessages as Array<Record<string, unknown>>

        let agentResponse: Record<string, unknown>
        try {
          // In force-summary mode, omit tools so the agent has to produce
          // a textual final answer instead of calling more tools.
          const callPayload: Record<string, unknown> = {
            model: modelId,
            messages: apiMessages,
            temperature: settings.agentTemperature ?? 0.3,
            max_tokens: Math.min(settings.agentMaxTokens || TASK_TOKEN_BUDGETS.AGENT_CHAT, getModelMaxTokens(modelId)),
          }
          if (!forceSummaryMode) {
            callPayload.tools = agentTools
            callPayload.tool_choice = 'auto'
          }
          agentResponse = await backendApi.agentChat(callPayload as Parameters<typeof backendApi.agentChat>[0])
          consecutiveLlmFailures = 0
        } catch (llmErr) {
          consecutiveLlmFailures++
          const errMsg = llmErr instanceof Error ? llmErr.message : 'LLM 调用失败'
          updateMessage(assistantMsgId, {
            thinking: `LLM 错误 (${consecutiveLlmFailures}/${CONSECUTIVE_FAIL_LIMIT}): ${errMsg}`,
          })
          await new Promise(r => setTimeout(r, 1000 * consecutiveLlmFailures))
          continue
        }

        // Parse OpenAI-compatible response
        const choices = (agentResponse.choices as Array<Record<string, unknown>>) || []
        const firstChoice = choices[0] || {}
        const choiceMsg = firstChoice.message as Record<string, unknown> | undefined
        const toolCalls = choiceMsg?.tool_calls as Array<{
          id: string
          function: { name: string; arguments: string }
        }> | undefined
        const assistantText = (choiceMsg?.content as string) || ''

        if (toolCalls && toolCalls.length > 0) {
          llmMessages.push({
            role: 'assistant',
            content: assistantText || null,
            tool_calls: toolCalls,
          })

          for (const tc of toolCalls) {
            if (signal.aborted) break

            const toolName = tc.function.name
            updateMessage(assistantMsgId, {
              thinking: `执行 ${toolName}...`,
              toolCalls: [...allToolResults],
            })

            let parsedArgs: Record<string, unknown> = {}
            try {
              parsedArgs = JSON.parse(tc.function.arguments)
              const result = await executeToolCall(toolName, parsedArgs)
              allToolResults.push({ name: toolName, result: result.message, success: result.success })
              // Feed the controller so it can detect loops (same tool+args repeated)
              controller.recordToolCall({ tool: toolName, args: parsedArgs, success: result.success })
              llmMessages.push({
                role: 'tool',
                content: JSON.stringify({ success: result.success, message: result.message, nodeIds: result.nodeIds }),
                tool_call_id: tc.id,
              } as LLMMessage)
            } catch {
              allToolResults.push({ name: toolName, result: '执行失败', success: false })
              controller.recordToolCall({ tool: toolName, args: parsedArgs, success: false })
              llmMessages.push({
                role: 'tool',
                content: JSON.stringify({ success: false, message: `执行失败: ${toolName}` }),
                tool_call_id: tc.id,
              } as LLMMessage)
            }
          }

          if (signal.aborted) { finalText = '已取消执行。'; break }

          updateMessage(assistantMsgId, {
            thinking: '继续推理...',
            toolCalls: [...allToolResults],
          })

          // ── Observation: inject progress feedback after each round ──
          const roundResults = allToolResults.slice(-toolCalls.length)
          const roundFailures = roundResults.filter(r => !r.success)
          const roundSuccesses = roundResults.filter(r => r.success)

          if (roundFailures.length > 0) {
            // Self-correction: inject reflection on failures
            const failSummary = roundFailures.map(f => `${f.name}: ${f.result}`).join('; ')
            const totalFailures = allToolResults.filter(r => !r.success).length
            let reflectionMsg = `[REFLECTION] 本轮有 ${roundFailures.length} 个工具调用失败: ${failSummary}。`
            if (totalFailures >= (settings.agentReflectionThreshold || 3)) {
              reflectionMsg += ` 累计已有 ${totalFailures} 次失败。请分析失败原因，考虑：1) 是否为暂时性错误（API负载、网络），可稍后重试；2) 是否为参数错误，需要修改方案；3) 是否应该跳过这一步，先做其他步骤。用 update_plan_step 标记失败步骤，然后调整策略继续。`
            } else {
              reflectionMsg += ` 请分析错误信息，决定是重试还是调整方案。`
            }
            llmMessages.push({ role: 'user', content: reflectionMsg } as LLMMessage)
          } else if (roundSuccesses.length > 0) {
            // Success observation: remind agent to update plan and check HALT
            const plan = useAgentMemoryStore.getState().currentPlan
            if (plan && !plan.completedAt) {
              const doneCount = plan.steps.filter(s => s.status === 'done').length
              const totalSteps = plan.steps.length
              const nextPending = plan.steps.find(s => s.status === 'pending')
              if (doneCount === totalSteps) {
                // HALT condition: all plan steps done → remind to verify and finish
                llmMessages.push({ role: 'user', content: `[OBSERVATION] 所有 ${totalSteps} 个计划步骤已完成。请调用 verify_task 进行最终质量检查，然后向用户总结结果。如果评分 >= 80，直接完成；否则修复问题后再次验证。` } as LLMMessage)
              } else if (nextPending) {
                llmMessages.push({ role: 'user', content: `[OBSERVATION] 本轮 ${roundSuccesses.length} 个工具执行成功。进度: ${doneCount}/${totalSteps}。记得用 update_plan_step 标记已完成的步骤，然后继续下一步: "${nextPending.description}"。` } as LLMMessage)
              }
            }
          }

          continue
        }

        finalText = assistantText
        break
      }

      if (!finalText && allToolResults.length > 0) {
        const succeeded = allToolResults.filter(r => r.success)
        const failed = allToolResults.filter(r => !r.success)
        const lines: string[] = []
        if (succeeded.length > 0) lines.push(`完成 ${succeeded.length} 项操作。`)
        if (failed.length > 0) lines.push(`${failed.length} 项失败: ${failed.map(f => f.result).join('; ')}`)
        finalText = lines.join(' ') || '操作已完成。'
      } else if (!finalText) {
        finalText = '(无回复)'
      }

      const totalDuration = Date.now() - startTime
      const finalTokens = estimateTotalTokens(llmMessages)

      updateMessage(assistantMsgId, {
        content: finalText,
        thinking: undefined,
        toolCalls: allToolResults.length > 0 ? allToolResults : undefined,
        duration: totalDuration,
        tokenUsage: finalTokens,
        contextLayer: currentLayer,
      })

    } catch (err) {
      const msg = err instanceof Error ? err.message : '调用 LLM 失败'
      updateMessage(assistantMsgId, {
        content: `错误: ${msg}`,
        thinking: undefined,
      })
    } finally {
      clearInterval(statsInterval)
      clearSessionTools()
      set({ streamingMessageId: null, abortController: null, agentStats: null })
      setProcessing(false)
    }
  },
}))


// ============================================================
// Backend Runtime Bridge (Phase 1 — feature-flagged path)
// ============================================================
//
// When `settings.useBackendRuntime` is true, `processUserMessage` defers
// to this function, which:
//   1. Calls `agentSseClient.run(...)` to start a server session
//   2. Subscribes to the SSE event stream
//   3. Translates events into chatStore message updates
//   4. Forwards `client_tool_request` events to the local clientToolBridge
//   5. Pushes `approval_required` events to `agentSessionStore.approvalQueue`
//
// The legacy in-process loop in `processUserMessage` stays untouched as a
// fallback.

interface RunViaBackendArgs {
  message: string
  images?: string[]
  activeRole: string
  model: string
  signal: AbortSignal
  updateMessage: (id: string, partial: Partial<ChatMessage>) => void
  addMessageId: string
}

async function runViaBackendRuntime(args: RunViaBackendArgs): Promise<void> {
  const { message, images, activeRole, model, signal, updateMessage, addMessageId } = args
  const sessionStore = useAgentSessionStore.getState()
  const startTime = Date.now()

  updateMessage(addMessageId, { thinking: '连接后端 Agent...' })

  let handle: { sessionId: number; events: AsyncIterable<AgentEvent>; cancel: () => Promise<void> }
  try {
    handle = await agentSseClient.run({
      message,
      images,
      role: activeRole,
      model,
      projectId: useFlowStore.getState().projectId,
      signal,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '后端 Agent 启动失败'
    updateMessage(addMessageId, {
      content: `错误: ${msg}`,
      thinking: undefined,
    })
    return
  }

  sessionStore.startSession(handle.sessionId)
  signal.addEventListener('abort', () => { handle.cancel().catch(() => undefined) }, { once: true })

  let assistantText = ''
  const toolCalls: { name: string; result: string; success: boolean }[] = []
  const nodeRefs: string[] = []
  const seenNodeRefs = new Set<string>()

  try {
    for await (const event of handle.events) {
      sessionStore.ingestEvent(event)

      // Forward client tool requests to the bridge (fire-and-forget; the
      // bridge POSTs the result back via reverse RPC).
      if (event.type === 'client_tool_request' && event.call_id && event.name) {
        void dispatchClientTool(
          event.name,
          (event.args as Record<string, unknown>) || {},
          { sessionId: handle.sessionId, callId: event.call_id },
          event.timeout_ms,
        )
      }

      // Real-time UI updates per event type
      switch (event.type) {
        case 'session_start':
          updateMessage(addMessageId, { thinking: '推理中...' })
          break
        case 'phase_change':
          updateMessage(addMessageId, { thinking: `阶段: ${event.phase || ''}` })
          break
        case 'reasoning_delta':
          if (event.text) {
            assistantText += event.text
            updateMessage(addMessageId, { content: assistantText, thinking: undefined })
          }
          break
        case 'tool_call':
          toolCalls.push({
            name: event.name || 'unknown',
            result: '执行中...',
            success: false,
          })
          updateMessage(addMessageId, {
            thinking: `执行 ${event.name || 'tool'}...`,
            toolCalls: [...toolCalls],
          })
          break
        case 'tool_result': {
          const last = [...toolCalls].reverse().find((c) => c.result === '执行中...')
          if (last) {
            last.success = !!event.ok
            try {
              last.result = event.ok
                ? (event.data ? JSON.stringify(event.data).slice(0, 200) : '完成')
                : (event.error?.message || '失败')
            } catch {
              last.result = event.ok ? '完成' : '失败'
            }
          }
          // Accumulate affected node ids for canvas ↔ chat binding (D-9).
          const data = event.data as { affected_node_ids?: string[]; nodeId?: string } | null | undefined
          const ids: string[] = []
          if (data && Array.isArray(data.affected_node_ids)) ids.push(...data.affected_node_ids)
          if (data && typeof data.nodeId === 'string') ids.push(data.nodeId)
          for (const id of ids) {
            if (!seenNodeRefs.has(id)) {
              seenNodeRefs.add(id)
              nodeRefs.push(id)
            }
          }
          updateMessage(addMessageId, { toolCalls: [...toolCalls], nodeRefs: [...nodeRefs] })
          break
        }
        case 'stats_update':
          set({
            agentStats: {
              startTime,
              elapsed: event.elapsed_ms ?? Date.now() - startTime,
              rounds: event.rounds ?? 0,
              tokensUsed: event.tokens ?? 0,
              contextLayer: 0,
              toolCallCount: event.tool_calls ?? toolCalls.length,
            },
          })
          break
        case 'final':
          if (event.text) assistantText = event.text
          updateMessage(addMessageId, {
            content: assistantText || '(无回复)',
            thinking: undefined,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            duration: Date.now() - startTime,
          })
          break
        case 'error':
          updateMessage(addMessageId, {
            thinking: `错误: ${event.message || ''}`.slice(0, 80),
          })
          break
        case 'done':
          // Loop exits naturally on next iteration (events generator yields done last).
          break
        default:
          break
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '后端会话异常中断'
    updateMessage(addMessageId, {
      content: assistantText || `错误: ${msg}`,
      thinking: undefined,
    })
  } finally {
    sessionStore.endSession()
  }
}

// `set` is not in scope inside the module-level helper — extract via the store.
function set(partial: Partial<ChatState>): void {
  useChatStore.setState(partial)
}
