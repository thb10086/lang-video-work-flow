---
name: 质量与工程技能
description: 质量控制 / 提示词工艺 / 工作流管理 / LLM 对话 — 贯穿全阶段的工程能力
---

# 质量与工程技能 (Quality & Craft)

## 覆盖的 SKILLS 模块

| 模块 ID | 名称 | 核心工具 |
|---------|------|---------|
| quality_control | 质量控制 | `review_content`, `verify_task` |
| prompt_craft | 提示词工艺 | `optimize_prompt` |
| workflow_management | 工作流管理 | `generate_workflow`, `plan_task`, `update_plan_step` |
| llm_chat | LLM 对话 | `create_llm_node` |

## 质量控制

**核心能力**: 多维度审查画布内容质量，自动评分和提供优化建议。

### review_content — 5 维内容审查
- prompt_quality: 提示词质量 (英文比例/长度/运镜词)
- character_consistency: 角色一致性 (锚定覆盖率)
- style_consistency: 风格一致性
- completeness: 字段完整度
- technical_params: 技术参数合规
- 输出: 0-100 评分 + 问题列表 + 优化建议

### verify_task — 6 维画布验证
- 节点数量 / 孤立节点 / 提示词语言 / 角色一致性 / 字段完整性 / 视频时长
- 输出: 0-100 评分 + 通过/未通过项列表

### detect_scenario — 场景类型识别
- 6 种场景: comic_drama / product_ad / store_tour / tutorial / short_drama / music_video
- 纯关键词匹配，零 LLM 延迟

### classify_image — 图片智能分类
- 6 类: product / character / scene / style_ref / logo / other
- LLM Vision 驱动，自动建议注入节点类型

## 提示词工艺

**核心能力**: LLM 驱动的提示词自动优化，按专业公式升级。

**工具**: `optimize_prompt`
- 图片: 按六维优化法 (主体/光影/构图/风格/负面/锚定)
- 视频: 按五段式公式 (主体动作/运镜/环境/节奏/情绪)
- 支持参数: style (风格方向) / characterAnchors (角色锚定) / keepOriginalIntent (保留原意)

**知识源**: `src/prompts/promptCraft.ts` — 单一知识源，定义所有公式/词库/审查规则
- IMAGE_DIMENSIONS / VIDEO_SECTIONS / STYLE_PRESETS / NEGATIVE_PRESETS
- LIGHTING_LIBRARY / COLOR_MOODS / REVIEW_RULES

## 工作流管理

### generate_workflow — 一键生成完整工作流
- 支持 6 种场景模式，每种生成不同 Pipeline 结构
- 场景 builder 在 `src/providers/workflowBuilders.ts`

### plan_task / update_plan_step — 任务规划
- 将复杂任务拆解为有序步骤
- 逐步执行并标记进度

### save_memory / recall_memory — 长期记忆
- 跨会话保留角色设定、风格偏好
- 50 条上限，自动去重，多词分词匹配

## LLM 对话

**核心能力**: 通用 LLM 对话节点，用于脚本生成、翻译、分析等文本任务。

**工具链**: `create_llm_node` → 填写 systemPrompt + userInput → `execute_node`

**连接方式**: `text-out` → storyboard/llmChat 的 `script-in`

## Agent 工具体系架构

```
toolDefinitions.ts    → 33 个工具 schema (OpenAI Function Calling)
agentTools.ts         → executeToolCall() 中央分发器
  ├── 节点创建/连接    → agentTools.ts (create_*, connect_nodes)
  ├── 工作流生成       → workflowBuilders.ts
  ├── 基础设施/CRUD    → toolHandlers.ts
  ├── 质量审查         → toolQuality.ts
  ├── 画布验证         → toolVerify.ts
  ├── 场景识别         → toolScenario.ts
  └── 图片分类         → toolClassify.ts
```

## 工具调用统一接口

```typescript
interface ToolCallResult {
  success: boolean
  message: string       // 纯文本, 禁止 emoji
  nodeId?: string
  nodeLabel?: string
  data?: unknown
}
```

## Smart Handle 自动解析

| 源节点类型 | 源端口 | 目标节点类型 | 目标端口 |
|-----------|--------|-------------|---------|
| characterGrid / sceneGrid | grid-out | imageGen | ref-in |
| imageGen | image-out | videoGen | first-frame |
| styleLock | style-out | imageGen / videoGen | style-in |
| storyboard | shots-out | — | script-in |
| videoGen | video-out | videoStitch | video-in |
| audioNode | audio-out | videoStitch | audio-in |
| textNode | text-out | storyboard / llmChat | script-in |

逻辑在 `src/providers/toolHelpers.ts` 的 `resolveSourceHandle()` / `resolveTargetHandle()`。
