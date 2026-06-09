# Keyframe Grid PoC — Playwright E2E 测试报告

> **执行时间**：2026-05-14  
> **工具**：playwright-cli 0.1.13 + 真实浏览器（vite dev @ localhost:3000）  
> **范围**：节点定义可见性 → 4 子类型 prompt 质量 → Agent 工具调度 → chip 状态切换 → 端到端 prompt 生成 → UI popover 交互  
> **结果**：✅ **8/8 阶段全部通过 / 132+ 项断言零失败**

---

## 1. 测试环境

| 项 | 值 |
|---|---|
| 前端 | `vite v6.4.1` @ `http://localhost:3000` |
| 后端 | **未启动**（不影响 PoC 测试，相关 7 个 console error 都是 `localhost:8000` 连接失败，与 PoC 无关） |
| 浏览器 | Playwright Chromium（默认 session） |
| 视口 | 1024×768 |
| 模块解析 | 通过 vite dev 的 `import('/src/.../*.ts')` 动态导入，绕过 window 暴露 |

---

## 2. 测试矩阵

### P1 — 基线导航
- ✅ 页面加载成功（`AI Video Workflow Studio`）
- ✅ React Flow canvas 渲染（hasCanvas: true）
- ✅ 7 个 console error 全部是后端连接（无关）
- 截图：`01-baseline.png`

### P2 — 节点面板可见性
- ✅ 点击「节点面板」按钮（ref e6）后 panel 展开
- ✅ 面板含「分镜拼贴图」节点卡片
- ✅ 描述文案完整：`一张图含 4/6/9 帧拼贴（剧情推演 / 动作分解 / 多机位）`
- ✅ 紫红色（fuchsia）样式 + LayoutGrid 图标
- 截图：`02-node-panel-with-keyframe.png`

### P3/P4 — Prompt 质量验证（132 个断言）
矩阵：**4 subType × 3 layout = 12 组 prompt**

每组 11 项断言：
- 变量替换（4）：`shotName` / `shotDescription` / `STYLE` / `MOOD`
- 布局正确（2）：`N panels` 数字 + `RxC grid` 字符串
- 锚定词（3）：`single composite image` / `grid layout` / `consistent|consistency`
- 子类型独有（1）：each subType has its dedicated marker
- 互斥（1）：当前子类型 prompt 不含其他 3 个子类型的标识词

**结果**：`{ total: 12, passed: 12, failed: [] }` — 132/132 断言全过

样本输出（subType=action-breakdown × layout=2x3）：
```
Storyboard sheet for shot "shot-revenge-3", displayed as a single composite image
with 6 panels arranged in a 2x3 grid layout. Thin light-gray dividing lines separate
each panel. Each panel is numbered top-left to bottom-right.

SHOT: protagonist confronts antagonist on rooftop at sunset
STYLE: noir
MOOD: tense

PANEL LAYOUT — ACTION BREAKDOWN:
Break a single complex action (turn, jump, swing, dance step, transformation) into
sequential motion phases. Each panel is one key pose along the motion arc — like a
frame-by-frame animation reference. Use slight motion-blur on limbs/cloth where
appropriate to suggest movement direction.
CONSISTENCY RULES:
- Same character identity, outfit, and body proportions in every panel
- Same camera angle and framing throughout the action
- Background remains identical; only character pose changes
- The N panels together must read as a smooth continuous motion

TECHNICAL: Cinematic composition per panel, professional color grading, consistent
character identity / outfit / proportions across all panels, no text or numbers
overlaid on the image, no watermarks. Output a single high-resolution composite image.
```

执行脚本：`check-prompt-quality.js`  
输出：`check-prompt-quality.out.json`

### P5 — Agent 工具调度（创建节点）
- ✅ `executeToolCall('create_keyframe_grid', ...)` 成功创建 1 个 `keyframeGrid` 节点
- ✅ 节点 `data` 字段全对：`shotName / shotDescription / subType / layout / style / mood / status / outputImage=null / label="分镜: 决战"`
- ✅ 返回消息含格数 + subType：`"已创建分镜拼贴图「决战」（6格 · multi-camera）"`
- ✅ Invalid subType / layout 强制 fallback 到默认值
- ✅ Matrix 4×3 = 12 个节点全部创建成功，`flowStore.nodes.length` 增量正确
- 截图：`03-canvas-with-14-nodes.png` — 14 节点全部渲染（含 chip）

执行脚本：`check-tool-dispatch.js`  
输出：`check-tool-dispatch.out.json`

### P6 — Chip 状态切换
- ✅ `updateNodeData(id, { subType: 'multi-camera' })` → store 反映
- ✅ `updateNodeData(id, { layout: '3x3' })` → store 反映
- ✅ `updateNodeData(id, { style, mood })` → store 反映
- ✅ UI 点击 chip → popover 弹出 → 4 个选项全部显示 → 当前选中态高亮
- ✅ 点击其他选项 → popover 选中态切换 + chip 文本同步更新 + store 同步
- 截图：
  - `04-clean-single-node.png` — 干净的单节点（preview / 输入框 / 4 chip / submit 全部）
  - `05-subtype-popover-open.png` — subType chip popover 打开（剧情推演 / 画面演进 / 动作分解 / 多机位）
  - `06-after-switch-to-multicam.png` — 切换后 chip 文本变成「多机位」+ popover 高亮同步

