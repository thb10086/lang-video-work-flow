---
name: 生产技能
description: 图片生成 / 图片编辑 / 图片裁切 / 视频生成 / COS 上传 — 核心生产阶段能力
---

# 生产技能 (Production)

## 覆盖的 SKILLS 模块

| 模块 ID | 名称 | 节点类型 | 核心工具 |
|---------|------|---------|---------|
| image_generation | 图片生成 | imageGen | `create_image_node` |
| image_edit | 图片编辑 | imageEdit | `create_image_edit_node` |
| image_crop | 图片裁切 | imageCrop | (由 characterGrid 下游自动创建) |
| video_generation | 视频生成 | videoGen | `create_video_node` |
| cos_upload | COS 上传 | — | 自动触发，无需手动工具 |

## 图片生成

**核心能力**: 调用 Gemini API 生成关键帧图片，支持参考图和风格注入。

**工具链**: `create_image_node` → 填写 prompt → `execute_node` → `get_node_output` 验证

**Smart Handle 连接**:
- 输入: `ref-in` (来自 characterGrid/sceneGrid), `style-in` (来自 styleLock), `script-in` (来自 storyboard)
- 输出: `image-out` → videoGen 的 `first-frame`

**提示词六维优化法** (用于 `optimize_prompt`):
1. 主体精确 — 具体描述角色/物体
2. 光影具体 — 明确光源方向和类型
3. 构图明确 — 景别 + 视角
4. 风格锁定 — 引用 styleLock 特征词
5. 负面屏蔽 — negative prompt 排除不需要的元素
6. 一致性锚 — 角色外貌关键词自动 prepend

## 图片编辑

**核心能力**: 通过 Gemini 对已有图片进行编辑 (修改局部/风格化/添加元素)。

**工具链**: `create_image_edit_node` → 连接源图到 `image-in` → 填写编辑指令 → `execute_node`

## 视频生成

**核心能力**: 调用后端统一路由的多模型视频 API 生成视频片段，支持首帧约束。

**工具链**: `create_video_node` → 连接关键帧到 `first-frame` → 填写 prompt + model → `execute_node`

**可用模型** (由后端 `ai_models` 表管理): doubao-seedance-2-0 (推荐) / doubao-seedance-2-0-fast / veo3.1-fast / veo3.1 / sora-2-vip / kling-v3

**参数面板**: 由后端 `param_schema` 动态驱动，前端零静态回退。前端通过 `useBackendModels('video')` 获取模型列表和参数定义。

**视频提示词五段式公式** (用于 `optimize_prompt`):
1. 主体动作 — 谁在做什么
2. 运镜 — 镜头如何移动 (pan/dolly/crane 等)
3. 环境变化 — 光线/天气/背景动态
4. 节奏 — 慢动作/正常/快动作
5. 情绪氛围 — 整体基调

**渠道路由**: 后端负责渠道选择与降级容错，前端仅需提交 model_id。

## COS 上传

**核心能力**: 生成的图片自动从 base64 上传到腾讯云 COS，获取公网 URL。

**触发方式**: 全自动 — nodeExecutor 在图片生成成功后自动调用 `cosUploader.ensureUrl()`
- 缓存机制: 相同 base64 hash 不重复上传
- 节点数据同时保存 `outputImage` (base64) 和 `outputImageUrl` (公网 URL)

## 阶段映射

本技能组对应 `PHASE_SKILL_MAP.production`，当画布含 imageGen/videoGen 节点时自动加载。
