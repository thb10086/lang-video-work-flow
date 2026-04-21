/**
 * Agent Skills Registry
 *
 * 分模块定义 Agent 的能力描述（SKILLS），注入到 Agent System Prompt 中。
 * 每个 Skill 包含：模块名、能力概述、可用工具、输入输出、使用场景。
 *
 * 设计原则：
 * - 模块化：每个业务域独立定义，可按需组合
 * - 专业化：提示词面向 LLM 理解优化，术语精确
 * - 可扩展：新增模块只需 push 到 ALL_SKILLS 数组
 */

import {
  renderImageFormula,
  renderVideoFormula,
  renderNegativePresets,
  STYLE_PRESETS,
} from '../promptCraft'

export interface SkillDefinition {
  /** 模块唯一标识 */
  id: string
  /** 模块中文名 */
  name: string
  /** 模块能力概述（1-2 句话） */
  summary: string
  /** 详细描述：包含可用工具、参数、流程 */
  details: string
  /** 该模块涉及的工具名列表 */
  tools: string[]
  /** 该模块涉及的节点类型 */
  nodeTypes: string[]
}

// ============================================================
// 1. 角色设计模块
// ============================================================
const characterDesign: SkillDefinition = {
  id: 'character_design',
  name: '角色设计',
  summary: '创建角色九宫图参考设定，提取角色特征，管理多角色资产。',
  details: `### 角色设计模块

**核心能力**：基于文字描述生成角色多视角参考图（九宫格），用于后续关键帧和视频生成时保持角色外貌一致性。

**工具链**：
- \`create_character_grid\` → 创建角色九宫图节点，需填入角色姓名 + 详细外貌特征描述
- \`execute_node\` → 调用 Gemini 图片模型生成 3×3 九宫格参考图
- \`get_node_output\` → 获取生成结果（base64 图片，自动上传 COS 获取公网 URL）

**输入要求**：
- name: 角色姓名（如「李明」「女主角」）
- description: 外貌特征描述，需包含：发型/发色、五官特征、体型、服装风格、标志性配饰
- style: 美术风格（anime / realistic / 3d_render / watercolor）

**输出**：九宫格参考图（正面/侧面/背面/表情变化等多视角），同时自动上传至 COS 生成公网 URL。

**最佳实践**：
- 外貌描述越详细，角色一致性越好
- 描述应使用英文关键词组合，如 "short silver hair, blue eyes, slim build, black leather jacket, silver necklace"
- 生成后的九宫图可连接到裁切节点，提取单视角图片作为视频首帧`,
  tools: ['create_character_grid', 'execute_node', 'get_node_output'],
  nodeTypes: ['characterGrid'],
}

// ============================================================
// 2. 场景设计模块
// ============================================================
const sceneDesign: SkillDefinition = {
  id: 'scene_design',
  name: '场景设计',
  summary: '创建场景九宫图参考设定，建立视觉世界观。',
  details: `### 场景设计模块

**核心能力**：基于文字描述生成场景多视角/多时段参考图（九宫格），确保视频中的环境视觉一致。

**工具链**：
- \`create_scene_grid\` → 创建场景九宫图节点，需填入场景名 + 环境描述 + 风格 + 氛围
- \`execute_node\` → 调用 Gemini 生成场景参考图
- \`connect_nodes\` → 将场景图连接到风格锁定节点提取风格特征

**输入要求**：
- name: 场景名称（如「赛博朋克街道」「森林深处」）
- description: 环境描述，需包含：地理特征、建筑/植被、天气/时间、光照条件、关键道具
- style: 视觉风格（cinematic / anime / photorealistic / fantasy）
- mood: 氛围基调（dramatic / peaceful / mysterious / energetic）

**输出**：场景九宫格（不同角度/时段/天气变化），自动上传 COS。

**最佳实践**：
- 场景描述应涵盖空间层次（前景/中景/远景）
- 可指定具体光照方向和色温，如 "warm sunset light from the left, long shadows"`,
  tools: ['create_scene_grid', 'execute_node', 'get_node_output'],
  nodeTypes: ['sceneGrid'],
}

