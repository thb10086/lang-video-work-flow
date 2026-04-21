---
description: 详细编码规范 — TypeScript/Python/SQL/性能/测试/Git/DB 设计（按需加载）
---

# 编码规范详细参考

> 精简版见 `rules/project-rules.md` "编码约束 10 条"。本文件为完整参考，按需加载。

## TypeScript

```typescript
// 类型定义在顶部，使用 interface
interface VideoConfig {
  model: string
  duration: number
  aspectRatio: string
}

// 函数参数解构 + 返回类型
function createVideoNode({ model, duration }: VideoConfig): string { /* ... */ }
```

- 文件名: `camelCase.ts` (工具类) / `PascalCase.tsx` (组件)
- 变量/函数: `camelCase` | 常量: `UPPER_SNAKE_CASE` | 类型: `PascalCase`
- 导入顺序: React → 第三方 → `@/` 内部 (store→providers→components→types→lib) → 相对路径
- 禁止: `any` / 魔术数字 / 嵌套 >3 层 / 单文件 >500 行

## Python

```python
# Pydantic BaseModel 定义数据结构，函数必须有类型注解
async def create_workflow(request: CreateWorkflowRequest) -> WorkflowResponse: ...
```

- 文件名: `snake_case.py` | 变量/函数: `snake_case` | 类: `PascalCase`
- 禁止: 裸 except / print 调试 / 全局可变状态
- 使用 logging 模块 + async/await 处理 IO

## SQL

- 表名: `snake_case` 复数 | 字段名: `snake_case` | 索引名: `idx_{table}_{column}`
- 主键: `BIGINT AUTO_INCREMENT` | 时间: `DATETIME(3)` + 默认 `CURRENT_TIMESTAMP(3)`
- 软删除: `deleted_at DATETIME(3) NULL` | 所有表必须有 `created_at` + `updated_at`
- ENUM 用 `VARCHAR(32)` + 应用层校验 | JSON 字段仅存 schema-less 数据

## 性能

### 前端

- Zustand selector 粒度尽量细，避免整 store re-render
- 图片 base64 仅预览，持久化必须上传 COS
- 输入框 onChange 用 300ms debounce
- 非首屏组件用 `React.lazy` + `Suspense`

### 后端

- 连接池: SQLAlchemy pool_size=10, max_overflow=20 | aioredis pool_size=20
- 超时: LLM 60s / 图片 120s / 视频 600s
- 并发: 视频生成最大并发 3 (Redis 信号量)
- 缓存: 模板列表 TTL 1h / 用户偏好 TTL 24h

### 数据库

- WHERE/JOIN/ORDER BY 字段必须有索引
- 大数据集 cursor-based 分页 | 小数据集 offset 分页
- 写操作涉及多表时必须用事务

## 测试

- 每个新增工具必须有对应单元测试
- 节点执行器修改必须跑 `vitest run` 全量测试
- API 适配器用 mock 测试，不依赖外部服务
- E2E 测试 (后续): Playwright 覆盖核心流程

## Git

```
<type>(<scope>): <subject>
type: feat | fix | refactor | style | docs | test | chore
scope: agent | ui | prompt | tools | db | api | template
subject: 中文简述，不超过 50 字
```

分支: `main` ← `develop` ← `feature/xxx` / `fix/xxx`

## 环境变量

- 前端: `VITE_` 前缀，统一通过 `src/lib/env.ts` (`ENV.*`) 访问
- 后端: `.env` + `pydantic-settings` 加载
- 敏感信息绝不提交 Git | `.env.example` 维护占位符

## 设计模式速查

| 模式 | 使用场景 | 实例 |
|------|---------|------|
| 策略 | 场景→Pipeline | `generate_workflow` |
| 注册表 | 节点/端口 | `portRegistry.ts` |
| 单例 | COS 上传 | `cosUploader.ts` |
| 状态机 | Agent 协作 | LangGraph StateGraph |
| 工厂 | 节点创建 | `agentTools.ts` create_* |
| 命令 | 工具调用 | `executeToolCall()` |

## Redis Key 规范

- 格式: `prism:{module}:{entity}:{id}` | 必须设 TTL
- Hash 存结构化数据 | String 存简单值 | 分布式锁 `SET NX EX`
