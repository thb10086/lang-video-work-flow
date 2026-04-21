---
name: 前期制作技能
description: 角色设计 / 场景设计 / 风格锁定 / 分镜脚本 — 创作前期阶段的全部能力
---

# 前期制作技能 (Pre-Production)

## 覆盖的 SKILLS 模块

| 模块 ID | 名称 | 节点类型 | 核心工具 |
|---------|------|---------|---------|
| character_design | 角色设计 | characterGrid | `create_character_grid` |
| scene_design | 场景设计 | sceneGrid | `create_scene_grid` |
| style_lock | 风格锁定 | styleLock | `create_style_lock_node` |
| storyboard | 分镜脚本 | storyboard | `create_storyboard_node` |

## 角色设计

**核心能力**: 生成角色九宫图参考设定，注册外貌到全局一致性系统。

**工具链**: `create_character_grid` → `execute_node` → 自动注册 `characterAppearances`

**外貌一致性链路**:
characterGrid 生成 → `setCharacterAppearance()` 注册 → `buildCharacterAnchorPrefix()` 自动 prepend → 所有 imageGen/videoGen 节点继承

**最佳实践**:
- 描述必须包含外貌关键词 (发色/服装/体型)，供下游锚定
- 生成后检查九宫图一致性，不满意则 `update_node` 调整描述后重新执行

## 场景设计

**核心能力**: 生成场景九宫图参考设定，建立视觉环境基调。

**工具链**: `create_scene_grid` → `execute_node` → 连接到 imageGen 的 `ref-in`

**最佳实践**:
- 描述包含环境五要素: 时间/地点/光线/天气/氛围
- 场景图连接到所有相关关键帧的 `ref-in` 端口

## 风格锁定

**核心能力**: 从参考图或文字描述提取风格特征，注入所有下游节点。

**工具链**: `create_style_lock_node` → `execute_node` → `style-out` 连接到 imageGen/videoGen 的 `style-in`

**最佳实践**:
- 一个工作流通常只需 1 个 styleLock 节点
- styleLock 的输出连接到所有 imageGen 和 videoGen 节点

## 分镜脚本

**核心能力**: AI 生成带 12 字段的专业分镜 (含 imagePrompt/videoPrompt/dialogue/角色标签)。

**工具链**: `create_storyboard_node` → `execute_node` → 展开为 imageGen + videoGen 节点

**输出字段**: shotNumber / description / imagePrompt / videoPrompt / dialogue / dialogueEN / audioHint / camera / duration / charactersPresent / emotionIntensity / transition

**最佳实践**:
- 脚本输入要具体 (场景/角色/情绪)，避免模糊指令
- 分镜生成后用 `get_node_output` 检查内容质量
- 展开节点时优先使用 imagePrompt/videoPrompt (含角色锚定)

## 阶段映射

本技能组对应 `PHASE_SKILL_MAP.pre_production`，当画布为空或仅有文本节点时自动加载到 Agent System Prompt。
