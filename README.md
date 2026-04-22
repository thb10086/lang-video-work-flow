# AI Video Workflow Studio

以 **"Ingredients-to-Video"** 方法论为核心，基于 React Flow 构建的生产级 AI 视频创作工作流引擎。通过节点连接可视化编排从剧本→角色→分镜→关键帧→视频的完整 pipeline，内置 Agent 对话驱动一键工作流生成。

> 研究基础：Langflow（React Flow 节点体系）、DeerFlow 2.0（Agent 编排）、TapNow（无限画布 + 视觉生成）

---

## 核心特性

### 🎬 完整视频制作 Pipeline
- **剧本** → **分镜脚本** → **角色九宫图** → **裁切** → **关键帧** → **视频** → **拼接**
- 角色一致性三层保障：参考图锚定 → First Frame 约束 → Sora Character 复用
- 风格锁定：AI 提取参考图风格特征，注入所有下游节点
- 默认视频模型：**Doubao Seedance 2.0**（有声视频/参考视频/首尾帧/4-15s，7 种画面比例）

### 🤖 商业级 Agent 系统（借鉴 Claude Code + Cursor Agent）

**三段式 Agent 循环** — 每轮 Analyze → Act → Verify：

- **33 个工具函数**：14 个节点创建/连接/工作流 + 10 个执行/查询 + 5 个 Agent 基础设施 + 4 个质量/分析
- **任务规划系统**：复杂任务自动分解为有序步骤，逐步执行并标记进度（`plan_task` / `update_plan_step`）
- **自我验证**：执行完毕后调用 `verify_task` 检查画布状态，发现问题自动修正
- **长期记忆**：localStorage 持久化，跨会话保留角色设定、风格偏好（`save_memory` / `recall_memory`）
- **上下文压缩**：对话超过 10 轮自动压缩历史，保留关键决策（Claude Code compaction 机制）
- **Agent 循环最多 25 轮**：支持完整 step-by-step pipeline
- **Action-First 设计**：收到任务立即执行，禁止反复追问，合理推断缺失信息
- **角色切换**：导演 / 编剧 / 美术 / 摄影师 / 通用助手，各有专业 System Prompt
- **SKILLS 模块**：16 个技能模块动态注入 System Prompt，每个含工具链+最佳实践
- **图片上传注入**：用户上传图片 → `inject_user_images` 自动注入到画布节点
- **聊天内模型选择**：在对话面板直接切换 LLM 模型
- **思考过程可视化**：实时显示 Agent 推理状态
- **任务进度面板**：可折叠步骤列表 + 进度条
- **自动反思**：连续失败 N 次后触发 self-correction（可配置阈值）

### 📡 后端统一模型管理 + Redis 缓存
- **后端 DB 为唯一数据源**：模型定义 + param_schema 存储在 `ai_models` 表，前端零静态回退
- **Redis 缓存**：模型列表 TTL 1h（key: `prism:models:{capability}`），CRUD 自动失效
- **前端 Hook**：`useBackendModels(capability)` 获取模型列表，带内存缓存 + error 状态
- **6 个视频模型**：Seedance 2.0 / 2.0-Fast、VEO 3.1 Fast / Quality、Sora 2 VIP、Kling v3
- **渠道路由**：后端负责渠道选择与降级容错

### 🖥️ 专业画布体验
- **15 种节点类型**，类型化端口系统，只允许兼容类型连接
- **完整快捷键**：撤销/重做/复制/粘贴/复制/全选/删除
- **画布工具栏**：背景模式（点阵/线格/十字/无）、网格间距、吸附开关、缩放控制
- **4 个内置模板**：短剧/广告/动画/教程，一键导入完整工作流
- **工作流导入/导出**：JSON 格式保存和加载
- **COS 图片上传**：腾讯云 COS 集成，base64 自动上传为公网 URL

### � 素材库 & 跨模型参考图适配（v0.5）
- **三类素材**：角色 / 场景 / 风格 — 每条带外貌描述 + 参考图 + 变体
- **@ 引用语法**：prompt 里写 `@char_sarah walks at dusk`，resolver 自动展开外貌 + 收集参考图
- **变体支持**：`@char_sarah:smiling` 合并基础外貌 + 变体 delta
- **跨模型参考图适配器**：同一 prompt 在不同视频模型上自动路由到正确字段
  - Seedance → `images` 原生多参考图
  - VEO 3.1 → `image_mode=reference`（≤2 张），有首帧自动降级为 `first_frame`
  - Sora-2 VIP → `characterUrl + characterTimestamps` 走 Character API
  - Kling v3 → 仅保留首/尾帧，多余参考图被 drop（带 notes）
- **LibTV 风格面板**：`Ctrl+Shift+A` 打开右侧抽屉，卡片可拖拽到画布自动创建对应节点
- **Agent 工具**：`list_assets` / `create_asset` / `update_asset` / `link_asset_to_node` / `resolve_prompt_refs`

