# agent-multimodal-input Specification

## Purpose

让 Agent 在 round 0 就**真实看见**用户上传的图片 — 此前 `ChatMessage.images` 只流入消息 UI 和 `inject_user_images` 工具，第一次 LLM 调用收到的还是纯文本 prompt，让 Agent 必须靠用户文字猜意图。本能力把上传图作为 `image_url` content parts 嵌入 round 0 的 `messages[0].content` 数组（OpenAI 兼容格式），并在 system prompt 末尾追加一行"本轮上传 N 张图像；可用 `create_from_images` / `inject_user_images`" 提示。新工具 `create_from_images({ intent? })` 自动按 `classify_image` 的类别建对应节点（character → `characterGrid`、scene → `sceneGrid`、style_lock → `styleLock`、低置信度 → `imageEdit` fallback），单次调用最多 10 张；`inject_user_images` 新增 `autoDistribute: true` round-robin 模式，把 N 图均匀绑到 M 目标节点，避免每张图被复制到每个节点。无图查询路径完全保持向后兼容（`messages[0].content` 仍是字符串）。

## Requirements

### Requirement: Agent Receives Uploaded Images on Round 0

On the first Agent loop iteration, if the user message carries one or more images, the Agent's first LLM request SHALL include those images as OpenAI `image_url` content parts (or equivalent per-provider multimodal envelope).

#### Scenario: User uploads a single reference image with a text request

- **WHEN** the user sends `"帮我做一个赛博朋克短片"` plus one image
- **THEN** the first LLM request's `messages[0].content` is an array
  containing one `text` part and one `image_url` part whose `url` is the
  data-URI derived from the uploaded image

#### Scenario: User uploads three images

- **WHEN** the user uploads three images in a single message
- **THEN** the first LLM request has four content parts: one text + three
  `image_url`, in the same order as upload

#### Scenario: No images uploaded — backward compatible

- **WHEN** the user sends only text
- **THEN** `messages[0].content` is a plain string (not an array) —
  existing behaviour preserved

### Requirement: Agent Knows About Uploaded Images in System Prompt

The system prompt SHALL include a one-line notice when the current user message carries images, telling the Agent which tools are appropriate.

#### Scenario: Image-aware system prompt hint

- **WHEN** the user message carries N ≥ 1 images
- **THEN** `buildAgentSystemPrompt(..., { imageCount: N })` appends a line
  along the lines of `本轮用户上传了 N 张图像；可用 create_from_images
  建节点或 inject_user_images 绑定到已有节点。`

### Requirement: `create_from_images` Tool Creates Nodes from Images

A new Tier 2 tool `create_from_images` SHALL classify each uploaded image and create one node per image with the image pre-bound to the appropriate field.

#### Scenario: Mixed batch of character + scene refs

- **WHEN** the user uploads 2 character photos + 1 rooftop scene photo and
  the Agent calls `create_from_images({ intent: "mixed" })`
- **THEN** the tool creates 2 `characterGrid` nodes (each with
  `referenceImage` = the corresponding photo) and 1 `sceneGrid` node, and
  returns `{ createdNodeIds: string[3], classifications: [...] }`

#### Scenario: Explicit intent=style_lock

- **WHEN** the Agent calls `create_from_images({ intent: "style_lock" })`
  with 1 image
- **THEN** one `styleLock` node is created with `referenceImage` set and
  `status = 'idle'`

#### Scenario: Fallback to imageEdit on low confidence

- **WHEN** classification confidence for an image is < 0.5
- **THEN** the tool creates an `imageEdit` node with `inputImage` set and
  includes `"confidence too low, defaulted to imageEdit"` in the
  classification rationale for that image

#### Scenario: Hard cap of 10 images per call

- **WHEN** the Agent calls `create_from_images` with 15 images
- **THEN** the tool rejects the call with
  `success: false, message: ~/最多 10 张/`

### Requirement: `inject_user_images` Supports Round-Robin Auto-Distribute

The existing `inject_user_images` tool SHALL gain an optional `autoDistribute: true` parameter that spreads N images across M targets round-robin rather than dumping every image onto every target.

#### Scenario: 3 images across 6 shot nodes

- **WHEN** the Agent calls `inject_user_images({ autoDistribute: true,
  targets: [shot1..shot6], field: "referenceImages" })` with 3 images in
  chat history
- **THEN** shots 1 & 4 receive image[0], shots 2 & 5 receive image[1], and
  shots 3 & 6 receive image[2]

#### Scenario: Default behaviour preserved

- **WHEN** `autoDistribute` is absent or `false`
- **THEN** the tool behaves exactly like before (every target gets all
  selected images)
