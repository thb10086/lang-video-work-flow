## Context

上一轮 `node-functional-parity-cleanup` 让所有 14 种节点、40 个 Agent 工具、执行器四者完整闭环，310/310 测试通过。但新增的 `agentGenerationEvaluation.test.ts` 以 10 维 rubric × 6 scenario 打分时暴露两类问题：

1. **builder 层连线 bug**（4 处）：某些 builder 创建了节点却忘记拉边，导致用户从 Agent 一键生成后出现视觉上的孤立节点或非法端口，`tutorial=86` / `music_video=86` 卡在 B 级。
2. **工具爆炸问题**：`AGENT_TOOLS` 共 40 个，每个 schema 约 150–350 tokens，整体 ≈8–12k tokens 塞进系统消息。即使用户只是"在画布上画 2 个圆圈"这种简单请求，上下文里也带着全部 40 个工具定义。这直接违背"渐进式披露"原则（Claude Code、Cursor、各类 skill-based agent 都采取分层加载）。

## Goals / Non-Goals

**Goals:**
- 修复 4 个 builder 连线缺陷，让 `tutorial` / `music_video` 达 A 级（≥90），全部 6 scenario 平均 ≥96
- 以"最小可行 Tier 化 + discovery 工具"的方式在保持 parity 的前提下把首轮 token 从 ~10k 降到 ~3k
- 引入 `agentParamEffective.test.ts` 确保 Agent 传入的每个 schema 参数都落地到 node.data 并通过 sanitizer
- 全部存量测试（310）不能回归；新测试全绿

**Non-Goals:**
- 不重写 `toolHandlers.ts` 的实现（只改 schema 暴露方式）
- 不引入工具调用链动态加载（保留 OpenAI function calling 的一次性 tools 约定，只是 tools 数组变小）
- 不改动态 schema 生成器（`buildCreateVideoNodeTool` 等保持原样，被 Tier 2 引用）
- 不改 backend、不动 LangGraph 节点
- 不引入 LRU/缓存层

## Decisions

### D1 — Builder 连线修复策略：最小化改动，保持各场景风格

| Builder | 问题 | 修复方式 |
|---------|------|---------|
| `buildShortDrama` / `buildStoreTour` | sceneGrid 创建后未连 imageGen | 在 `addScenes()` 返回后调用新辅助 `linkScenesToImages(wb, scenes, imgIds)`；若 imageGen 节点的 port registry 有 `scene-in` 则用之，否则降级用 `ref-in`。**不要**给 imageGen 加新端口，省得破坏向后兼容 |
| `buildMusicVideo` | 缺 characterManager；storyboard 悬空 | 复制 `buildShortDrama` 的 manager 插入代码；storyboard 改为接 `textNode(script) → storyboard.script-in`（textNode 自带 script-out） |
| `buildTutorial` | `textNode.text-in` 端口不存在 | 把 `llm → textNode` 改成直写：`handleLLMChat` 后 `store.updateNodeData(textId, { content: ... })`。去掉该条假 edge |

**拒方案**：给 `textNode` 加 `text-in` 端口。理由：textNode 定位是"数据源"，加入端口会让 UI 重新布置 + 污染所有依赖方的期望；builder 一处改动更小。

**拒方案**：在 `addScenes` 内部硬编码连线。理由：`addScenes` 也被其他不需要连 imageGen 的 builder（将来可能的纯场景展示场景）调用，拆到 `linkScenesToImages` 保持组合性。

### D2 — Tier 化工具集：静态分类 + 运行时注入

**Tier 分层**（新文件 `src/providers/toolTiers.ts`）：

```ts
// 永远加载：导航 + 元工具 + 验证（~8）
export const TIER_1_CORE = [
  'detect_scenario', 'generate_workflow', 'get_canvas_state',
  'execute_node', 'parallel_execute', 'verify_task',
  'connect_nodes', 'update_node',
]

// 意图匹配"创建"时加载（~14）
export const TIER_2_CREATION = [
  /^create_.*_node$/,  // 所有节点创建工具
  'create_character_grid', 'create_scene_grid', 'create_image_node',
  'create_video_node', 'create_audio_node',
  'delete_node',
]

// 显式关键词或 Agent 用 discover_tools 请求才加载（~18）
export const TIER_3_ADVANCED = [
  'plan_task', 'update_plan_step', 'save_memory', 'recall_memory',
  'optimize_prompt', 'review_content', 'inject_user_images',
  'list_assets', 'create_asset', 'update_asset', 'link_asset_to_node',
  'resolve_prompt_refs', 'classify_image', 'list_models',
  'get_model_params', 'retry_node', 'batch_execute', 'get_node_output',
]
```