// ============================================================
// 3. 风格锁定模块
// ============================================================
const styleLock: SkillDefinition = {
  id: 'style_lock',
  name: '风格锁定',
  summary: '从参考图中提取视觉风格特征，注入下游节点保持全片风格统一。',
  details: `### 风格锁定模块

**核心能力**：分析参考图片的色调、笔触、光影、构图等视觉特征，生成风格描述文本，注入下游图片/视频节点的提示词。

**工具链**：
- \`create_style_lock_node\` → 创建风格锁定节点，填入期望的风格描述
- \`connect_nodes\` → 将场景九宫图连接为参考图输入
- \`execute_node\` → 调用 LLM 分析参考图提取风格特征

**输入**：参考图片（来自上游节点连线）+ 期望的风格描述文本
**输出**：结构化风格描述（extractedStyle），可被下游节点读取并融入提示词

**使用场景**：确保同一项目中所有关键帧和视频保持统一的视觉风格`,
  tools: ['create_style_lock_node', 'connect_nodes', 'execute_node'],
  nodeTypes: ['styleLock'],
}

// ============================================================
// 4. 分镜脚本模块
// ============================================================
const storyboard: SkillDefinition = {
  id: 'storyboard',
  name: '分镜脚本',
  summary: 'AI 自动将剧本/创意拆解为结构化分镜列表，含镜头描述、时长、运镜。',
  details: `### 分镜脚本模块

**核心能力**：接收剧本文本，由 LLM 自动拆解为分镜序列。每个分镜包含画面描述、镜头类型、运镜方式、时长、情绪氛围。

**工具链**：
- \`create_storyboard_node\` → 创建分镜脚本节点，填入剧本/创意描述
- \`connect_nodes\` → 可选连接文本节点作为剧本输入
- \`execute_node\` → 调用 LLM 生成分镜列表
- \`get_node_output\` → 获取分镜结果，据此创建后续关键帧和视频节点

**输入**：script（剧本文本或创意概要）
**输出**：JSON 格式的增强分镜列表 shots[]，每项含：
- scene / camera / duration / mood / emotionIntensity(1-10)
- imagePrompt（英文六维法，直接可用于 imageGen）
- videoPrompt（英文五段式，直接可用于 videoGen）
- dialogue（中文对话/旁白）/ dialogueEN（英文翻译）
- audioHint（环境音/背景乐提示）/ charactersPresent（出场角色列表）

**最佳实践**：
- 分镜拆解后，逐个创建 imageGen 节点（画面描述作 prompt）和 videoGen 节点（运镜+动作作 prompt）
- 分镜数量建议 3-8 个，过多会导致单个镜头内容不够充实`,
  tools: ['create_storyboard_node', 'execute_node', 'get_node_output'],
  nodeTypes: ['storyboard'],
}

// ============================================================
// 5. 图片生成模块
// ============================================================
const imageGeneration: SkillDefinition = {
  id: 'image_generation',
  name: '图片生成',
  summary: '基于提示词生成关键帧图片，支持参考图引导、比例选择、风格注入。',
  details: `### 图片生成模块

**核心能力**：使用 Gemini 图片模型根据文字描述生成高质量关键帧图片。支持参考图引导生成、多种画面比例。生成的图片自动上传 COS 获取公网 URL。

**工具链**：
- \`create_image_node\` → 创建图片生成节点，填入画面描述提示词
- \`connect_nodes\` → 连接参考图（来自角色裁切/场景/风格锁定节点）
- \`execute_node\` → 调用 Gemini 模型生成图片
- \`update_node\` → 修改 prompt / aspectRatio / imageSize 等参数

**参数**：
- prompt: 画面描述提示词（英文效果更好）
- model: gemini-3.1-flash-image-preview（默认）
- aspectRatio: 1:1 / 16:9 / 9:16 / 4:3 / 3:4
- imageSize: 1k / 2k

**输出**：单张图片（base64 + COS 公网 URL），可作为视频生成的首帧/尾帧。

**提示词规范**：
- 结构：[主体] + [动作/姿态] + [环境] + [光影] + [风格] + [画质]
- 示例："A young woman with silver hair stands on a rooftop overlooking a neon-lit cyberpunk city at night, dramatic rim lighting, cinematic composition, 8K detail"`,
  tools: ['create_image_node', 'execute_node', 'update_node', 'connect_nodes', 'get_node_output'],
  nodeTypes: ['imageGen'],
}

