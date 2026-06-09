import { useState } from 'react'
import { Settings, Check } from 'lucide-react'
import { useSettingsStore } from '@/store/settingsStore'
import { useBackendModels } from '@/hooks/useBackendModels'
import { DEFAULT_VISION_ADAPTER } from '@/providers/modelDefaults'

function SettingsPanel() {
  const {
    pollInterval,
    defaultImageModel,
    defaultVideoModel,
    defaultLLMModel,
    enableResponseBudget,
    enablePromptCaching,
    visionVerifyModel,
    useBackendRuntime,
    setPollInterval,
    setDefaultModels,
    setEnableResponseBudget,
    setEnablePromptCaching,
    setVisionVerifyModel,
    setUseBackendRuntime,
  } = useSettingsStore()

  const [localPollInterval, setLocalPollInterval] = useState(String(pollInterval / 1000))
  const [saved, setSaved] = useState(false)

  const { models: imageModelsRaw } = useBackendModels('image')
  const { models: videoModelsRaw } = useBackendModels('video')
  const { models: textModelsRaw } = useBackendModels('text')
  const imageModels = imageModelsRaw.map(m => ({ id: m.model_id, name: m.name, provider: m.provider }))
  const videoModels = videoModelsRaw.map(m => ({ id: m.model_id, name: m.name, provider: m.provider }))
  const textModels = textModelsRaw.map(m => ({ id: m.model_id, name: m.name, provider: m.provider }))

  // Vision verify adapters are declared statically in code (see
  // `src/providers/geminiVisionAdapter.ts`) — the backend whitelist mirrors
  // this set. Adding an adapter = register + add id here.
  const visionVerifyOptions: Array<{ id: string; name: string }> = [
    { id: DEFAULT_VISION_ADAPTER, name: 'Gemini Vision (默认)' },
  ]

  const handleSave = () => {
    const interval = Math.max(1, Number(localPollInterval) || 5) * 1000
    setPollInterval(interval)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="p-3 space-y-4">
      <div className="flex items-center gap-2 mb-3">
        <Settings className="w-4 h-4 text-muted-foreground" />
        <span className="font-semibold text-sm">设置</span>
      </div>

      {/* Channel status (read-only) */}
      <div className="space-y-1.5">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">渠道状态</span>
        <div className="text-[11px] text-muted-foreground space-y-1 bg-muted/30 rounded-md px-3 py-2">
          {videoModels.length > 0 ? (
            videoModels.map(m => (
              <div key={m.id} className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                <span className="font-mono text-[10px]">{m.id}</span>
                <span className="text-muted-foreground/60 ml-auto">{m.provider}</span>
              </div>
            ))
          ) : (
            <span className="text-red-400">未配置视频渠道，请检查 .env</span>
          )}
        </div>
      </div>

      <div className="pt-2 border-t border-border">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">偏好设置</span>
      </div>

      {/* Poll Interval */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">轮询间隔 (秒)</label>
        <input
          type="number"
          value={localPollInterval}
          onChange={(e) => setLocalPollInterval(e.target.value)}
          min="1"
          max="60"
          className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-muted/30 focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Default Image Model */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">默认图片模型</label>
        <select
          value={defaultImageModel}
          onChange={(e) => setDefaultModels({ defaultImageModel: e.target.value })}
          className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-muted/30 focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {imageModels.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      {/* Default Video Model */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">默认视频模型</label>
        <select
          value={defaultVideoModel}
          onChange={(e) => setDefaultModels({ defaultVideoModel: e.target.value })}
          className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-muted/30 focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {videoModels.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      {/* Default LLM Model */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">默认 LLM 模型</label>
        <select
          value={defaultLLMModel}
          onChange={(e) => setDefaultModels({ defaultLLMModel: e.target.value })}
          className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-muted/30 focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {textModels.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      <div className="pt-2 border-t border-border">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Agent 优化</span>
      </div>

      {/* Vision Verify Model */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">视觉校验模型</label>
        <select
          value={visionVerifyModel}
          onChange={(e) => setVisionVerifyModel(e.target.value)}
          className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-muted/30 focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {visionVerifyOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>{opt.name}</option>
          ))}
        </select>
        <p className="text-[10px] text-muted-foreground/60">
          决定 verify_image_semantic + verify_task(useVisionVerify) 调用的 Vision 适配器
        </p>
      </div>

      {/* Response Budget Toggle */}
      <label className="flex items-start gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={enableResponseBudget}
          onChange={(e) => setEnableResponseBudget(e.target.checked)}
          className="mt-0.5 accent-primary"
        />
        <div className="flex-1">
          <div className="text-xs font-medium">工具响应预算</div>
          <p className="text-[10px] text-muted-foreground/60">
            查询类工具默认返回精简字段；LLM 需要细节时显式传 response_format=&quot;detailed&quot;
          </p>
        </div>
      </label>

      {/* Prompt Caching Toggle */}
      <label className="flex items-start gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={enablePromptCaching}
          onChange={(e) => setEnablePromptCaching(e.target.checked)}
          className="mt-0.5 accent-primary"
        />
        <div className="flex-1">
          <div className="text-xs font-medium">提示词缓存（实验）</div>
          <p className="text-[10px] text-muted-foreground/60">
            将 system prompt 拆为多个 content 块，支持 Anthropic cache_control；非 Anthropic 网关会自动扁平化回字符串
          </p>
        </div>
      </label>

      {/* Backend Runtime Toggle (Phase 1 灰度开关) */}
      <label className="flex items-start gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={useBackendRuntime}
          onChange={(e) => setUseBackendRuntime(e.target.checked)}
          className="mt-0.5 accent-primary"
        />
        <div className="flex-1">
          <div className="text-xs font-medium">后端 Agent Runtime（实验）</div>
          <p className="text-[10px] text-muted-foreground/60">
            把 Agent 主循环交给后端 LangGraph 运行，前端通过 SSE 接收事件 + 反向 RPC 执行画布操作。
            关闭则继续使用前端循环（兼容路径）。
          </p>
        </div>
      </label>

      {/* Save Button */}
      <button
        onClick={handleSave}
        className="w-full py-2 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5"
      >
        {saved ? (
          <><Check className="w-3.5 h-3.5" /> 已保存</>
        ) : (
          '保存偏好设置'
        )}
      </button>

      <p className="text-[10px] text-muted-foreground/50 text-center">
        渠道配置请修改项目根目录 .env 文件
      </p>
    </div>
  )
}

export default SettingsPanel
