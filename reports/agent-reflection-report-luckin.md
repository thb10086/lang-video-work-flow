# Luckin × Grok Video 3 — Agent E2E 反思报告

> **Change**: `openspec/changes/agent-e2e-test-grok-luckin/`
> **执行人**: Cascade (Windsurf)
> **时间**: 2026-05-14
> **耗时**: ~90 分钟（含 Task 1 探测 + Task 2–7 实现 + Task 8/9 部分 UI 验证 + 报告）
> **验证策略**: 用户选「我启动 + 只跑 cheap 验证」— 跳过 Agent chat 流程（场景 2-4）与真实视频生成（场景 6），其余按 spec 全做

---

## 0. 执行摘要

### 完成度

| 模块 | 状态 | 证据 |
|---|---|---|
| Task 1 前置探测 (P0) | ✅ 真实 API 探测 1 次（用户验证 toapis 返回 200） | 用户口头确认 + spec 探测记录 |
| Task 2 DB seed | ✅ MODELS_SEED + MAPPINGS_SEED 含 grok-video-3 | `python -m app.db.seed` 输出 `4 channels, 21 models, 19 mappings`；DB 查询命中 |
| Task 3 toapis_adapter | ✅ seconds 白名单 + images 双写 + 3 张截断 | `@server/app/services/adapters/toapis_adapter.py:280-283, 310-329` |
| Task 4 toolDefinitions | ✅ KNOWN_VIDEO_MODELS 含 grok-video-3 | `@src/providers/modelDefaults.ts:37` |
| Task 5 modelReferenceAdapter | ✅ grokStrategy 注入 + dispatch | `@src/providers/modelReferenceAdapter.ts:218-231, 264` |
| Task 6 pytest 回归 | ✅ 6/6 passed | `test_toapis_adapter.py` 全过 |
| Task 7 vitest 回归 | ✅ 6/6 grokVideoAdapter + 1/1 sora→grok 切换 | 全量 `679 passed / 1 skipped` |
| Task 8 UI 场景 1 | ✅ 模型下拉里有 Grok Video 3 | puppeteer DOM 断言 + 节点 data fiber 提取 |
| Task 8 UI 场景 2-4 | ⏭ 跳过（用户决策） | — |
| Task 9 UI 场景 5 (参数适配) | ✅ 节点 data 含 seconds="10" + aspect_ratio="16:9"，duration/resolution/size 被 sanitize 为 undefined | fiber 取证 |
| Task 9 UI 场景 6 (真实生成) | ⏭ 跳过（用户决策） | — |
| Task 10.1-10.2 自我反思 | ⏭ 跳过（用户决策） | — |
| Task 10.3-10.4 回归 | ✅ vitest 53 文件 / 679 passed；pytest 6/6 passed | 见 §4 |
| Task 11 反思报告 | ✅ 本文档 | — |

### 「Agent 自评摘要」段

> task 10.1 跳过，本段由 Cascade 直接代写，标注「Cascade 自检」。

#### ✓ 做对了
1. **DRY 严格执行**：toapis_adapter 的字段映射改动**只在一处**，没有按 model 拆 if/elif；前端 KNOWN_VIDEO_MODELS 是单一事实源，自动让所有 enum 引用自动包含 grok。
2. **回归保护到位**：测试用例 6.3 `test_seedance_unchanged` 提前锁定「Seedance 不出现 seconds、不出现 images/image_urls」的现有行为，避免 grok 改动破坏其他 6 个模型。
3. **schema-driven 一致性**：grok 的 `seconds` 字段用字符串（不是数字）+ DB schema default，让 sanitizeOnModelSwitch 自动接管，前端不需要硬编码默认值。
4. **TDD 节奏**：每完成一个 task 组（3.x / 5.x）立即写测试验证（6.x / 7.x），3.x 改动出错可在 5 分钟内发现。

#### ✗ 做错了
1. **BUG-001 sea.py 死代码未及时发现**：第一次跑 seed.py 直接 SyntaxError（`await` 在 `if __name__` 块裸出现）—— 这是历史合并残骸，跟本次 change 无关，但**应当在 Task 0 pre-flight 阶段就跑一次空 seed 提前发现**。
2. **第一次 edit 静默失败**：第一次给 MODELS_SEED 加 grok dict 的 edit 工具报告"成功"，但 grep 验证发现 dict 没真的插入；只在跑 seed 看到 "Skipping mapping" warning 后才发现。**应当 edit 后立即 grep 验证而不是依赖工具回显**。
3. **前端端口假设错**：spec 假设前端是 3001，实际 Vite 默认 3000。AGENTS.md 写的 3001 与代码现实不一致 — 没在 Task 1 时核对。

