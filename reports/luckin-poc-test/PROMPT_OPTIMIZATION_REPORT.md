# Keyframe Grid Prompt v0.1 → v0.2 优化报告

> **日期**：2026-05-14
> **范围**：`src/prompts/templates/keyframeSheet.ts`
> **驱动**：v0.1 4 张真实生图揭示 4 / 4 都存在「panel 之间近乎重复」的核心质量问题
> **方法**：业界对标 + TDD（11 项新断言）+ 真实生图 A/B 对比
> **测试**：`npm test` 全绿，717 passed | 1 skipped | 0 failed

---

## 1. 问题诊断

v0.1 用 toapis + `gpt-image-2` 跑了瑞幸咖啡 PoC 4 个 keyframeGrid（time-progression / scene-evolution / action-breakdown / multi-camera），4 张图都有同一个缺陷：

| subType | 期望 | v0.1 实际 |
|---|---|---|
| time-progression（点单流程，6 格） | 6 帧叙事推进：看手机 → 浏览 → 选择 → 确认 → 等取餐 | 6 帧几乎一样，男人都坐着看手机，仅手机界面有微差 |
| scene-evolution（咖啡萃取，6 格） | 空杯 → 第一滴 → 半满 → 满 → 静止满 → 余韵 | **本张相对最好**，但仅 1-2 帧之间有梯度，3-4-5 高度相似 |
| action-breakdown（拉花，6 格） | 6 个动作关键 pose（举罐 → 下降 → 接触 → 拉花叶形 → 收笔 → 完成） | 6 帧几乎一模一样的「正在倒奶」中段动作 |
| multi-camera（成品 4 格） | 4 个分类不同机位（top-down / eye-level / hero / close-up） | **4 帧全是正面 eye-level 视角**，仅微小旋转 |

### 1.1 根因

v0.1 prompt 用的是抽象指令：
```text
PANEL LAYOUT — MULTI-CAMERA COVERAGE:
All panels capture the SAME frozen moment in time from different camera angles
(e.g. wide / medium / close-up / over-the-shoulder / Dutch / low-angle / high-angle / POV).
```

模型读到 *"different camera angles"* 后没有被强制使用其中任何一个具体机位，
而是默认走「安全输出」 = 4 个相似的正面构图。括号里的列表是「可选示例」，
模型不视为硬约束。

类似地 action-breakdown 的 *"frame-by-frame animation reference"* 也太抽象 —
模型理解成「同一动作的 6 张连拍」而不是「6 个递进的关键 pose」。

---

## 2. 业界对标（v0.2 设计来源）

学习了以下顶尖 AI 视频/图像 storyboard 平台的 prompt 工程：

| 平台 | 关键模式 |
|---|---|
| **Higgsfield Shots** | 1 张参考 → 3×3 contact sheet。prompt 显式列出每 panel：`Panel 1: subject looking at camera, 50mm, eye level. Panel 2: profile view, telephoto, hip level. ...` |
| **LibTV `/storyboard`** | 多机位九宫格 / 25 宫格连贯分镜。numbered 列表，每 panel 单独一行 cue |
| **Midjourney `--panels 4` + `--cref`** | 用户在 prompt 中显式描述每格内容；character 一致性靠 `--cref` |
| **Sora storyboard mode** | `Scene 1: ... Scene 2: ...` 时间轴 cue，每场景独立指令 |
| **Stable Diffusion comic creator** | `Panel A \| Panel B \| Panel C` 强分隔；要求每 panel 之间「Visual difference is mandatory」 |

**共同模式**（v0.1 全部缺失）：

1. **显式枚举每个 panel**（不能笼统说「N 个不同角度」）
2. **每 panel 的差异点必须用具体名词**（top-down vs eye-level，而不是 slightly above vs slightly higher）
3. **明确禁止重复**（"two slight rotations of the same view are NOT acceptable"）
4. **保持其他维度一致**（only camera angle changes / only pose changes / etc.）

---

## 3. v0.2 改造方案

### 3.1 三层 prompt 结构