### � 可扩展模型体系
- **后端管理**：新增模型只需在后端 `ai_models` 表插入记录（含 param_schema JSON），前端自动生效
- **已接入图片**：Gemini 原生 API（gemini-3.1-flash-image-preview / gemini-3-pro-image-preview）
- **已接入视频**：Seedance 2.0 / 2.0-Fast、VEO 3.1 系列、Sora-2 VIP、Kling v3
- **已接入 LLM**：OpenAI 兼容（GPT-5.4 / Gemini 3.1 Pro / Claude Sonnet 4）
- **前端动态渲染**：参数面板（下拉、滑块等）由后端 param_schema 驱动，无需前端代码改动

### 🧪 测试体系
- **10 个测试套件**，162 个用例，Vitest + happy-dom
- 覆盖：flowStore、nodeExecutor、agentTools、pipeline、数据传播、图片上传、seedance Agent 集成、后端模式

---

## 快速开始

### 前端（必需）

```bash
npm install          # 安装依赖
npm run dev          # 启动开发服务器（http://localhost:3001）
npm test             # 运行测试
npm run test:ui      # 测试 UI（可视化）
```

### 后端（必需，LangGraph Agent 编排）

```bash
cd server
pip install -r requirements.txt    # 安装 Python 依赖
cp .env.example .env               # 配置后端环境变量
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000  # 启动 FastAPI
```

启用后端模式需在前端 `.env` 中设置：

```env
VITE_BACKEND_ENABLED=true
VITE_BACKEND_URL=ws://localhost:8000
```

### 环境配置

复制 `.env` 并填入 API Key：

```env
# 主渠道 — LLM + 图片（yunwu.ai）
VITE_API_BASE_URL=https://yunwu.ai
VITE_API_KEY=your-api-key

# 视频渠道 — APIMart（Seedance/VEO/Sora/Kling）
VITE_CHANNEL_APIMART_KEY=your-apimart-key

# 视频渠道 — Puyo（VEO 3.1 备用）
VITE_CHANNEL_PUYO_KEY=your-puyo-key

# 腾讯云 COS — 图片上传（供视频首帧）
VITE_COS_SECRET_ID=your-id
VITE_COS_SECRET_KEY=your-key
VITE_COS_REGION=ap-guangzhou
VITE_COS_BUCKET=your-bucket

# 默认模型
VITE_DEFAULT_VIDEO_MODEL=doubao-seedance-2-0
VITE_DEFAULT_IMAGE_MODEL=gemini-3.1-flash-image-preview
VITE_DEFAULT_LLM_MODEL=gpt-5.4

# 后端模式（必需）
VITE_BACKEND_ENABLED=true
VITE_BACKEND_URL=ws://localhost:8000
```

完整配置项请参见 `.env` 文件注释。

---

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl + Z` | 撤销（Undo） |
| `Ctrl + Y` / `Ctrl + Shift + Z` | 重做（Redo） |
| `Ctrl + C` | 复制选中节点 |
| `Ctrl + V` | 粘贴节点 |
| `Ctrl + D` | 复制选中节点（Duplicate） |
| `Ctrl + A` | 全选所有节点 |
| `Delete` / `Backspace` | 删除选中节点 |
| `Ctrl + Shift + A` | 打开/关闭素材库面板 |
| `Ctrl + K` | 打开快速节点搜索 |
| `Ctrl + J` | 打开/关闭 Agent 抽屉 |

> 在输入框/文本框/下拉框中输入时，上面大部分快捷键自动禁用，不会干扰编辑。
> `@` 符号仅在 PromptInput 里触发素材自动补全；其它输入框不受影响。

---

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| **React** | 18.3 | 前端框架 |
| **TypeScript** | 5.6 | 类型安全 |
| **Vite** | 6.0 | 构建工具 |
| **TailwindCSS** | 3.4 | 样式系统 |
| **@xyflow/react** | 12.4 | Canvas 画布 + 节点编辑器 |
| **Zustand** | 5.0 | 状态管理（5 个 Store） |
| **Radix UI** | — | 无障碍 UI 原语（Dialog / Select / Slider / Switch / Tabs） |
| **Lucide React** | 0.468 | 图标库 |
| **cos-js-sdk-v5** | 1.10 | 腾讯云 COS 图片上传 |
| **react-markdown** | 10.1 | Agent 消息 Markdown 渲染 |
| **Vitest** | 4.1 | 单元测试框架 |
| **happy-dom** | 20.8 | 测试 DOM 环境 |

---

## 架构设计

### 三栏布局

```
┌────────────────────────────────────────────────────────────────┐
│  顶栏: 模板 | 导入 | 导出 | 运行工作流                          │
├──────────┬───────────────────────┬──────────────────────────────┤
│          │                       │                              │
│  节点面板 │    Canvas 画布         │   Agent Chat / 设置          │
│  (拖拽)  │  (React Flow)         │   (LLM + Function Calling)  │
│          │                       │                              │
│  15种节点 │  节点 + 连线 + 工具栏   │   角色切换 + 快捷按钮         │
│          │  快捷键 + 吸附 + 缩放   │   多轮工具调用 + 流式输出     │
│          │                       │                              │
├──────────┴───────────────────────┴──────────────────────────────┤
│  MiniMap + Controls                                             │
└────────────────────────────────────────────────────────────────┘
```

### 后端驱动模型架构

```
前端 UI 组件
     ↓  useBackendModels(capability)