// ============================================================
// 6. 图片编辑模块
// ============================================================
const imageEdit: SkillDefinition = {
  id: 'image_edit',
  name: '图片编辑',
  summary: '基于 Gemini 原生编辑能力对已有图片进行修改：换背景、加元素、修改细节。',
  details: `### 图片编辑模块

**核心能力**：接收一张输入图片和编辑指令，由 Gemini 模型执行图片编辑。适用于微调关键帧细节、替换背景、添加/移除元素。

**工具链**：
- \`create_image_edit_node\` → 创建编辑节点，填入编辑指令
- \`connect_nodes\` → 连接输入图片（来自 imageGen / characterGrid）
- \`execute_node\` → 执行编辑

**输入**：editInstruction（编辑指令，如"将背景换成海滩""移除左边的树""给角色加上墨镜"）
**输出**：编辑后的图片`,
  tools: ['create_image_edit_node', 'connect_nodes', 'execute_node'],
  nodeTypes: ['imageEdit'],
}

// ============================================================
// 8. 视频生成模块
// ============================================================
const videoGeneration: SkillDefinition = {
  id: 'video_generation',
  name: '视频生成',
  summary: '后端统一路由视频生成，推荐 Seedance 2.0（有声视频/参考视频/首尾帧/4-15s），也支持 VEO 3.1 / Sora-2 VIP / Kling v3。',
  details: `### 视频生成模块

**核心能力**：将文字描述 + 可选首帧图片转化为视频片段。模型列表及参数 Schema 统一由后端 DB 管理 (Single Source of Truth)。

**架构**：后端驱动
- 模型定义 + param_schema 存储在后端数据库 ai_models 表
- 前端通过 useBackendModels hook 获取模型列表
- 视频任务提交走后端 /api/generate/video 路由，后端负责渠道选择与降级

**可用模型**（由后端 DB 管理，以下为典型配置）：
| 统一模型名 | 提供方 | 时长 | 特色能力 |
|-----------|--------|------|---------|
| doubao-seedance-2-0 ★默认 | 字节跳动 | 4-15s | 有声视频/参考视频/参考音频/首尾帧/7种比例/固定镜头/连续生成 |
| doubao-seedance-2-0-fast | 字节跳动 | 4-15s | 同上，生成更快 |
| veo3.1-fast | Google | 8s | 高画质 |
| veo3.1 | Google | 8s | 最高画质 |
| sora-2-vip | OpenAI | 10/15s | Character 复用 |
| kling-v3 | 快手 | 5/10/15s | 首尾帧+负面提示 |

**Seedance 专属参数**（doubao-seedance-2-0 / doubao-seedance-2-0-fast）：
- \`size\`（非 aspect_ratio）: 16:9, 9:16, 1:1, 4:3, 3:4, 21:9, adaptive
- \`resolution\`: 480p, 720p
- \`generate_audio\`: 生成有声视频
- \`camera_fixed\`: 固定摄像机位
- \`return_last_frame\`: 返回末帧图片用于连续生成
- \`seed\`: 随机种子

**工具链**：
- \`create_video_node\` → 创建视频节点，指定 model / prompt / size（Seedance）或 aspect_ratio（其他）
- \`update_node\` → 切换模型或调整参数
- \`connect_nodes\` → 连接首帧图片（来自 imageGen 节点）
- \`execute_node\` → 提交任务（后端自动路由+降级，异步轮询）

**首帧引导**：图片自动上传到腾讯云 COS 获取公网 URL（视频模型要求 URL 而非 base64）。

**提示词规范**（格式：[Camera] + [Subject] + [Atmosphere] + [Quality] + [Negative]）：
- **关键**：[Subject] 段必须嵌入角色外貌关键词（发色、服装等），否则模型会改变角色外貌
- 示例："Slow dolly forward. A woman with short silver hair and black leather jacket walks through rain-soaked neon street with confident stride. Wet pavement reflections, volumetric fog, cool blue and neon pink lighting. Cinematic 4K, 24fps film grain, shallow depth of field. No morphing, no identity drift, no flickering."`,
  tools: ['create_video_node', 'execute_node', 'update_node', 'connect_nodes', 'get_node_output'],
  nodeTypes: ['videoGen'],
}

