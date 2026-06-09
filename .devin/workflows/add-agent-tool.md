---
description: 新增 Agent 工具的完整步骤 — Schema/执行器/标签/SKILLS 四步闭环
---

# 新增 Agent 工具

当需要给 Agent 添加新的可调用工具时，按以下步骤操作。

1. 定义工具 Schema

编辑 `src/providers/toolDefinitions.ts`，在 `AGENT_TOOLS` 数组末尾添加新工具定义：

```typescript
{
  type: 'function' as const,
  function: {
    name: 'your_tool_name',
    description: '工具描述（含前置条件、使用时机、副作用）',
    parameters: {
      type: 'object',
      properties: {
        param1: { type: 'string', description: '参数说明' },
      },
      required: ['param1'],
    },
  },
}
```

description 要点：
- 写明前置条件（如"必须先创建节点"）
- 写明创建后还需做什么（如"创建后需 execute_node 执行"）
- 对 LLM 友好，无歧义

2. 实现执行逻辑

根据工具类型选择文件：
- 节点创建 → `src/providers/agentTools.ts` 内部 switch case
- CRUD/查询 → `src/providers/toolHandlers.ts`
- 质量/分析 → `src/providers/toolQuality.ts` 或新建 `toolXxx.ts`

在 `agentTools.ts` 的 `executeToolCall` 函数 switch 中添加分发：

```typescript
case 'your_tool_name':
  return handleYourTool(args, nodes, edges, ...)
```

工具返回值必须符合 `ToolCallResult` 接口：

```typescript
return { success: true, message: '操作成功描述', nodeId, nodeLabel }
```

3. 添加 UI 标签

编辑 `src/components/sidebar/AgentChat.tsx`，在 `TOOL_LABELS` 中添加：

```typescript
your_tool_name: '中文工具名',
```

4. 关联到 SKILLS 模块

编辑 `src/prompts/skills/index.ts`，在相关模块的 `tools` 数组中添加新工具名。
如果是全新能力域，创建新的 `SkillDefinition` 并加入 `ALL_SKILLS`。

5. 编写测试

编辑 `src/__tests__/agentTools.test.ts`，添加新工具的单元测试。

6. 验收

```bash
npx vitest run
npx tsc --noEmit
```

- 确认工具总数与 README/toolDefinitions 一致
- 确认 TOOL_LABELS 条目数与工具数一致
- 确认 SKILLS 模块引用了新工具