后端 GET /api/models?capability=video
     ↓  Redis 缓存 (TTL 1h, key=prism:models:{capability})
后端 ModelService → ai_models 表 (MySQL)
     ↓  返回 model_id + name + param_schema + schema_version
前端动态渲染参数面板 (下拉/滑块/开关) + Agent 工具 schema
```

**多模型参数适配（v0.2+）**：
- **单一 schema 源**：`ai_models.param_schema` 是前端 UI + Agent 工具 + 后端验证器共用的 ParamField[]
- **版本控制**：`schema_version` 列在 `param_schema` 更新时自增，客户端可基于版本决定缓存失效
- **运行时 Agent schema**：`src/providers/toolSchemaGenerator.ts` 在每次 Agent 调用前从后端模型列表构造 `create_video_node` / `create_image_node` / `create_audio_node` 的 union 属性 + `model` 枚举，非通用字段在描述里标注 `[仅适用于 <ids>]`
- **Sanitizer 双保险**：`src/providers/paramSanitizer.ts` 在前端切换模型时清理陈旧字段 + 注入新默认值；`server/app/services/param_validator.py` 在后端 adapter 层校验，非法参数返回 HTTP 422 `{ error: "invalid_params", violations: [...] }`
- **Agent 工具**：`get_model_params(model_id)` 让 LLM 在需要精确参数时按需查询

新增模型只需 1 步：
1. 后端 `ai_models` 表插入记录（含 `param_schema` JSON 数组），前端 UI + Agent 工具自动感知

### 核心服务层

```
providers/
├── index.ts                  ← 统一导出入口（仅类型）
├── types.ts                  ← IModelAdapter 接口 + ParamField + 枚举
├── modelDefaults.ts          ← 全局默认值常量（单一维护点）
├── nodeExecutor.ts           ← 12 种节点类型统一执行服务
├── agentTools.ts             ← Agent 工具执行器入口（委派模式）
├── toolDefinitions.ts        ← 33 个工具 schema（OpenAI function calling 格式）
├── toolHelpers.ts            ← 工具共享辅助（节点查找/位置/端口解析）
├── toolHandlers.ts           ← 基础设施+节点CRUD+查询工具处理器
├── toolQuality.ts            ← 质量审查 + LLM 提示词优化
├── toolVerify.ts             ← 6 维度画布质量评分
├── toolScenario.ts           ← 6 种场景识别引擎
├── toolClassify.ts           ← LLM Vision 图片智能分类
├── workflowBuilders.ts       ← generate_workflow 一键编排
├── cosUploader.ts            ← 腾讯云 COS 上传（单例/缓存/自动转换）
├── videoMerger.ts            ← FFmpeg.wasm 视频拼接
└── executors/
    ├── generationExecutors.ts   ← 图片/视频/角色/场景生成执行器
    └── processingExecutors.ts   ← 分镜/风格/LLM/编辑/检查/拼接/音频执行器
