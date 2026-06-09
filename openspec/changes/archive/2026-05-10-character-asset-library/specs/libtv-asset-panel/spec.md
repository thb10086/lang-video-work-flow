## ADDED Requirements

### Requirement: Left-Side Asset Library Panel
The application SHALL expose an `AssetLibraryPanel` accessible from the main sidebar (alongside the existing `TemplatePanel`). The panel opens as a 360px right-sliding drawer, with three tabs — Characters / Scenes / Styles — each showing a grid of asset cards.

The panel mimics LibTV's Elements panel UX: each card shows a primary reference thumbnail, the asset name, a small variation count badge, and two quick actions on hover — "Drag to canvas" and "Edit".

Cross-capability dependency: depends on `asset-library`.

#### Scenario: Open panel and switch tabs
- **WHEN** the user clicks the Asset Library button in the main sidebar
- **THEN** a 360px drawer slides in from the right, Characters tab active by default; clicking Scenes or Styles switches the grid content without closing the drawer

#### Scenario: Drag asset onto canvas
- **GIVEN** the drawer is open on the Characters tab
- **WHEN** the user drags the "Sarah" card and drops onto the canvas
- **THEN** a new `characterGrid` node is created at the drop position, pre-filled with `name`, `description`, `outputImage` (first reference image), and a `assetId: char_sarah` linkage; no network call is required if the asset already has a reference image

#### Scenario: Card hover shows actions
- **WHEN** the user hovers over a card for 200ms
- **THEN** a translucent overlay with "Drag" and "Edit" icons appears; clicking Edit opens the Asset Detail modal

### Requirement: Asset Detail Modal with Variations
An `AssetDetailModal` SHALL allow creating / editing an asset's name, appearance (character) / environment (scene) / guide (style), reference images (upload + paste URL), and variations (add / edit / remove).

#### Scenario: Create a new character from the panel
- **GIVEN** the Characters tab is visible
- **WHEN** the user clicks the "+ New Character" card and fills in `name = "Alex"`, `appearance = "blond, leather jacket"`, uploads 2 reference images
- **THEN** on Save, a POST hits `/api/assets`; the new card appears at the top of the grid

#### Scenario: Edit an existing variation
- **GIVEN** Sarah has a "formal" variation
- **WHEN** the user opens Sarah's detail modal, clicks the formal variation, changes `appearance_delta` to "red evening gown", saves
- **THEN** a PATCH updates the variation; the card's variation badge stays at the same count

### Requirement: Sidebar Integration & Keyboard Shortcut
The main sidebar SHALL include an "Assets" entry with the same icon family as existing entries (TemplatePanel etc.). Pressing `Ctrl/Cmd+Shift+A` anywhere in the app SHALL toggle the Asset Library drawer open/closed.

#### Scenario: Shortcut toggle
- **WHEN** focus is in the canvas area and the user presses `Ctrl+Shift+A`
- **THEN** the drawer opens; pressing again closes it

#### Scenario: Shortcut ignored inside an editable input
- **GIVEN** focus is inside a node's prompt textarea
- **WHEN** the user presses `Ctrl+Shift+A`
- **THEN** the shortcut is ignored (default text-selection behavior in the field)

### Requirement: Asset Search
The panel header SHALL contain a search box that filters the current tab's grid by `name`, `name_en`, or `description` using case-insensitive substring match; search results are limited to 50 by default.

#### Scenario: Search narrows grid
- **WHEN** the user types "café" in the search box on the Scenes tab
- **THEN** only scenes whose name/description contains "café" (or "cafe" with fold) remain visible
