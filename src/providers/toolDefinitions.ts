/**
 * Agent Tool Definitions (OpenAI Function Calling Schema)
 *
 * 定义 LLM 可调用的工具函数 schema，不包含执行逻辑。
 * 执行逻辑见 agentTools.ts → toolHandlers.ts
 *
 * 关于 `create_video_node` / `create_image_node` / `create_audio_node`：
 *   静态版本（下方）是回退方案，当前端尚未加载后端模型列表时使用。
 *   运行时优先通过 getAgentTools(models) 生成模型感知版本（见 toolSchemaGenerator.ts）。
 */

import type { AiModelResponse } from '@/api/backend'
import { DEFAULT_VIDEO_MODEL, DEFAULT_AUDIO_MODEL, KNOWN_VIDEO_MODELS, KNOWN_AUDIO_MODELS } from '@/providers/modelDefaults'
import {
  buildCreateVideoNodeTool,
  buildCreateImageNodeTool,
  buildCreateAudioNodeTool,
  GET_MODEL_PARAMS_TOOL,
} from './toolSchemaGenerator'
import {
  selectTier,
  expandTierSelection,
  allTierToolNames,
  type SelectTierContext,
  type TierId,
} from './toolTiers'
import { applyBudgetToSchema } from './toolBudget'

export const AGENT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'create_character_grid',
      description: '在画布上创建角色九宫图节点，用于生成角色多视角参考图。前置条件：必须提供 name 和 description（含发色/服装/体型等外貌关键词），否则后续 imageGen 会缺少角色锚定。创建后需 execute_node 执行生成。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '角色名称' },
          description: { type: 'string', description: '角色外貌和特征描述' },
          style: {
            type: 'string',
            enum: ['anime', 'realistic', 'cartoon', 'watercolor', 'pixel art', 'comic book', '3D render'],
            description: '画风',
          },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_scene_grid',
      description: '在画布上创建场景九宫图节点，用于生成场景多角度参考图。前置条件：必须提供 name 和 description（含环境/光照/氛围），否则生成效果差。创建后需 execute_node 执行生成。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '场景名称' },
          description: { type: 'string', description: '场景环境描述' },
          style: {
            type: 'string',
            enum: ['cinematic', 'anime', 'realistic', 'painterly', 'noir', 'fantasy'],
            description: '风格',
          },
          mood: {
            type: 'string',
            enum: ['dramatic', 'peaceful', 'tense', 'romantic', 'mysterious', 'epic'],
            description: '情绪',
          },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_keyframe_grid',
      description: '为单个复杂镜头生成"分镜拼贴图"——一张图内含 4/6/9 个相关 panel（一次调用 image model，成本 ≈ 1 张单图）。子类型：(1) time-progression 时间序列推演（同机位、剧情向前）；(2) scene-evolution 画面演进（状态/天气/氛围渐变）；(3) action-breakdown 动作分解（复杂动作拆 N 个 pose）；(4) multi-camera 多机位（同一时刻不同角度）。【触发场景】shot 含运镜/连续动作/剧情推演/状态变化时使用；简单短镜头继续用 create_image_node。创建后需 execute_node 执行。',
      parameters: {
        type: 'object',
        properties: {
          shotName: { type: 'string', description: '镜头名（如 shot-3-revenge）' },
          shotDescription: { type: 'string', description: '镜头详细描述（含动作/环境/角色/镜头运动）' },
          subType: {
            type: 'string',
            enum: ['time-progression', 'scene-evolution', 'action-breakdown', 'multi-camera'],
            description: '分镜子类型：剧情推演 / 画面演进 / 动作分解 / 多机位',
          },
          layout: {
            type: 'string',
            enum: ['2x2', '2x3', '3x3'],
            description: '宫格布局：四宫格(简单) / 六宫格(标准，默认) / 九宫格(复杂)',
          },
          style: {
            type: 'string',
            enum: ['cinematic', 'anime', 'realistic', 'painterly', 'noir', 'fantasy'],
            description: '风格',
          },
          mood: {
            type: 'string',
            enum: ['dramatic', 'peaceful', 'tense', 'romantic', 'mysterious', 'epic'],
            description: '情绪',
          },
        },
        required: ['shotName', 'shotDescription', 'subType'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_image_node',
      description: '在画布上创建图片生成节点（Gemini API）。提示词必须用英文，包含角色外貌关键词。创建后用 connect_nodes 连接参考图，再 execute_node 执行。如需优化提示词，用 optimize_prompt 而非手动修改。',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '图片生成提示词' },
          aspectRatio: {
            type: 'string',
            enum: ['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4'],
            description: '宽高比',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_video_node',
      description: `在画布上创建视频生成节点。可选模型：${KNOWN_VIDEO_MODELS.join(' / ')}（默认 ${DEFAULT_VIDEO_MODEL}）。同一模型可能有多个渠道供应商，系统自动按优先级选择并降级容错。前置条件：prompt 必须英文且包含 [Camera]/[Subject]/[Negative] 段。创建后必须用 connect_nodes 连接首帧图片，再 execute_node 执行。多个视频节点请用 parallel_execute 并行执行。模型能力差异（duration/aspect_ratio/generate_audio 等）通过 get_model_params 查询。`,
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '视频描述提示词' },
          model: {
            type: 'string',
            enum: [...KNOWN_VIDEO_MODELS],
            description: `视频模型（默认 ${DEFAULT_VIDEO_MODEL}）`,
          },
          aspect_ratio: {
            type: 'string',
            enum: ['16:9', '9:16', '1:1'],
            description: '画面比例（VEO/Sora/Kling 使用，默认 16:9）',
          },
          size: {
            type: 'string',
            enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
            description: '画面比例（Seedance 专用，支持 7 种比例含超宽和自适应，默认 16:9）',
          },
          duration: { type: 'number', description: '时长（秒），Seedance 支持 4-15' },
          resolution: { type: 'string', enum: ['480p', '720p'], description: '分辨率（Seedance 专用）' },
          generate_audio: { type: 'boolean', description: '生成有声视频（Seedance 专用）' },
          camera_fixed: { type: 'boolean', description: '固定镜头（Seedance 专用）' },
          return_last_frame: { type: 'boolean', description: '返回末帧图片用于连续生成（Seedance 专用）' },
          seed: { type: 'number', description: '随机种子（Seedance 专用）' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_llm_node',
      description: '在画布上创建LLM对话节点',
      parameters: {
        type: 'object',
        properties: {
          systemPrompt: { type: 'string', description: '系统提示词（设定AI角色）' },
          userInput: { type: 'string', description: '初始用户输入' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_text_node',
      description: '在画布上创建文本/脚本节点',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '初始文本内容' },
          label: { type: 'string', description: '节点标题' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'connect_nodes',
      description: '连接两个节点的端口。系统自动根据节点类型解析正确的 handle（如 characterGrid→grid-out, imageGen→ref-in）。前置条件：两个节点必须已存在于画布上。',
      parameters: {
        type: 'object',
        properties: {
          sourceNodeLabel: { type: 'string', description: '源节点的标签名' },
          targetNodeLabel: { type: 'string', description: '目标节点的标签名' },
        },
        required: ['sourceNodeLabel', 'targetNodeLabel'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_audio_node',
      description: `在画布上创建音频/配音节点（支持 ${KNOWN_AUDIO_MODELS.join(' / ')}）`,
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要转为语音的文本内容' },
          model: { type: 'string', enum: [...KNOWN_AUDIO_MODELS], description: `音频模型（默认 ${DEFAULT_AUDIO_MODEL}）` },
          voice: { type: 'string', description: '声音名称' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_storyboard_node',
      description: '在画布上创建分镜脚本节点，用于AI拆解剧本为分镜列表',
      parameters: {
        type: 'object',
        properties: {
          script: { type: 'string', description: '初始剧本或创意描述' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_character_extract_node',
      description: '从视频中提取角色为可复用的角色引用。通常连接上游 videoGen 的输出，执行时调用 Sora/Seedance 角色提取 API。提取结果可连接到 characterManager 或直接到 videoGen 的 character-in。',
      parameters: {
        type: 'object',
        properties: {
          videoUrl: { type: 'string', description: '视频 URL（可选，通常由上游 videoGen 自动注入）' },
          timestamps: { type: 'string', description: '采样时间戳（秒，逗号分隔），如 "1,3"；默认 "1,3"' },
          label: { type: 'string', description: '节点标题（默认"角色提取"）' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_character_manager_node',
      description: '创建角色管理器节点，作为画布级的角色库（name/description/characterUrl 列表）。下游的 imageGen/videoGen 可用 @角色名 引用其中的角色。可接多个 characterGrid/characterExtract 的输出来自动填充。',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: '节点标题（默认"角色管理器"）' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_style_lock_node',
      description: '在画布上创建风格锁定节点，用于提取参考图风格特征并注入下游节点',
      parameters: {
        type: 'object',
        properties: {
          styleDescription: { type: 'string', description: '期望的风格描述，如"赛博朋克、暖色调、胶片质感"' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_image_edit_node',
      description: '在画布上创建图片编辑节点（Gemini原生编辑：换背景/加元素/修改细节）',
      parameters: {
        type: 'object',
        properties: {
          editInstruction: { type: 'string', description: '编辑指令，如"将背景换成海滩"' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_from_images',
      description: '根据用户本轮上传的多张图片，自动分类并批量创建合适节点（角色九宫图 / 场景九宫图 / 风格锁定 / 图片编辑）。每张图独立判定 character/scene/style/edit_input 并挂到对应节点的参考图字段。一次最多处理 10 张图。',
      parameters: {
        type: 'object',
        properties: {
          images: {
            type: 'array',
            items: { type: 'string' },
            description: 'data-URL 或 base64 PNG 数组；留空则自动取最近一条用户消息里的全部图片',
          },
          intent: {
            type: 'string',
            enum: ['character_refs', 'scene_refs', 'style_lock', 'edit', 'mixed'],
            description: '整体意图提示。mixed=每张图独立分类（默认）',
          },
          names: {
            type: 'array',
            items: { type: 'string' },
            description: '可选：每张图片对应的命名（长度应与 images 一致）',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_video_stitch_node',
      description: '在画布上创建视频拼接节点，用于将多段视频合并为完整短片。需连接多个视频生成节点的输出。执行时自动收集上游已完成的视频。',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: '节点标题（默认"最终合成"）' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_continuity_check_node',
      description: '在画布上创建连续性检查节点，用于AI检查相邻镜头之间角色/光照/色调/场景的视觉一致性',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: '节点标题' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_timeline_node',
      description: '在画布上创建时间轴节点，用于将多个视频/音频片段编排为带剪切点的完整时间轴。执行时自动按上游 x 坐标排序、计算总时长 + cuts 列表，输出标准 timeline JSON 给下游 stitch / 渲染节点。',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: '节点标题（默认"时间轴"）' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'generate_workflow',
      description: '【核心工具】根据用户创意描述，一键生成完整的AI视频制作工作流。支持6种场景模式(漫剧/产品广告/探店/教程/短剧/MV)。前置条件：必须先调用 detect_scenario 确定场景类型。禁止：不要留空任何 prompt/description 字段，shotPrompts 和 videoPrompts 必须是英文。生成后建议：调用 verify_task 检查质量，用 review_content 审查所有节点。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '项目标题' },
          description: { type: 'string', description: '完整的创意描述/剧本概要' },
          scenario: {
            type: 'string',
            enum: ['comic_drama', 'product_ad', 'store_tour', 'tutorial', 'short_drama', 'music_video'],
            description: '场景类型（由 detect_scenario 识别）。comic_drama=漫剧, product_ad=产品广告, store_tour=探店, tutorial=教程, short_drama=短剧, music_video=MV。未指定时默认 short_drama。',
          },
          characterNames: {
            type: 'array',
            items: { type: 'string' },
            description: '角色名称列表',
          },
          characterDescriptions: {
            type: 'array',
            items: { type: 'string' },
            description: '每个角色的详细外貌特征描述（与 characterNames 一一对应），用于生成角色九宫图',
          },
          sceneNames: {
            type: 'array',
            items: { type: 'string' },
            description: '场景名称列表',
          },
          sceneDescriptions: {
            type: 'array',
            items: { type: 'string' },
            description: '每个场景的详细环境描述（与 sceneNames 一一对应），用于生成场景九宫图',
          },
          shotCount: { type: 'number', description: '分镜/镜头数量（默认4，建议3-8）' },
          shotPrompts: {
            type: 'array',
            items: { type: 'string' },
            description: '每个镜头的关键帧图片提示词（英文，与 shotCount 对应）。格式：[角色外貌+动作] + [环境] + [光影] + [风格+质量]。必须包含角色外貌关键词。',
          },
          videoPrompts: {
            type: 'array',
            items: { type: 'string' },
            description: '每个镜头的视频提示词（英文，与 shotCount 对应）。【强制结构】以 `Camera:` 或 `Action:` 开头 — 第一句话必须是动作或运镜指令。【禁止】不要在 videoPrompt 开头重复角色完整外貌描述（如 "X is a 25-year-old woman with..."）—— imageGen 的首帧已经锁定身份，且系统会自动注入 `[Character Anchor]` 前缀；在 videoPrompt 里重复外貌会让模型把注意力预算花在静态身份上，导致视频生成出"静止说话"的无动作镜头。格式：`Camera: <运镜>. Action: <主体动作 + 次级运动>. Keep <锚定项> consistent. Avoid: <具体失败模式>.`。运镜偏好 subtle push-in / slow pan / gentle dolly / locked-off with parallax；避免 360 orbit / crane / whip pan。Negative 用具体名词如 warped fingers, face distortion, logo flicker, frame stutter（不要 morphing 这种抽象词）。产品镜头加 `Keep product label and logo perfectly readable.`',
          },
          styleDescription: { type: 'string', description: '整体视觉风格描述，如"赛博朋克、冷色调、霓虹灯光、电影质感"' },
          narrationText: { type: 'string', description: '旁白/配音文本内容' },
          productImage: {
            type: 'string',
            description: '【产品广告专用】产品参考图 URL 或 data-url。开启后会作为 referenceImage 锚定到全部 imageGen / videoGen 节点，保证产品在每个镜头的外观完全一致。仅在 scenario=product_ad 时生效。',
          },
          productOnlyShots: {
            type: 'array',
            items: { type: 'number' },
            description: '【产品广告专用】1-based 镜头索引列表，列出的镜头将不带任何角色 ref，呈现纯产品。常用：[1,2] 表示前两个 hero / 桌面镜头仅产品，从第 3 镜头起人物入画。仅在 scenario=product_ad + 有 characterNames 时生效。',
          },
          replaceCanvas: {
            type: 'boolean',
            description: '是否在生成新工作流前先清空画布。默认 true（替换模式），重新跑 generate_workflow 时会丢弃旧画布，确保 verify_task 只评分新版本、不会出现新旧节点并存导致总分被旧节点压低。仅当你明确想把多次生成累加到同一画布（如多场景拼接）时才传 false。',
          },
        },
        required: ['title', 'description'],
      },
    },
  },

  // ============================================================
  // Agent Infrastructure Tools (Planning / Memory / Verification)
  // ============================================================
  {
    type: 'function' as const,
    function: {
      name: 'set_phase',
      description: '【阶段切换】自我声明当前工作阶段。阶段影响工具可用性（例如 planning 禁用 create_*_node，reviewing 禁用 delete_node）。典型序列：planning → designing → building → executing → reviewing。默认 idle=无 gating。',
      parameters: {
        type: 'object',
        properties: {
          phase: {
            type: 'string',
            enum: ['idle', 'planning', 'designing', 'building', 'reviewing', 'executing'],
            description: '目标阶段',
          },
          reason: { type: 'string', description: '切换原因（简短，用于审计日志）' },
        },
        required: ['phase'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'plan_task',
      description: '【任务规划】将复杂任务分解为有序步骤。当用户请求涉及多个操作时，必须先制定计划再逐步执行。每完成一步必须调用 update_plan_step 标记进度。所有步骤完成后必须调用 verify_task 自检。最后一步应为验证步骤。',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: '任务总目标的简短描述' },
          steps: {
            type: 'array',
            items: { type: 'string' },
            description: '有序的执行步骤列表，每步应具体明确',
          },
        },
        required: ['goal', 'steps'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_plan_step',
      description: '更新当前任务计划中某一步的状态。每完成一个步骤后调用此工具标记进度。',
      parameters: {
        type: 'object',
        properties: {
          stepIndex: { type: 'number', description: '步骤索引（从0开始）' },
          status: { type: 'string', enum: ['in_progress', 'done', 'failed'], description: '新状态' },
          result: { type: 'string', description: '执行结果的简短描述' },
        },
        required: ['stepIndex', 'status'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'verify_task',
      description: '【自我验证】全面检查当前画布状态，返回 0-100 质量评分。检查维度：节点数量、连线完整性、提示词语言(英文)、角色外貌一致性、字段完整性、视频时长合理性、孤立节点。使用时机：在所有 plan_task 步骤执行完毕后必须调用此工具进行自检。如果评分 < 80，需根据问题列表修复后重新验证。',
      parameters: {
        type: 'object',
        properties: {
          expectedNodes: { type: 'number', description: '预期的节点数量' },
          checkConnections: { type: 'boolean', description: '是否检查连线完整性（默认 true）' },
          verbose: { type: 'boolean', description: '是否输出详细逐节点报告（默认 false）' },
          useVisionVerify: {
            type: 'boolean',
            description: '开启视觉语义校验：第 4 维（角色外貌一致性）改用 Vision 模型（默认 gemini-vision）对每个 imageGen 的输出图做逐张语义比对。网络失败时自动 fallback 到启发式字符串匹配并在 message 中附 [vision fallback] 标记。默认 false（保留原启发式行为）。',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'verify_image_semantic',
      description: '【视觉 QC】对单个生成图片节点的 outputImage 做语义级校验：调 Vision 模型（默认 gemini-vision）判断画面是否符合 expectedSubjects / expectedStyle。返回结构化 matchScore (0-100) + detectedSubjects + missingElements + recommendation ("accept" | "retry" | "edit_prompt")。使用时机：生成关键帧后想在提交视频前确认方向正确，或 verify_task 评分低时定位具体哪张图偏离。比 review_generated_image 更精准（调真正 Vision 模型，非启发式）。',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: '目标节点 ID（精确匹配，推荐）' },
          nodeLabel: { type: 'string', description: '目标节点标签（模糊匹配，适用于 imageGen / videoGen 首帧 / imageEdit）' },
          expectedSubjects: {
            type: 'array',
            items: { type: 'string' },
            description: '期望出现的主体（英文），如 ["character Lin Xia", "cyberpunk street"]',
          },
          expectedStyle: {
            type: 'string',
            description: '期望风格（英文），如 "anime, vibrant colors"',
          },
          threshold: {
            type: 'number',
            description: '接受阈值（0-100）。matchScore < threshold 时 recommendation 至少为 retry。默认 70。',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'save_memory',
      description: '保存重要信息到分层记忆（Claude Code CLAUDE.md 模式）。scope 决定可见范围：session（本次对话有效）/ project（当前项目有效）/ global（跨项目永久）。相同 type+title 的记忆会自动更新而非重复创建。pinned=true 的记忆始终进入系统提示词。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '记忆标题' },
          content: { type: 'string', description: '记忆内容' },
          type: {
            type: 'string',
            enum: ['project_preference', 'character_profile', 'style_guide', 'workflow_pattern', 'user_feedback'],
            description: '记忆类型',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: '标签，用于后续检索与相关性排序（命中当前用户消息的标签会被优先注入）',
          },
          scope: {
            type: 'string',
            enum: ['session', 'project', 'global'],
            description: '记忆作用域。session=默认，仅当前对话；project=当前 canvas 专属；global=跨项目通用',
          },
          pinned: {
            type: 'boolean',
            description: '置顶记忆。开启后每轮都会注入系统提示，绕过相关性排序（谨慎使用，上限建议 2 条）',
          },
        },
        required: ['title', 'content', 'type'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'recall_memory',
      description: '从长期记忆中检索相关信息。当需要参考之前的项目设定、用户偏好或历史决策时使用。⚠️ 重要：返回的记忆可能已过期，务必结合当前画布状态（get_canvas_state）验证后再依据记忆行动。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索关键词' },
          limit: { type: 'number', description: '返回条数上限（默认5）' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'forget_memory',
      description: '按 id / tag / scope / 年龄 删除记忆条目（Claude Code /memory clean 模式）。至少提供一个过滤条件。返回删除条数。典型用法：忘掉旧项目偏好 / 清空 session / 按标签批量清理。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '精确的 memory id（最强过滤）' },
          tag: { type: 'string', description: '包含该标签的条目会被删除（大小写不敏感）' },
          scope: {
            type: 'string',
            enum: ['session', 'project', 'global'],
            description: '匹配该 scope 的条目会被删除',
          },
          olderThan: { type: 'number', description: '毫秒数。updatedAt 早于 Date.now()-N 的条目会被删除。例如 604800000 = 7 天' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'review_generated_image',
      description: '审查已生成图片/视频节点的质量。通过 nodeLabel 或 nodeId 定位节点，返回 0-100 评分、是否通过、问题列表和改进建议。reviewing 阶段推荐使用此工具。当前为启发式 stub（不消耗 Vision API），后续可接入 GPT-4V 进行视觉一致性审查。',
      parameters: {
        type: 'object',
        properties: {
          nodeLabel: { type: 'string', description: '目标节点标签名（模糊匹配）' },
          nodeId: { type: 'string', description: '目标节点精确 ID（优先于 nodeLabel）' },
          threshold: { type: 'number', description: '通过阈值 0-100，默认 60' },
          aspects: {
            type: 'array',
            items: { type: 'string', enum: ['composition', 'consistency', 'prompt_adherence', 'all'] },
            description: '审查维度，默认 all',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_node',
      description: '更新画布上已有节点的数据字段。通过 nodeLabel（模糊匹配）或 nodeId（精确匹配）定位节点。若同名节点有多个，先用 get_canvas_state 获取节点 ID，再用 nodeId 精确定位。可修改字段：prompt、description、content、name、style、model、aspect_ratio、duration 等。提示：如果目的是优化提示词质量，优先使用 optimize_prompt 工具（自动 LLM 优化并写回）。',
      parameters: {
        type: 'object',
        properties: {
          nodeLabel: { type: 'string', description: '目标节点的标签名（模糊匹配）' },
          nodeId: { type: 'string', description: '目标节点的精确 ID（优先于 nodeLabel，用于消除同名歧义）' },
          updates: {
            type: 'object',
            description: `要更新的字段键值对。示例：{"model": "${DEFAULT_VIDEO_MODEL}", "prompt": "新提示词"}`,
            additionalProperties: true,
          },
        },
        required: ['updates'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_node',
      description: '删除画布上的节点及其所有连线。通过节点标签名或精确 ID 定位。⚠️ 不可逆操作：删除前确认该节点无下游依赖节点，否则下游节点的输入会断开。建议先用 get_canvas_state 查看连线关系。',
      parameters: {
        type: 'object',
        properties: {
          nodeLabel: { type: 'string', description: '要删除的节点标签名（模糊匹配）' },
          nodeId: { type: 'string', description: '要删除的节点精确 ID（优先）' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'execute_node',
      description: '触发画布上单个节点的生成/执行操作。支持类型：characterGrid/sceneGrid/imageGen/videoGen/storyboard/styleLock/llmChat/imageEdit/continuityCheck/videoStitch/audioNode。前置条件：确保节点的 prompt/description 等关键字段已填充（非空），否则执行会失败或生成低质量结果。执行后用 get_node_output 检查结果。多个独立节点请用 parallel_execute 并行执行以节省时间。',
      parameters: {
        type: 'object',
        properties: {
          nodeLabel: { type: 'string', description: '要执行的节点标签名（模糊匹配）' },
          nodeId: { type: 'string', description: '要执行的节点精确 ID（优先）' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'retry_node',
      description: '重试已失败或执行异常的节点。重置节点状态后重新执行。仅用于暂时性失败（网络超时、模型负载）。如果是参数/内容错误导致的失败，应先用 update_node 或 optimize_prompt 修正内容，再用此工具重试。',
      parameters: {
        type: 'object',
        properties: {
          nodeLabel: { type: 'string', description: '要重试的节点标签名（模糊匹配）' },
          nodeId: { type: 'string', description: '要重试的节点精确 ID（优先）' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'batch_execute',
      description: '按顺序串行执行多个节点。仅用于有明确前后依赖关系的节点（如先执行 characterGrid 再执行依赖其输出的 imageGen）。如果节点之间无依赖关系（如多个 imageGen），请改用 parallel_execute 并行执行以大幅缩短时间。',
      parameters: {
        type: 'object',
        properties: {
          nodeLabels: {
            type: 'array',
            items: { type: 'string' },
            description: '要按顺序串行执行的节点标签名列表',
          },
        },
        required: ['nodeLabels'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'parallel_execute',
      description: '【性能优化】同时并行执行多个相互独立的节点，大幅缩短总执行时间。适用于同一阶段的无依赖节点，例如：8个关键帧图片生成（可同时启动）、8个视频生成（可同时提交）。注意：有依赖关系的节点不要并行（如 characterGrid 必须在 imageGen 之前完成）。并行度默认4（最多同时4个），可通过 concurrency 参数调整。',
      parameters: {
        type: 'object',
        properties: {
          nodeLabels: {
            type: 'array',
            items: { type: 'string' },
            description: '要并行执行的节点标签名列表（这些节点应相互独立，无先后依赖）',
          },
          nodeIds: {
            type: 'array',
            items: { type: 'string' },
            description: '要并行执行的节点 ID 列表（优先于 nodeLabels，更精确）',
          },
          concurrency: {
            type: 'number',
            description: '最大并发数（默认4，建议视频节点用2-4，图片节点用4-8）',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_node_output',
      description: '检查某个节点的执行结果和状态。返回 status、outputImage/outputVideo/shots 等关键输出字段。使用时机：每次 execute_node 之后必须调用此工具确认执行成功。如果 status 为 error，用 retry_node 重试。',
      parameters: {
        type: 'object',
        properties: {
          nodeLabel: { type: 'string', description: '目标节点的标签名（模糊匹配）' },
          nodeId: { type: 'string', description: '目标节点的精确 ID（优先）' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_canvas_state',
      description: '获取画布当前完整状态：所有节点（含 id/type/label/status/关键字段）和连线关系。用于了解当前工作流构成、消除同名歧义（获取精确 nodeId）。避免频繁调用——结果已含完整信息，一次调用后缓存在对话上下文中即可。',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_models',
      description: '列出当前系统中所有已注册的可用模型，包括图片模型、视频模型和LLM模型。用于确认哪些模型当前可用，以及每个视频模型的渠道配置。',
      parameters: {
        type: 'object',
        properties: {
          capability: {
            type: 'string',
            enum: ['image', 'video', 'llm', 'all'],
            description: '过滤模型类型（默认返回所有）',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'inject_user_images',
      description: '将用户在本轮对话中上传的图片注入到画布上指定节点的指定字段。典型用法：用户上传产品图片 → 注入到 imageGen 的 referenceImages 或 characterGrid 的 inputImage。支持注入到多个节点。imageIndex 从 0 开始，对应用户上传的图片顺序。',
      parameters: {
        type: 'object',
        properties: {
          targets: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                nodeLabel: { type: 'string', description: '目标节点标签名' },
                nodeId: { type: 'string', description: '目标节点精确 ID（优先）' },
                field: {
                  type: 'string',
                  enum: ['referenceImages', 'inputImage', 'referenceImage', 'firstFrameImage'],
                  description: '目标字段名。referenceImages=参考图数组(追加), inputImage=单张输入图, referenceImage=单张参考图, firstFrameImage=视频首帧',
                },
                imageIndices: {
                  type: 'array',
                  items: { type: 'number' },
                  description: '要注入的图片索引列表（0-based，对应用户上传顺序）。不指定则注入全部图片。',
                },
              },
              required: ['field'],
            },
            description: '注入目标列表',
          },
          autoDistribute: {
            type: 'boolean',
            description: '开启后，N 张图按 round-robin 分配到 M 个 targets（target[i] 拿 image[i % N]）。默认 false（每个 target 拿全部图）。',
          },
        },
        required: ['targets'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'review_content',
      description: '【质量门控】审查画布上节点的内容质量，包括提示词、剧本、分镜、角色一致性等。返回评分、问题列表和优化建议。使用时机：在 execute_node/parallel_execute 之前调用，避免对低质量内容浪费 API 配额。发现问题后用 optimize_prompt 自动修复或 update_node 手动修复。',
      parameters: {
        type: 'object',
        properties: {
          nodeLabel: { type: 'string', description: '要审查的节点标签名（模糊匹配）' },
          nodeId: { type: 'string', description: '要审查的节点精确 ID（优先）' },
          reviewAll: { type: 'boolean', description: '是否审查画布上所有节点（忽略 nodeLabel/nodeId）' },
          aspects: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['prompt_quality', 'character_consistency', 'style_consistency', 'completeness', 'technical_params'],
            },
            description: '要审查的维度（默认全部）。prompt_quality=提示词质量, character_consistency=角色一致性, style_consistency=风格统一, completeness=字段完整性, technical_params=技术参数合理性',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'optimize_prompt',
      description: '【提示词优化】使用 LLM 自动优化指定节点的提示词。根据美术六维优化法和摄影五段式公式，将粗糙的提示词升级为专业级。支持图片提示词和视频提示词。优化后自动写回节点。优先使用此工具而非 update_node 手动修改 prompt。支持 characterAnchors 参数确保角色外貌一致性。',
      parameters: {
        type: 'object',
        properties: {
          nodeLabel: { type: 'string', description: '要优化的节点标签名（模糊匹配）' },
          nodeId: { type: 'string', description: '要优化的节点精确 ID（优先）' },
          style: { type: 'string', description: '期望的视觉风格（如 "cinematic", "anime", "commercial"），用于指导优化方向' },
          characterAnchors: {
            type: 'array',
            items: { type: 'string' },
            description: '角色锚定描述列表，优化时会确保这些描述被包含在提示词中',
          },
          keepOriginalIntent: { type: 'boolean', description: '是否保留原始提示词的核心意图（默认 true）' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'detect_scenario',
      description: '【场景识别】分析用户描述，识别视频制作场景类型（漫剧/产品广告/探店/教程/短剧/MV），并推荐最佳制作Pipeline和匹配模板。使用时机：收到用户创作需求后第一时间调用，必须在 generate_workflow 之前调用。结果中的 scenario 值直接传给 generate_workflow 的 scenario 参数。',
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: '用户的创作需求描述（如"帮我做一个二次元短剧"、"15秒产品广告"、"探店vlog"等）',
          },
          userImages: {
            type: 'boolean',
            description: '用户是否已上传图片素材（默认 false）',
          },
        },
        required: ['description'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'classify_image',
      description: '【图片智能分类】使用 LLM vision 分析用户上传的图片，自动分类为 product(产品)、character(角色)、scene(场景)、style_ref(风格参考)、logo(Logo)、other(其他)。返回分类结果、描述和建议注入的节点类型。应在用户上传图片后调用，用于决定图片的最佳用途。',
      parameters: {
        type: 'object',
        properties: {
          imageIndex: {
            type: 'number',
            description: '用户本轮上传的图片序号（从 0 开始）',
          },
          imageUrl: {
            type: 'string',
            description: '图片的 URL 或 base64 data URI（如果已知直接 URL 可传入，否则从聊天消息中按 imageIndex 提取）',
          },
        },
        required: [],
      },
    },
  },
  GET_MODEL_PARAMS_TOOL,
  // ── Asset Library Tools ──
  {
    type: 'function' as const,
    function: {
      name: 'list_assets',
      description: '列出素材库中的角色/场景/风格资产。用于在创建节点前查询已有资产，避免重复。支持按 kind 过滤与关键字搜索。',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['character', 'scene', 'style'], description: '过滤类型（可选）' },
          search: { type: 'string', description: '名称/描述/asset_id 关键字搜索（可选）' },
          limit: { type: 'number', description: '最多返回条数，默认 20' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_asset',
      description: '在素材库中创建新的角色/场景/风格资产。成功后返回 asset_id，可用于后续 prompt 中的 @token 引用或 link_asset_to_node。',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['character', 'scene', 'style'], description: '资产类型' },
          name: { type: 'string', description: '资产名称（展示用）' },
          name_en: { type: 'string', description: '英文名（可选，用于稳定 @token）' },
          appearance: { type: 'string', description: 'kind=character 时必填：角色外貌描述' },
          environment: { type: 'string', description: 'kind=scene 时必填：场景环境描述' },
          guide: { type: 'string', description: 'kind=style 时必填：风格指南/关键字' },
          reference_images: { type: 'array', items: { type: 'string' }, description: '参考图 URL 数组（可选）' },
        },
        required: ['kind', 'name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_asset',
      description: '更新素材库中现有资产的字段（名称/描述/参考图）。仅传需要修改的字段。',
      parameters: {
        type: 'object',
        properties: {
          asset_id: { type: 'string', description: '资产 ID，如 char_abc123' },
          name: { type: 'string', description: '新名称（可选）' },
          appearance: { type: 'string', description: '角色外貌（可选）' },
          environment: { type: 'string', description: '场景环境（可选）' },
          guide: { type: 'string', description: '风格指南（可选）' },
          reference_images: { type: 'array', items: { type: 'string' }, description: '完整替换参考图列表（可选）' },
        },
        required: ['asset_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'link_asset_to_node',
      description: '把素材库中的资产链接到画布上的节点（写入 node.data.assetRefs）。之后 resolvePromptRefs 会自动注入其外貌描述与参考图。',
      parameters: {
        type: 'object',
        properties: {
          node_id: { type: 'string', description: '目标节点 ID' },
          asset_id: { type: 'string', description: '要链接的资产 ID' },
        },
        required: ['node_id', 'asset_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'resolve_prompt_refs',
      description: '把含 @token 的 prompt 展开为完整文本，并返回参考图/角色 URL/时间戳。用于调试资产引用或在发给外部模型前预览最终 prompt。',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '原始 prompt 文本（含 @assetId 语法）' },
          extra_refs: { type: 'array', items: { type: 'string' }, description: '额外的 asset_id 列表（可选，来自节点 assetRefs）' },
        },
        required: ['prompt'],
      },
    },
  },
  // ═══════════════════════════════════════════════════════════════════
  // Meta-tool: Progressive disclosure entry point. Always in Tier 1.
  // ═══════════════════════════════════════════════════════════════════
  {
    type: 'function' as const,
    function: {
      name: 'discover_tools',
      description: '【元工具】按需查询当前会话未直接暴露的工具。默认 Agent 看到精简的 Tier 1+2 工具；如需使用记忆/素材库/优化等高级工具，先用此工具检索，再按返回 schema 调用。query 匹配工具 name/description 子串；tier=1/2/3 可整档取回。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '关键词（可选），匹配工具 name 或 description 子串' },
          tier: { type: 'number', enum: [1, 2, 3], description: '（可选）按档位取全档工具' },
        },
        required: [],
      },
    },
  },
]

/** Agent 工作阶段。idle=无 gating（默认），其它阶段叠加白/黑名单。 */
export type AgentPhase = 'idle' | 'planning' | 'designing' | 'building' | 'reviewing' | 'executing'

/** 选项式参数，用于 getAgentTools 支持渐进式披露（progressive disclosure）。 */
export interface GetAgentToolsOptions {
  videoModels?: AiModelResponse[]
  imageModels?: AiModelResponse[]
  audioModels?: AiModelResponse[]
  /** 强制使用的 tier 集合；跳过启发式。 */
  tier?: TierId[]
  /** 返回所有 40+1 个工具，用于旧测试与回退。 */
  includeAll?: boolean
  /** 启发式上下文（用户消息 + 画布状态）。 */
  context?: { userMessage?: string; canvasEmpty?: boolean }
  /** Agent 当前工作阶段；'idle'=no-op；其他阶段会叠加 phase-aware 白/黑名单。 */
  phase?: AgentPhase
}

/**
 * Phase → (allow?, deny?) 表。
 * allow: 强制加入的工具（在 tier 过滤之后补回）
 * deny:  强制剔除的工具（比 allow 优先级低，但会覆盖 tier 的结果）
 */
const PHASE_POLICY: Record<AgentPhase, { allow?: string[]; deny?: string[] }> = {
  idle: {},
  planning: {
    allow: ['plan_task', 'save_memory', 'recall_memory', 'detect_scenario', 'set_phase', 'discover_tools'],
    // 禁止在 planning 阶段创建节点 —— 先说清楚做什么，再动手。
    deny: [
      'create_video_node', 'create_image_node', 'create_audio_node',
      'create_character_grid', 'create_scene_grid', 'create_storyboard_node',
      'create_style_lock_node', 'create_image_edit_node', 'create_video_stitch_node',
      'create_continuity_check_node', 'create_llm_node', 'create_text_node',
      'create_character_extract_node', 'create_character_manager_node',
      'create_from_images', 'generate_workflow',
    ],
  },
  designing: {
    allow: ['create_style_lock_node', 'create_character_grid', 'create_scene_grid', 'create_from_images', 'set_phase'],
    // 禁止真正执行 —— 设计阶段只铺架子，别早于时间消耗 API 配额。
    deny: ['execute_node', 'retry_node', 'batch_execute', 'parallel_execute'],
  },
  building: {
    allow: [], // Tier2 已包含所有 create_*，无需额外 allow
    deny: [],
  },
  reviewing: {
    allow: ['review_generated_image', 'verify_image_semantic', 'verify_task', 'review_content', 'set_phase', 'recall_memory'],
    // 禁止破坏性操作：reviewing 时保持画布可观察。
    deny: [
      'delete_node', 'forget_memory',
      'create_video_node', 'create_image_node', 'create_audio_node',
      'create_character_grid', 'create_scene_grid',
      'create_style_lock_node', 'create_image_edit_node',
      'create_video_stitch_node', 'create_continuity_check_node',
      'create_llm_node', 'create_text_node',
      'create_character_extract_node', 'create_character_manager_node',
      'create_from_images', 'generate_workflow',
    ],
  },
  executing: {
    allow: ['execute_node', 'batch_execute', 'parallel_execute', 'retry_node', 'get_node_output', 'set_phase'],
    deny: [
      'create_video_node', 'create_image_node', 'create_audio_node',
      'create_character_grid', 'create_scene_grid',
      'create_style_lock_node', 'create_image_edit_node',
      'create_video_stitch_node', 'create_continuity_check_node',
      'create_llm_node', 'create_text_node',
      'create_character_extract_node', 'create_character_manager_node',
      'create_from_images',
    ],
  },
}

/**
 * 运行时工具列表构造器。两种调用方式：
 *
 * ```ts
 * // 1) 老风格（向后兼容，位置参数）：返回全部工具，不做 tier 过滤。
 * getAgentTools(videoModels, imageModels, audioModels)
 *
 * // 2) 新选项对象：支持 tier / includeAll / 启发式上下文。
 * getAgentTools({ videoModels, imageModels, audioModels,
 *                 context: { userMessage: '...', canvasEmpty: true } })
 * ```
 *
 * `create_video_node / create_image_node / create_audio_node` 在有对应
 * 后端模型时会被替换为动态 schema。
 *
 * @returns 过滤后的工具数组；始终包含 `discover_tools` 兜底让 LLM 能自己补齐。
 */
export function getAgentTools(
  videoOrOptions: AiModelResponse[] | GetAgentToolsOptions = [],
  imageModels: AiModelResponse[] = [],
  audioModels: AiModelResponse[] = [],
): typeof AGENT_TOOLS {
  // Normalise parameters
  const opts: GetAgentToolsOptions = Array.isArray(videoOrOptions)
    ? { videoModels: videoOrOptions, imageModels, audioModels, includeAll: true }
    : videoOrOptions

  const { videoModels: vm = [], imageModels: im = [], audioModels: am = [], tier, includeAll, context, phase = 'idle' } = opts

  // 1) Dynamic replacements for model-aware tools
  const replacements: Record<string, unknown> = {}
  if (vm.length > 0) replacements.create_video_node = buildCreateVideoNodeTool(vm)
  if (im.length > 0) replacements.create_image_node = buildCreateImageNodeTool(im)
  if (am.length > 0) replacements.create_audio_node = buildCreateAudioNodeTool(am)

  // Apply replacements while preserving AGENT_TOOLS order
  const fullList = AGENT_TOOLS.map(t => {
    const name = t.function?.name
    if (name && replacements[name]) return replacements[name] as typeof t
    return t
  }) as typeof AGENT_TOOLS

  // 2) includeAll / legacy positional path → return everything
  if (includeAll) return fullList.map(t => applyBudgetToSchema(t)) as typeof AGENT_TOOLS

  // 3) Otherwise decide which tools to expose
  let allowedNames: Set<string>
  if (tier && tier.length > 0) {
    // Explicit tier selection
    allowedNames = expandTierSelection({ tiers: tier, addOns: [] })
  } else {
    // Heuristic based on user message and canvas state
    const selection = selectTier(
      context?.userMessage || '',
      { canvasEmpty: context?.canvasEmpty },
    )
    allowedNames = expandTierSelection(selection)
  }

  // Guarantee discover_tools is present so the LLM can always escape the tier
  allowedNames.add('discover_tools')

  // ── Phase-aware gating (Claude Code explicit-state pattern) ──
  // phase='idle' is a no-op for backward compat. Other phases union in
  // any 'allow' tools (so the LLM can still navigate) and remove any
  // 'deny' tools (to prevent the wrong move at the wrong time).
  if (phase !== 'idle') {
    const policy = PHASE_POLICY[phase]
    for (const n of policy.allow || []) allowedNames.add(n)
    for (const n of policy.deny || []) allowedNames.delete(n)
    // set_phase + discover_tools always stay — they're the escape hatches.
    allowedNames.add('set_phase')
    allowedNames.add('discover_tools')
  }

  const filtered = fullList.filter(t => {
    const name = t.function?.name
    return !!name && allowedNames.has(name)
  }) as typeof AGENT_TOOLS

  // 4) Decorate schemas of budgeted tools with `response_format` param.
  //    Uniform injection keeps each schema literal clean and the registry
  //    (src/providers/toolBudget.ts) as the single source of truth.
  const decorated = filtered.map(t => applyBudgetToSchema(t)) as typeof AGENT_TOOLS

  // 5) Dev-only telemetry: log rough schema size
  if (typeof import.meta !== 'undefined' && (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
    const tokens = Math.round(JSON.stringify(decorated).length / 4)
    const tierLabel = tier ? tier.join('+') : 'auto'
    // eslint-disable-next-line no-console
    console.info(`[agent-tools] tier=${tierLabel} tools=${decorated.length} ~${tokens}tok`)
  }

  return decorated
}

/** Expose tier metadata for tests / UI. */
export const ALL_TIER_TOOL_NAMES = allTierToolNames()
export type { TierId, SelectTierContext } from './toolTiers'
