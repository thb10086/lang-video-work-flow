# 瑞幸 × 鸿星尔克 1 分钟广告 — Agent 端到端测试报告

**测试时间**：2026-05-14 21:00 → 21:34 (UTC+8) — 共 ~35 min，3 轮 Agent 调用
**测试模式**：浏览器真实 UI → Agent loop → 工具调用（**无任何 MockLLM**）
**LLM**：Claude Opus 4（yunwu.ai 渠道）
**前端**：http://localhost:3000 ✅
**后端**：http://localhost:8000 ✅
**产品图**：`image/1778657723_f411dd72.png`（瑞幸×鸿星尔克联名冰拿铁）

---

## 📌 最终成果（v2，TDD 修复后）

| 指标 | 值 |
|---|---|
| **verify_task 自检** | **100/100 ✅** |
| 节点 / 连线 | 19 / 31 |
| 镜头数 | 8（每镜头 12s × 8 = 96s） |
| 工具调用 | 5 步（set_phase + classify_image + detect_scenario + generate_workflow + verify_task） |
| 总耗时 | 176.4s / 7.9k tokens |
| 角色锚定 | 8 镜头中 shot 2-8 都嵌入完整外貌句 ✅ |
| 产品锚定 | 8 imageGen + 8 videoGen 全部用 productImage ✅ |
| productOnlyShots | [1] ✅ |
| Replace 模式 | 默认 true，无 doubling ✅ |

---

## 一、Agent 工具栈执行结果（全成）

| # | 工具 | 状态 | 关键产出 |
|---|---|---|---|
| 1 | `classify_image` | ✅ | 视觉无法直接分析附件预览（toapis 限制），转为文本理解继续 |
| 2 | `detect_scenario` | ✅ | 识别为 **`product_ad`** 场景，匹配模板 `ad-product` |
| 3 | `generate_workflow` | ✅ | 一次性建好画布，下面详述 |
| 4 | `verify_task` | ✅ | 画布质量 **80/100**（5 项通过，1 项发现待优化点） |

总计：**4 个工具调用 / 114.6 秒 / 5.0k tokens**

---

## 二、画布产出

- **节点 19 个 / 连线 31 条**
- 8 × `imageGen`（关键帧）+ 8 × `videoGen`（i2v）+ 1 × `videoStitch`（拼接）+ `styleLock` + `character` + `videoModel selector` + `imageGen` for 角色/场景模板等
- **productImage 锚定全部 8 镜头** ← 我新加的字段已生效
- **productOnlyShots: [1]** ← shot 1 仅产品，无角色 ref
- 角色 **Lin Yao / 林瑶** 锚定 shot 2-8

---

## 三、Agent 自主创作（创意 + 角色 + 镜头）

### 3.1 片名

> **《这一口，轻松有型》**
> 瑞幸 × 鸿星尔克联名冰拿铁产品广告

### 3.2 整体调性

cinematic 中式商业广告 / 暖调自然光 / 浅景深 / 都市女性生活方式叙事
节奏：**产品亮相 → 都市陪伴 → 情绪收束**

### 3.3 女主角设定（Agent 设计 + 全片锚定）

**Lin Yao / 林瑶** — 中国年轻都市女性

- 身高 ~168cm，纤细匀称，暖白肤色，柔和椭圆脸
- **发型**：深棕色中分锁骨发，发尾自然顺直，微微别耳
- **妆容**：棕色细眼线、纤长睫毛、蜜桃色腮红、豆沙玫瑰唇
- **穿搭（全片固定）**：米杏色亚麻西装外套 + 白色无袖针织上衣 + 浅蓝高腰直筒牛仔裤 + 白色干净运动鞋
- **配饰**：金色细表 + 小珍珠耳钉
- **气质**：干净 / 专业 / 松弛 / 亲和 / 都市感

### 3.4 8 个镜头（每镜头 12s × 8 = 96s）

