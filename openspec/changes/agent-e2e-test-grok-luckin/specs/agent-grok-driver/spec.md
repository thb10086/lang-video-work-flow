## ADDED Requirements

### Requirement: Grok-Video-3 模型在 ai_models 表注册并对前端可发现
系统 SHALL 将 `grok-video-3` 作为 capability=video 的模型注册到 ai_models 表，前端通过 `/api/models?capability=video` 与 `useBackendModels` Hook 自动获取，不需要前端硬编码。

#### Scenario: seed 后前端模型下拉显示 grok-video-3
- **WHEN** 后端执行 `python -m app.db.seed` 完成
- **AND** 前端刷新页面打开任意 VideoGenNode
- **THEN** 模型下拉列表中存在「Grok Video 3」选项，model_id 为 `grok-video-3`

#### Scenario: 选中 grok-video-3 后参数面板渲染正确
- **WHEN** 用户在 VideoGenNode 把 model 切换为 `grok-video-3`
- **THEN** 参数面板渲染 2 个字段：`seconds` (select, 默认 "10")、`aspect_ratio` (select, 默认 "16:9")
- **AND** `seconds` 选项是字符串值 `["6","10","15","20","25","30"]`，不是 number
- **AND** `aspect_ratio` 选项包含 `["16:9","9:16","3:2","2:3","1:1"]`

#### Scenario: 切换模型时无关字段被 sanitize 清掉
- **WHEN** 节点先选 `sora-2-vvip`（含 duration / generate_audio / resolution 字段），用户在 UI 真实切换为 `grok-video-3`
- **THEN** `data.seconds` / `data.aspect_ratio` 出现并取默认值
- **AND** `data.duration` / `data.generate_audio` / `data.resolution` 被清除（不在 grok schema 里）
- **AND** `data.prompt` / `data.images` / `data.firstFrame` / `data.characterUrl`（reserved 字段）保留不变

### Requirement: toapis_adapter 适配 Grok 字段命名差异
系统 SHALL 在 `toapis_adapter._do_submit_video` 提交体里同时写入 grok 期望的字段名（`seconds` / `images`）与现有模型期望的字段名（`duration` / `image_urls`），保证多模型字段名兼容性。

#### Scenario: seconds 字段透传不破坏现有 duration
- **WHEN** 上层调用 `submit_task("grok-video-3", {"seconds": "10", "prompt": "xx", "aspect_ratio": "16:9"})`
- **THEN** 实际发往 toapis 的 body 含 `"seconds": "10"`
- **WHEN** 上层调用 `submit_task("doubao-seedance-2-0", {"duration": 10, "prompt": "xx"})`
- **THEN** 实际发往 toapis 的 body 含 `"duration": 10`，不含 `"seconds"`（不传就不写）

#### Scenario: 参考图同时双写 images 与 image_urls
- **WHEN** 上层调用 `submit_task("grok-video-3", {"images": ["https://cos/img1.png", "https://cos/img2.png"]})`
- **THEN** 实际发往 toapis 的 body 同时含 `"images": [...]` 与 `"image_urls": [...]`，二者值相同

#### Scenario: 参考图必须是 https URL（与 grok 限制一致）
- **WHEN** images 数组里混杂 `data:image/png;base64,xxx`
- **THEN** adapter 在提交前先调用 `media_url_normalizer.normalize_image_list` 转成 https URL（已有逻辑，本 spec 不改写）
- **AND** 若超过 3 张，截断保留前 3 张（grok 文档上限）

### Requirement: VideoGenNode 与 generate_workflow 支持 grok-video-3 作为 model 参数
系统 SHALL 允许 Agent 通过 `create_video_node` / `update_node` / `generate_workflow` 工具传入 `model="grok-video-3"`，工具 schema 的 enum 包含此值，且参数注入路径与 sora / seedance 等价。

#### Scenario: generate_workflow 一次创建带 grok-video-3 的工作流
- **WHEN** Agent 调用 `generate_workflow({...videoModel: "grok-video-3"})`
- **THEN** 所有创建的 videoGen 节点 `data.model === "grok-video-3"`
- **AND** 节点 `data.seconds` 取 schema 默认 "10"，`data.aspect_ratio` 取 "16:9"
- **AND** 节点 `data.prompt` 是 i2v 友好自然语言（无方括号，含 Camera/Action/Keep/Avoid 段）

#### Scenario: modelReferenceAdapter 把多端口图汇集到 images 数组
- **WHEN** VideoGenNode 模型为 grok-video-3，且节点同时连接了 first-frame 端口（产品图）+ ref-in 端口（角色图）+ style-in 端口（风格图）
- **THEN** 提交体的 `images` 字段为长度 ≤ 3 的 URL 数组，**优先级**：firstFrame → characterRefs → styleRefs（截断保留前 3）
- **AND** 不保留各端口的独立字段（不再写 `firstFrame` / `characterUrl` 等），避免 toapis 网关把它们误送给非 grok 模型

#### Scenario: 切换为 grok 后 update_node 不破坏现有 prompt
- **WHEN** 已存在的 videoGen 节点 prompt = "Camera: dolly in. Action: ..." 且 model = "sora-2-vvip"
- **AND** Agent 调用 `update_node({nodeId, model: "grok-video-3"})`
- **THEN** 节点 `data.prompt` 保留原 i2v 自然语言文本，仅 model + 参数 schema 字段被替换为 grok 默认