### P7 — 端到端 prompt 生成
- ✅ 用户输入 `shotName` / `shotDescription` → store 更新
- ✅ Store data 调 `buildKeyframePrompt` → 生成 prompt 含用户输入
- ✅ 切换 subType → prompt body 真的换了（multi-camera 标记出现，time-progression 标记消失）
- ✅ 切换后用户输入的文本仍然保留
- ✅ 长度合理（1066 字符，对 image model 不会超 token）

执行脚本：`check-state-and-e2e-prompt.js`  
输出：`check-state-and-e2e-prompt.out.json`

### P8 — 测试报告
- 本文件 + 6 张截图 + 3 个 JSON 输出

---

## 3. 关键证据汇总

| 文件 | 用途 |
|---|---|
| `01-baseline.png` | 页面加载基线 |
| `02-node-panel-with-keyframe.png` | 节点面板「分镜拼贴图」卡片 |
| `03-canvas-with-14-nodes.png` | 14 节点全 fit-view 渲染 |
| `04-clean-single-node.png` | 单节点完整 UI（preview/输入/4 chip） |
| `05-subtype-popover-open.png` | subType popover 4 选项 |
| `06-after-switch-to-multicam.png` | 切换后 chip 文本同步 |
| `check-prompt-quality.js` + `.out.json` | 132 prompt 断言 |
| `check-tool-dispatch.js` + `.out.json` | Agent 工具调度 |
| `check-state-and-e2e-prompt.js` + `.out.json` | chip 切换 + 端到端 prompt |
| `setup-clean-demo.js` | 截图准备脚本 |

---

## 4. Prompt 质量主观评估

### 优点
1. **格式锚定明确** — 每条 prompt 都以 `single composite image with N panels arranged in RxC grid layout` 开头，强制 image model 理解"是一张图含 N 格"，与 `sceneSheetTemplate` 一致（已被实战验证）
2. **结构化字段** — `SHOT: / STYLE: / MOOD: / PANEL LAYOUT: / CONSISTENCY RULES: / TECHNICAL:` 5 个分区清晰，便于模型逐条解析
3. **子类型差异充分** — 4 个 subType 的 PANEL LAYOUT 段差异显著，且都有专属 CONSISTENCY RULES（防止模型把 time-progression 当 multi-camera 处理）
4. **TECHNICAL footer 防护到位** — `no text or numbers overlaid on the image, no watermarks` 防止模型把 panel 编号画在图里污染输出
5. **长度合适** — 平均 ~1000 字符，远低于现代 image model 的 prompt 长度上限（DALL·E 3 / Imagen / Seedream 都支持 4000+ 字符）

### 风险点（需真实模型验证）
| 风险 | 缓解 |
|---|---|
| 9 个 panel 内 character identity 漂移 | 已有 `consistent character identity / outfit / proportions across all panels` 锚定，但实测才能验证强度 |
| 模型把 dividing lines 画歪 / 不画 | 已写 `Thin light-gray dividing lines`，符合 Higgsfield 等业界做法 |
| `motion-blur` 描述对动漫风格可能违和 | `action-breakdown` 文案有 `where appropriate`，给模型选择权 |
| 中文 shotName 在 image model 里效果未知 | 实测建议 prompt 强制英文，让 Agent 在调用时先翻译；shotName 本身只用于 label 不入 prompt 也是选项 |

---

## 5. 验收结论

✅ **PoC 实现完整、UI 链路通畅、prompt 质量满足"引导 image model 输出 N 格拼贴"的设计目标**

✅ **所有可在浏览器内验证的功能点都通过端到端测试**：
   - 132 个 prompt 断言（4 subType × 3 layout × 11 项 = 132）
   - Agent 工具调度（normal + invalid + 12 矩阵 = 14 个真实节点创建）
   - Chip UI 联动（store ↔ UI ↔ popover 三向同步）
   - 端到端 prompt 生成（用户输入 → store → buildKeyframePrompt → 含输入文本）

❌ **未验证（需真实 LLM/Image API call，超出 e2e 范围）**：
   - Agent 在自然对话里基于触发词主动选 `create_keyframe_grid` 的命中率
   - 真实 image model 输出的 9 格拼贴图视觉质量

🚀 **下一步建议**：
   1. 用户在浏览器里发起 1-2 次 Agent chat（参考 `reports/keyframe-grid-poc.md` 第 5 节的 6 个用例）
   2. 对每个触发的 keyframeGrid 节点，启动后端 + 配置 image model API key，跑一张实图验证质量
   3. 若实图质量 ≥ 80% 可用，进入 v2 路线（子帧切分 + videoGen 接力 + Vision 一致性校验）
