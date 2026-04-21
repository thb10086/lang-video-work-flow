---
description: 视频模型管理架构 — 后端 DB 统一管理 + Redis 缓存
---

# 视频模型管理架构

## 核心概念

模型定义（含 param_schema）统一存储在后端 `ai_models` 数据库表中。
前端通过 `useBackendModels` hook 获取模型列表，参数面板由 `param_schema` 动态驱动。
前端不再维护任何静态模型列表或 paramSchema 回退。

```
前端 UI 组件
     ↓  useBackendModels(capability)
后端 GET /api/models?capability=video
     ↓  Redis 缓存 (TTL 1h, key: prism:models:{capability})
后端 ModelService → ai_models 表 (MySQL)
     ↓  返回 model_id + name + param_schema
前端动态渲染参数面板 (下拉/滑块/开关)
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `server/app/routers/models.py` | /api/models CRUD 端点 |
| `server/app/services/model_service.py` | 模型服务（CRUD + Redis 缓存） |
| `src/hooks/useBackendModels.ts` | 前端模型列表 Hook（内存缓存 + error 状态） |
| `src/providers/modelDefaults.ts` | 全局默认模型名常量 |
| `src/providers/types.ts` | ParamField 接口定义 |

## 可用模型（后端 DB 管理）

| 统一模型名 (model_id) | 提供方 | capability | 特色 |
|----------------------|--------|-----------|------|
| `doubao-seedance-2-0` ★默认 | 字节跳动 | video | 有声视频/首尾帧/7种比例/4-15s |
| `doubao-seedance-2-0-fast` | 字节跳动 | video | 同上，生成更快 |
| `veo3.1-fast` | Google | video | 高画质 |
| `veo3.1` | Google | video | 最高画质 |
| `sora-2-vip` | OpenAI | video | Character 复用 |
| `kling-v3` | 快手 | video | 首尾帧+负面提示 |

## 新增模型步骤

1. 在后端 `ai_models` 表插入记录（含 `param_schema` JSON 数组 + `capability`）
2. 在 `src/providers/toolDefinitions.ts` 的 `create_video_node.model.enum` 加入新模型名
3. Redis 缓存自动失效（CRUD 操作触发 `invalidate_model_cache`）
4. 前端自动生效，无需重新部署

## Redis 缓存策略

- **Key 格式**: `prism:models:{capability}` (如 `prism:models:video`)
- **TTL**: 1 小时
- **失效时机**: 模型 CRUD 操作时自动清除所有 `prism:models:*` 缓存
- **序列化**: JSON

## 注意事项

- 前端 `useBackendModels` 有内存缓存，页面刷新后重新请求
- 后端不可用时前端返回空列表 + error 状态，UI 需处理空模型场景
- param_schema 格式为 `ParamField[]`，每个字段包含 key/label/type/options/default
