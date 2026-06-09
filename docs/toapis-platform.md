# ToApis 平台接入手册

> **作用**：本文档是 ToApis (`https://toapis.com`) AI 网关在本项目中的接入参考与故障排查手册。  
> **时效**：2026-05 抓取自 toapis 官方文档 + 实测验证。  
> **维护**：toapis 价格/SKU 变更或本项目接入新模型时同步更新。

---

## 1. 平台概览

- **网关地址**：`https://toapis.com`
- **API 文档**：`https://docs.toapis.com`
- **协议**：OpenAI 兼容 + 任务异步模型
- **认证**：`Authorization: Bearer <API_KEY>`（项目当前 key 在 `server/.env` 的 `TOAPIS_API_KEY`）
- **任务类型**：
  - **同步**：`/v1/chat/completions`（LLM）
  - **异步任务**：图片 (`/v1/images/generations`) / 视频 (`/v1/videos/generations`)，提交返回 task_id，轮询查询结果

---

## 2. 视频模型清单（按价格排序）

| Model ID | 提供方 | 计费方式 | 价格 | 5s 成本 | 备注 |
|---|---|---|---|---|---|
| `wan2.6-flash` | Alibaba | 按秒 | **6 积分/s** | 30 | 最便宜兜底 |
| `kling-v2-6` | Kuaishou | 按秒 | 7.36 积分/s | 36.8 | 首尾帧优秀 |
| `minimax-hailuo-2-3` | MiniMax | 按秒 | 9.76 积分/s | 48.8 | 运动表现强 |
| `veo3.1-fast` | Google | **按次** | 16 积分/次 | 16 | 仅 8s 固定，超低成本按次 |
| `veo3.1-lite` | Google | 按次 | (更低) | <16 | 同 fast 但更轻 |
| `sora-2-vvip` ⭐ | OpenAI | **按次** | **30 积分/次** | 30 | **项目默认**，1080p/20s |
| `sora-2-official` | OpenAI | 按秒 | 16 积分/s | 80 | 官方原版，价高质优 |
| `doubao-seedance-2-0` | ByteDance | 按 token | 1057.14/1M | varies | 多帧参考一致性最佳 |
| `doubao-seedance-2-0-fast` | ByteDance | 按 token | 1057.14/1M | varies | 快速版 |

❌ **已禁用**：`veo3.1-quality`（用户决策，价格太高，由 `veo3.1-lite` 替代）

⚠️ **已废弃**：`sora-2-vip` → `sora-2-vvip`，`kling-v3` → `kling-v2-6`

### 模型选型建议

- **默认/主力**：`sora-2-vvip` — 30 积分/次，画质佳，按次计费可控
- **海量迭代**：`wan2.6-flash` — 30 积分/5s，Agent 大量草图阶段优先
- **关键镜头**：`sora-2-official` — 80 积分/5s，最终版本/重要镜头
- **首尾帧驱动**：`kling-v2-6`（首+末两张参考图）
- **动态镜头**：`minimax-hailuo-2-3`（人物动作表现力强）
- **多帧角色一致性**：`doubao-seedance-2-0`（最多 4 张参考图）

---

## 3. 图片模型清单

| Model ID | 提供方 | 备注 |
|---|---|---|
| `gpt-image-2` ⭐ | OpenAI | 项目默认，质量最稳 |
| `gemini-3.1-flash-image-preview` | Google | 快速迭代用 |
| `gemini-3-pro-image-preview` | Google | 最终质量版 |

价格参考请直接看 toapis 模型解析页（变动频繁，本文档不作权威源）。

---

## 4. LLM 模型清单（项目接入）

通过 `yunwu-llm` 渠道（OpenAI 兼容）调用，不直接走 toapis：

- `gpt-5.4` / `gpt-4o`
- `claude-opus-4-7` ⭐ / `claude-sonnet-4-20250514`
- `gemini-3.1-pro-preview`

---

## 5. 视频生成 API 详细参数

### 5.1 通用提交格式（OpenAI 兼容扁平结构）

**Endpoint**: `POST https://toapis.com/v1/videos/generations`

```json
{
  "model": "sora-2-vvip",
  "prompt": "镜头描述 + 风格 + 节奏...",
  "duration": 10,
  "aspect_ratio": "16:9",
  "resolution": "720p",
  "image_urls": ["https://files.toapis.com/...png"],
  "input_reference": "https://files.toapis.com/...png",
  "seed": 42,
  "client_business_id": "可选业务幂等 ID"
}
```

**返回**：

```json
{ "id": "tsk_vid_01KR01HXP6H6MQBSVNGPJFYKY6", "object": "generation.task", "status": "queued", "progress": 0 }
```

### 5.2 模型专属参数（关键差异）