```text
┌─────────────────────────────────────────────────┐
│  HEADER (旧)                                    │
│  - shot name / description / style / mood       │
│  - 单图 + R×C grid + 分隔线                     │
├─────────────────────────────────────────────────┤
│  SUB-TYPE INSTRUCTIONS (旧, 加强)               │
│  - 整体目标 + 一致性规则                        │
├─────────────────────────────────────────────────┤
│  ★ PANEL-LEVEL CHECKLIST (新, v0.2 核心)        │
│  PANEL 1: <具体差异 cue>                        │
│  PANEL 2: <具体差异 cue>                        │
│  ...                                            │
│  PANEL N: <具体差异 cue>                        │
├─────────────────────────────────────────────────┤
│  ★ DIFFERENCE ENFORCEMENT (新)                  │
│  - 每 panel 必须 visually distinct              │
│  - 列出 forbidden failure modes                 │
│  - "interchangeable panels = defect"            │
├─────────────────────────────────────────────────┤
│  TECHNICAL FOOTER (旧, 加强)                    │
└─────────────────────────────────────────────────┘
```

### 3.2 默认 blueprint（per subType × layout）

提供 4 subTypes × 3 layouts = 12 套默认 panel 序列。每套用**分类级**词汇（不是渐变修饰），保证模型必须做出可见区分。

**multi-camera 2x2** 例：
```text
PANEL 1: OVERHEAD shot — 90° straight-down top-down, flat-lay composition, subject centered
PANEL 2: EYE-LEVEL front view — 50mm lens equivalent, frontal, neutral horizon
PANEL 3: 3/4 HERO angle — 45° above and to the side, slight tilt, dramatic depth
PANEL 4: EXTREME CLOSE-UP — macro lens, texture / material / detail focus on the most expressive part
```

**action-breakdown 2x3** 例：
```text
PANEL 1: Preparation pose — windup, weight loading, anticipation
PANEL 2: Initiation pose — motion just started, leading limb extending
PANEL 3: Mid-motion A — accelerating phase, body committed
PANEL 4: Peak / apex pose — maximum extension or contact, peak energy
PANEL 5: Mid-motion B — decelerating phase, momentum carrying through
PANEL 6: Follow-through pose — completion, weight settling, recoil
```

### 3.3 可选 `panelDescriptions` 入参

为「Agent / 上游精控路径」预留 escape hatch：

```ts
buildKeyframePrompt({
  subType, layout, shotName, shotDescription,
  panelDescriptions: ['custom 1', 'custom 2', 'custom 3', 'custom 4'],
})
```

当且仅当长度 = `KEYFRAME_LAYOUTS[layout].n` 时覆盖默认 blueprint，否则
fallback。这样未来可以接 LLM 拆分 storyboard 自动产出 N 段精确 cue。

### 3.4 DIFFERENCE ENFORCEMENT 段（强约束）

```text
DIFFERENCE ENFORCEMENT:
- Each of the {{n}} panels MUST be visually and compositionally distinct
  from every other panel along the panel's stated difference axis.
- Apply the SHOT description above to every panel; vary only the
  per-panel difference factor stated in the checklist.
- Forbidden failure modes: copy-paste between panels; near-identical
  poses; near-identical camera angles when the panels are supposed to
  differ; identical framing when motion is supposed to advance.
- A panel that looks at-a-glance interchangeable with another panel is
  a defect — never produce two panels that a viewer would mistake for
  the same frame.
```

直接命中 v0.1 的 4 个失败模式。

---

## 4. 真实生图 A/B 对比

**统一参数**：
- channel: `toapis` / model: `gpt-image-2` / size: `1024x1024` / resolution: `2048`
- 同 4 个瑞幸 shot（shotName / subType / layout / style / mood / shotDescription 完全一致）
- 唯一变量：prompt body（v0.1 → v0.2）

**生成耗时**：
| subType | v0.1 elapsed | v0.2 elapsed | v0.2 prompt 长度 |
|---|---|---|---|
| time-progression | ~60s | 56s | 2776 chars |
| scene-evolution | ~70s | 65s | 2761 chars |
| action-breakdown | ~110s | 105s | 3040 chars |
| multi-camera | ~70s（重复输出） | 129s（一次重试） | 2887 chars |

