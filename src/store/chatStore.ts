import { create } from 'zustand'
import { generateId } from '@/lib/utils'
import { useSettingsStore } from '@/store/settingsStore'
import { AGENT_TOOLS, executeToolCall } from '@/providers/agentTools'
import { useAgentMemoryStore } from '@/store/agentMemoryStore'
import { buildAgentSystemPrompt, compactConversationHistory, smartCompress, estimateTotalTokens } from '@/store/chatPromptBuilder'
import type { LLMMessage } from '@/store/chatPromptBuilder'
import { backendApi } from '@/api/backend'
import { getModelMaxTokens, TASK_TOKEN_BUDGETS } from '@/providers/modelDefaults'

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
}

export interface AgentStats {
  startTime: number
  elapsed: number
  rounds: number
  tokensUsed: number
  contextLayer: number
  toolCallCount: number
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

    // ── Always use frontend Agent loop (Claude Code pattern) ──
    // All generation calls are proxied through the backend.

    const memStore = useAgentMemoryStore.getState()
    if (memStore.currentPlan?.completedAt) {
      memStore.clearPlan()
    }

    const settings = useSettingsStore.getState()
    const modelId = chatModel || settings.defaultLLMModel

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
      const systemPrompt = buildAgentSystemPrompt(activeRole)

      const chatHistory = get().messages.filter(m => m.id !== assistantMsgId)
      const compactedHistory = compactConversationHistory(chatHistory)
      let llmMessages: LLMMessage[] = compactedHistory

      const MAX_TOOL_ROUNDS = settings.agentMaxToolRounds || 25
      const CONSECUTIVE_FAIL_LIMIT = 3
      let finalText = ''
      let consecutiveLlmFailures = 0
      let currentLayer = 0
      const allToolResults: { name: string; result: string; success: boolean }[] = []

      const thinkingVerbs = [
        '分析请求...', '理解意图...', '规划步骤...',
        '推理中...', '评估方案...', '组织思路...',
        '深入分析...', '检查依赖...', '调整策略...',
      ]

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        // ── Abort check ──
        if (signal.aborted) {
          finalText = '已取消执行。'
          break
        }

        const isFirstRound = round === 0

        // ── Circuit breaker ──
        if (consecutiveLlmFailures >= CONSECUTIVE_FAIL_LIMIT) {
          finalText = `Agent 连续 ${CONSECUTIVE_FAIL_LIMIT} 次调用 LLM 失败，已自动停止。请检查 API Key 和网络连接。`
          break
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

        // Update stats
        const tokenEstimate = estimateTotalTokens(llmMessages)
        set({ agentStats: {
          startTime, elapsed: Date.now() - startTime, rounds: round + 1,
          tokensUsed: tokenEstimate, contextLayer: currentLayer, toolCallCount: allToolResults.length,
        }})

        // ── LLM call via backend proxy (zero secrets in frontend) ──
        // Build messages array for OpenAI-compatible format
        const apiMessages: Array<Record<string, unknown>> = isFirstRound
          ? [
              { role: 'system', content: systemPrompt },
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
          agentResponse = await backendApi.agentChat({
            model: modelId,
            messages: apiMessages,
            temperature: settings.agentTemperature ?? 0.3,
            max_tokens: Math.min(settings.agentMaxTokens || TASK_TOKEN_BUDGETS.AGENT_CHAT, getModelMaxTokens(modelId)),
            tools: AGENT_TOOLS as unknown as Array<Record<string, unknown>>,
            tool_choice: 'auto',
          })
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

            try {
              const args = JSON.parse(tc.function.arguments)
              const result = await executeToolCall(toolName, args)
              allToolResults.push({ name: toolName, result: result.message, success: result.success })
              llmMessages.push({
                role: 'tool',
                content: JSON.stringify({ success: result.success, message: result.message, nodeIds: result.nodeIds }),
                tool_call_id: tc.id,
              } as LLMMessage)
            } catch {
              allToolResults.push({ name: toolName, result: '执行失败', success: false })
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
      set({ streamingMessageId: null, abortController: null, agentStats: null })
      setProcessing(false)
    }
  },
}))
