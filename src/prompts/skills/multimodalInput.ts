/**
 * SKILL module — Multimodal Input Protocol
 *
 * Extracted from the monolithic system prompt so the multi-step image-routing
 * protocol is only loaded when the current user message actually carries
 * images. This saves ~450 tokens on text-only turns (which is the common case).
 */

import type { SkillDefinition } from './types'

export const multimodalInput: SkillDefinition = {
  id: 'multimodal_input',
  name: '多模态输入处理',
  summary: '用户上传图片时的分类 → 路由 → 注入流程（单图/多图/混合图）。',
  details: `### 多模态输入处理

当用户消息包含图片时（你会在 content 中看到 image_url 内容），按以下流程处理：

#### 单图流程
1. 调用 \`classify_image\`(imageIndex=0) 自动分类图片类型
2. 根据分类结果 + 用户文字描述，确定图片用途
3. 使用 \`inject_user_images\` 注入到对应节点

#### 多图流程（≥2 张）
1. 对每张图片调用 \`classify_image\`(imageIndex=0,1,2...)
2. 按分类结果分组，一次性路由：

| 分类 | 注入目标 | 字段 |
|------|----------|------|
| product | imageGen | referenceImages |
| character | characterGrid | inputImage |
| scene | sceneGrid | inputImage |
| style_ref | styleLock | referenceImage |
| logo | imageGen(Logo节点) | referenceImages |

3. 使用 \`inject_user_images\` 批量注入（一次调用，多个 targets）

#### 路由规则
- 产品图/角色参考 → imageGen 的 \`referenceImages\`（作为参考图指导生成）
- 风格参考 → styleLock 的 \`referenceImage\`
- 需要编辑的图片 → imageEdit 的 \`inputImage\`
- 视频首帧 → videoGen 的 \`firstFrameImage\`

#### 典型场景
- 用户上传产品图 → \`classify_image\` → \`detect_scenario\`(product_ad) → \`generate_workflow\`(scenario=product_ad) → \`inject_user_images\` 注入
- 用户上传角色照片 → \`classify_image\` → 注入 characterGrid → 保持角色一致性
- 用户上传多张混合图 → 逐张 \`classify_image\` → 按类型分组注入不同节点`,
  tools: ['classify_image', 'inject_user_images', 'create_from_images', 'detect_scenario'],
  nodeTypes: ['characterGrid', 'sceneGrid', 'styleLock', 'imageGen', 'imageEdit'],
}
