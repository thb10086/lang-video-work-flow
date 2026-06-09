/**
 * SKILL module — Vision Verify
 *
 * Explains the three verification tools the Agent has at its disposal and
 * when to use each. Without this guidance the Agent tends to default to the
 * cheapest `verify_task` heuristic even when a visual mismatch needs the
 * real Vision model, or — worse — calls the expensive `verify_image_semantic`
 * on every frame instead of sampling.
 *
 * Loaded only in `reviewing` and `post_production` phases (QC time) — so
 * the block never pollutes the build-heavy planning turns.
 */

import type { SkillDefinition } from './types'

export const visionVerify: SkillDefinition = {
  id: 'vision_verify',
  name: '视觉质量校验',
  summary: '三档校验工具的选择：启发式 verify_task → 真 Vision verify_image_semantic → 画布级 review_generated_image。',
  details: `### 视觉质量校验

三个校验工具，按"成本从低到高"排列——**先用便宜的定位问题，再用贵的深挖**：

| 工具 | 成本 | 何时使用 |
|-----|------|---------|
| \`verify_task\` | 免费 | 交付前的整体体检；画布结构/提示词语言/字段完整性等 6 维启发式打分 |
| \`verify_image_semantic\` | **调用 Vision 模型，有 token 成本** | 定点排查单张图：prompt 说了但画面缺失的主体/风格/角色识别 |
| \`review_generated_image\` | 免费 | 画布级启发式质量门控：节点状态、宽高比、输出存在等元数据检查 |

#### 决策路径

1. **交付前**：先跑 \`verify_task()\`，拿到 6 维评分。
2. **分数 < 80** 且怀疑是视觉问题（非结构问题）：
   - 抽样 1-2 个关键帧调 \`verify_image_semantic({ nodeId, expectedSubjects })\`。
   - 根据返回的 \`missingElements\` 决定是 \`retry_node\`（随机性导致）还是 \`canvas.update_node\`（prompt 不到位）。
3. **大批量高置信度校验**：直接 \`verify_task({ useVisionVerify: true })\` —
   对所有 \`imageGen\` 的 outputImage 并行调 Vision 模型，平均分计入第 4 维。
   失败时自动 fallback 到启发式 + 附 \`[vision fallback]\` 标记。

#### recommendation 语义

Vision 返回的 \`recommendation\` 决定后续动作：

- \`accept\`：画面达标（matchScore ≥ threshold），继续下一步。
- \`retry\`：方向正确但细节缺失（threshold-20 ≤ matchScore < threshold），
  调 \`retry_node\` 重新生成——**不要改 prompt**。
- \`edit_prompt\`：方向错误（matchScore < threshold-20），先 \`canvas.update_node\`
  把缺失的 \`missingElements\` 补进 prompt，然后 \`retry_node\`。

#### 成本注意

- \`verify_image_semantic\` **每次调用都打 Vision 模型**（≈1000 tokens/次）。
  对 8 个镜头全量调用就是 8k tokens。**除非排查问题，否则用 \`verify_task\` 的
  启发式打分即可**。
- \`useVisionVerify: true\` 下 \`verify_task\` 会对每个 \`imageGen\` 的
  outputImage 并行调 Vision 模型——同样的成本，但只调用一次工具。

#### 典型剧本

- 关键帧批量就绪 → \`verify_task({ checkConnections: true })\` → 79 分，有孤立节点 → 修连线 → 重验 → 86 分 → 通过。
- 关键帧看着不对 → \`verify_image_semantic({ nodeId: 'img_shot3', expectedSubjects: ['林夏', '霓虹街道', '雨夜'] })\` → matchScore=48, missingElements=['霓虹', '雨夜'] → \`canvas.update_node\` 增强 prompt → \`retry_node\`。
- 最终交付前 → \`verify_task({ useVisionVerify: true, verbose: true })\` → 每个镜头逐一比对 → 若某张拖分会在 verbose issues 里明确指出。`,
  tools: ['verify_task', 'verify_image_semantic', 'review_generated_image'],
  nodeTypes: ['imageGen', 'videoGen', 'imageEdit'],
}