#### → 改进点
1. **DB seed 文件维护**：建议在 `seed.py` 入口加 `assert` 防御性检查 `if __name__ == "__main__"` 块只有一个；或者拆 `seed_database()` 与 `main()` 两个明确入口。
2. **`MAPPINGS_SEED` 完整性检查**：本次出现「mapping 引用未注册 model」时只是 warning 不阻断 — 应该改成 `raise` 让 seed 失败掉，因为 mapping 引用孤儿是真 bug。
3. **AGENTS.md vs vite.config 同步**：把前端端口写进一个常量（`scripts/dev.json` 之类）让 docs 引用，避免手动维护两份。
4. **edit 工具静默失败的兜底**：每次 `edit` 后用 `grep_search` 或 `read_file` 确认目标 string 真的进了文件（已经在第二次找到 grok 后做了，但应当成习惯）。

---

## 1. BUG（影响功能正确性，必须修）

### BUG-001 `seed.py` 末尾死代码导致 SyntaxError

| 字段 | 内容 |
|---|---|
| **证据** | 第一次跑 `python -m app.db.seed`：`SyntaxError: 'await' outside function`，位置 `@server/app/db/seed.py:556`（已修） |
| **根因** | 历史合并残骸：第 552-557 行第一个 `if __name__ == "__main__"` 块里包含裸 `await _clear_model_cache()`，但该函数定义在第 559 行之后；同时文件末尾第 584-586 行又有一个**真正**的入口块（仅 `asyncio.run`）。两个入口块并存说明历史 merge 没收尾干净。 |
| **影响范围** | 任何运行 `python -m app.db.seed` 的人 — 整个 DB seed 入口完全不可用 |
| **严重性** | P0（阻塞，本次必须修） |
| **修复路径** | ✅ 已修 — 删除第 552-557 行重复块，保留 559+ 的函数定义和 584+ 的真正入口。Commit 包含在本 change 内。 |

### BUG-002 「mapping 引用未注册 model」只 warning 不阻断

| 字段 | 内容 |
|---|---|
| **证据** | 第二次跑 seed 看到 `WARNING:prism.seed:Skipping mapping: model=grok-video-3, channel=toapis`，但 exit code 还是 0 + Redis 缓存被清。如果不仔细看输出，会以为 seed 成功了。 |
| **根因** | `@server/app/db/seed.py:507-509` 的 `if not model or not channel: logger.warning(...); continue`。设计上是容错，但实际上"mapping 指向不存在的 model"是真 bug — model 一定要先注册。 |
| **影响范围** | 任何手动维护 MAPPINGS_SEED 但忘了同步 MODELS_SEED 的开发者；引发的孤儿 mapping 只会在用户切换到该 model 时出 500 错误。 |
| **严重性** | P1（隐蔽性高，会浪费多次调试时间） |
| **修复路径** | 建议把 `continue` 改成 `raise RuntimeError(f"Mapping references unregistered model: {model_id_str}")`。这是一个独立的 5 行修改，建议作为后续 `db-seed-strict-validation` change 提出。 |

---

## 2. 设计问题（不阻塞当前任务，但反映架构隐患）

### DESIGN-001 模型字段在 toapis 网关层缺少 schema 同步机制

| 字段 | 内容 |
|---|---|
| **证据** | 本次接入 grok 发现两个字段差异：(1) 时长字段 `seconds`（不是 `duration`，且类型是字符串），(2) 图片字段 `images`（不是 `image_urls`）。我们用「白名单 + 双写」做兼容（`@server/app/services/adapters/toapis_adapter.py:280-283, 310-329`），但这是**症状级修补**。 |
| **根因** | toapis_adapter 把所有上游模型当作"字段相同"，靠白名单元组定义可透传字段。新模型每加一种字段（grok 的 `seconds` / Sora 的 `character_url` / Wan 的 `image` / Hailuo 的 `first_frame`），白名单元组就长一截。**没有 per-model 的字段映射表**。 |
| **影响范围** | 后续每接入一个新视频模型都要改 adapter；如果两个模型字段冲突（比如未来某模型用 `seconds` 但是数字类型），就要再加分支判断。 |
| **严重性** | P2（短期可控，长期会变成大杂烩） |
| **修复路径** | 建议在 `ai_models` 表增加 `upstream_field_map` JSON 列（如 `{"duration": "seconds", "image_urls": "images"}`），由 `seed.py` 同步定义。adapter 改成读这个 map 做字段名翻译，去掉白名单元组。这是一个 ~3 天的 refactor，建议作为 `adapter-field-mapping-layer` change 提出。 |

