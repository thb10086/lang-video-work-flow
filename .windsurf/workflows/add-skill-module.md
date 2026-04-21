---
description: 新增 SKILLS 模块 — Agent 能力定义注入到系统提示词
---

# 新增 SKILLS 模块

SKILLS 是注入到 Agent System Prompt 中的能力描述，帮助 LLM 理解可用工具和最佳实践。

1. 编辑 `src/prompts/skills/index.ts`

在文件中创建新的 `SkillDefinition` 对象：

```typescript
const myNewSkill: SkillDefinition = {
  id: 'my_new_skill',           // 唯一标识 (snake_case)
  name: '模块中文名',            // 显示名
  summary: '一句话能力概述。',    // 1-2 句
  details: `### 模块名

**核心能力**：描述这个模块做什么。

**工具链**：
- \`tool_name_1\` → 做什么
- \`tool_name_2\` → 做什么

**输入**：需要什么参数
**输出**：产出什么结果

**最佳实践**：
- 实践 1
- 实践 2`,
  tools: ['tool_name_1', 'tool_name_2'],  // 涉及的工具名
  nodeTypes: ['nodeType'],                  // 涉及的节点类型
}
```

2. 加入 `ALL_SKILLS` 数组

在文件底部的 `ALL_SKILLS` 数组中添加新模块。

3. 配置阶段映射（如需要）

在 `PHASE_SKILL_MAP` 中将新模块 id 加入对应阶段：
- `pre_production`: 角色/场景/风格/分镜
- `production`: 图片/视频生成
- `post_production`: 音频/检查/拼接

4. 验证

```bash
npx tsc --noEmit
```

确认 `buildSkillsPrompt()` 输出包含新模块的索引行和详细描述。

5. 更新文档

更新 README.md 中的 SKILLS 模块数量。