// ============================================================
// 9. 音频/配音模块
// ============================================================
const audioGeneration: SkillDefinition = {
  id: 'audio_generation',
  name: '音频配音',
  summary: '将文本转为语音配音，支持 ElevenLabs / Fish Speech / CosyVoice。',
  details: `### 音频配音模块

**核心能力**：将旁白/对话文本转化为语音音频，用于视频的配音轨。

**工具链**：
- \`create_audio_node\` → 创建音频节点，填入文本 + 选择模型 + 声音
- \`connect_nodes\` → 可连接文本节点作为内容输入
- \`execute_node\` → 生成语音

**支持模型**：elevenlabs / fish-speech / cosyvoice
**输入**：text（旁白文本）、model（模型）、voice（声音名称）
**输出**：音频文件`,
  tools: ['create_audio_node', 'execute_node', 'connect_nodes'],
  nodeTypes: ['audioNode'],
}

// ============================================================
// 10. LLM 对话模块
// ============================================================
const llmChat: SkillDefinition = {
  id: 'llm_chat',
  name: 'LLM 对话',
  summary: '通用大语言模型对话节点，可设定角色、进行创意讨论、生成文案。',
  details: `### LLM 对话模块

**核心能力**：在画布上创建独立的 LLM 对话节点，支持自定义系统提示词设定 AI 角色，适用于头脑风暴、文案生成、剧本创作等。

**工具链**：
- \`create_llm_node\` → 创建 LLM 对话节点，设定 systemPrompt + userInput
- \`execute_node\` → 发送对话请求获取回复

**默认模型**：gemini-3.1-pro-preview（支持通过 update_node 切换）`,
  tools: ['create_llm_node', 'execute_node', 'update_node'],
  nodeTypes: ['llmChat'],
}

// ============================================================
// 11. 连续性检查模块
// ============================================================
const continuityCheck: SkillDefinition = {
  id: 'continuity_check',
  name: '连续性检查',
  summary: '检查相邻镜头之间的视觉连续性，发现并标注不一致之处。',
  details: `### 连续性检查模块

**核心能力**：对比相邻镜头的关键帧图片，检查角色外貌、服装、道具、环境等元素是否保持一致。由 LLM 视觉分析完成，输出不一致报告。

**使用场景**：在所有关键帧生成完毕后，批量检查镜头间的连续性问题。`,
  tools: ['execute_node', 'get_node_output'],
  nodeTypes: ['continuityCheck'],
}

// ============================================================
// 12. 视频拼接模块
// ============================================================
const videoStitch: SkillDefinition = {
  id: 'video_stitch',
  name: '视频拼接',
  summary: '将多段视频片段按顺序拼接为完整短片，执行时自动收集上游已完成视频。',
  details: `### 视频拼接模块

**核心能力**：将多个 videoGen 节点输出的视频片段按连接顺序拼接为一个完整视频文件。

**工具链**：
- \`create_video_stitch_node\` → 创建视频拼接节点
- \`connect_nodes\` → 连接所有 videoGen 节点和 audioNode 的输出
- \`execute_node\` → 自动收集所有上游已完成视频的 URL，汇总为 clips 列表

**输入**：多段视频（通过连线，video-in 接视频，audio-in 接音频）
**输出**：clips 列表（各段视频 URL）+ 拼接后的完整视频

**注意**：执行前必须确保上游视频节点已执行完毕（status=done 且有 outputVideo）`,
  tools: ['create_video_stitch_node', 'connect_nodes', 'execute_node', 'get_node_output'],
  nodeTypes: ['videoStitch'],
}

// ============================================================
// 13. 工作流管理模块
// ============================================================
const workflowManagement: SkillDefinition = {
  id: 'workflow_management',
  name: '工作流管理',
  summary: '任务规划、批量执行、自我验证、长期记忆，驱动完整创作流程。',
  details: `### 工作流管理模块

**核心能力**：Agent 的元认知层——规划任务步骤、追踪执行进度、验证完成状态、记录偏好。

**工具链**：
- \`plan_task\` → 将复杂任务拆解为有序步骤
- \`update_plan_step\` → 标记步骤完成/失败
- \`verify_task\` → 检查画布状态是否符合预期
- \`batch_execute\` → 批量执行多个节点
- \`get_canvas_state\` → 获取画布全局状态
- \`save_memory\` → 保存用户偏好/项目设定到长期记忆
- \`recall_memory\` → 从记忆中检索相关信息
- \`generate_workflow\` → 一键生成完整工作流骨架

**最佳实践**：
- 复杂任务先 plan_task 分步，逐步执行并 update_plan_step
- 所有节点执行后 verify_task 自检
- 用户偏好（风格、常用模型）用 save_memory 记录，后续 recall_memory 复用`,
  tools: ['plan_task', 'update_plan_step', 'verify_task', 'batch_execute', 'get_canvas_state', 'save_memory', 'recall_memory', 'generate_workflow'],
  nodeTypes: [],
}

