/**
 * SKILL module — Error Recovery Recipes
 *
 * 把现有 chatStore 的"错误处理协议"（识别特征 → 应对策略）从原则升级为
 * 具体可执行剧本。每条 recipe 是「症状 → 诊断步骤 → 修复指令」的三段式。
 *
 * 注入时机：所有阶段均加载（错误可发生在任意阶段）。Token 成本 ~600，
 * 但能显著降低 Agent 在失败后的乱重试 / 早放弃概率。
 *
 * 设计原则：
 *   1. 每条剧本必须给出**精确工具调用**，而非模糊建议
 *   2. 区分「可自愈」与「需用户决策」两类，前者直接执行，后者立即 HALT
 *   3. 所有 recipe 与 toolHandlers / executors 中的实际错误信息文本对齐
 */

import type { SkillDefinition } from './types'

export const errorRecipes: SkillDefinition = {
  id: 'error_recipes',
  name: '错误自愈剧本',
  summary: '常见失败的诊断 + 自动修复步骤；区分可自愈 vs HALT 两类。',
  details: `### 错误自愈剧本

工具失败时，按下表诊断 → 执行修复，**不要盲目 retry**。

#### 1. 模型参数错误（HTTP 422 / "field not allowed" / "unknown parameter"）

**症状**：execute_node 返回包含 \`422\` / \`Invalid\` / \`unknown\` / \`not allowed\` 的错误信息。

**诊断**：模型 schema 不匹配（如对 veo3.1 传了 generate_audio，对 sora-2 传了 duration > 上限）。

**修复**：
\`\`\`
1. model.get_params(model_id: 当前节点的 model)     # 拿到完整 ParamField schema
2. canvas.update_node(nodeId, updates: { 仅保留合法字段 })  # 删掉报错的字段
3. retry_node(nodeId)
\`\`\`

不要重复传同样的参数，不要换别的模型——先看 schema 再决策。

---

#### 2. 引用未解析（"unresolved character: @XXX" / "asset not found"）

**症状**：optimize_prompt / execute_node 报告引用未解析。

**诊断**：prompt 中 \`@角色名\` / \`#资产ID\` 没匹配到任何 characterManager / asset_store 条目。

**修复**：
\`\`\`
1. resolve_prompt_refs(prompt: 报错节点的当前 prompt)  # 看哪些 ref 失败
2. list_assets(kind: 'character')                      # 检查名字是否拼错
3. 二选一：
   - 名字拼错 → canvas.update_node(nodeId, updates: { prompt: 用正确名字 })
   - 角色未注册 → create_asset(kind: 'character', name, appearance) 后 retry_node
\`\`\`

---

#### 3. 图片返回为空（"未返回图片" / "no image in response"）

**症状**：generationExecutors 报告 \`未返回图片 (已重试 3 次)\`。

**诊断**：上游 API 偶发失败（不是参数错），底层已重试 3 次。

**修复**：
\`\`\`
1. 等待 30s 不要立即重试（API 可能在限流恢复中）
2. retry_node(nodeId)                                  # 再给 1 次机会
3. 仍失败 → plan.update_step(stepId, status: 'failed', result: 'API 持续无响应')
   并向用户报告：「{节点标签} 因上游服务无响应失败，已重试 4 次，建议稍后手动重试或检查 API Key」
\`\`\`

不要把同一节点 retry 超过 5 次（包含底层 3 次自动重试 + 这里 2 次手动）。

---

#### 4. 节点不存在（"节点未找到" / nodeLabel 模糊匹配多结果）

**症状**：canvas.connect / execute_node / canvas.update_node 报告找不到节点或多个匹配。

**修复**：
\`\`\`
1. get_canvas_state()                                 # 拿到精确 node IDs
2. 用 nodeId（而非 nodeLabel）重新调用工具
\`\`\`

---

#### 5. 上游依赖未就绪（imageGen / videoGen 提示首帧缺失）

**症状**：execute_node videoGen 时报错「first-frame 不可用」或自动跳过。

**修复**：
\`\`\`
1. get_canvas_state()                                # 看 videoGen 的 first-frame 边
2. 如果没连：
   找到对应 imageGen 节点 → canvas.connect(srcLabel: imageGen, tgtLabel: videoGen)
3. 如果连了但 imageGen 未执行：
   execute_node(imageGen)  → get_node_output 确认 outputImage 存在 → 再 retry_node(videoGen)
\`\`\`

---

#### 6. 角色外貌漂移（review_generated_image / verify_image_semantic 评分 < 阈值）

**症状**：审查工具返回 score < threshold，consistency 维度失分。

**修复**：
\`\`\`
1. get_node_output(nodeId)                          # 看实际 prompt
2. 检查 prompt 是否包含 [Character Anchor: ...] 段
3. 缺失 → canvas.update_node(nodeId, updates: {
     prompt: "[Character Anchor: <角色完整外貌词>]\\n\\n" + 原 prompt
   })
   然后 retry_node(nodeId)
4. 已包含但仍漂移 → 检查 ref-in 是否连了 characterGrid 输出
\`\`\`

---

#### 7. 连续失败 ≥ 3 次（同一步骤）

**HALT 条件**：不再自愈，立即停止并向用户报告。
\`\`\`
1. plan.update_step(stepId, status: 'failed', result: '<具体原因>')
2. 向用户：「{步骤名} 连续失败 N 次，原因：{摘要}。建议：{用户操作指引}」
3. 跳过该步骤，先做计划中其他无依赖步骤（避免完全卡死）
\`\`\`

---

#### 决策速查

| 错误特征 | 是否自愈 | 首选工具 |
|---------|---------|---------|
| 422 / parameter not allowed | ✅ | model.get_params + canvas.update_node |
| ref unresolved | ✅ | resolve_prompt_refs + list_assets |
| 空响应 / 网络超时 | ⚠️ 限 1-2 次 | retry_node + 等待 |
| 节点找不到 | ✅ | get_canvas_state + nodeId |
| 依赖未就绪 | ✅ | canvas.connect + 上游 execute |
| 一致性失分 | ✅ | canvas.update_node 加 anchor + retry |
| 连续 3+ 失败 | ❌ HALT | plan.update_step failed + 报告用户 |
| API Key 缺失 | ❌ HALT | 立即报告，不要尝试任何执行 |

**关键纪律**：每次 retry 前必须先解释「为什么这次会成功」。同样的参数、同样的工具，连续重试不会改变结果。`,
  tools: [
    'model.get_params',
    'canvas.update_node',
    'retry_node',
    'resolve_prompt_refs',
    'list_assets',
    'create_asset',
    'get_canvas_state',
    'get_node_output',
    'canvas.connect',
    'execute_node',
    'plan.update_step',
  ],
  nodeTypes: [],
}
