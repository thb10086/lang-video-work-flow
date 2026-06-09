# Keyframe Grid PoC v0.1 — 实施与反思

> **日期**：2026-05-14  
> **触发对话**：用户要求探讨"关键帧做成九宫图"的可行性，参考 libTV / Higgsfield 等业界做法  
> **关键认知修正**：九宫图是**单张图内的 N 格拼贴**（一次 image model 调用），不是 N 张独立图  
> **范围**：方案 C（imageGen 保留 + 新增 keyframeGrid，Agent 二选一），最小骨架

---

## 1. 业界调研沉淀

### LibTV（LiblibAI，国内同类最深）
通过 `/` slash 命令调用专业分镜工具：
- **多机位九宫格** — 同一场景、9 个不同机位
- **25 宫格连贯分镜** — 同一事件、25 帧时间序列
- **剧情推演四宫格** — 4 帧叙事进展
- **画面推演** — 时间推断（"3 秒后"）
- **角色三视图** — 正/侧/背

### Higgsfield Shots（海外标杆）
单张输入图 → 3×3 = 9 帧 contact sheet：
- 训练在 100M+ 小时电影上，AI 学会"摄影机如何绕主体走"
- Identity 保持近 100%
- 用户挑帧后 upscale 到生产质量
- **9 帧 = 4 credits ≈ 一张 4K 单图的成本** ← 核心便利点

### 关键洞察
业界把"分镜九宫图"按维度分两类：

| 类型 | 维度 | 用途 | 项目现状 |
|---|---|---|---|
| **A** | 空间（机位/角度） | 角色/场景多视角参考、运镜预演 | ✅ `characterGrid` + `sceneGrid` 已有 |
| **B** | 时间（事件推进） | 剧情推演、动作分解、状态演进 | ❌ **缺失** ← PoC 补的就是这个 |

---

## 2. PoC 实施范围

### 已交付（13 个任务 / 100% 完成）

| # | 任务 | 文件 |
|---|---|---|
| 1 | 4 个子类型 prompt 模板 | `src/prompts/templates/keyframeSheet.ts` (新建) |
| 2 | 节点定义注册 | `src/data/nodeDefinitions.ts` |
| 3 | 端口注册 | `src/types/portRegistry.ts` |
| 4 | 节点组件 | `src/components/nodes/KeyframeGridNode.tsx` (新建) |
| 5 | Canvas nodeTypes 注册 | `src/components/canvas/WorkflowCanvas.tsx` |
| 6 | Agent 工具 schema | `src/providers/toolDefinitions.ts` |
| 7 | Agent 工具执行 case | `src/providers/agentTools.ts` |
| 8 | Tier 2 注册 + parity 测试同步 | `src/providers/toolTiers.ts` + 2 个测试文件 |
| 9 | SKILL 决策准则（含触发词表） | `src/prompts/skills/videoWorkflowRecipe.ts` |
| 10 | 单测 | `src/__tests__/keyframeGrid.test.ts` (新建，26 cases) |
| 11 | 全量 vitest 回归验证 | 706 passed / 0 failed |
| 12 | Puppeteer UI 节点面板验证 | 截图存档 |
| 13 | 反思笔记 | 本文件 |

### 核心设计

**4 个子类型**（依据"触发词信号"选取）：
- `time-progression` — 剧情推演（同机位、时间向前）
- `scene-evolution` — 画面演进（状态/天气/氛围渐变）
- `action-breakdown` — 动作分解（复杂动作拆 N 个 pose）
- `multi-camera` — 多机位（同一时刻不同角度）

**3 种布局**：
- `2x2` 四宫格 — 简单（4 panels）
- `2x3` 六宫格 — 标准默认（6 panels）
- `3x3` 九宫格 — 复杂（9 panels）

**Agent 决策准则**（已注入 `videoWorkflowRecipe` SKILL）：

| 触发信号 | 触发词（中英）| 推荐 subType |
|---|---|---|
| 运镜 | pan / zoom / dolly / orbit / 推拉 / 摇 / 跟 | `multi-camera` |
| 时间序列 | 然后 / 接着 / 最终 / before-after / progressively | `time-progression` |
| 复杂动作 | 战斗 / 舞蹈 / 转身 / 跳跃 / fight / dance / motion | `action-breakdown` |
| 状态演进 | 从X到Y / 逐渐 / gradually / 天气变 | `scene-evolution` |
| 显式声明 | 九宫图 / 分镜推演 / 过程图 / 动作分解 | 按上下文选 |