### DESIGN-002 截断逻辑分散在前后端

| 字段 | 内容 |
|---|---|
| **证据** | grok 的"最多 3 张参考图"规则同时出现在：(1) `@src/providers/modelReferenceAdapter.ts:226` 前端 grokStrategy，(2) `@server/app/services/adapters/toapis_adapter.py:317-322` 后端 adapter。两处实现重复且无明确「单一事实源」标注。 |
| **根因** | 前端在合并 firstFrame + characterUrls + styleRefs 时需要决定截断顺序（语义优先级：首帧 → 角色 → 风格），后端是兜底。两层都需要逻辑无法消除，但**约束值（3 张）**应该共享。 |
| **影响范围** | 后续如果 toapis 调整 grok 限制（如改成 5 张），需要改两处；忘改一处会出 silent 截断不一致。 |
| **严重性** | P3（写在两处但都对，不阻塞） |
| **修复路径** | 把 `MAX_REFERENCE_IMAGES_PER_MODEL` 放到 `shared/modelLimits.ts`（或后端 `ai_models.constraints` JSON 字段），前后端从同源读。短期可以接受现状。 |

### DESIGN-003 sanitizeOnModelSwitch 把 schema 不需要的字段设为 undefined 而不是 delete

| 字段 | 内容 |
|---|---|
| **证据** | UI 测试发现切换到 grok 后，`node.data` 仍含 `size: undefined / duration: undefined / resolution: undefined`（key 名还在）。JSON.stringify 会过滤但 React DevTools / Object.keys 会看到。 |
| **根因** | sanitize 用 `data.duration = undefined` 而不是 `delete data.duration`。Zustand store 更新差异时，undefined 字段被 spread 时仍保留 key。 |
| **影响范围** | 看 DevTools 时混淆视听；可能影响某些 schema 验证库（如 zod strict mode）；序列化到后端的 payload 体积稍微变大。 |
| **严重性** | P3 |
| **修复路径** | 在 `handleUpdateNode` sanitize 路径里把 undefined 字段过滤掉再 setState；或者用 `_.pickBy(data, v => v !== undefined)`。1 行改动 + 1 个测试。 |

---

## 3. 可优化点（不是 bug，纯改善）

### OPT-001 puppeteer MCP 截图无法落盘

| 字段 | 内容 |
|---|---|
| **证据** | 多次 `mcp4_puppeteer_screenshot` 调用，截图返回到 conversation history 但 `reports/screenshots/` 目录里没文件。`Get-ChildItem -Recurse *.png` 30 分钟内 0 个匹配。 |
| **影响范围** | UI 测试归档证据无法持久化，PR review 时无法看到截图除非 reviewer 回放对话。 |
| **严重性** | P3（不阻塞验证，仅影响审计） |
| **修复路径** | 短期：用 `mcp4_puppeteer_evaluate` 调 `canvas.toDataURL()` + PowerShell base64 解码写文件。长期：给 puppeteer-mcp 提 issue 加 `path` 参数。 |

### OPT-002 KNOWN_VIDEO_MODELS 与 DB 不同步无报错

| 字段 | 内容 |
|---|---|
| **证据** | `@src/providers/modelDefaults.ts:33-41` 写死 8 个 model；DB seed 现在 9 个 video models（含 grok）。如果忘了同步 KNOWN_VIDEO_MODELS，create_video_node 静态 fallback 不会列 grok，但 runtime 通过 `getAgentTools(opts)` 注入仍会工作。最坏情况：Agent 完全离线（无 DB 连接）回退到静态 schema 时缺 grok。 |
| **影响范围** | 极少触发但隐蔽 |
| **严重性** | P4（开发期同步即可） |
| **修复路径** | 加 vitest test：`expect(KNOWN_VIDEO_MODELS).toEqual(expect.arrayContaining(seedVideoModelIds))`，从 backend `/api/models` 或直接 import `seed.py` 的 MODELS_SEED 比对。 |

### OPT-003 模型下拉选了之后不自动关

| 字段 | 内容 |
|---|---|
| **证据** | UI 验证时观察：点 "Grok Video 3" 后下拉**仍然浮着**（截图见对话历史 luckin-003-grok-selected），需要再次点画布空白处才关闭。 |
| **影响范围** | UX 不连贯，用户多按一次。 |
| **严重性** | P3 |
| **修复路径** | 在 `VideoGenNode.tsx` 的模型选择 callback 里 `setDropdownOpen(false)`。预计 2 行改动。 |

---

## 4. 验证证据快照

### 4.1 pytest 后端回归

