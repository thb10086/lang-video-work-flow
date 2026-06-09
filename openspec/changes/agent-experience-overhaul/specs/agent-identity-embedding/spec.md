## ADDED Requirements

### Requirement: Asset Schema Includes Identity Embedding Field

The Asset record (characters / scenes / styles) in the backend SHALL include an optional `identity_embedding` JSON field with the shape:

```typescript
interface IdentityEmbedding {
  vector_id: string         // opaque ID referring to provider-specific vector
  provider: 'sora_character' | 'ip_adapter' | 'face_id' | 'manual'
  created_at: string         // ISO 8601
  metadata?: Record<string, unknown>
}
```

This field is **metadata only** in this change — no real vector storage. The schema MUST exist so future visual-consistency changes can populate it without DB migration.

#### Scenario: Asset CRUD preserves the field

- **WHEN** the user creates a character via `asset.create(...)` and the field is omitted
- **THEN** `identity_embedding = null`; subsequent `asset.update({ identity_embedding: {...} })` correctly persists the value

#### Scenario: Field is optional and nullable

- **WHEN** an asset has no identity embedding
- **THEN** the asset is still fully usable in workflows; reference routing falls back to `reference_images`

### Requirement: IdentityRouter Routes Reference Payload Per Model

The backend SHALL implement `IdentityRouter` (in `server/app/services/identity_router.py`) that, given a target video model and an asset (or list of assets), returns the model-specific reference payload using a single dispatch table:

| Model family | Primary channel | Inputs consumed | Fallback |
|--------------|-----------------|-----------------|----------|
| `seedance.*` | `reference_images: string[]` | up to 3 reference image URLs | as-is |
| `veo.*` | `image_mode='reference'` + 1-2 images | first 1-2 reference URLs | first-frame mode |
| `sora.*` | `characterUrl` + `characterTimestamps` | identity_embedding(provider='sora_character') | drop refs (Sora does not use raw images) |
| `kling.*` | first-frame only | first reference URL | drop multi-refs |
| unknown | empty | — | first-frame fallback |

When `identity_embedding.vector_id` is present and the provider matches the target model family, the router MUST use it in preference to raw reference images.

#### Scenario: Seedance accepts multi-ref

- **WHEN** an asset has 3 reference images and target is `doubao-seedance-2-0`
- **THEN** the resulting payload contains `reference_images: [url1, url2, url3]`

#### Scenario: Sora uses character API when identity_embedding present

- **WHEN** an asset has `identity_embedding = { provider: 'sora_character', vector_id: 'char_abc' }` and target is `sora-2-vip`
- **THEN** the payload uses `characterUrl: 'char_abc'` (Sora's character ID) and ignores raw reference images

#### Scenario: Kling drops extra refs gracefully

- **WHEN** an asset has 3 reference images and target is `kling-v3`
- **THEN** the payload contains only the first as `first_frame_image`; the result includes `dropped_refs: 2` for log/audit

#### Scenario: Unknown model falls back

- **WHEN** target is a future model `xyz-1` not in the dispatch table
- **THEN** the router returns `{ first_frame: url1 }` and logs `identity_router.unknown_model: xyz-1`

### Requirement: VideoGen Submission Uses IdentityRouter

The backend video submission service (currently in `server/app/services/video_service.py` or equivalent) SHALL invoke `IdentityRouter.route(model, assets)` to compute the reference payload, instead of inlining model-specific branching.

This consolidation MUST eliminate the per-model `if model.startswith('seedance')` / `elif veo` chains scattered across the submission code.

#### Scenario: Code search finds zero ad-hoc model checks

- **WHEN** scanning `server/app/services/video_service.py` after this change
- **THEN** there are no string comparisons like `if model.startswith('seedance')` or `if 'sora' in model`; all branching lives inside `IdentityRouter`

#### Scenario: Adding a new model only requires registry change

- **WHEN** registering a hypothetical new model `wan-1.0` with reference channel `image_refs[]`
- **THEN** the only code change required is adding an entry to `IdentityRouter.dispatch_table` plus a unit test; no other files touched

### Requirement: Frontend Asset Detail Modal Shows Identity Status

The `AssetDetailModal` (existing) SHALL display an "Identity Embedding" section showing:

- "Not yet embedded" if `identity_embedding` is null (with greyed-out future button "Generate embedding…")
- The provider name + creation date if present
- A "Refresh" action (no-op in this change; placeholder)

#### Scenario: Empty state shown for new asset

- **WHEN** the user opens detail for a freshly created character
- **THEN** the Identity Embedding section reads "尚未生成" with a disabled button labeled "生成 (即将推出)"

#### Scenario: Provider info shown for embedded asset

- **WHEN** the asset has `identity_embedding = { provider: 'sora_character', vector_id: 'char_xyz', created_at: '2026-04-28T...' }`
- **THEN** the section shows "Provider: sora_character · Generated: 2026-04-28"