**Heuristic selector** `selectTier(message, ctx)`：

| 命中信号 | 返回 tier |
|---------|----------|
| `/生成|创建|做|帮我|拍|视频|广告|漫剧|短剧/` 或 `ctx.canvasEmpty` | `['tier1', 'tier2']`（~22 tools） |
| `/优化|改|重写|提示词|prompt/` | `['tier1', 'optimize_prompt', 'review_content']` |
| `/素材库|asset|资产/` | `['tier1', 'list_assets', 'create_asset', ...]` |
| 默认 | `['tier1']`（8 tools） |

**新工具 `discover_tools`** 放 Tier 1：允许 LLM 调用以取回 Tier 2/3 里的某个具体 tool schema。signature：

```ts
discover_tools({ query?: string, tier?: 1|2|3 })
  → { tools: [{ name, description, parameters }] }
```

**拒方案**：完整动态挂载（每轮根据 LLM 调用 history 换 tools 列表）。理由：OpenAI function calling 要求单轮 tools 不变；Anthropic 允许但会引发客户端缓存抖动。Tier 化 + discovery 是更稳的折中。

**拒方案**：把所有 create_*_node 合成一个 god-tool `create_node({type, data})`。理由：违反 project-rules "Prefer per-capability tools over god-tool patterns"；也会丧失各节点 schema 自带的约束（如 enum）。

### D3 — 参数落地验证：端到端白盒测试

- `agentParamEffective.test.ts`：枚举每个 `create_*_node` 工具，按 schema 的 `properties` 字段构造一个非默认值的 args，执行后断言 `node.data[key]` 与 args 一致（字符串化容差）。
- `nodeAgentToolUtilization.test.ts`：扫描所有 scenario builders + executor tests，构造 "这个 node type 被使用" 的证据集合，断言 14 种节点无 dead type。

### D4 — Telemetry：记录 tool schema 字节数，暴露到 console.log

在 `getAgentTools()` 返回前执行：
```ts
const bytes = JSON.stringify(tools).length
const est = Math.round(bytes / 4)  // 粗略 token
if (import.meta.env.DEV) console.info(`[agent-tools] tier=${tier} tools=${tools.length} ~${est}tok`)
```

不引入 metrics pipeline（项目当前未启用），仅 DEV 环境 console。生产可后续接 OTel。

## Risks / Trade-offs

- **[Risk] Tier 选择误判** → Mitigation：默认 Tier 1+2，误判代价只是多/少几个工具，LLM 仍可用 `discover_tools` 补齐；加单测覆盖关键正则命中率
- **[Risk] 用户现有对话已经在依赖"所有 40 个工具都可见"** → Mitigation：`getAgentTools()` 保留"全部返回"模式（传 `tier='all'` 或 `includeAll: true`），默认路径行为变化但可以一键回退
- **[Risk] builder 连线修复改变了保存工作流 snapshot 的节点数** → Mitigation：无需迁移，因为只影响新生成，`music_video` 原来就有 bug；但要更新 `workflowQuality.test.ts` 的 music_video 期望计数
- **[Trade-off] 加 discover_tools 意味着多一次 LLM 轮次** → 但一次 tool 定义 bytes 省 ~7k token，按 gpt-4 pricing ≈ $0.07 / call，相比 discovery call 的 300 tokens ≈ $0.003，净省 96%

## Migration Plan

1. 先 merge builder 修复 + 新 tests（独立、低风险）
2. 再引入 `toolTiers.ts` 和 `selectTier()`，但默认 `getAgentTools()` 保持"全部返回"行为（behind flag `VITE_AGENT_TIERING=1`）
3. dev/staging 灰度开启 flag 2-3 天观察 Agent 行为
4. 确认无回归后把默认改为 tier 模式；把 `includeAll` 变成 opt-in

回滚：把 flag 拉回 `0`；或单测里直接 `getAgentTools({ includeAll: true })`。

## Open Questions

- 是否要把 `generate_workflow` 本身拆成更小的 scenario 专用工具（如 `generate_short_drama`）？延后，目前 `detect_scenario` 已能处理分发
- `discover_tools` 返回时要不要帮 LLM 直接 enable 那个工具？当前方案是纯只读，留给 LLM 下一轮自己调用——保持工具无副作用原则
