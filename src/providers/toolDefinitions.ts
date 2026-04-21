/**
 * Agent Tool Definitions (OpenAI Function Calling Schema)
 *
 * 定义 LLM 可调用的工具函数 schema，不包含执行逻辑。
 * 执行逻辑见 agentTools.ts → toolHandlers.ts
 */

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
      description: '在画布上创建视频生成节点。推荐模型：doubao-seedance-2-0（默认，功能最全：有声视频/参考视频/首尾帧/4-15s）/doubao-seedance-2-0-fast（快速版）/veo3.1-fast/veo3.1/sora-2-vip/kling-v3。同一模型可能有多个渠道供应商，系统自动按优先级选择并降级容错。前置条件：prompt 必须英文且包含 [Camera]/[Subject]/[Negative] 段。创建后必须用 connect_nodes 连接首帧图片，再 execute_node 执行。多个视频节点请用 parallel_execute 并行执行。',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '视频描述提示词' },
          model: {
            type: 'string',
            enum: ['doubao-seedance-2-0', 'doubao-seedance-2-0-fast', 'veo3.1-fast', 'veo3.1', 'sora-2-vip', 'kling-v3'],
            description: '视频模型（默认 doubao-seedance-2-0）',
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
      description: '在画布上创建音频/配音节点（支持ElevenLabs/FishSpeech/CosyVoice）',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要转为语音的文本内容' },
          model: { type: 'string', enum: ['elevenlabs', 'fish-speech', 'cosyvoice'], description: '音频模型' },
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
            description: '每个镜头的视频提示词（英文，与 shotCount 对应）。格式：[Camera]: 运镜. [Subject]: 角色外貌+动作（必须包含发色/服装等外貌词）. [Atmosphere]: 氛围. [Quality]: Cinematic 4K, 24fps film grain. [Negative]: No morphing, no identity drift.',
          },
          styleDescription: { type: 'string', description: '整体视觉风格描述，如"赛博朋克、冷色调、霓虹灯光、电影质感"' },
          narrationText: { type: 'string', description: '旁白/配音文本内容' },
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
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'save_memory',
      description: '保存重要信息到长期记忆（跨会话持久化）。适用于：用户偏好、角色设定、项目风格、工作流模式。相同 type+title 的记忆会自动更新而非重复创建。注意：记忆可能过期，recall_memory 返回的信息应与当前画布状态对照验证后再使用。',
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
            description: '标签，用于后续检索',
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
      name: 'update_node',
      description: '更新画布上已有节点的数据字段。通过 nodeLabel（模糊匹配）或 nodeId（精确匹配）定位节点。若同名节点有多个，先用 get_canvas_state 获取节点 ID，再用 nodeId 精确定位。可修改字段：prompt、description、content、name、style、model、aspect_ratio、duration 等。提示：如果目的是优化提示词质量，优先使用 optimize_prompt 工具（自动 LLM 优化并写回）。',
      parameters: {
        type: 'object',
        properties: {
          nodeLabel: { type: 'string', description: '目标节点的标签名（模糊匹配）' },
          nodeId: { type: 'string', description: '目标节点的精确 ID（优先于 nodeLabel，用于消除同名歧义）' },
          updates: {
            type: 'object',
            description: '要更新的字段键值对。示例：{"model": "veo3.1-fast", "prompt": "新提示词"}',
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
]
