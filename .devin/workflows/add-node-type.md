---
description: 新增节点类型的完整步骤 — 端口注册/节点组件/执行器/Agent工具/SKILLS
---

# 新增节点类型

按以下顺序完成所有步骤，确保节点在画布、执行器、Agent 工具全链路可用。

1. 注册端口定义
// turbo
```
读取文件 src/types/portRegistry.ts
```
在 `PORT_DEFINITIONS` 中为新节点注册输入/输出端口，指定端口名、类型、颜色。

2. 创建节点 UI 组件
```
创建文件 src/components/nodes/XxxNode.tsx
```
- 继承 `workflow-node` CSS 类
- 使用 `Handle` 组件注册端口
- 通过 `useFlowStore` 读写节点 data
- 提供执行按钮调用 `nodeExecutor`

3. 注册到画布 nodeTypes
// turbo
```
读取文件 src/components/canvas/WorkflowCanvas.tsx
```
在 `nodeTypes` 对象中添加新节点类型映射。

4. 添加到节点面板
// turbo
```
读取文件 src/components/sidebar/NodePanel.tsx
```
在 `NODE_LIST` 中添加新节点条目（名称、图标、类型、描述）。

5. 实现执行逻辑
```
编辑文件 src/providers/executors/generationExecutors.ts 或 processingExecutors.ts
```
- 生成类节点（调 API）放 generationExecutors
- 处理类节点（本地逻辑）放 processingExecutors
- 在 `src/providers/nodeExecutor.ts` 的 switch 中注册新执行器

6. 创建 Agent 工具
```
编辑文件 src/providers/toolDefinitions.ts — 添加 create_xxx_node schema
编辑文件 src/providers/agentTools.ts — 添加 switch case
编辑文件 src/components/sidebar/AgentChat.tsx — TOOL_LABELS 添加中文标签
```

7. 添加 Smart Handle 解析
```
编辑文件 src/providers/toolHelpers.ts
```
在 `resolveSourceHandle` 和 `resolveTargetHandle` 中添加新节点类型的端口映射。

8. 添加 SKILL 模块
```
编辑文件 src/prompts/skills/index.ts
```
创建新的 `SkillDefinition` 对象并加入 `ALL_SKILLS` 数组。

9. 更新工作流模板（如适用）
```
编辑文件 src/templates/workflowTemplates.ts
编辑文件 src/providers/workflowBuilders.ts
```

10. 编写测试
```
编辑文件 src/__tests__/executeNode.test.ts — 添加新节点执行测试
```

11. 验收
```bash
npx vitest run
npx tsc --noEmit
```
- TypeScript 编译零错误
- 所有测试通过
- 画布可拖拽创建新节点
- Agent 可通过 create_xxx_node 工具创建