// ============================================================
// 14. COS 图片上传模块
// ============================================================
const cosUpload: SkillDefinition = {
  id: 'cos_upload',
  name: 'COS 图片上传',
  summary: '自动将生成的图片上传至腾讯云 COS，获取公网 URL 供视频模型使用。',
  details: `### COS 图片上传模块

**核心能力**：所有图片生成节点（characterGrid / sceneGrid / imageGen）在生成完成后，自动将 base64 图片上传至腾讯云 COS 对象存储，获取公网可访问 URL。

**自动化流程**：
1. 图片生成完成 → 节点 data 写入 outputImage（base64，用于界面展示）
2. 后台异步上传至 COS → 节点 data 写入 outputImageUrl（公网 URL）
3. 视频生成时，自动优先使用 outputImageUrl 作为首帧/尾帧
4. 若 COS 未配置，降级使用 base64（yunwu.ai Sora 支持 base64，APIMart 模型不支持）

**配置**：在 .env 中填入腾讯云 COS 的 VITE_COS_SECRET_ID / VITE_COS_SECRET_KEY / VITE_COS_REGION / VITE_COS_BUCKET，重启后生效。

**注意**：此模块为自动化后台服务，Agent 无需手动调用上传工具。`,
  tools: [],
  nodeTypes: [],
}

// ============================================================
// 15. 质量门控与提示词优化模块
// ============================================================
const qualityControl: SkillDefinition = {
  id: 'quality_control',
  name: '质量门控与提示词优化',
  summary: '审查画布节点质量、自动优化提示词，在执行前进行质量把关。',
  details: `### 质量门控与提示词优化模块

**核心能力**：在执行节点消耗 API 配额之前，先审查内容质量并自动优化提示词，避免浪费资源。

**工具链**：
- \`review_content\` → 审查单个节点或整个画布的内容质量
  - 检查维度：字段完整性、提示词质量（长度/语言/光照/运镜/负面词）、角色一致性、风格统一、技术参数
  - 返回：评分(0-100)、问题列表、优化建议
  - reviewAll=true 审查整个画布；否则指定 nodeLabel/nodeId 审查单个节点
- \`optimize_prompt\` → 使用 LLM 自动将粗糙提示词升级为专业级
  - 图片节点：按美术六维优化法（主体/光影/构图/风格/负面/一致性）
  - 视频节点：按摄影五段式公式（Camera/Subject/Environment/Quality/Negative）
  - 支持传入 style（视觉风格方向）和 characterAnchors（角色锚定词）
  - 优化后自动写回节点

**推荐工作流**：
1. 生成工作流或手动创建节点后 → \`review_content\`(reviewAll=true) 全局审查
2. 发现问题 → \`optimize_prompt\` 逐节点自动优化
3. 优化完成后 → 再次 \`review_content\` 确认评分提升
4. 评分 ≥ 80 分 → 开始 \`execute_node\` / \`batch_execute\``,
  tools: ['review_content', 'optimize_prompt'],
  nodeTypes: [],
}

// ============================================================
// 16. 提示词工艺模块 (Prompt Craft — 知识源)
// ============================================================
const promptCraft: SkillDefinition = {
  id: 'prompt_craft',
  name: '提示词工艺',
  summary: '提示词工程方法论：图片六维法、视频五段式、风格预设词库、负面约束预设。',
  details: (() => {
    const styleList = STYLE_PRESETS.map(s => `\`${s.id}\` ${s.nameZh}`).join(' / ')
    return `### 提示词工艺模块（知识源）

**核心能力**：为所有角色和工具提供统一的提示词工程方法论，是提示词编写的单一知识源（Single Source of Truth）。

**图片提示词六维优化法**：
${renderImageFormula(true)}

每个维度缺失都可能导致生成失控。\`optimize_prompt\` 工具按此公式自动升级图片提示词。

**视频提示词五段式公式**：
${renderVideoFormula(true)}

**关键**：[Subject] 段必须嵌入角色外貌锚定词，否则视频模型会改变角色外貌。

**风格预设**（可通过 \`optimize_prompt\` style 参数指定）：
${styleList}

**负面词预设**：
${renderNegativePresets()}

**使用方式**：
- Agent 写提示词时参考六维法/五段式公式
- \`optimize_prompt\` 工具自动按公式升级粗糙提示词
- \`review_content\` 工具按公式各维度审查缺失项
- 角色提示词（美术/摄影师）自动引用此知识源，无需重复定义`
  })(),
  tools: ['optimize_prompt', 'review_content'],
  nodeTypes: [],
}