| Model | duration | aspect_ratio | resolution | i2v 字段 | 特有字段 |
|---|---|---|---|---|---|
| `sora-2-vvip` | **仅 12s**（实测 svip 分组定价规则；4/5/6/8/10/15/16/20 全部 503） | 16:9 / 9:16 | 720p / 1080p | `input_reference` | `style` (anime/comic/news/selfie/nostalgic), `watermark`, `seed` |
| `sora-2-official` | 2-15s | 16:9 / 9:16 | 720p / 1080p | `input_reference` | `seed`, `watermark` |
| `veo3.1-fast` | **8s 固定** | 16:9 / 9:16 | 720p / 1080p / 4k | `image_urls[]` (max 2) | `image_mode` (frame/reference) |
| `veo3.1-lite` | 8s 固定 | 16:9 / 9:16 | 720p / 1080p | `image_urls[]` (max 2) | `image_mode` |
| `kling-v2-6` | 5/10s | 16:9 / 9:16 / 1:1 | (mode 控制) | `image_urls[]` (首+末) | `mode` (std/pro), `negative_prompt`, `audio` |
| `wan2.6-flash` | 5/8s | 16:9 / 9:16 / 1:1 | 480p / 720p / 1080p | `image` (单图) | `negative_prompt` |
| `minimax-hailuo-2-3` | 6/10s | 16:9 / 9:16 | 768p / 1080p | `first_frame` | — |
| `doubao-seedance-2-0` | 4/5/8/10/12/15s | 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9 / adaptive | 480p / 720p | `image_urls[]` (多张) | `generate_audio`, `camera_fixed`, `return_last_frame`, `seed` |

### 5.3 ⚠️ Sora i2v 关键约束

**input_reference 图片尺寸必须与 `resolution × aspect_ratio` 严格匹配**，否则 toapis 返回 400：

```
"Inpaint image must match the requested width and height"
```

| resolution | 16:9 | 9:16 |
|---|---|---|
| 720p | 1280×720 | 720×1280 |
| 1080p | 1920×1080 | 1080×1920 |

**项目处理方案**（`ToApisAdapter._do_submit_video`）：当 `images[]` 有 URL 时自动填入 `input_reference`，让用户/Agent 不必手动管理这个字段。但**图片尺寸生成必须与目标视频匹配** — Agent 生成 keyframe 时应主动指定 `aspectRatio` 和 `imageSize`。

### 5.4 任务状态轮询

**Endpoint**: `GET /v1/videos/generations/{task_id}?language=zh`

**Status 枚举**：

- `queued` → `in_progress` → `completed` / `failed`

**轮询策略建议**（toapis 官方）：

- 初始等待 5s
- 轮询间隔 10s
- 最大等待 600s（10min）
- 典型耗时 1-5min

**项目实现**：`server/app/services/adapters/toapis_adapter.py::query_task` 兼容两种返回结构（toapis 标准 + APIMart 历史包装）。

---

## 6. 图片生成 API

### 6.1 提交（同步包装）

```json
POST /v1/images/generations
{
  "model": "gpt-image-2",
  "prompt": "...",
  "n": 1,
  "size": "1024x1024",      // 或 "1:1" / "16:9" 比例形式
  "reference_images": ["https://..."],   // URL 数组
  "metadata": { "resolution": "2k", "quality": "high" },
  "response_format": "url"
}
```

### 6.2 ⚠️ size 字段约束

- **gpt-image-2**：接受 `1024x1024` / `1792x1024` / `1024x1792`
- **gemini-3.1-flash-image-preview**：通过 `metadata.imageSize` 传 `1k/2k/4k` + `aspectRatio`
- **生成 sora i2v 用图时**：必须显式给 `size: "1280x720"` 或类似值匹配目标视频

---

## 7. 错误码

| HTTP | code | 含义 | 处理 |
|---|---|---|---|
| 400 | `invalid_request_error` | 字段缺失/类型错 | 校验 prompt/duration/aspect_ratio，特别注意 i2v 尺寸 |
| 400 | `Inpaint image must match...` | i2v 图片尺寸不匹配 | 重新生成尺寸严格匹配的图 |
| 401 | `authentication_error` | API Key 无效或缺失 | 确认 .env 的 `TOAPIS_API_KEY` |
| 429 | `rate_limit_exceeded` | 限流/配额命中 | 指数退避 1s/2s/4s + 抖动 |
| 500 | `internal_error` | 上游瞬时异常 | 短间隔重试 2-3 次 |
| 503 | `model_not_found: pricing rule match failed` | **账户分组下未启用该模型 SKU** | toapis 控制台开通模型分组 |

### 503 model_not_found 的关键解读

**这不是模型不存在**，而是**用户账户的"分组"配置里**没有该模型的定价规则。解决：

1. 登录 `https://toapis.com/dashboard`
2. 进入 **账户设置 → 模型分组 / 计费分组**
3. 把目标模型加入当前分组的可用列表
4. 或更换 API Key（不同 key 可能属于不同分组）

