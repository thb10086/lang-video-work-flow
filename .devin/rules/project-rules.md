---
description: Prism AI 唯一规则文件 — 每次开发自动加载，保持精简
---

# Prism AI — 项目规则

基于 React Flow 的 AI 视频工作流引擎，用户通过画布拖拽 + Agent 对话完成创意到成片的全流程。

## 技术栈

| 层 | 技术 | 入口 |
|----|------|------|
| 前端 | React 18 + TS + Vite + Zustand + TailwindCSS + @xyflow/react | `src/main.tsx` |
| Agent | OpenAI Function Calling, 33 工具, 25 轮循环 | `src/store/chatStore.ts` |
| 后端 | FastAPI + LangGraph + WebSocket | `server/app/main.py` |
| DB | MySQL 8.0 + Redis 7 | `server/app/db/` |
| 测试 | Vitest (8 套件, 159 用例) | `src/__tests__/` |

## 核心架构

```
用户 → AgentChat → chatStore (Agent 循环)
                       ↓
              chatPromptBuilder (提示词 + 三层压缩)
                       ↓
              LLM API (Function Calling)
                       ↓
              executeToolCall → 4 组工具分发
                       ↓
              nodeExecutor → 15 种节点 → 后端 API (模型由 DB 管理)
```

## 5 Store | 15 节点 | 33 工具 | 16 SKILLS

- **Store**: flowStore / chatStore / chatPromptBuilder / settingsStore / agentMemoryStore
- **节点**: characterGrid / sceneGrid / imageGen / videoGen / storyboard / styleLock / audioNode / llmChat / imageEdit / imageCrop / continuityCheck / videoStitch / textNode
- **工具 (4 组)**: 节点创建连接(14) + 执行查询(10) + 基础设施(5) + 质量分析(4)
- **SKILLS**: 按阶段动态加载 → pre_production / production / post_production

## 编码约束 (10 条)

1. 单一职责 — Store 不调 API, Provider 不管 UI
2. DRY — 常量统一在 `modelDefaults.ts` / `config.py`, 禁止散落硬编码
3. 开闭原则 — 新增场景/模型/节点通过注册表扩展
4. 文件名 `camelCase.ts` / `PascalCase.tsx`, 变量 `camelCase`, 常量 `UPPER_SNAKE_CASE`
5. 禁止 `any` 类型 / 魔术数字 / 嵌套超 3 层回调 / 单文件超 500 行
6. 导入顺序: React → 第三方 → `@/` 内部 → 相对路径
7. 工具输出禁止 emoji, 禁止暴露 nodeId (用 label)
8. 环境变量统一通过 `src/lib/env.ts` (`ENV.*`) 访问
9. Git commit: `<type>(<scope>): <中文简述>`, type = feat/fix/refactor/docs/test
10. 每次完成任务后更新 TASK_TRACKER.md

## 渐进式导航 — 需要更多细节时按需加载

| 要做什么 | 加载位置 |
|---------|---------|
| 详细编码/测试/DB/性能规范 | workflow: `/coding-standards` |
| 新增节点类型 | workflow: `/add-node-type` |
| 新增 Agent 工具 | workflow: `/add-agent-tool` |
| 新增 SKILLS 模块 | workflow: `/add-skill-module` |
| 新增模型/渠道 | workflow: `/add-model-adapter` |
| 理解渠道路由 | workflow: `/channel-routing` |
| 新功能设计 | workflow: `/brainstorming` → `/writing-plans` |
| Bug 修复 | workflow: `/debugging` |
| 测试 | workflow: `/testing` |
| 完成前验证 | workflow: `/verification` |
| 前期制作技能 (角色/场景/风格/分镜) | `.windsurf/skills/pre-production.md` |
| 生产技能 (图片/视频生成) | `.windsurf/skills/production.md` |
| 后期技能 (音频/检查/拼接) | `.windsurf/skills/post-production.md` |
| 质量与工程技能 | `.windsurf/skills/quality-and-craft.md` |
| 任务进度 | `.tasks/TASK_TRACKER.md` |
