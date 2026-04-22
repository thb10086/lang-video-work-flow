---
description: 每次开发前必须执行的上下文加载流程
---

# 开发启动流程

每次开始新的开发会话时，按以下顺序加载上下文：

1. 读取项目规则（唯一规则文件，已自动加载）
// turbo
```
确认 .windsurf/rules/project-rules.md 已加载
```

2. 读取任务追踪
// turbo
```
读取文件 .tasks/TASK_TRACKER.md
```

3. 按需加载深度上下文（仅在需要时）
- 编码规范详情: `/coding-standards`
- 前期技能 (角色/场景/风格/分镜): `.windsurf/skills/pre-production.md`
- 生产技能 (图片/视频): `.windsurf/skills/production.md`
- 后期技能 (音频/检查/拼接): `.windsurf/skills/post-production.md`
- 质量与工程技能: `.windsurf/skills/quality-and-craft.md`

3.5 数据库 schema 检查（涉及后端时必跑）
// turbo
```
cd server && alembic current
```
如果输出不是 `(head)`，立即执行 `alembic upgrade head`。
症状：后端 500 `Unknown column 'xxx' in 'field list'` = ORM 新增字段但 DB 未升级。

4. 确认当前任务
- 找到 `status: pending` 的最高优先级任务
- 或继续上次 `进行中` 的任务

5. 选择开发工作流

根据任务类型选择对应 workflow:
- 新功能设计: `/brainstorming` → `/writing-plans`
- 新增节点: `/add-node-type`
- 新增工具: `/add-agent-tool`
- 新增 SKILLS: `/add-skill-module`
- 新增模型: `/add-model-adapter`
- 渠道路由: `/channel-routing`
- Bug 修复: `/debugging`
- 测试: `/testing`

6. 开始开发
- 更新任务状态为 `进行中`
- 按任务描述实施

7. 完成前验证
- 执行 `/verification` workflow
- TS 编译零错误 + 全量测试通过

8. 完成后更新
- 更新任务状态为 `done` + 完成日期
- 更新 Phase 进度计数
- 如有新发现，更新 project-rules.md 或相关 workflow/skills
