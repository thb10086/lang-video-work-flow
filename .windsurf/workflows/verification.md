---
description: 完成前验证清单 — 确保修改真正完成并且不引入回归（灵感来自 Superpowers verification skill）
---

# 完成前验证 (Verification Before Completion)

在声明任何任务完成之前，必须通过以下验证清单。

## 硬性约束

"我觉得应该没问题" 不是验证。必须有证据。

## 验证清单

1. TypeScript 编译

// turbo
```
npx tsc --noEmit
```

零错误。警告需要逐一确认是否为已知/可接受的。

2. 全量测试

// turbo
```
npx vitest run
```

所有测试通过。如果有跳过的测试，确认跳过原因。

3. 变更范围检查

确认本次修改只涉及计划中的文件：

```bash
git diff --name-only
```

意外修改的文件需要解释原因或撤回。

4. 功能验证

根据任务类型选择验证方式：

- 新增节点类型: 画布拖拽创建 + Agent create_xxx_node + 执行
- 新增工具: Agent 对话调用 + 返回结果格式正确
- Bug 修复: 复现路径确认已修复 + 回归测试通过
- UI 变更: 亮/暗主题 + 窗口缩放 + 移动端响应
- 文档更新: 链接可访问 + 数字准确

5. 文档同步

- README.md 数字是否需要更新（工具数/测试数/SKILLS 数）
- TASK_TRACKER.md 任务状态是否已更新
- 相关 workflow 文件是否需要更新

6. 边界情况

- 空值/undefined 输入
- 超长文本输入
- 网络断开/API 超时
- 并发操作

## 验证记录格式

```markdown
### 验证结果 (YYYY-MM-DD)
- TS 编译: 零错误
- 测试: X/Y 通过
- 功能验证: [描述验证过程]
- 文档: 已同步 / 无需更新
```

## 常见遗漏

- 忘记更新 TOOL_LABELS（新增工具后）
- 忘记更新 ALL_SKILLS 数组（新增 SKILLS 后）
- 忘记更新 README 数字（工具/测试/模块数变化后）
- 忘记运行全量测试（只跑了单个测试文件）