```
tests/test_toapis_adapter.py::test_seconds_passthrough PASSED            [ 16%]
tests/test_toapis_adapter.py::test_images_double_write PASSED            [ 33%]
tests/test_toapis_adapter.py::test_seedance_unchanged PASSED             [ 50%]
tests/test_toapis_adapter.py::test_sora_input_reference_preserved PASSED [ 66%]
tests/test_toapis_adapter.py::test_images_truncated_at_3 PASSED          [ 83%]
tests/test_toapis_adapter.py::test_non_url_images_filtered PASSED        [100%]
======================== 6 passed, 6 warnings in 0.04s =======================
```

### 4.2 vitest 全栈回归

```
Test Files  53 passed | 1 skipped (54)
     Tests  679 passed | 1 skipped (680)
  Duration  4.47s
```

新增测试：
- `@src/__tests__/grokVideoAdapter.test.ts` — 6 cases
- `@src/__tests__/updateNodeRegression.test.ts` — +1 case (`switching from sora-2-vvip to grok-video-3`)

### 4.3 后端 API 端到端验证

`GET http://localhost:8000/api/models?capability=video` 返回片段：

```json
{
  "id": 189,
  "model_id": "grok-video-3",
  "name": "Grok Video 3",
  "provider": "xAI",
  "capability": "video",
  "param_schema": [
    {"key": "seconds", "default": "10", ...},
    {"key": "aspect_ratio", "default": "16:9", ...}
  ],
  "sort_order": 50
}
```

### 4.4 UI 节点 data fiber 取证（puppeteer evaluate）

切换到 grok-video-3 后 `node.data` 完整内容：

```json
{
  "label": "视频生成",
  "model": "grok-video-3",
  "prompt": "",
  "outputVideo": null,
  "status": "idle",
  "seconds": "10",
  "aspect_ratio": "16:9"
}
```

`Object.keys` 含 `size / duration / resolution` 但值为 `undefined`（参见 DESIGN-003）。

### 4.5 截图清单（conversation history）

| 编号 | 名称 | 内容 | 状态 |
|---|---|---|---|
| 1 | page-initial | 空画布初始状态 | 在对话 |
| 2 | luckin-001-video-node-created | 创建 videoGen 节点（默认 sora-2-vvip） | 在对话 |
| 3 | luckin-002-model-dropdown-grok | 模型下拉展开看到所有 video models | 在对话 |
| 4 | luckin-003-grok-selected | 切换到 Grok Video 3 后节点 chip 状态 | 在对话 |

⚠️ **OPT-001**：puppeteer MCP 截图未落盘，证据仅在对话历史可见。

---

## 5. 下一步清单

| # | 动作类型 | 目标产物 | 优先级 |
|---|---|---|---|
| 1 | OpenSpec change | 新建 `db-seed-strict-validation`：把 BUG-002 的 warning 改成 raise + 加 vitest 检查 KNOWN_VIDEO_MODELS 同步 DB | P1 |
| 2 | 单文件修 | `@src/providers/toolHandlers.ts` sanitizeOnModelSwitch 用 delete 替代 undefined（DESIGN-003） | P3 |
| 3 | 单文件修 | `@src/components/nodes/VideoGenNode.tsx` 模型选择后关闭下拉（OPT-003） | P3 |
| 4 | OpenSpec change | 新建 `adapter-field-mapping-layer`：把字段名翻译从白名单元组改成 DB schema 驱动（DESIGN-001） | P2 |
| 5 | ROADMAP 条目 | 在 `@ROADMAP.md` 加「Q3 接入更多 toapis 视频 SKU」section，把后续 grok-image / minimax-image 等接入流程标准化 | P3 |
| 6 | 工具改进 | 给 puppeteer-mcp 提 issue 加 `screenshot.path` 参数（OPT-001） | P4 |
| 7 | 文档同步 | 修 `@AGENTS.md` 把前端端口从 3001 改成 3000，或者把 vite.config.ts 端口设成 3001 | P3 |
| 8 | 手测补全 | 用户自己跑 Agent chat 流程（场景 2-4）+ 真实 6s grok 视频生成（场景 6），补 4 张缺失截图 | — |

---

## 6. 元信息

- **本 change 修改的文件**: 6 个（2 后端 + 2 前端 + 2 测试）
- **新增代码行数**: ~250 行（含注释 + 测试）
- **测试增量**: pytest +6 / vitest +7
- **回归数**: 0
- **未跑的 spec 任务**: 8.3-8.5（Agent chat 流程）、9.2-9.4（真实生成）、10.1-10.2（自我反思）、11.1 截图归档（OPT-001 阻塞）
- **下次会话 onboarding 关键文件**: `@openspec/changes/agent-e2e-test-grok-luckin/tasks.md` 含完成度记号

