---
description: 新增 AI 模型 — 后端 DB 插入 + 前端 toolDefinitions 更新
---

# 新增 AI 模型

模型定义统一由后端 `ai_models` 数据库表管理。前端不再需要编写 Adapter 或注册到 registry。

## 步骤

1. 在后端 `ai_models` 表插入记录

```sql
INSERT INTO ai_models (model_id, name, provider, capability, description, param_schema, is_active)
VALUES (
  'new-model-id',
  'New Model Name',
  'ProviderName',
  'video',  -- video / image / text / audio
  '模型描述',
  '[{"key":"duration","label":"时长","type":"slider","min":4,"max":15,"default":5,"step":1}]',
  1
);
```

`param_schema` 是 `ParamField[]` JSON 数组，每个字段支持:
- `key`: 参数键名
- `label`: UI 显示名
- `type`: `select` / `slider` / `switch`
- `options`: select 类型的选项数组 `[{value, label}]`
- `min/max/step`: slider 类型的范围
- `default`: 默认值

2. 更新 Agent 工具 schema

编辑 `src/providers/toolDefinitions.ts` 中相关工具的 `enum` 列表（如 `create_video_node` 的 `model` 参数）。

3. 更新默认值（如适用）

编辑 `src/providers/modelDefaults.ts` 更新默认模型常量。

4. 验证

```bash
# 后端 — Redis 缓存自动失效
# 前端 — 刷新页面即可看到新模型

npx vitest run       # 前端测试
npx tsc --noEmit     # TS 编译检查
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `server/app/services/model_service.py` | 模型 CRUD + Redis 缓存 |
| `server/app/routers/models.py` | /api/models REST 端点 |
| `src/hooks/useBackendModels.ts` | 前端模型列表 Hook |
| `src/providers/toolDefinitions.ts` | Agent 工具 schema (model enum) |
| `src/providers/modelDefaults.ts` | 全局默认模型名常量 |