| # | 标签 | 角色 | 拍摄手法（运镜） | 节奏意图 |
|---|---|---|---|---|
| 1 | Hero Product Only | ❌ 仅产品 | **slow push-in**（清扫桌面 → hero close-up） | 产品身份锚定 |
| 2 | 女主首次出场 | ✅ Lin Yao | **gentle dolly-in + slight right→left pan**（half-body） | 引入主角 |
| 3 | 都市出店，建立生活方式感 | ✅ Lin Yao | **smooth side-tracking + subtle push-in** | 生活方式陪伴 |
| 4 | 办公场景，建立使用场景 | ✅ Lin Yao | **slow pan + locked-off + parallax**（medium） | 多元使用场景 |
| 5 | 第一口饮用特写 | ✅ Lin Yao | **intimate beauty close-up + soft push-in** | 情绪高点 |
| 6 | 产品细节强化 | ✅ Lin Yao（背景虚化）| **macro-style product close-up + subtle slider feel**（无 orbit） | 产品质感 |
| 7 | 黄金时刻情绪拉满 | ✅ Lin Yao | **gentle handheld stabilized follow + slow push-in @ golden hour** | 情绪饱满 |
| 8 | 收束结尾 | ✅ Lin Yao | **slow emotional dolly-in**（medium close → product+face close-up） | 收束结尾 |

**专业拍摄手法已覆盖**：push-in × 4 / dolly-in × 2 / pan × 2 / side-tracking × 1 / locked-off + parallax × 1 / macro × 1 / handheld follow × 1。

**每镜头 prompt 结构**（Agent 自洽生成）：
- `Camera:` 清晰运镜描述
- `Action:` 主体动作 + 次级运动
- `Keep ... consistent`：人物身份 + 产品外观 + logo + 红色搅拌棒 锚定
- `Avoid:` face distortion / hand warping / cup wobble / logo flicker / frame stutter（具体名词，符合 i2v 友好范式）

详见 `agent-full-output.txt`（Agent 完整 markdown 输出）。

---

## 四、Verify_task 自检结果

**评分：80/100**

**通过 (5 项)**：节点数 19 / 无孤立节点 / prompt 全英文（16 节点）/ 字段完整 / videoPrompt 完整

**待优化 (1 项)**：
> 多个含人物的镜头 prompt 里，**角色外貌锚点词还不够强** — 「林瑶」的外貌描述在部分镜头里没有重复得足够明确，后续直接执行有轻微漂移风险。

**Agent 主动给出的下一步建议**：

| 方案 | 内容 |
|---|---|
| **A. 继续修正后再执行** | 补强所有人物镜头 shotPrompts/videoPrompts 的外貌锚定词 → 重新 verify_task → 力争 90+ |
| **B. 补充叙事层** | 60s 中文旁白 + 片尾 slogan + 字幕文案 + 把时长压到接近 60s |

---

## 五、Agent 工具栈基础设施验证

本测试同时验证了我之前 TDD 阶段加的两个 GAP 修复（`luckinAdE2E.test.ts` 8/8 全绿）确实在真实 Agent 决策路径里**生效**：

- `productImage`（产品图锚定全片）：✅ Agent 在 generate_workflow 调用里自动用上，画布 19 节点里 8 个 imageGen + 8 个 videoGen 都看到「✓ 已连接 1 张角色/场景参考图」
- `productOnlyShots: [1]`：✅ Agent 自动设为 [1]，shot 1 不连角色 ref

`@d:\PythonProject\lang-video-work-flow\src\providers\toolDefinitions.ts:415-423` 的 schema 描述已经被 LLM 正确理解和使用。

---

## 六、TDD 修复 — `generate_workflow` replace 模式（v2 之所以能 100/100）

v1 测试发现：第 1 次 `generate_workflow` 后，第 2 次再调（用户要求补强外貌锚定）会**叠加**而非**替换**画布 — 节点从 19 → 38，连线从 31 → 62。verify_task 把新旧两套都算进去，分数被旧节点压在 80。

Agent 自己一眼诊断出了这个 bug。修复路径（**根因 > 症状**）：

**RED 测试**：

