# model-reference-adapter Specification

## Purpose

把 asset 引用 payload（`{ appearance, reference_images[], character_urls[], timestamps }`）翻译成各视频/图像模型的实际字段 — 一个 resolver 收敛 4 家 video provider 的差异：Seedance 用原生 `reference_images[]`、VEO 用 `image_mode='reference'` + 第一帧/最后一帧槽位、Sora 用 `characterUrl` + `characterTimestamps`、Kling 没有原生 reference_images 字段降级到 `first_frame` / `last_frame`（>2 张 drop + debug log）。图像模型同理：Gemini 接受 `reference_images[]`，Seedream 用 `style_refs[]`，无 reference 字段的模型返回 `{}` + warn。Adapter 在执行流水里**位置在 `sanitizeForExecute` 之前** — 注入字段一律走 sanitizer 校验，adapter 自己不短路 schema 检查（adapter 加 `reference_images` 但模型 schema 只有 `first_frame`，最终被 sanitizer drop + debug log）。Agent 工具 `create_video_node` / `create_image_node` / `execute_node` / `retry_node` 接受可选 `assetRefs: string[]`，在 execute 时调用 adapter 把节点 submission 转成对应模型的 shape。本能力是 `asset-library` + `at-reference-system` + `model-param-registry` 三者的桥梁。

## Requirements

### Requirement: Capability-Aware Reference Injection
The system SHALL provide a module that, given a `model_id` and a resolved asset-reference payload `{ appearance, reference_images[], character_urls[], timestamps }`, produces the correct model-specific fields to merge into the submission params. The module covers ALL registered video models (not just Seedance).

Cross-capability dependency: depends on `asset-library`, `at-reference-system`, and `model-param-registry`.

#### Scenario: Seedance native reference
- **GIVEN** `model_id = doubao-seedance-2-0` and payload contains 2 reference_images
- **WHEN** the adapter is called
- **THEN** the output merges into params as `{ reference_images: [img1, img2] }` (native field name), without touching `first_frame`

#### Scenario: VEO image_mode switch
- **GIVEN** `model_id = veo3.1-fast` and payload contains 1 reference image
- **WHEN** the adapter is called and the model's schema declares `image_mode: 'reference' | 'frame'`
- **THEN** the output sets `image_mode: 'reference'` and routes the single image into the first-frame slot; a second image (if any) goes into last-frame

#### Scenario: Sora Character API routing
- **GIVEN** `model_id = sora-2-vip` and payload has `character_urls: ["https://sora/.../c1"]`
- **WHEN** the adapter is called
- **THEN** the output sets `characterUrl: "..."` and `characterTimestamps: "1,3"` (default window), NOT `reference_images`

#### Scenario: Kling first-frame fallback
- **GIVEN** `model_id = kling-v3` (no native `reference_images` field)
- **WHEN** the adapter is called with 1 reference image
- **THEN** the output sets `first_frame: img1`; if there is also a second image it sets `last_frame: img2`; extra images beyond 2 are dropped with a debug log

### Requirement: Image-Generation Model Pass-Through
For image-capability models that support reference images (e.g. Gemini with `reference_images` list, Seedream with `style_refs`), the adapter SHALL respect the model's declared `param_schema`: only set fields that exist in the schema for the chosen model.

#### Scenario: Gemini image accepts reference_images
- **GIVEN** `model_id = gemini-3.1-flash-image-preview` (image capability) and payload has 3 images
- **WHEN** the adapter is invoked
- **THEN** the output contains `reference_images: [img1, img2, img3]`

#### Scenario: Unknown image model with no reference schema
- **GIVEN** a hypothetical model whose `param_schema` declares no image-accepting field
- **WHEN** the adapter is invoked with references
- **THEN** the output is `{}` (no fields added), a warning is logged, and execution proceeds without references

### Requirement: Integration with Existing Sanitizer and Validator
The injection adapter SHALL run BEFORE `sanitizeForExecute` (from multi-model-param-adaptation) so that injected fields are validated against the schema. Any field the adapter adds but the model does not declare MUST be dropped by the sanitizer — the adapter never short-circuits validation.

#### Scenario: Adapter field dropped if sanitizer rejects
- **GIVEN** the adapter sets `reference_images` for a model whose schema declares only `first_frame`
- **WHEN** the sanitizer runs next
- **THEN** `reference_images` is dropped and a debug log is emitted; the request proceeds with `first_frame` only (if set)

### Requirement: Agent Tool Integration
The Agent tools `create_video_node`, `create_image_node`, `execute_node`, and `retry_node` SHALL accept an optional `assetRefs: string[]` parameter. When present, the tool handler SHALL invoke the reference adapter during execute-time so the resulting node submission already carries the correct model-specific fields.

#### Scenario: Agent uses asset refs
- **GIVEN** the Agent calls `create_video_node({ prompt: "@char_sarah walks into @scene_cafe", assetRefs: ["char_sarah", "scene_cafe"], model: "doubao-seedance-2-0" })`
- **THEN** the resulting node has `assetRefs` saved in `node.data`; on execute, the adapter expands the prompt, attaches `reference_images`, and the backend receives the Seedance-shaped payload
