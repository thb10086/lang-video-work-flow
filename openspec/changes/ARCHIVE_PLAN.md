# Archive Audit Trail (Executed)

> All 5 ready-to-archive changes were synced into `openspec/specs/`
> and moved to `openspec/changes/archive/` between 2026-05-09 and
> 2026-05-10. This file kept the manual sync → mv steps used in lieu
> of a missing `openspec` CLI binary. Pre-execution it served as a
> plan; post-execution it serves as the audit trail. The `mv`
> commands at the bottom were run by the maintainer with explicit
> approval (see `run_command` invocation history).

---

## Synced and Archived

| Change | Capabilities synced | Sync date | Archive path |
|--------|--------------------|-----------|--------------|
| `multi-model-param-adaptation` | `model-param-registry` (NEW) · `agent-tool-schemas` (NEW) · `video-generation-node` (NEW) | 2026-05-09 | `archive/2026-05-09-multi-model-param-adaptation/` |
| `agent-pro-upgrade` | `agent-memory-management` (NEW) · `agent-multimodal-input` (NEW) · `agent-phase-state` (NEW) | 2026-05-09 | `archive/2026-05-09-agent-pro-upgrade/` |
| `character-asset-library` | `asset-library` (NEW) · `at-reference-system` (NEW) · `libtv-asset-panel` (NEW) · `model-reference-adapter` (NEW) · `video-generation-node` (+2 reqs) | 2026-05-10 | `archive/2026-05-10-character-asset-library/` |
| `node-functional-parity-cleanup` | `workflow-generation` (NEW) · `agent-tool-schemas` (+3 reqs) · `video-generation-node` (+2 reqs) | 2026-05-10 | `archive/2026-05-10-node-functional-parity-cleanup/` |
| `workflow-builder-wiring-fixes` | `agent-tool-tiering` (NEW) · `agent-tool-schemas` (+4 reqs) · `workflow-generation` (+5 reqs) | 2026-05-10 | `archive/2026-05-10-workflow-builder-wiring-fixes/` |

**Net effect:** `openspec/specs/` 4 → 16 (+300 %); `openspec/changes/archive/` 1 → 6;
active changes 7 → 1 (only `agent-experience-overhaul`, in design).

---

## Original Per-Change Sync Routes (kept for posterity)

### 1. `character-asset-library` (5 capability deltas)

**Delta specs to merge into `openspec/specs/`:**

| Delta path | Target main spec | Conflict? |
|------------|------------------|-----------|
| `character-asset-library/specs/asset-library/spec.md` | `openspec/specs/asset-library/spec.md` (NEW) | No |
| `character-asset-library/specs/at-reference-system/spec.md` | `openspec/specs/at-reference-system/spec.md` (NEW) | No |
| `character-asset-library/specs/libtv-asset-panel/spec.md` | `openspec/specs/libtv-asset-panel/spec.md` (NEW) | No |
| `character-asset-library/specs/model-reference-adapter/spec.md` | `openspec/specs/model-reference-adapter/spec.md` (NEW) | No |
| `character-asset-library/specs/video-generation-node/spec.md` | `openspec/specs/video-generation-node/spec.md` | **YES — already synced from `multi-model-param-adaptation`** |

**Conflict resolution for `video-generation-node`:**
The delta from `character-asset-library` likely adds a "shows asset tag
chip row showing referenced assets" requirement. After reading the
existing `video-generation-node/spec.md` and the delta, `## ADDED
Requirements` from the delta should be appended below the existing
Requirements section (no rename, no modify of existing scenarios).

**Estimated effort:** 4 file copies (1:1 from delta) + 1 manual append
≈ 15 min.

---

### 2. `node-functional-parity-cleanup` (3 capability deltas)

**Delta specs to merge:**

| Delta path | Target main spec | Conflict? |
|------------|------------------|-----------|
| `node-functional-parity-cleanup/specs/agent-tool-schemas/spec.md` | `openspec/specs/agent-tool-schemas/spec.md` | **YES — already synced** |
| `node-functional-parity-cleanup/specs/video-generation-node/spec.md` | `openspec/specs/video-generation-node/spec.md` | **YES — already synced** |
| `node-functional-parity-cleanup/specs/workflow-generation/spec.md` | `openspec/specs/workflow-generation/spec.md` (NEW) | No |

**Conflict resolution:**
This change is mostly BREAKING — `imageEdit.editPrompt` rename, `imageCrop`
removal, two new `create_*_node` Agent tools. The deltas likely contain
`## REMOVED Requirements` and `## ADDED Requirements` blocks for the
two conflicting capabilities. Process:

1. For `agent-tool-schemas/spec.md`:
   - Append the new `### Requirement: create_character_extract_node` and
     `### Requirement: create_character_manager_node` from the delta's
     ADDED block.
   - If REMOVED block lists `### Requirement: ImageCrop Schema` (or
     similar), delete that requirement from the main spec.
2. For `video-generation-node/spec.md`:
   - Apply the `editPrompt → editInstruction` rename to whichever
     requirement currently mentions `editPrompt` (none today — the
     existing 4 requirements don't reference imageEdit, so this is
     likely a no-op for this main spec).
3. For `workflow-generation`: copy delta as a new main spec.

**Estimated effort:** 1 file copy + 2 manual merges ≈ 25 min.

---

### 3. `workflow-builder-wiring-fixes` (3 capability deltas)

**Delta specs to merge:**

| Delta path | Target main spec | Conflict? |
|------------|------------------|-----------|
| `workflow-builder-wiring-fixes/specs/agent-tool-schemas/spec.md` | `openspec/specs/agent-tool-schemas/spec.md` | **YES — already synced** |
| `workflow-builder-wiring-fixes/specs/agent-tool-tiering/spec.md` | `openspec/specs/agent-tool-tiering/spec.md` (NEW) | No |
| `workflow-builder-wiring-fixes/specs/workflow-generation/spec.md` | `openspec/specs/workflow-generation/spec.md` | **YES if `node-functional-parity-cleanup` was synced first** |

**Conflict resolution:**
This change adds the Tier-aware tool disclosure capability — the new
`agent-tool-tiering` spec is a clean ADDED. The two conflicting
capabilities each pick up a couple of new Requirements:

1. `agent-tool-schemas`: append `### Requirement: discover_tools` and
   the `tier` parameter for `getAgentTools` to the existing main spec.
2. `workflow-generation`: append the wiring-fix scenarios (sceneGrid
   orphan fix, music_video characterManager, storyboard wiring) to the
   main spec from `node-functional-parity-cleanup`.

**Estimated effort:** 1 new spec + 2 merges ≈ 25 min.

---

## Sync Order (Executed)

```
Session 1 (2026-05-09):
  1. multi-model-param-adaptation   → 3 NEW specs
  2. agent-pro-upgrade              → 3 NEW specs
  mv × 2 to archive/2026-05-09-*

Session 2 (2026-05-10):
  3. character-asset-library         → 4 NEW + 1 append
  4. node-functional-parity-cleanup  → 1 NEW + 2 merges
  5. workflow-builder-wiring-fixes   → 1 NEW + 2 merges
  mv × 3 to archive/2026-05-10-*
```

Final `openspec/specs/` holds (alphabetical):
`agent-eval-harness`, `agent-memory-management`, `agent-multimodal-input`,
`agent-phase-state`, `agent-prompt-architecture`,
`agent-tool-response-budget`, `agent-tool-schemas`,
`agent-tool-tiering`, `agent-vision-verify`,
`asset-library`, `at-reference-system`, `libtv-asset-panel`,
`model-param-registry`, `model-reference-adapter`,
`video-generation-node`, `workflow-generation`.

**Total:** 16 capability specs — 4× the original 4.

---

## Why this audit exists

OpenSpec's `/opsx-archive` workflow expects an `openspec` CLI binary
(`openspec list --json`, `openspec status --change`) which is not
installed in this workspace. The two execution sessions replicated the
workflow manually:

- Step 4 (sync delta specs) — file writes / appends documented above
- Step 5 (mv directory) — PowerShell `Move-Item` blocks below

```powershell
# Session 1 — 2026-05-09
$today = Get-Date -Format "yyyy-MM-dd"
$base = "openspec\changes"
Move-Item "$base\multi-model-param-adaptation" "$base\archive\$today-multi-model-param-adaptation"
Move-Item "$base\agent-pro-upgrade"            "$base\archive\$today-agent-pro-upgrade"

# Session 2 — 2026-05-10
$today = Get-Date -Format "yyyy-MM-dd"
$base = "openspec\changes"
Move-Item "$base\character-asset-library"        "$base\archive\$today-character-asset-library"
Move-Item "$base\node-functional-parity-cleanup" "$base\archive\$today-node-functional-parity-cleanup"
Move-Item "$base\workflow-builder-wiring-fixes"  "$base\archive\$today-workflow-builder-wiring-fixes"
```

This file is the post-execution audit trail.