`@d:\PythonProject\lang-video-work-flow\src\__tests__\luckinAdE2E.test.ts:296-349` 加了 2 个新断言（GAP-4），覆盖默认 replace 行为 + 显式 append 行为。

**最小变更（3 处）**：

1. `@d:\PythonProject\lang-video-work-flow\src\providers\workflowBuilders.ts:48-60` — `WorkflowArgs` 加 `replaceCanvas?: boolean`
2. `@d:\PythonProject\lang-video-work-flow\src\providers\workflowBuilders.ts:536-546` — `buildWorkflow` 入口判断 `replaceCanvas !== false` 时调 `useFlowStore.getState().clearAll()`，默认 true
3. `@d:\PythonProject\lang-video-work-flow\src\providers\agentTools.ts:429`、`@d:\PythonProject\lang-video-work-flow\src\providers\toolDefinitions.ts:424-427` — 透传 + schema 描述

**测试结果**：
```
luckinAdE2E.test.ts: 10/10 PASS (GAP-1 ~ GAP-4 全绿)
回归套件 pipeline + workflowQuality + agentTools + agentGenerationEvaluation: 67/67 PASS
6 场景 Agent 评估均分 99/100, product_ad=100
```

**真实浏览器验证**：v2 在浏览器里调一次 generate_workflow → 节点 19/31，符合预期；不再 doubling。

---

## 七、v2 Agent 自主增量产出（v1 没有的部分）

- **完整中文旁白文案**（Agent 主动加）：
  > 晨光刚刚落下，城市开始有了自己的节奏。一杯联名冰拿铁，把清爽、醇香与今天的好状态一起唤醒。看得见的绵密奶顶，分明的咖啡纹理，还有一眼就认出的联名标记。她带着它出门，在街角、在人群、在片刻停留之间，找到属于自己的从容步调。瑞幸 × 鸿星尔克联名冰拿铁，轻松一口，灵感在线。
- **产品一致性锚点白名单**（Agent 内化的视觉契约）：
  - transparent plastic cup
  - blue deer logo
  - white soft-serve swirl on top
  - rich iced latte marbling
  - red mascot stir stick
- **女主完整外貌锚定句**（已嵌入 shot 2-8 每个 shotPrompt + videoPrompt 开头）：
  > A 168 cm tall urban Chinese woman with fair warm-toned skin, an oval face, long chestnut-brown slightly wavy hair falling below the shoulders with a clean center part, soft natural makeup with defined brows light eyeliner peach blush and muted rose lips, wearing an ivory fitted knit top under a light camel short trench jacket, high-waisted dark straight-leg trousers, clean white low-top sneakers, small gold hoop earrings, a slim metal wristwatch, and a structured beige shoulder bag.

---

## 八、待用户确认

请审 `agent-v2-full-output.txt` 里的 8 个 v2 prompts，然后告诉我下一步走哪条：

1. **直接执行**：当前 100/100，直接跑画布执行（生 8 张 keyframe → 生 8 段 video → 拼接 96s mp4，Agent 已提议批量压时长 12s→8s 让总时长接近 1 分钟）
2. **批量压时长后再执行**：先让 Agent 把 8 个 videoGen 的 duration 从 12s 改成 6-8s，然后跑执行（成片接近 60s）
3. **再补一版导演阐述 + 中文分镜表**：Agent 提议过，可以单独输出

---

## 附件

| 文件 | 说明 |
|---|---|
| `canvas-v2-after-replace-fix.png` | **v2 画布最终态**（19/31，verify 100/100） |
| `agent-v2-full-output.txt` | **v2 Agent 完整输出**（8 个强外貌锚定 prompts + 中文旁白 + 创作设定） |
| `agent-canvas-overview.png` | v1 画布全貌（旧版，外貌锚定不强） |
| `agent-canvas-fit.png` | v1 画布 fit-view（旧版） |
| `agent-full-output.txt` | v1 Agent 完整输出（旧版） |
| `keyframes/` | PowerShell 直跑生成的 3 张产品 only 关键帧（仅作产品 identity 参照） |

