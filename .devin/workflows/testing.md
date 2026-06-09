---
description: 测试驱动开发流程 — RED-GREEN-REFACTOR 循环（灵感来自 Superpowers TDD skill）
---

# 测试驱动开发 (Testing)

遵循 RED-GREEN-REFACTOR 循环。先写测试，再写实现。

## 项目测试现状

- 框架: Vitest
- 套件: 8 个
- 用例: 159 个
- 位置: `src/__tests__/`

## 流程

1. 确认测试基线

// turbo
```
npx vitest run
```

确保所有现有测试通过。如果有失败，先修复再继续。

2. RED: 编写失败测试

```typescript
// src/__tests__/yourFeature.test.ts
import { describe, it, expect, vi } from 'vitest'

describe('Your Feature', () => {
  it('should do expected behavior', () => {
    // 断言预期行为
    expect(actualResult).toBe(expectedResult)
  })
})
```

运行测试确认它失败（RED 状态）：

```bash
npx vitest run src/__tests__/yourFeature.test.ts
```

3. GREEN: 编写最小实现

只写刚好能让测试通过的代码，不多不少。

```bash
npx vitest run src/__tests__/yourFeature.test.ts
```

确认测试通过（GREEN 状态）。

4. REFACTOR: 优化代码

在测试保护下重构：
- 提取重复逻辑
- 改善命名
- 简化条件

```bash
npx vitest run
```

确认所有测试仍然通过。

5. 重复循环

回到步骤 2，添加下一个测试用例。

## 测试分类

按项目约定，测试放在 `src/__tests__/` 下：

- `flowStore.test.ts` — 画布节点/边 CRUD
- `executeNode.test.ts` — 节点执行器
- `agentTools.test.ts` — Agent 工具
- `pipeline.test.ts` — 场景 Pipeline
- `dataPropagation.test.ts` — 数据流传播
- `imageUpload.test.ts` — 图片上传
- `seedance.test.ts` — Seedance 视频集成
- `backendMode.test.ts` — 后端模式

## Mock 策略

- 外部 API 调用: 使用 `vi.mock()` 模拟
- Zustand Store: 使用 `useFlowStore.getState()` 直接操作
- LLM 响应: 使用固定 JSON fixture
- 文件系统: 使用 `vi.spyOn()` 拦截

## 反模式

- 测试代码复制粘贴 → 使用 `describe.each` 或 helper
- 断言过于宽泛（如只检查 truthy）→ 精确断言值
- 测试之间共享可变状态 → 每个测试独立 setup
- 只测 happy path → 必须覆盖错误和边界