// ============================================================
// 全部 SKILLS 汇总
// ============================================================
export const ALL_SKILLS: SkillDefinition[] = [
  characterDesign,
  sceneDesign,
  styleLock,
  storyboard,
  imageGeneration,
  imageEdit,
  videoGeneration,
  audioGeneration,
  llmChat,
  continuityCheck,
  videoStitch,
  workflowManagement,
  promptCraft,
  qualityControl,
  cosUpload,
]

/**
 * 生成 Agent System Prompt 中的 SKILLS 段落
 * 格式：快速索引表 + 各模块详细说明（无冗余 summary）
 */
export function buildSkillsPrompt(): string {
  // Quick-reference index: one line per module
  const indexRows = ALL_SKILLS
    .filter(s => s.tools.length > 0) // hide COS (auto service, no agent tools)
    .map(s => `| ${s.name} | ${s.tools.slice(0, 3).join(' / ')} | ${s.nodeTypes.join(', ') || '—'} |`)
  const indexTable = `| 模块 | 核心工具（前3）| 节点类型 |\n|------|--------------|----------|\n${indexRows.join('\n')}`

  // Detail sections: skip redundant summary line (already in details)
  const sections = ALL_SKILLS.map(skill => skill.details)

  return `## SKILLS（能力清单）

${indexTable}

${sections.join('\n\n')}`
}

/**
 * 生成精简版 SKILLS（用于 token 紧张场景）
 */
export function buildSkillsSummary(): string {
  const lines = ALL_SKILLS.map(s => `- **${s.name}**：${s.summary}`)
  return `## 能力概览\n\n${lines.join('\n')}`
}

/**
 * 按工作阶段加载相关 SKILLS（动态瘦身）
 *
 * Phase 映射：
 * - pre_production: 角色设计 + 场景设计 + 风格锁定 + 分镜 + 工作流管理
 * - production:     图片生成 + 图片编辑 + 视频生成 + 提示词工艺
 * - post_production: 音频 + 连续性检查 + 视频拼接 + 质量控制
 * - full:           全部（默认）
 */
const PHASE_SKILL_MAP: Record<string, string[]> = {
  pre_production: ['character_design', 'scene_design', 'style_lock', 'storyboard', 'workflow_management', 'llm_chat'],
  production: ['image_generation', 'image_edit', 'video_generation', 'prompt_craft', 'style_lock', 'character_design'],
  post_production: ['audio_generation', 'continuity_check', 'video_stitch', 'quality_control'],
}

export function buildSkillsPromptByPhase(phase?: string): string {
  if (!phase || phase === 'full') return buildSkillsPrompt()

  const skillIds = PHASE_SKILL_MAP[phase]
  if (!skillIds) return buildSkillsPrompt()

  const filtered = ALL_SKILLS.filter(s => skillIds.includes(s.id))
  if (filtered.length === 0) return buildSkillsPrompt()

  const indexRows = filtered
    .filter(s => s.tools.length > 0)
    .map(s => `| ${s.name} | ${s.tools.slice(0, 3).join(' / ')} | ${s.nodeTypes.join(', ') || '—'} |`)
  const indexTable = `| 模块 | 核心工具（前3）| 节点类型 |\n|------|--------------|----------|\n${indexRows.join('\n')}`
  const sections = filtered.map(skill => skill.details)

  const otherSkills = ALL_SKILLS.filter(s => !skillIds.includes(s.id))
  const otherSummary = otherSkills.length > 0
    ? `\n\n> 其他可用模块（本阶段非重点）：${otherSkills.map(s => s.name).join('、')}`
    : ''

  return `## SKILLS（${phase} 阶段）

${indexTable}

${sections.join('\n\n')}${otherSummary}`
}
