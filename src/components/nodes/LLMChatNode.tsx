import { memo, useCallback, useMemo, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { MessageSquare, Play, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { useFlowStore } from '@/store/flowStore'
import { backendApi } from '@/api/backend'
import { useSettingsStore } from '@/store/settingsStore'
import { DEFAULT_LLM_MODEL, TASK_TOKEN_BUDGETS } from '@/providers/modelDefaults'
import { useBackendModels } from '@/hooks/useBackendModels'

function LLMChatNode({ id, data, selected }: NodeProps) {
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

  const handleModelChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    updateNodeData(id, { model: e.target.value })
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

  const borderClass = status === 'generating'
    ? 'border-yellow-400 shadow-yellow-200/50 animate-pulse'
    : status === 'done'
    ? 'border-green-500 shadow-green-200/50'
    : status === 'error'
    ? 'border-red-500 shadow-red-200/50'
    : selected
    ? 'border-violet-500 shadow-violet-200'
    : 'border-border'

  return (
    <div className={`workflow-node bg-card border-2 rounded-xl shadow-lg w-[300px] transition-all duration-300 ${borderClass}`}>
      <Handle type="target" position={Position.Left} id="system-in" className="!w-3 !h-3 !bg-amber-500" style={{ top: '30%' }} />
      <Handle type="target" position={Position.Left} id="user-in" className="!w-3 !h-3 !bg-amber-500" style={{ top: '70%' }} />

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-violet-500/10 rounded-t-xl border-b border-border">
        <MessageSquare className="w-4 h-4 text-violet-500" />
        <span className="font-semibold text-sm">{label}</span>
        {status === 'done' && <CheckCircle2 className="w-3.5 h-3.5 text-green-500 ml-auto" />}
        {status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-red-500 ml-auto" />}
      </div>

      {/* Content */}
      <div className="p-3 space-y-2">
        {/* Model */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">模型</span>
          <select
            value={modelId}
            onChange={handleModelChange}
            className="text-xs font-medium bg-violet-100 text-violet-700 px-2 py-0.5 rounded border-0 outline-none cursor-pointer"
          >
            {llmModels.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>

        {/* System Prompt */}
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">系统提示</label>
          <textarea
            value={systemPrompt}
            onChange={handleSystemPromptChange}
            placeholder="设置AI角色和行为..."
            rows={2}
            className="w-full text-xs rounded-md border border-border bg-muted/30 p-2 resize-none focus:outline-none focus:ring-1 focus:ring-violet-400 placeholder:text-muted-foreground/50"
          />
        </div>

        {/* User Input */}
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">用户输入</label>
          <textarea
            value={userInput}
            onChange={handleUserInputChange}
            placeholder="输入问题或指令..."
            rows={2}
            className="w-full text-xs rounded-md border border-border bg-muted/30 p-2 resize-none focus:outline-none focus:ring-1 focus:ring-violet-400 placeholder:text-muted-foreground/50"
          />
        </div>

        {/* Error */}
        {errorMsg && (
          <div className="text-[10px] text-red-500 bg-red-50 rounded px-2 py-1 break-all">{errorMsg}</div>
        )}

        {/* Response */}
        {response && (
          <div className="bg-muted/50 rounded-md p-2 max-h-[150px] overflow-y-auto">
            <p className="text-xs whitespace-pre-wrap text-foreground">
              {response}
              {isStreaming && <span className="inline-block w-1.5 h-3.5 bg-violet-500/70 ml-0.5 animate-pulse" />}
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border">
        <button
          onClick={handleGenerate}
          disabled={!userInput.trim() || isStreaming}
          className={`w-full py-1.5 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            isStreaming
              ? 'bg-yellow-100 text-yellow-700'
              : status === 'done'
              ? 'bg-green-500 text-white hover:bg-green-600'
              : 'bg-violet-500 text-white hover:bg-violet-600'
          }`}
        >
          {isStreaming ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> 生成中...</>
          ) : status === 'done' ? (
            <><Play className="w-3 h-3" /> 重新生成</>
          ) : (
            <><Play className="w-3 h-3" /> 生成</>
          )}
        </button>
      </div>

      <Handle type="source" position={Position.Right} id="text-out" className="!w-3 !h-3 !bg-amber-500" />
    </div>
  )
}

export default memo(LLMChatNode)