---

## 8. 项目接入实现要点

### 8.1 适配器位置

- `server/app/services/adapters/toapis_adapter.py`：提交/轮询/字段映射

### 8.2 字段映射机制（已实现）

`_do_submit_video` 接受多种字段命名形式（兼容前端策略层）：

- **snake_case 直传白名单**：`duration` / `aspect_ratio` / `resolution` / `size` / `image_mode` / `watermark` / `style` / `storyboard` / `private` / `negative_prompt` / `audio` / `mode` / `camera_fixed` / `return_last_frame` / `generate_audio` / `character_url` / `character_timestamps` / `input_reference` / `image` / `first_frame` / `last_frame`
- **camelCase 自动转 snake_case**：`characterUrl` → `character_url`，`firstFrame` → `first_frame`，`aspectRatio` → `aspect_ratio` 等
- **images[] 自动填充 input_reference**：当 `images[]` 有 URL 但没有显式 `input_reference` 时，自动用 `images[0]`

### 8.3 前端模型策略适配

`src/providers/modelReferenceAdapter.ts` 按模型类型分发参考图字段：

- `seedancStrategy`：多张 → `images[]`
- `veoStrategy`：max 2 → `images[]` + `image_mode`
- `soraStrategy`：1 张主图 + character_url → `images[0]` + `characterUrl`
- `klingStrategy`：首末 2 帧 → `images[]`
- `wanStrategy` (新)：单张 → `image`
- `hailuoStrategy` (新)：单张 → `first_frame`

`detectVideoStrategy` 用 `includes` 而非 `startsWith`，让 `kling-v2-6`/`minimax-hailuo-2-3` 这种命名也能正确路由。

### 8.4 修改默认模型 Checklist

修改 `DEFAULT_VIDEO_MODEL` 时同步：

1. `server/.env` 的 `DEFAULT_VIDEO_MODEL=xxx`
2. `src/providers/modelDefaults.ts` 的 `DEFAULT_VIDEO_MODEL`
3. `src/providers/modelDefaults.ts` 的 `KNOWN_VIDEO_MODELS` 数组
4. `server/app/db/seed.py` 的 `MODELS_SEED` 加条目 + `MAPPINGS_SEED` 加 channel 映射
5. `src/store/settingsStore.ts` 的 `version` 递增 + 加 migrate 步骤
6. 重启后端 + 跑 `python -m app.db.seed`

---

## 9. 常用 PowerShell 调试命令

### 提交视频任务

```powershell
$h = @{ Authorization = 'Bearer sk-xxx'; 'Content-Type' = 'application/json' }
$body = '{"model":"sora-2-vvip","prompt":"test","duration":10,"aspect_ratio":"16:9","resolution":"720p"}'
Invoke-WebRequest -Uri 'https://toapis.com/v1/videos/generations' -Method Post -Headers $h -Body $body
```

### 查询任务

```powershell
Invoke-WebRequest -Uri "https://toapis.com/v1/videos/generations/$tid?language=zh" -Headers $h
```

### 列出 LLM 模型

```powershell
(Invoke-WebRequest -Uri 'https://toapis.com/v1/models' -Headers $h).Content | ConvertFrom-Json | % { $_.data.id }
```

注：`/v1/models` 仅返回 LLM 列表，**视频/图片模型不在此返回**。视频/图片模型清单查 `https://toapis.com/market`。

---

## 10. 已知问题与风险

1. **toapis 文档不全**：模型解析页只列概念性参数（mode / duration），没有完整字段表。**真实参数以实测 + AIMLAPI 镜像文档（`https://docs.aimlapi.com`）为准**。
2. **价格变动**：toapis 定价页可能调价。每季度回访 `https://toapis.com/pricing` 校准。
3. **账户分组限制**：高级模型（如 sora-2-vvip）需在 toapis 控制台手动开通，开通前会 503。
4. **i2v 尺寸约束**：sora 系列严格校验 input_reference 尺寸；其他模型相对宽容。
5. **任务返回 URL 有效期**：toapis 返回的视频/图片 URL 有效期未明文标注，建议**生成后立即转存 COS**（项目 `image_service.py` 已实现自动转存逻辑）。

---

## 11. 参考资源

- ToApis 官网：`https://toapis.com`
- ToApis 文档：`https://docs.toapis.com`
- ToApis 模型广场：`https://toapis.com/market`
- ToApis 定价页：`https://toapis.com/pricing`
- ToApis 任务日志：`https://toapis.com/dashboard/tasks`
- AIMLAPI Sora 镜像文档（参数最详细）：`https://docs.aimlapi.com/api-references/video-models/openai/sora-2-i2v`
- OpenAI Sora 官方文档：`https://developers.openai.com/api/docs/guides/video-generation`
