/**
 * SKILL module — Video Workflow Recipe
 *
 * Extracted from the monolithic system-prompt block so it can be
 * loaded only when the agent is in a workflow-building phase
 * (planning / building / executing / pre_production / production).
 * This saves ~1500 tokens when the agent is idle or in a reviewing phase.
 *
 * Covers:
 *   - Path A (generate_workflow fast mode) + Path B (plan.update_step)
 *   - Stage-by-stage execution order with exact node labels
 *   - Dependency chain constraints (characterGrid → imageGen → videoGen)
 *   - Parallel/batch execution guidance
 */

import type { SkillDefinition } from './types'

export const videoWorkflowRecipe: SkillDefinition = {
  id: 'video_workflow_recipe',
  name: '视频制片 Pipeline',
  summary: '两种路径（快速一键 / 逐步精控）+ 四阶段执行序列 + 依赖链约束。',
  details: `### 视频制片 Pipeline

#### 路径选择

| 用户意图 | 选择 |
|---------|------|
| 完整视频项目（有故事/角色/多镜头） | **路径A：generate_workflow 快速模式**（推荐） |
| 单独添加/修改某个节点 | **路径B：逐步模式**，按节点类型用对应 create_xxx 工具 |
| 工作流已存在，只需执行 | 直接跳至执行序列，按依赖链顺序 batch/parallel_execute |

---

#### 路径A：快速模式

##### Step 1 — generate_workflow（一次性传入所有内容，参数越完整画面越好）

\`\`\`
generate_workflow({
  title:                "项目名",                          // 必填
  description:          "完整故事梗概，3-5句",              // 必填
  characterNames:       ["角色A", "角色B"],                // 强烈建议
  characterDescriptions:["英文外貌描述A", "英文外貌描述B"], // 与 names 一一对应
  sceneNames:           ["场景名1", "场景名2"],
  sceneDescriptions:    ["英文环境描述1", "英文环境描述2"],
  shotCount:            4,                                 // 3-8个镜头
  shotPrompts:          [                                  // 每个关键帧图片提示词（英文）
    "镜头1: [角色外貌+动作] + [环境] + [光影] + [风格质量]",
    "镜头2: ..."
  ],
  videoPrompts:         [                                  // 每个视频提示词（英文，i2v 友好格式）
    // 格式: Camera: <小幅运镜>. Action: <主体动作 + 次级运动>. Keep <锚定项> consistent. Avoid: <具体名词>.
    // 不要再用 [Camera]/[Subject]/[Quality] 这种方括号标签 —— Sora/VEO/Seedance 实测对自然语言更敏感。
    "镜头1: Camera: subtle push-in with gentle focus pull. Action: <主体动作 + 次级运动如 hair sway / steam drift>. Keep characters consistent. Avoid: warped fingers, face distortion, frame stutter.",
    "镜头2: ..."
  ],
  styleDescription:     "整体视觉风格，如：赛博朋克、冷色调、霓虹、电影质感",
  narrationText:        "旁白配音文本"
})
\`\`\`

**自动创建的节点及其标签**（batch_execute / parallel_execute 必须使用这些精确标签）：

| 节点类型 | 标签格式 | 示例 |
|--------|---------|------|
| textNode | \`{title} - 剧本\` | 追风 - 剧本 |
| storyboard | \`分镜脚本\` | 分镜脚本 |
| characterGrid | \`角色: {charName}\` | 角色: 林夏 |
| sceneGrid | \`场景: {sceneName}\` | 场景: 天台 |
| styleLock | \`风格锁定\` | 风格锁定 |
| imageGen | \`镜头{N} 关键帧\` | 镜头1 关键帧 |
| videoGen | \`镜头{N} 视频\` | 镜头1 视频 |
| videoStitch | \`最终合成\` | 最终合成 |

##### Step 2 — 执行序列（严格按顺序，禁止跳跃）

**阶段一：风格锁定 + 角色/场景准备（串行，有依赖）**
\`\`\`
batch_execute(nodeLabels: ["风格锁定", "角色: A", "角色: B", "分镜脚本"])
\`\`\`
验证：\`get_node_output\` 确认 styleLock.extractedStyle / characterGrid.outputImage / storyboard.shots 均存在

**阶段二：关键帧生成（并行，无依赖）**
\`\`\`
parallel_execute(nodeLabels: ["镜头1 关键帧", "镜头2 关键帧", ...], concurrency: 4)
\`\`\`
验证：\`get_node_output\` 抽查 1-2 个节点确认 outputImage 存在 → 告知用户关键帧就绪，询问是否提交视频

**阶段三：视频提交（并行，异步）**
\`\`\`
parallel_execute(nodeLabels: ["镜头1 视频", "镜头2 视频", ...], concurrency: 4)
\`\`\`
立即返回（任务异步执行 60-300 秒）→ 告知用户等待，视频完成后再告诉你

**阶段四：后期合成（视频完成后，用户确认）**
\`\`\`
batch_execute(nodeLabels: ["最终合成"])
\`\`\`
验证：\`get_node_output\` 确认 videoStitch.clips 列表非空 → \`verify_task\` 自检

**性能参考**：8个关键帧串行≈4分钟 → parallel_execute≈30秒（8x）；8个视频并行提交≈5分钟（vs 串行40分钟）

---

#### 路径B：逐步模式

**Phase 1 — Pre-Production（前期筹备）**
1. \`plan.create\` 制定分步计划
2. \`create_text_node\` 撰写剧本（content 填入完整剧本文本）
3. \`create_style_lock_node\`（styleDescription）→ \`execute_node\` → 确认 extractedStyle（风格锁定先于角色/场景，确保风格一致）
4. 每个角色：\`character.create_grid\`（name + description 英文外貌词）→ \`execute_node\` → \`get_node_output\` 确认 outputImage
5. 每个场景：\`create_scene_grid\`（name + description + style + mood）→ \`execute_node\` → \`get_node_output\` 确认 outputImage

**Phase 2 — Design（设计定稿）**
6. \`create_storyboard_node\`（script）→ \`execute_node\` → \`get_node_output\` 获取 shots[] 列表

**Phase 3 — Production（生产制作）**

依赖链不可违反，见下方「依赖链约束」

7. 每个镜头：\`create_image_node\`（label="镜头N 关键帧", prompt=英文图片提示词, aspectRatio）→ \`canvas.connect\`（各 characterGrid→imageGen, ref-in）→ \`canvas.connect\`（styleLock→imageGen, style-in）
8. \`parallel_execute\`（所有 imageGen, concurrency=4）→ 抽查确认 outputImage
9. 每个镜头：\`create_video_node\`（label="镜头N 视频", prompt=英文视频提示词, model 默认即可；如需非默认模型可先 \`model.get_params\` 获取参数范围）→ \`canvas.connect\`（imageGen→videoGen, first-frame）
10. \`parallel_execute\`（所有 videoGen, concurrency=4）→ 异步任务，立即返回

**Phase 4 — Post-Production（后期合成）**
11. \`create_video_stitch_node\` → \`canvas.connect\`（各 videoGen→stitch）→ 用户确认视频完成后 \`execute_node\`
12. 可选：\`create_continuity_check_node\` → \`canvas.connect\`（相邻 imageGen 输出）→ \`execute_node\`
13. \`verify_task\` 自检完成状态

---

#### 依赖链约束（不可违反）

\`\`\`
characterGrid → imageGen → videoGen
\`\`\`

- 未执行 characterGrid 直接执行 imageGen = 零角色参考（每帧人物外貌不一致）
- 未执行 imageGen 直接提交 videoGen = 无首帧引导（视频内容不可控）
- 系统有 autoExecutePrerequisites 机制，但仍需主动按序执行

**数据流**（执行后自动传播，无需手动复制）：
characterGrid.outputImage → imageGen.referenceImages[] → imageGen.outputImage → videoGen.firstFrameImage

**所有节点类型均支持 execute_node**：characterGrid / sceneGrid / keyframeGrid / imageGen / videoGen / storyboard / styleLock / llmChat / imageEdit / continuityCheck / videoStitch / audioNode（textNode 无需执行）

---

#### 关键帧策略（PoC v0.1 — keyframeGrid 分镜拼贴图）

每个 storyboard shot 二选一：
- **默认 → \`create_image_node\` 单帧**（短/简单镜头，成本最低）
- **复杂 → \`create_keyframe_grid\`**（一次出 **一张** 含 4/6/9 帧的拼贴大图，成本 ≈ 1 张高清单图，灵感：LibTV 剧情推演 / Higgsfield Shots）

**触发 \`create_keyframe_grid\` 的信号**（命中任一即可）：

| 信号 | 触发词（含中英）| 推荐 subType |
|------|----------------|-------------|
| 运镜 | pan / zoom / dolly / orbit / handheld / 推拉 / 摇 / 跟 | \`multi-camera\` |
| 时间序列 | 然后 / 接着 / 最终 / 前一刻 / 后一刻 / before-after / progressively | \`time-progression\` |
| 复杂动作 | 战斗 / 舞蹈 / 转身 / 跳跃 / 连续 / fight / dance / transformation / motion | \`action-breakdown\` |
| 状态演进 | 从X到Y / 逐渐 / from … to / gradually / 天气变 | \`scene-evolution\` |
| 显式声明 | 九宫图 / 分镜推演 / 过程图 / 动作分解 | 按上下文选 |

**布局选择**：
- \`2x2\` 四宫格 — 简单 2-4 个关键节点（默认轻量）
- \`2x3\` 六宫格 — 标准复杂度（默认平衡）
- \`3x3\` 九宫格 — 多步骤 / 高细节 / 真正"九宫"叙事

**预算守门**：单个项目超过 4 个 keyframeGrid 节点时，先告知用户成本影响并请求确认。简单短剧不要滥用。

**下游接力**（PoC 阶段）：
- keyframeGrid.outputImage 可作为 imageGen.referenceImage 的 style anchor
- 用户在拼贴图上挑帧后手动接 videoGen（v2 会做自动切分挑帧）`,
  tools: [
    'generate_workflow',
    'create_text_node',
    'create_style_lock_node',
    'character.create_grid',
    'create_scene_grid',
    'create_keyframe_grid',
    'create_storyboard_node',
    'create_image_node',
    'create_video_node',
    'create_video_stitch_node',
    'create_continuity_check_node',
    'canvas.connect',
    'batch_execute',
    'parallel_execute',
    'execute_node',
    'get_node_output',
    'verify_task',
    'plan.create',
  ],
  nodeTypes: [
    'textNode',
    'storyboard',
    'characterGrid',
    'sceneGrid',
    'keyframeGrid',
    'styleLock',
    'imageGen',
    'videoGen',
    'videoStitch',
    'continuityCheck',
  ],
}
