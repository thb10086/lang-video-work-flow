## ADDED Requirements

### Requirement: Canonical Parameter Schema Per Model
The system SHALL maintain a canonical ParamField schema for every registered AI model (video / image / audio) in the `ai_models` table, accessible to both frontend UI and backend adapters. The schema uses the existing `ParamField` type (`key`, `label`, `type`, `default?`, `min?`, `max?`, `step?`, `options?`, `required?`, `hidden?`) and SHALL be the single source of truth for what the model accepts.

#### Scenario: Query schema for a specific model
- **WHEN** a client calls `GET /api/models/{model_id}/params` for a registered model `doubao-seedance-2-0`
- **THEN** the response contains the full ParamField array including `duration`, `resolution`, `size`, `generate_audio`, `camera_fixed`, `return_last_frame`, `seed`, with their legal ranges and defaults

#### Scenario: Seedance-only flags hidden from other video models
- **WHEN** the UI requests the param schema for `veo3.1-fast`
- **THEN** the response MUST NOT include `generate_audio`, `camera_fixed`, `return_last_frame`, `size` (7-ratio variant); it MUST include `aspect_ratio` (16:9/9:16/1:1)

#### Scenario: Unknown model returns 404
- **WHEN** a client calls `GET /api/models/unknown-xyz/params`
- **THEN** the response is HTTP 404 with a structured error body

### Requirement: Schema Versioning and Cache Invalidation
The Model Param Registry SHALL include a `schema_version` integer per model, monotonically increasing when the schema changes. Redis caches SHALL key on `model_id + schema_version` so stale schemas never leak to clients.

#### Scenario: Schema upgrade invalidates client cache
- **WHEN** an admin updates `ai_models.param_schema` for `kling-v3` (increasing `schema_version` from 1 to 2)
- **THEN** the `/api/models` cache is invalidated and next client request receives the new schema within 1 second

### Requirement: Parameter Validation at Adapter Boundary
The backend generation adapters (`video_service.submit`, `image_service.generate`, audio equivalent) SHALL validate incoming `params` dict against the model's schema and reject requests with HTTP 422 listing unknown/invalid fields.

#### Scenario: Unknown field rejected
- **WHEN** a client submits a `generate/video` request with `model_id=veo3.1-fast` and `params={ "generate_audio": true }`
- **THEN** the backend returns HTTP 422 with body `{ "error": "unknown_param", "field": "generate_audio", "model": "veo3.1-fast" }`

#### Scenario: Out-of-range slider rejected
- **WHEN** a client submits `params={ "duration": 30 }` for a model whose schema caps `duration` at 15
- **THEN** the backend returns HTTP 422 with body `{ "error": "out_of_range", "field": "duration", "max": 15 }`

#### Scenario: Valid params pass through
- **WHEN** all submitted params match the schema
- **THEN** the request is forwarded to the provider adapter unchanged and returns the provider's task response
