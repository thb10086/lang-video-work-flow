## ADDED Requirements

### Requirement: Vision Verifier Adapter Registry

系统 SHALL 通过适配器注册表暴露 vision verify 能力，使调用方不绑死特定 provider。

Adapter 注册表 MUST 提供：

- `VisionVerifier` 接口：`{ id: string; verify(url, criteria): Promise<VerifyResult> }`
- `registerVerifier(v)` / `getActiveVerifier()` 两个 API
- `settings.visionVerifyModel` 字符串：用户可切换当前 active verifier
- 至少 1 个内置适配器（`gemini-vision`）

#### Scenario: 切换 settings.visionVerifyModel 即切换 active adapter

- **WHEN** `settings.visionVerifyModel = 'gemini-vision'` 且已注册 `gemini-vision` 和 `gpt5-vision` 两个适配器
- **WHEN** 调用 `getActiveVerifier()`
- **THEN** 返回 `gemini-vision` 适配器实例

#### Scenario: 未注册的 adapter 回退到默认

- **WHEN** `settings.visionVerifyModel = 'nonexistent-model'`
- **WHEN** 调用 `getActiveVerifier()`
- **THEN** 回退到第一个已注册的 adapter 并记录 warn 日志

#### Scenario: 注册新 adapter 不需修改既有代码

- **WHEN** 开发者新增文件 `claudeVisionAdapter.ts` 调用 `registerVerifier({ id: 'claude-vision', verify: ... })`
- **THEN** 该 adapter 立即可被选中，无需改动注册表源码

### Requirement: `verify_image_semantic` Agent Tool

系统 SHALL 提供名为 `verify_image_semantic` 的 Agent 工具，用于对生成的图片节点做语义校验。

工具参数 MUST 包含：

- `nodeId`：目标节点 ID（支持 imageGen / videoGen 的首帧 / imageEdit）
- `expectedSubjects?`：string[]，期望出现的主体（如 `['character Lin Xia', 'cyberpunk street']`）
- `expectedStyle?`：string，期望风格（如 `'anime, vibrant colors'`）
- `threshold?`：number，默认 70，低于此分即 `recommendation='retry'`

工具返回 `ToolCallResult`，`message` 中 MUST 结构化包含：

- `matchScore`：0-100
- `detectedSubjects`：string[]
- `missingElements`：string[]
- `unexpectedElements`：string[]
- `recommendation`：`'accept' | 'retry' | 'edit_prompt'`
- `reasoning`：简短中文解释（≤120 字符）

#### Scenario: 正常场景返回高分

- **WHEN** 调用 `verify_image_semantic({ nodeId: 'img_1', expectedSubjects: ['cat'] })`
- **WHEN** 节点的 outputImage 确实是一张猫的图
- **THEN** 返回 `matchScore ≥ 80`、`detectedSubjects` 含 `'cat'`、`recommendation='accept'`

#### Scenario: 错检测场景返回 retry 建议

- **WHEN** `expectedSubjects: ['cyberpunk street at night']` 但实际输出是"白天的田园风景"
- **THEN** `matchScore < threshold`、`missingElements` 含关键缺失项、`recommendation='retry'`

#### Scenario: 节点不存在返回错误

- **WHEN** `nodeId` 指向不存在的节点
- **THEN** `success: false`，`message` 中文说明节点找不到并列出可用节点列表 top 5

### Requirement: Backend Vision Verify Endpoint

后端 SHALL 提供 `POST /api/verify/image` 端点作为前端 adapter 的执行通道。

端点 MUST：

- 入参 `{ image_url, model, criteria: { subjects?, style?, threshold? } }`
- 校验 `model` 在已注册 vision 模型列表内，否则返回 422
- 调用对应 provider，统一返回上述 VerifyResult schema
- 对同一个 `(image_url, criteria)` 组合的请求缓存 300 秒（Redis）

#### Scenario: 合法请求返回 VerifyResult

- **WHEN** POST `/api/verify/image` 带合法 body
- **THEN** 返回 200 + VerifyResult JSON

#### Scenario: 非法 model 返回 422

- **WHEN** body 含 `model: 'fake-model-xyz'`
- **THEN** 返回 422，错误信息列出当前可用的 vision model id

#### Scenario: 相同请求 5 分钟内命中缓存

- **WHEN** 在 300 秒内重复请求相同 `{image_url, criteria}`
- **THEN** 第二次请求返回同样结果且响应时间 < 50ms（Redis 命中），provider 端无调用

### Requirement: `verify_task` Integration

`verify_task` 工具 SHALL 可选调用 `verify_image_semantic` 替换原第 4 维（"角色外貌一致性"字符串匹配）为语义匹配。

新行为 MUST：

- 通过参数 `useVisionVerify: boolean`（默认 `false`）显式开启
- 开启时对所有 `imageGen` 节点的 `outputImage` 做一次 vision verify
- 每个节点的 vision 结果权重计入总分第 4 维（仍为 20 pts）
- 失败或网络错误时 fallback 到原启发式打分，不阻塞 verify_task 返回

#### Scenario: useVisionVerify=true 触发 vision 调用

- **WHEN** `verify_task({ useVisionVerify: true })` 且画布有 3 个 imageGen 节点
- **THEN** `verify_image_semantic` 被调用 3 次，第 4 维得分基于 vision result

#### Scenario: Vision API 失败时 fallback

- **WHEN** vision endpoint 返回 500
- **THEN** `verify_task` 继续使用原字符串匹配打分，message 附加 `'[vision fallback]'` 标记

#### Scenario: 默认行为不变

- **WHEN** 调用 `verify_task()` 不传 `useVisionVerify`
- **THEN** 行为与升级前完全一致，第 4 维走原启发式逻辑
