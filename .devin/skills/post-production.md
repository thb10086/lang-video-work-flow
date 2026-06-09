---
name: 后期制作技能
description: 音频配音 / 连续性检查 / 视频拼接 — 后期合成阶段能力
---

# 后期制作技能 (Post-Production)

## 覆盖的 SKILLS 模块

| 模块 ID | 名称 | 节点类型 | 核心工具 |
|---------|------|---------|---------|
| audio_generation | 音频配音 | audioNode | `create_audio_node` |
| continuity_check | 连续性检查 | continuityCheck | `create_continuity_check_node` |
| video_stitch | 视频拼接 | videoStitch | `create_video_stitch_node` |

## 音频配音

**核心能力**: TTS 语音合成，为视频片段生成配音。

**工具链**: `create_audio_node` → 填写文本 + 选择语音 → `execute_node`

**当前状态**: TTS adapter 尚未实现 (placeholder)，节点 UI 已就绪。

**连接方式**: `audio-out` → videoStitch 的 `audio-in`

## 连续性检查

**核心能力**: 将多张关键帧图片发送给 LLM Vision，分析镜头间的视觉连续性。

**工具链**: `create_continuity_check_node` → 连接多个 imageGen 到 `image-a/image-b` → `execute_node`

**输出**: 一致性评分 + 不一致项目列表 + 优化建议

**最佳实践**:
- 在所有关键帧生成完毕后执行
- 重点关注角色外貌、光照方向、色调一致性

## 视频拼接

**核心能力**: 收集上游所有 videoGen 节点的视频 URL，组合为完整视频片段列表。

**工具链**: `create_video_stitch_node` → 连接多个 videoGen 到 `video-in` → `execute_node`

**连接方式**:
- 输入: `video-in` (来自多个 videoGen), `audio-in` (来自 audioNode)
- 输出: clips 数组 (有序视频片段)

**最佳实践**:
- 确保所有上游 videoGen 已成功执行
- 视频片段按 storyboard 分镜顺序排列

## 阶段映射

本技能组对应 `PHASE_SKILL_MAP.post_production`，当画布含已生成视频输出时自动加载。