---

## 3. 验证证据

### 单测（26/26 通过）
```
src/__tests__/keyframeGrid.test.ts
  ✓ keyframeSheet templates × 6
  ✓ KEYFRAME_LAYOUTS × 4
  ✓ buildKeyframePrompt × 4
  ✓ create_keyframe_grid tool dispatch × 9
    - 默认值 / 4 个 subType × layout / invalid sanitize / 中文 label / 风格情绪保留
  ✓ keyframeGrid registration × 3
    - portRegistry 4 端口 / TIER_2_CREATION / AGENT_TOOLS schema 完整
```

### 全量回归
```
Test Files  54 passed | 1 skipped (55)
Tests       706 passed | 1 skipped (707)
```
基线 679 → 706（+27）。零回归。

### UI 验证
- 节点面板"分镜拼贴图"卡片显示正常（紫红色 / LayoutGrid 图标）
- 描述文案完整："一张图含 4/6/9 帧拼贴（剧情推演 / 动作分解 / 多机位）"
- 截图见 puppeteer MCP 记录

---

## 4. 已知限制（PoC 阶段不做）

| 限制 | 原因 | 何时补 |
|---|---|---|
| 不切分子帧 | 后端服务 + 图像分割逻辑，超出 PoC | v2 |
| 不接 videoGen 序列入口 | 需要新增 `frames-out` (IMAGE_SET) 消费逻辑 | v2 |
| 不做 Vision 一致性校验 | 9 个 panel 内部 identity drift 检测，需要 Vision LLM | v2 |
| Agent 决策选型未在真实对话里验证 | 需要消耗真实 LLM API call，PoC 收敛在"决策准则已写入 SKILL"层面 | 手测 |
| 成本守门只是 SKILL 提示 | 没做硬限流 | v2 |
| `category: 'storyboard'` 占位 | `PromptTemplate.category` 类型未扩展（避免破坏现有类型） | v2 |

---

## 5. 真实场景手测脚本（供用户验证 Agent 选型）

打开 Agent chat，依次发送以下 prompt，观察 Agent 是否主动调用 `create_keyframe_grid`：

### 用例 A — 应该触发（time-progression）
```
帮我做一个镜头：主角从地铁站出来，然后看见远处的车祸现场，
接着他冲过去，最后跪在地上崩溃。这是一个长镜头的剧情推演。
```
**期望**：Agent 看到"然后/接着/最后/剧情推演" → 调用 `create_keyframe_grid({ subType: 'time-progression', layout: '2x3' or '3x3' })`

### 用例 B — 应该触发（action-breakdown）
```
镜头是反派施展回旋踢的连续动作分解，把这个复杂动作拆出来。
```
**期望**：Agent 看到"连续动作/分解" → `create_keyframe_grid({ subType: 'action-breakdown' })`

### 用例 C — 应该触发（multi-camera）
```
同一个对峙场景，给我多机位覆盖：wide / medium / close-up / over-shoulder。
```
**期望**：`subType: 'multi-camera'`，可能用 `layout: '2x2'`

### 用例 D — 应该触发（scene-evolution）
```
镜头是一个海港，从晴天逐渐变成暴风雨，给我这个状态变化。
```
**期望**：`subType: 'scene-evolution'`

### 用例 E — 不应触发（短镜头）
```
帮我画一张赛博朋克城市街角的图。
```
**期望**：Agent 用 `create_image_node`（不应升级到 keyframeGrid）。

### 用例 F — 显式声明
```
给我一个九宫图分镜推演。
```
**期望**：强制 `create_keyframe_grid`，按上下文选 subType。

---

## 6. v2 路线图（如果 PoC 验收通过）

按工作量从小到大：

1. **子帧坐标元数据**（0.5d）— 输出图带 grid 坐标，前端在拼贴图上 overlay panel 编号
2. **挑帧 UI**（0.5d）— 在 PreviewArea 上点击 panel 切出单帧（client-side image crop 即可，不用后端）
3. **frames-out 端口接 videoGen**（1d）— `IMAGE_SET` → `videoGen.first-frame + last-frame`，配合 kling/seedance 的 first/last frame 模式
4. **Vision 一致性校验**（1d）— 复用 `verify_image_semantic` 检测 9 panel 内 identity drift
5. **成本硬限流**（0.5d）— 项目级 keyframeGrid 数量阈值，超过提示
6. **服务端图像分割**（1d）— Python 后端按 grid 坐标切出 N 张子图存到 `assets`
7. **`category` 扩展**（10min）— `PromptTemplate.category` 加入 `'keyframe'` 枚举值