prompt 长度 v0.1 ≈ 1100 → v0.2 ≈ 2800（+150%）。多花的 token 都用在
**显式 panel cue + DIFFERENCE ENFORCEMENT**。生成耗时基本持平（多出来的输入
token 不显著影响 image diffusion 时间）。

### 4.1 视觉对比

| subType | v0.1 输出特征 | v0.2 输出特征 | 改善评级 |
|---|---|---|---|
| **time-progression** | 6 帧几乎相同：男人坐着低头看手机 | 6 帧呈现完整叙事弧：① 入座放杯 ② 拿起手机 ③ 浏览菜单 ④ 选择产品 ⑤ 看到确认 ⑥ 收手机望取餐台 | 🟢 巨大改善 |
| **scene-evolution** | 6 帧空→半→满，但 3-4-5 帧高度相似 | 6 帧梯度更平滑：空 → 第一滴 → 1/4 → 1/2 → 满 → 水流停的静止满 | 🟢 进一步细化 |
| **action-breakdown** | 6 帧几乎相同的「中段倒奶」pose | 6 帧呈现完整动作：① 罐悬空 ② 奶柱下降 ③ 中段稳定 ④ 接触表面 ⑤ 叶形成型 ⑥ 罐收起+完成 | 🟢 巨大改善 |
| **multi-camera** | 4 帧全部正面 eye-level，仅微旋转 | 4 帧分类区分：① OVERHEAD 俯视冰块 ② EYE-LEVEL 正面看 logo ③ 3/4 HERO ④ EXTREME CLOSE-UP 冰块特写 | 🟢 完全修复 |

### 4.2 图像归档

```
reports/luckin-poc-test/
├── images/                                       # v0.1 baseline
│   ├── luckin-点单流程-time-progression.png
│   ├── luckin-咖啡萃取-scene-evolution.png
│   ├── luckin-拉花动作-action-breakdown.png
│   └── luckin-成品展示-multi-camera.png
└── images-v2/                                    # v0.2 (本次)
    ├── luckin-点单流程-time-progression-v2.png
    ├── luckin-咖啡萃取-scene-evolution-v2.png
    ├── luckin-拉花动作-action-breakdown-v2.png
    └── luckin-成品展示-multi-camera-v2.png
```

---

## 5. TDD 证据

### 5.1 新增 11 项断言（全绿）

`src/__tests__/keyframeGrid.test.ts` 新增 `describe('keyframeSheet v0.2 — explicit per-panel blueprint')`：

| # | 断言 | 防止回归 |
|---|---|---|
| 1 | `PANEL 1: ... PANEL N:` 编号块出现在最终 prompt | 蓝图渲染契约 |
| 2 | 3x3 layout 必须输出 9 个 PANEL 行 | 不能少格 |
| 3 | multi-camera 蓝图必须含 top-down / eye-level / profile / close-up 词汇 | 防退回到模糊机位描述 |
| 4 | action-breakdown 蓝图必须含 preparation / peak / follow-through 词汇 | 防退回到模糊动作描述 |
| 5 | time-progression 蓝图必须含 opening beat / climax / resolution 词汇 | 防退回到模糊叙事描述 |
| 6 | scene-evolution 蓝图必须含 initial / peak / final state 词汇 | 防退回到模糊状态描述 |
| 7 | DIFFERENCE ENFORCEMENT 段必须存在 + 含 distinct + forbidden 词 | 防强约束被删 |
| 8 | 调用方传入的 panelDescriptions 必须按数完全替换默认蓝图 | 精控路径契约 |
| 9 | 长度不匹配的 panelDescriptions 必须 fallback 到默认蓝图 | 防误覆盖 |
| 10 | `keyframeSheetTemplates[*].template` 必须含 `{{panel_blueprint}}` 占位符 | 渲染契约 |
| 11 | 最终 prompt 必须含 no text / no watermark | 防 footer 被破坏 |

### 5.2 全量回归

```text
Test Files  54 passed | 1 skipped (55)
     Tests  717 passed | 1 skipped (718)
  Duration  4.87s
```

