## ADDED Requirements

### Requirement: Three Asset Kinds with Common Envelope
The system SHALL persist three kinds of assets — `character`, `scene`, `style` — each sharing a common envelope `{ id, kind, name, name_en, description, variations[], reference_images[], metadata, created_at, updated_at }` and kind-specific fields (e.g. `character.appearance`, `scene.environment`, `style.guide`).

#### Scenario: Create a character asset
- **WHEN** a client POSTs `{ kind: "character", name: "Sarah", name_en: "Sarah", appearance: "red hair, trench coat, tall", reference_images: ["https://cos/.../s1.png"] }` to `/api/assets`
- **THEN** the response is HTTP 201 with the persisted asset containing a generated id (prefix `char_`), `variations: []`, `metadata: {}`

#### Scenario: List assets with search and kind filter
- **WHEN** a client GETs `/api/assets?kind=character&q=sarah&limit=20`
- **THEN** the response contains all character assets whose `name`, `name_en`, or `description` case-insensitively contains "sarah", paginated by limit

#### Scenario: Asset update bumps version
- **WHEN** a client PATCHes an asset's `appearance` or `reference_images`
- **THEN** the response reflects the change and `appearance_version` (integer) is incremented by 1

### Requirement: Variations as First-Class Children
An asset SHALL be able to carry zero or more `variations`, each with `{ id, label, appearance_delta, reference_images }`. Variations share the parent's base identity but allow clothing/mood/lighting deltas. A variation is addressable as `{parentId}:{variationId}` (e.g. `char_sarah:formal`).

#### Scenario: Add a variation
- **WHEN** a client POSTs to `/api/assets/char_sarah/variations` with `{ label: "formal", appearance_delta: "black evening gown" }`
- **THEN** the parent asset's `variations` array contains a new entry with a generated id like `var_001`; the parent's own `appearance` is unchanged

#### Scenario: Resolve full appearance for a variation
- **WHEN** a client GETs `/api/assets/char_sarah/resolve?variation=var_001`
- **THEN** the response contains `{ appearance: "<base appearance>, <delta>", reference_images: [<merged>] }` where reference images prioritize the variation's images, falling back to parent's

### Requirement: Soft Delete and Scope
Assets SHALL support soft delete (`deleted_at`) and an optional `project_id` scope — assets with null project_id are global (visible across projects for that user), assets with a project_id are pinned to that project only.

#### Scenario: Global asset visible across projects
- **GIVEN** a user creates a character asset with `project_id: null`
- **WHEN** they switch to a different project
- **THEN** `/api/assets?kind=character` still returns that asset

#### Scenario: Soft-deleted asset hidden but recoverable
- **WHEN** a client DELETEs an asset
- **THEN** subsequent `GET /api/assets` does not include it; a dedicated `GET /api/assets/trash` lists soft-deleted assets within 30 days for recovery