总计 v2 约 4-5 天。

---

## 7. 与现有架构的契合点（已实现）

| 现有能力 | 在 PoC 里的复用 |
|---|---|
| `SceneGridNode` 3×3 拼贴 prompt 工程 | `keyframeSheet` 模板直接沿用同款 `single composite image with N panels` 范式 |
| `<NodeShell>` / `<PreviewArea>` / `<ParamPopover>` / `<SegmentedPicker>` | KeyframeGridNode 4 个 chip + preview 全部复用 |
| `flowStore.addNode` + 节点 sanitize | Agent 工具 case 走标准路径 |
| `TIER_2_CREATION` 渐进披露 | `create_keyframe_grid` 自动加入"创建意图"工具集 |
| `videoWorkflowRecipe` SKILL | 决策段已注入，Agent 在 production 阶段会看到 |
| `agentNodeParity` / `toolTiers` 测试基础设施 | 同步更新两个硬编码 map，零回归 |

---

## 8. 关键设计决策回放

### 决策 1：「一张图含 N 格」而非「N 张独立图」
**用户原话**："镜头九宫图是在一张图片里面去实现，而不是去生成九张图片"  
**实施依据**：Higgsfield Shots「9 帧 = 4 credits ≈ 1 张 4K 单图」+ 现有 `sceneSheetTemplate` 已验证 prompt 工程可行  
**收益**：成本降低 9x、identity 保持有保障、UI 简单（一张图 + chip 切换）

### 决策 2：新节点 `keyframeGrid` 而非扩展 `imageGen`
**理由**：SRP（imageGen 单图职责清晰）、复用 grid 渲染逻辑、下游接力清晰  
**代价**：Agent 多一个工具要学

### 决策 3：4 子类型而非 2 子类型
**理由**：覆盖 LibTV 同类 4 个 slash 功能（多机位 / 时间序列 / 剧情推演 / 状态演进）  
**风险**：Agent 选错 subType。**缓解**：SKILL 决策准则表 + invalid 值强制 fallback

### 决策 4：默认 `2x3` 六宫格而非 `3x3` 九宫格
**理由**：6 帧画质 > 9 帧画质（同样 token 预算下，panel 越多每格越糊）；用户原话："九宫太多，六宫也可"

### 决策 5：暂不接 videoGen 序列入口
**理由**：PoC 收敛在"节点能创建、Agent 能选型、UI 能渲染"三件事。下游消费是 v2 范围。  
**用户在 PoC 阶段的产出消费方式**：拼贴图作为"分镜板"展示，或挑一帧手动接 imageGen。

---

## 9. 风险与未知

| 风险 | 等级 | 缓解 |
|---|---|---|
| 真实 image model 对"N panel grid" prompt 的执行质量未验证 | 中 | 用 `lib-nano-pro` / `seedream-5.0` 跑 5-10 张实测后再判断 |
| Agent 在没有显式触发词时是否会"过度使用" keyframeGrid 9x 烧成本 | 中 | SKILL 里已写预算守门 + 默认仍是 `create_image_node` |
| LLM 把 `subType` 传成 enum 外的值 | 低 | Agent 工具 case 已做 invalid sanitize（测试覆盖） |
| 拼贴图 panel 之间 character identity drift | 中 | sceneSheet 模板已验证可控，但跨更长 prompt 可能恶化；v2 加 Vision 校验 |

---

## 10. 总结

✅ **PoC 目标全部达成**：节点完整接入 / Agent 工具就绪 / SKILL 决策准则到位 / 26 单测 + 706 全量回归零失败 / UI 渲染正常。  
🔬 **未验证项**：真实 image model 输出质量、Agent 在自然对话中的选型行为。这两项需要花费真实 API call 或人工 chat 测试，超出 PoC 范围。  
🚀 **建议下一步**：用户在浏览器里发起一次自然语言对话（参考第 5 节手测脚本），如果 Agent 主动选 `create_keyframe_grid` 且画面质量可接受，就立刻进 v2（子帧切分 + videoGen 接力）。