旧断言（37 项 keyframeGrid + 其他 17 项 agentNodeParity / toolTiers / 等）零变化。

---

## 6. 后续优化方向

### 6.1 立即可做（短期）

1. **Agent `create_keyframe_grid` 工具加 `panelDescriptions` 字段**
   让 Agent 在创建节点时可显式传 N 段 cue（精控路径），同时保持 default blueprint 作 fallback（一键路径）。
2. **toapis multi-camera 偶发 timeout**：默认 polling 180s 偶发不够；考虑根据 layout.n 动态调整（2x2 → 180s, 3x3 → 300s）。
3. **`shotDescription` 与 blueprint 的耦合规则**：当 caller 已经在 description 里手写了机位（如 v0.1 的 "from 4 camera angles: top-down, eye-level, ..."），应该 detect 后让 blueprint 让位 / 合并。否则模型会收到 2 套机位列表。当前 v0.2 通过文档约定 + 业务侧入口规范保证，未来可加 ESLint 规则或运行时 warning。

### 6.2 中期

4. **接 LLM 自动拆分 panelDescriptions**：让 Agent 读完 storyboardScript 后用一次 LLM 调用产生 N 段精确 cue 替换默认蓝图。
5. **对每张 panel 单独算 CLIP 相似度**：评估实际差异性，做自动质量门禁（出现 ≥ 0.95 相似的 panel pair 触发警告）。
6. **多语言 blueprint**：当前全英文（diffusion 模型对英文最敏感）；未来可加中文版本走中文 image model（如 Tongyi Wanxiang）。

### 6.3 长期

7. **基于失败案例自动更新 blueprint**：把 v0.1 这次「4 帧全是正面」案例加入 eval harness，每次 prompt 改动跑回归。
8. **subType ↔ scene 自动选择**：让 Agent 读 shotDescription 自动判断该用哪种 subType + layout（当前还是 Agent 手动选）。

---

## 7. 文件改动清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/prompts/templates/keyframeSheet.ts` | M | v0.1 → v0.2，新增 `DEFAULT_BLUEPRINTS`、`{{panel_blueprint}}` 占位符、`panelDescriptions` 入参、DIFFERENCE ENFORCEMENT 段 |
| `src/__tests__/keyframeGrid.test.ts` | M | 新增 `describe('keyframeSheet v0.2 ...')` 11 项断言 |
| `reports/luckin-poc-test/gen-prompts-v2.ts` | A | 用 v0.2 重新生成 4 个瑞幸 prompt（用 tsx 跑） |
| `reports/luckin-poc-test/03-prompts.v2.json` | A | v0.2 4 个 prompt 的 JSON snapshot |
| `reports/luckin-poc-test/run-real-generation-v2.ps1` | A | v0.2 4 张真实生图（与 v0.1 同参数，prompt 是唯一变量） |
| `reports/luckin-poc-test/retry-multi-camera.py` | A | multi-camera 单独重试脚本（urllib） |
| `reports/luckin-poc-test/real-generation-results.v2.json` | A | v0.2 生图结果元数据（URL / elapsed / size） |
| `reports/luckin-poc-test/images-v2/luckin-*-v2.png` | A | 4 张 v0.2 真实生图 |
| `reports/luckin-poc-test/PROMPT_OPTIMIZATION_REPORT.md` | A | 本文 |

---

## 8. 验收清单

- [x] **TDD RED**：11 项新断言初次跑全失败（lint 报 panelDescriptions 不存在 + 11 项 expect 不匹配）
- [x] **TDD GREEN**：keyframeSheet.ts 重写 → 37/37 keyframeGrid 测试通过
- [x] **全量回归**：`npm test` → 717 passed | 1 skipped | 0 failed
- [x] **真实生图 A/B**：4/4 v0.2 图全部产出 + 4 个 subType 全部肉眼可见改善
- [x] **业界对标**：5 个顶尖平台 prompt 模式 + 共同失败模式分析记录在案
- [x] **escape hatch**：`panelDescriptions` 入参就绪，未来 Agent 精控路径可直接接入