```

> **已删除模块**：`registry.ts`、`channelRouter.ts`、`taskManager.ts`、`adapters/` 目录 — 模型管理全部迁移至后端 DB。

### 状态管理（5 个 Zustand Store）

| Store | 文件 | 职责 |
|-------|------|------|
| **flowStore** | `flowStore.ts` | 画布节点/边状态、Undo/Redo 历史栈（50层）、剪贴板、导入/导出 |
| **chatStore** | `chatStore.ts` | Agent 消息、LLM 多轮 Tool Calling 循环（25轮）、角色切换、流式输出 |
| **chatPromptBuilder** | `chatPromptBuilder.ts` | 系统提示词构建、画布快照、上下文压缩、阶段检测 |
| **settingsStore** | `settingsStore.ts` | 渠道配置、用户偏好（默认模型/画布/COS）、任务重试策略 |
| **agentMemoryStore** | `agentMemoryStore.ts` | 长期记忆持久化、任务计划管理、上下文压缩摘要 |

### DRY 架构原则

项目遵循**单一数据源**（Single Source of Truth）：

| 数据 | 权威来源 | 引用方 |
|------|---------|--------|
| 模型定义 + param_schema | **后端 `ai_models` 表** | 前端 `useBackendModels` hook → 所有 UI 节点 |
| 默认模型名 + 默认参数 | `modelDefaults.ts` | settingsStore / nodeExecutor / agentTools / 模板 / UI |
| Agent 角色 Prompt | `prompts/roles/*.ts` | chatStore |
| SKILLS 能力描述 | `prompts/skills/index.ts` | chatStore（动态注入） |

---

## 全部节点类型（15 种）

### 核心创作节点（7 种）

| 节点 | 类型 ID | 输入端口 | 输出端口 | 功能说明 |
|------|---------|---------|---------|---------|
| **角色九宫图** | `characterGrid` | — | grid-out | Gemini 生成 3×3 角色参考图，自动上传 COS |
| **场景九宫图** | `sceneGrid` | — | grid-out | Gemini 生成 3×3 场景参考图，自动上传 COS |
| **图片生成** | `imageGen` | prompt-in, ref-in, style-in | image-out | Gemini 原生 API，支持参考图叠加/宽高比/分辨率(1K-4K) |
| **视频生成** | `videoGen` | prompt-in, first-frame | video-out | 后端多模型（默认 Seedance 2.0），参数由 param_schema 动态渲染 |
| **文本/脚本** | `textNode` | text-in | text-out | 4 种角色（脚本/提示词/旁白/对话），颜色编码 |
| **音频生成** | `audioNode` | text-in | audio-out | ElevenLabs / Fish Speech / CosyVoice |
| **LLM 对话** | `llmChat` | — | text-out | 画布内 LLM 节点，流式输出，多模型切换 |

### 流程控制节点（3 种）

| 节点 | 类型 ID | 功能说明 |
|------|---------|---------|
| **图片裁切** | `imageCrop` | 从九宫图中选取特定格子（1-9），Canvas 裁切输出单张图片 |
| **角色提取** | `characterExtract` | 从视频片段创建 Sora Character |
| **分镜脚本** | `storyboard` | AI 拆解剧本为分镜列表 + 一键展开为关键帧→视频节点对 |

### 高级差异化节点（5 种）

| 节点 | 类型 ID | 功能说明 |
|------|---------|---------|
| **角色管理器** | `characterManager` | 角色库持久化 + 跨项目复用 Character |
| **风格锁定** | `styleLock` | AI 提取参考图风格特征，通过 style-out 注入下游节点 |
| **连续性检查** | `continuityCheck` | LLM 对比相邻镜头角色/光照/色调一致性 |
| **视频拼接** | `videoStitch` | 自动收集上游视频节点输出，按顺序合并 |
| **图片编辑** | `imageEdit` | Gemini 原生图片编辑（换背景/加元素/修改细节） |

### 端口类型系统

| 数据类型 | 端口颜色 | 可连接目标 |
|---------|---------|-----------|
| `image` | 蓝色 | ref-in, first-frame, image-in |
| `grid` | 紫色 | ref-in, grid-in |
| `video` | 红色 | video-in |
| `text` | 绿色 | text-in, prompt-in, script-in |
| `audio` | 橙色 | audio-in |
| `style` | 粉色 | style-in |

---

## Agent 系统

### 全部工具函数（33 个）

#### 节点创建 / 连接 / 工作流工具（14 个）

| 工具名 | 功能 |
|--------|------|
| `create_character_grid` | 创建角色九宫图节点（name + description + style） |
| `create_scene_grid` | 创建场景九宫图节点（name + description + style + mood） |
| `create_image_node` | 创建图片生成节点（prompt + aspectRatio） |
| `create_video_node` | 创建视频生成节点（6 模型可选 + Seedance 专属参数） |
| `create_llm_node` | 创建 LLM 对话节点（systemPrompt + userInput） |
| `create_text_node` | 创建文本/脚本节点（content + label） |
| `create_audio_node` | 创建音频/配音节点（text + model + voice） |
| `create_storyboard_node` | 创建分镜脚本节点（script） |
| `create_style_lock_node` | 创建风格锁定节点（styleDescription） |
| `create_image_edit_node` | 创建图片编辑节点（editInstruction） |
| `create_video_stitch_node` | 创建视频拼接节点 |
| `create_continuity_check_node` | 创建连续性检查节点 |
| `connect_nodes` | 连接两个节点（自动解析端口类型） |
| `generate_workflow` | **一键生成完整工作流**（角色+场景+分镜+关键帧+视频+配音+拼接） |

#### 执行与查询工具（10 个）

| 工具名 | 功能 |
|--------|------|
| `execute_node` | 触发单个节点执行（支持 12 种节点类型） |
| `retry_node` | 重试已失败的节点（重置状态后重新执行） |
| `batch_execute` | 串行执行多个节点（有依赖关系时使用） |
| `parallel_execute` | 并行执行多个节点（无依赖，可配并发度，默认 4） |
| `get_node_output` | 检查节点执行结果和状态（结构化 JSON） |
| `get_canvas_state` | 获取画布完整状态（结构化 JSON：所有节点+连线） |
| `update_node` | 更新节点数据（支持 nodeId 精确 / nodeLabel 模糊定位） |
| `delete_node` | 删除节点及其连线 |
| `list_models` | 列出所有已注册可用模型及渠道配置 |
| `inject_user_images` | 将用户上传图片注入到画布节点的指定字段 |

#### Agent 基础设施工具（5 个）

| 工具名 | 功能 |
|--------|------|
| `plan_task` | 任务规划 — 将复杂任务分解为有序步骤 |
| `update_plan_step` | 更新步骤状态（in_progress / done / failed） |
| `verify_task` | 自我验证 — 6 维度画布质量评分（0-100） |
| `save_memory` | 长期记忆 — localStorage 持久化跨会话 |
| `recall_memory` | 检索记忆 — 多词分词匹配 + 类型优先级 |

#### 质量门控与分析工具（4 个）

| 工具名 | 功能 |
|--------|------|
| `review_content` | 审查画布节点内容质量（5 维度：prompt/角色/风格/完整性/技术参数） |
| `optimize_prompt` | LLM 自动优化提示词（六维法/五段式，自动写回节点） |
| `detect_scenario` | 场景识别引擎（6 种场景类型，推荐 Pipeline + 模板） |
| `classify_image` | LLM Vision 图片智能分类（6 类，返回建议注入目标） |

### 一键工作流编排

用户对话示例：

> 「帮我做一个 30 秒的赛博朋克风格短片，主角是一个女黑客，场景是霓虹城市」

Agent 自动执行 `generate_workflow`，一次性创建：

1. **剧本节点** → 自动连线 → **分镜脚本节点**
2. N 个 **角色九宫图** → 自动连线 → **图片裁切** → 每个关键帧的 ref-in
3. M 个 **场景九宫图** → 自动连线 → **风格锁定** → 每个关键帧的 style-in
4. 每组镜头：**关键帧(图片生成)** → 自动连线 → **视频生成**（首帧连线）
5. 剧本 → **旁白配音** 节点
6. 所有视频 → **视频拼接** 节点

总计 15-30+ 节点，全部自动排版和连线。

### Agent 多轮执行流程

```
用户消息 → 本地意图匹配（快速路径，无需 API）
          ↓ 未匹配
       LLM + Function Calling（tool_choice: auto）
          ↓ 返回 tool_calls
       执行工具 → 节点创建/连线/执行
          ↓ 工具结果回传 LLM
       LLM 决定下一步 → 继续调用 or 生成总结
          ↓
       最多 25 轮循环（支持完整 pipeline）
```

### 4 阶段 Pipeline 工作流

| 阶段 | 名称 | 主要操作 |
|------|------|---------|
| Phase 1 | **Pre-Production（构思与角色）** | 创建角色/场景九宫图 → 裁切 → 执行生成 |
| Phase 2 | **Design（风格与分镜）** | 风格锁定 → 分镜脚本 → 配置连线 |
| Phase 3 | **Production（关键帧与视频）** | 创建关键帧+视频节点 → parallel_execute 批量生成 |
| Phase 4 | **Post-Production（后期合成）** | 视频拼接 → 连续性检查 → 配音 |

### SKILLS 模块（16 个）

| 模块 | 核心能力 |
|------|----------|
| `characterDesign` | 角色九宫图生成 + 外貌特征锚定 |
| `sceneDesign` | 场景九宫图生成 + 环境氛围设定 |
| `styleLock` | 风格提取 + 全链路注入 |
| `storyboard` | 剧本→分镜拆解 + 一键展开 |
| `imageGeneration` | Gemini 原生图片 + 参考图叠加 |
| `imageEdit` | Gemini 原生图片编辑 |
| `videoGeneration` | 多模型视频生成（Seedance/VEO/Sora/Kling） |
| `audioGeneration` | TTS 配音（ElevenLabs/Fish Speech/CosyVoice） |
| `llmChat` | 画布内 LLM 对话节点 |
| `continuityCheck` | 跨镜头视觉一致性检测 |
| `videoStitch` | 多段视频合并 |
| `workflowManagement` | 一键工作流编排 + 模板 |
| `cosUpload` | COS 图片上传 + URL 转换 |
| `qualityControl` | 质量门控 + 提示词审查 |
| `promptCraft` | 提示词工程方法论（六维法/五段式/风格预设/负面约束） |

---

## API 集成

### 视频模型

| 统一模型名 | 渠道 | 时长 | 特色功能 |
|-----------|------|------|---------|
| **doubao-seedance-2-0** (默认) | APIMart | 4-15s | 有声视频/参考视频/首尾帧/固定镜头/末帧返回/7种比例/480p-720p |
| **doubao-seedance-2-0-fast** | APIMart | 4-15s | 同上，生成速度更快 |
| **veo3.1-fast** | APIMart, Puyo | 8s | 60-150s 出片 |
| **veo3.1** | APIMart, Puyo | 8s | 画质更优，120-300s 出片 |
| **sora-2-vip** | APIMart | 10-15s | 风格预设/水印/故事板 |
| **kling-v3** | APIMart | 5-15s | 首尾帧/有声视频/负面提示词 |

### Seedance 2.0 参数（默认模型）

| 参数 | 类型 | 选项 | 默认值 |
|------|------|------|--------|
| `duration` | slider | 4-15 秒 | 5 |
| `size` | select | 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9 / adaptive | 16:9 |
| `resolution` | select | 480p / 720p | 720p |
| `generate_audio` | boolean | — | false |
| `camera_fixed` | boolean | — | false |
| `return_last_frame` | boolean | — | false |
| `seed` | number | — | (random) |

### 图片生成 — Gemini 原生 generateContent

```
渠道：yunwu.ai
POST /v1beta/models/{model}:generateContent
模型：gemini-3.1-flash-image-preview / gemini-3-pro-image-preview
参数：aspectRatio (1:1 ~ 21:9), imageSize (1k/2k/4k)
特性：支持参考图编辑（inline_data 传入 base64）
```

### 视频生成 — 后端统一路由

```
前端提交 → 后端 /api/generate/video → 根据 model_id 选择渠道
渠道: APIMart (doubao-seedance-2.0 / veo3.1-fast / sora-2-vip / kling-v3)
        Puyo (veo-3-1-fast / veo-3-1)
异步轮询: 后端管理 taskId → 渠道路由 → 返回进度
```

### LLM Chat — OpenAI 兼容

```
渠道：yunwu.ai
POST /v1/chat/completions
模型：gpt-5.4 / gemini-3.1-pro-preview / gpt-4o / claude-sonnet-4
特性：流式 SSE + Function Calling + 多轮工具调用
```

---

## 工作流模板

| 模板 | 节点数 | 连线数 | 描述 |
|------|--------|--------|------|
| 🎬 **短剧基础流程** | 10 | 6 | 角色设计→场景设计→分镜脚本→关键帧→视频→风格锁定→拼接 |
| 📺 **产品广告 15 秒** | 7 | 2 | 产品图→使用场景→3段视频→品牌风格→合成 |
| 🎨 **角色动画短片** | 8 | 6 | 角色九宫图→多视角关键帧→动画视频→一致性检查 |
| 📚 **教程/解说视频** | 8 | 4 | LLM 脚本→说明图→配音→视频片段→合成 |

---

## 项目结构

```
src/
├── main.tsx                              # 入口
├── App.tsx                               # 主布局（顶栏 + 三栏 + 模板面板）
├── index.css                             # 全局样式 + CSS 变量
│
├── lib/
│   └── utils.ts                          # 工具函数（cn, generateId）
│
├── types/
│   └── portRegistry.ts                   # 端口类型系统 + 连接验证 + PORT_COLORS
│
├── hooks/
│   └── useBackendModels.ts              # 后端模型列表 Hook（带内存缓存 + error 状态）
│
├── providers/                            # 核心服务层
│   ├── index.ts                          # 统一导出入口（仅类型）
│   ├── types.ts                          # IModelAdapter 接口 + ParamField + 枚举
│   ├── modelDefaults.ts                  # 全局默认值常量（单一维护点）
│   ├── nodeExecutor.ts                   # 12 种节点类型统一执行服务
│   ├── agentTools.ts                     # Agent 工具执行器入口（委派到 toolHandlers）
│   ├── toolDefinitions.ts               # 33 个工具 schema 定义（OpenAI function calling 格式）
│   ├── toolHelpers.ts                   # 工具共享辅助函数（节点查找/位置/端口解析）
│   ├── toolHandlers.ts                  # 基础设施+节点CRUD+查询工具执行逻辑
│   ├── toolQuality.ts                   # 质量审查 + 提示词优化工具
│   ├── toolVerify.ts                    # 6 维度画布质量评分引擎
│   ├── toolScenario.ts                  # 6 种场景识别引擎
│   ├── toolClassify.ts                  # LLM Vision 图片智能分类
│   ├── workflowBuilders.ts              # generate_workflow 一键编排构建器
│   ├── cosUploader.ts                    # 腾讯云 COS 上传（单例/缓存）
│   ├── videoMerger.ts                    # FFmpeg.wasm 视频拼接
│   └── executors/                        # 节点执行器
│       ├── generationExecutors.ts        # 图片/视频/角色/场景生成
│       └── processingExecutors.ts        # 分镜/风格/LLM/编辑/检查/拼接/音频
│
├── prompts/                              # Prompt 工程
│   ├── promptEngine.ts                   # 模板引擎（变量替换）
│   ├── roles/                            # Agent 角色 System Prompt
│   │   ├── index.ts                      # 5 种角色注册 + 切换
│   │   ├── director.ts                   # AI 导演（视觉风格/镜头语言/分镜规划）
│   │   ├── screenwriter.ts              # AI 编剧（剧本/对话/叙事结构）
│   │   ├── artist.ts                     # AI 美术（提示词优化/风格统一）
│   │   └── cinematographer.ts           # AI 摄影师（运镜/视频提示词优化）
│   ├── skills/
│   │   └── index.ts                      # 16 个 SKILLS 模块定义 + 动态注入
│   ├── promptCraft.ts                   # 提示词工程单一知识源（六维法/五段式/风格预设/审查规则）
│   └── templates/                        # 节点提示词模板
│       ├── characterSheet.ts             # 角色九宫图模板
│       ├── sceneSheet.ts                 # 场景九宫图模板
│       └── videoGen.ts                   # 视频生成模板
│
├── templates/
│   └── workflowTemplates.ts              # 4 个内置工作流模板
│
├── store/                                # 状态管理
│   ├── flowStore.ts                      # 画布状态 + Undo/Redo(50层) + 剪贴板
│   ├── chatStore.ts                      # Agent Chat + 25轮 Tool Calling + 角色切换
│   ├── chatPromptBuilder.ts             # 系统提示词构建 + 画布快照 + 上下文压缩
│   ├── settingsStore.ts                  # 渠道配置 + 用户偏好 + 任务重试策略
│   └── agentMemoryStore.ts              # 长期记忆 + 任务计划 + 上下文压缩
│
├── __tests__/                            # 测试套件（10 文件, 162 用例）
│   ├── flowStore.test.ts                 # 画布状态管理测试
│   ├── executeNode.test.ts               # 节点执行服务测试
│   ├── agentTools.test.ts                # Agent 工具调用测试
│   ├── pipeline.test.ts                  # 全链路 Pipeline 测试
│   ├── propagation.test.ts               # 数据传播测试
│   ├── imageUpload.test.ts               # 图片上传注入测试
│   └── seedance.test.ts                  # Seedance Agent 工具集成测试
│
└── components/
    ├── canvas/
    │   ├── WorkflowCanvas.tsx            # Canvas 画布 + 全局快捷键注册
    │   └── CanvasToolbar.tsx             # 画布工具栏（背景/吸附/缩放）
    ├── sidebar/
    │   ├── NodePanel.tsx                 # 左侧节点面板（15 种节点拖拽创建）
    │   ├── AgentChat.tsx                 # 右侧 Agent（角色切换+快捷按钮+33工具标签）
    │   ├── SettingsPanel.tsx             # 设置面板（API Key/模型/COS 配置）
    │   └── TemplatePanel.tsx             # 模板选择（分类筛选 + 一键导入）
    └── nodes/                            # 15 种自定义节点组件
        ├── CharacterGridNode.tsx         # 角色九宫图（COS 自动上传）
        ├── SceneGridNode.tsx             # 场景九宫图（COS 自动上传）
        ├── ImageGenNode.tsx              # 图片生成（模型/比例/分辨率/参考图）
        ├── VideoGenNode.tsx              # 视频生成（动态参数面板 from 后端 param_schema）
        ├── TextNode.tsx                  # 文本/脚本（4种角色颜色编码）
        ├── AudioNode.tsx                 # 音频/配音（3模型可选）
        ├── LLMChatNode.tsx               # LLM 对话（流式输出）
        ├── ImageCropNode.tsx             # 图片裁切（Canvas 3x3 选格）
        ├── CharacterExtractNode.tsx      # 角色提取（Sora Character）
        ├── StoryboardNode.tsx            # 分镜脚本（一键展开）
        ├── CharacterManagerNode.tsx      # 角色管理器
        ├── StyleLockNode.tsx             # 风格锁定
        ├── ContinuityCheckNode.tsx       # 连续性检查（LLM 视觉分析）
        ├── VideoStitchNode.tsx           # 视频拼接（自动收集上游）
        └── ImageEditNode.tsx             # 图片编辑（Gemini 原生）

.windsurf/                                   # Windsurf IDE 工程化配置
├── rules/
│   └── project-rules.md                     # 唯一规则文件 (~80行, 自动加载)
├── skills/                                  # SKILLS 技能文档 (按需加载)
│   ├── pre-production.md                    # 角色/场景/风格/分镜
│   ├── production.md                        # 图片/视频生成
│   ├── post-production.md                   # 音频/检查/拼接
│   └── quality-and-craft.md                 # 质量控制/提示词工艺/工具体系
└── workflows/                               # 斜杠命令 (按需触发)
    ├── dev-start.md                         # /dev-start
    ├── coding-standards.md                  # /coding-standards — 详细编码规范
    ├── channel-routing.md                   # /channel-routing
    ├── add-node-type.md                     # /add-node-type (11 步)
    ├── add-agent-tool.md                    # /add-agent-tool (6 步)
    ├── add-skill-module.md                  # /add-skill-module
    ├── add-model-adapter.md                 # /add-model-adapter
    ├── brainstorming.md                     # /brainstorming (Superpowers)
    ├── writing-plans.md                     # /writing-plans (Superpowers)
    ├── debugging.md                         # /debugging (Superpowers)
    ├── testing.md                           # /testing (Superpowers)
    └── verification.md                      # /verification (Superpowers)
```

---

## 与 TapNow 功能对比

| 功能 | TapNow | AI Video Workflow Studio |
|------|--------|-------------------------|
| 无限画布 | ✅ | ✅ + 可配背景/网格/吸附 |
| 文生图 | ✅ | ✅ Gemini 原生 + 参考图编辑 |
| 图生视频 | ✅ 单帧 | ✅ 单帧 + **首尾帧** + **Character** |
| 文生视频 | ✅ | ✅ 6 模型多渠道（Seedance/VEO/Sora/Kling） |
| 角色一致性 | ❌ | ✅ **三层机制**（参考图+首帧+Character） |
| 节点类型化端口 | ❌ | ✅ 6 种数据类型 + 智能连接验证 |
| AI Agent | ❌ | ✅ 33 工具 + 25 轮循环 + 5 角色 |
| 一键工作流编排 | ❌ | ✅ 描述创意 → 15-30 节点自动生成连线 |
| 多渠道降级 | ❌ | ✅ 后端自动路由 + 故障转移 |
| 风格锁定 | ❌ | ✅ AI 提取风格特征注入 |
| 连续性检查 | ❌ | ✅ LLM 跨镜头一致性检测 |
| 长期记忆 | ❌ | ✅ localStorage 持久化跨会话 |
| 任务规划 | ❌ | ✅ plan_task + verify_task |
| 快捷键 | ❌ | ✅ Undo/Redo/Copy/Paste/Delete/SelectAll |
| 工作流模板 | 有限 | ✅ 8 个行业模板 + Agent 动态生成 |
| 多模型可扩展 | 部分 | ✅ 后端 DB 插入一行即生效 |

---

## 后端架构（LangGraph Agent 编排）

后端通过 WebSocket 提供 LangGraph 多 Agent 协作能力，是系统必需组件。前端通过 `VITE_BACKEND_ENABLED=true` 连接后端 Agent 编排服务。

```
server/
├── app/
│   ├── main.py                    # FastAPI + lifespan（DB/Redis 初始化）
│   ├── config.py                  # pydantic-settings 配置
│   ├── agents/                    # LangGraph 编排层
│   │   ├── state.py               # VideoProjectState（共享状态 + 5 子类型）
│   │   ├── orchestrator.py        # 9 节点状态图 + 条件边 + 审核循环
│   │   ├── screenwriter.py        # 编剧 Agent（大纲 + 角色列表）
│   │   ├── artist.py              # 美术 Agent（角色外貌 + 风格锁定）
│   │   ├── cinematographer.py     # 摄影 Agent（分镜 + 运镜）
│   │   └── review_gate.py         # 质量审核门（6 维评分 + 条件路由）
│   ├── tools/                     # 后端工具层
│   │   ├── canvas_tools.py        # 画布指令构建器（8 个 cmd_* 函数）
│   │   ├── generation_tools.py    # LLM 调用 + 图片分类
│   │   ├── review_tools.py        # 4 维分项审查
│   │   └── translation_tools.py   # 中英翻译
│   ├── routers/                   # API 路由
│   │   ├── chat.py                # /ws/chat WebSocket 端点
│   │   ├── health.py              # /health 健康检查
│   │   ├── models.py              # /api/models CRUD + param_schema
│   │   ├── projects.py            # 项目 CRUD
│   │   ├── workflows.py           # 工作流 CRUD
│   │   └── templates.py           # 模板 CRUD
│   ├── services/
│   │   └── model_service.py       # 模型服务（CRUD + Redis 缓存）
│   ├── models/                    # SQLAlchemy ORM（9 张表 + ai_models）
│   ├── schemas/                   # Pydantic 请求/响应模型
│   └── db/                        # 数据库连接（MySQL + Redis）
├── alembic/                       # 数据库迁移
├── requirements.txt               # Python 依赖
└── pyproject.toml                 # 项目元数据
```

### 编排流程

```
START → detect_scenario → plan_story → design_characters → design_style
      → plan_shots → build_canvas → execute_canvas → review_gate
      → (pass) END  /  (fail & retry < 3) → 回退到对应阶段
```

### 双模式运行

| 模式 | 条件 | 链路 |
|------|------|------|
| **前端模式** | `BACKEND_ENABLED=false`（默认） | 用户 → chatStore → LLM API → Tool Calling → 画布 |
| **后端模式** | `BACKEND_ENABLED=true` | 用户 → WebSocket → LangGraph 编排 → 画布指令流 |

---

## Windsurf 工程化体系

采用渐进式披露架构，减少模型上下文负担：

### Level 0: Rules（自动加载，~80 行）

| 文件 | 用途 |
|------|------|
| `project-rules.md` | 唯一规则 — 技术栈/架构/10 条编码约束/导航表 |

### Level 1: Skills（按需加载）

| 文件 | 覆盖 SKILLS 模块 |
|------|------|
| `pre-production.md` | 角色设计 / 场景设计 / 风格锁定 / 分镜脚本 |
| `production.md` | 图片生成 / 图片编辑 / 视频生成 / COS 上传 |
| `post-production.md` | 音频配音 / 连续性检查 / 视频拼接 |
| `quality-and-craft.md` | 质量控制 / 提示词工艺 / 工具体系架构 / Smart Handle |

### Level 2: Workflows（斜杠命令，按需触发）

| 命令 | 用途 |
|------|------|
| `/dev-start` | 开发会话启动流程 |
| `/coding-standards` | 详细编码/测试/DB/性能规范 |
| `/add-node-type` | 新增节点 (11 步) |
| `/add-agent-tool` | 新增工具 (6 步) |
| `/add-skill-module` | 新增 SKILLS 模块 |
| `/add-model-adapter` | 新增模型/渠道 |
| `/channel-routing` | 渠道路由架构 |
| `/brainstorming` | 头脑风暴 (Superpowers) |
| `/writing-plans` | 实现计划 (Superpowers) |
| `/debugging` | 系统化调试 (Superpowers) |
| `/testing` | TDD 流程 (Superpowers) |
| `/verification` | 完成前验证 (Superpowers) |

### Vibe Coding 开发流程

```
用户想法 → /brainstorming (设计) → /writing-plans (计划)
         → /add-node-type 或 /add-agent-tool (实施)
         → /testing (测试) → /verification (验收)
```

---

## 集成到 Electron

本项目设计为 Electron 友好的架构：

1. **Zustand 状态管理** — 可通过 Electron IPC 桥接主进程/渲染进程
2. **纯前端 + API 调用** — 无 SSR 依赖，可直接作为 Electron 渲染进程
3. **模块化节点** — 每个节点独立文件，易于扩展
4. **JSON 工作流** — 导入/导出可对接本地文件系统
5. **COS 上传** — 可替换为本地存储或其他云服务
6. **后端编排** — LangGraph 后端提供多 Agent 协作能力，可独立部署或本地运行

---

## License

MIT
