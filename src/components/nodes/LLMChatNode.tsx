/**
 * LLMChatNode — LibTV-style LLM conversation node.
 *
 * Accepts a system prompt (in a popover chip so it stays out of the way)
 * and a main user input. The response is rendered as a chat bubble beneath
 * the input. Inputs come from two left handles (system-in / user-in),
 * output is a plain text string on the right.
 */
import { memo, useCallback, useMemo, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  MessageSquare, AlertTriangle, Sparkles, ChevronDown, Terminal,
} from 'lucide-react'

import { useFlowStore } from '@/store/flowStore'
import { backendApi } from '@/api/backend'
import { DEFAULT_LLM_MODEL, TASK_TOKEN_BUDGETS } from '@/providers/modelDefaults'
import { useBackendModels } from '@/hooks/useBackendModels'

import {
  NodeShell, NodeToolbar, SubmitButton, ParamPopover,
} from '@/components/nodes/_shell'

function LLMChatNode({ id, data }: NodeProps) {
  const { models: backendLLMModels } = useBackendModels('text')
  const llmModels = useMemo(() => {
    return backendLLMModels.map(m => ({ id: m.model_id, name: m.name }))
  }, [backendLLMModels])
  const status = String(data.status || 'idle')
  const label = String(data.label || 'LLM 对话')
  const systemPrompt = String(data.systemPrompt || '')
  const userInput = String(data.userInput || '')
  const response = String(data.response || '')
  const modelId = String(data.model || 'gemini-3.1-pro-preview')
  const errorMsg = data.errorMsg ? String(data.errorMsg) : null
  const [isStreaming, setIsStreaming] = useState(false)

  const updateNodeData = useFlowStore((s) => s.updateNodeData)

  const handleSystemPromptChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateNodeData(id, { systemPrompt: e.target.value })
  }, [id, updateNodeData])

  const handleUserInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateNodeData(id, { userInput: e.target.value })
  }, [id, updateNodeData])

  const handleModelChange = useCallback((newModelId: string) => {
    updateNodeData(id, { model: newModelId })
  }, [id, updateNodeData])

  const handleGenerate = useCallback(async () => {
    const prompt = String(data.userInput || '')
    if (!prompt.trim() || isStreaming) return

    const currentModelId = String(data.model || DEFAULT_LLM_MODEL)
    updateNodeData(id, { status: 'generating', errorMsg: null, response: '' })
    setIsStreaming(true)

    try {
      const sysPrompt = String(data.systemPrompt || '')

      const result = await backendApi.chat({
        model_id: currentModelId,
        prompt,
        system_prompt: sysPrompt || undefined,
        temperature: 0.7,
        max_tokens: TASK_TOKEN_BUDGETS.LLM_CHAT,
      })
      updateNodeData(id, { status: 'done', response: result.text || '' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '调用失败'
      updateNodeData(id, { status: 'error', errorMsg: msg })
    } finally {
      setIsStreaming(false)
    }
  }, [id, data.userInput, data.model, data.systemPrompt, isStreaming, updateNodeData])

  const nodes = useFlowStore(s => s.nodes)
  const handleGhostConnect = useCallback((side: 'left' | 'right') => {
    const self = nodes.find(n => n.id === id)
    if (!self) return
    const offset = side === 'left' ? -340 : 340
    const position = { x: (self.position?.x ?? 0) + offset, y: self.position?.y ?? 0 }
    window.dispatchEvent(new CustomEvent('libtv-ghost-connect', {
      detail: { sourceNodeId: id, side, position },
    }))
  }, [nodes, id])

  const currentModel = llmModels.find(m => m.id === modelId)
  const hasSystemPrompt = systemPrompt.trim().length > 0

  const labelRightSlot = (
    <div className="flex items-center gap-1">
      {status === 'done' && <span className="text-[hsl(var(--success))]">✓</span>}
      {status === 'error' && <AlertTriangle size={11} className="text-[hsl(var(--destructive))]" />}
    </div>
  )

  return (
    <NodeShell
      icon={<MessageSquare size={11} strokeWidth={2.5} />}
      label={label}
      labelRight={labelRightSlot}
      width={380}
      executing={isStreaming}
      ghostConnect={{ left: true, right: true }}
      onGhostConnect={handleGhostConnect}
    >
      <Handle type="target" position={Position.Left} id="system-in" style={{ top: '35%' }} />
      <Handle type="target" position={Position.Left} id="user-in"   style={{ top: '65%' }} />
      <Handle type="source" position={Position.Right} id="text-out" />

      <div className="p-3 space-y-2.5">
        {/* ── RESPONSE CHAT BUBBLE (preview-like slot, only when we have output) ── */}
        {(response || isStreaming) && (
          <div className="libtv-preview p-3 max-h-[220px] overflow-y-auto" style={{ aspectRatio: 'auto' }}>
            <p className="text-[12px] whitespace-pre-wrap text-[hsl(var(--foreground))] leading-relaxed">
              {response || (isStreaming ? '正在思考...' : '')}
              {isStreaming && (
                <span className="inline-block w-1.5 h-3.5 bg-[hsl(var(--libtv-accent)/0.8)] ml-0.5 animate-pulse align-middle" />
              )}
            </p>
          </div>
        )}

        {/* ── USER INPUT (primary) ── */}
        <textarea
          value={userInput}
          onChange={handleUserInputChange}
          placeholder="输入问题或指令…"
          rows={3}
          className="libtv-prompt"
        />

        {/* ── TOOLBAR ── */}
        <NodeToolbar
          left={
            <>
              <ParamPopover
                align="start"
                width={240}
                trigger={({ toggle }) => (
                  <button type="button" className="libtv-chip" onClick={toggle}>
                    <Sparkles size={12} strokeWidth={2} className="text-[hsl(var(--libtv-accent))]" />
                    <span className="truncate max-w-[120px]" title={currentModel?.name || modelId}>
                      {currentModel?.name || modelId}
                    </span>
                    <ChevronDown size={11} strokeWidth={2} />
                  </button>
                )}
              >
                <div className="space-y-0.5 max-h-[240px] overflow-y-auto">
                  {llmModels.length === 0 && (
                    <div className="text-[11px] text-[hsl(var(--libtv-muted))] p-2">加载模型列表...</div>
                  )}
                  {llmModels.map(m => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleModelChange(m.id)}
                      className={`w-full text-left px-2 py-1.5 rounded-md text-[11px] transition-colors ${
                        m.id === modelId
                          ? 'bg-[hsl(var(--libtv-accent)/0.15)] text-[hsl(var(--libtv-accent))]'
                          : 'hover:bg-[hsl(var(--libtv-chip-bg))]'
                      }`}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              </ParamPopover>

              <ParamPopover
                align="start"
                width={320}
                trigger={({ toggle }) => (
                  <button
                    type="button"
                    className={`libtv-chip ${hasSystemPrompt ? 'libtv-chip--active' : ''}`}
                    onClick={toggle}
                    title={hasSystemPrompt ? systemPrompt : '设置系统提示'}
                  >
                    <Terminal size={12} strokeWidth={2} />
                    <span>{hasSystemPrompt ? '系统提示 · 已设' : '系统提示'}</span>
                    <ChevronDown size={11} strokeWidth={2} />
                  </button>
                )}
              >
                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-[hsl(var(--libtv-chip-fg))]">System Prompt</div>
                  <textarea
                    value={systemPrompt}
                    onChange={handleSystemPromptChange}
                    placeholder="设置AI角色和行为…例：你是一名专业的视频分镜师。"
                    rows={5}
                    className="libtv-prompt !py-2 !px-3 !bg-[hsl(var(--libtv-chip-bg))] rounded-lg"
                  />
                </div>
              </ParamPopover>
            </>
          }
          right={
            <SubmitButton
              onClick={handleGenerate}
              disabled={!userInput.trim() || isStreaming}
              loading={isStreaming}
            />
          }
        />

        {errorMsg && (
          <div className="text-[10px] text-[hsl(var(--destructive))] bg-[hsl(var(--destructive)/0.08)] border border-[hsl(var(--destructive)/0.2)] rounded-lg px-2 py-1.5 break-all">
            {errorMsg}
          </div>
        )}
      </div>
    </NodeShell>
  )
}

export default memo(LLMChatNode)
