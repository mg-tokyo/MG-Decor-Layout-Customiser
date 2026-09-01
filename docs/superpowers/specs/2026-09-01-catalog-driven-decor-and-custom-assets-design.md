# Catalog-driven decor + custom assets — design

**Date:** 2026-09-01
**Repo:** `MG-Decor-Layout-Customiser` (vanilla JS, GitHub Pages, branch-deployed from `main` root)
**Status:** approved in brainstorming; implementation plan to follow

## 1. Goals

1. The decor picker lists every decor item the live game has, with game-correct
   sprites, anchors, rotation variants and edge-snap behaviour, and picks up new
   decor automatically when the game adds it — no hand-edited data files.
2. Users can upload their own images and place them with game-correct
   positioning (anchor at tile centre, 1 texture px = 1 world px unless scaled),
   store them locally, and share layouts containing them.

Non-goals: plants, pets, eggs, mutations (dropped from the picker); animated
(Rive/WebP) decor playback; tile textures (kept as the committed `tiles.webp`).

## 2. Verified facts the design relies on

Sources were fetched on 2026-09-01 (game version 1063).

| Fact | Evidence |
|---|---|
| World tile = 256 px; decor textures are 1 texture px = 1 world px, no scaling; sprite anchor from the atlas frame is placed at the tile centre; flips only, never angle rotation | beta `DecorVisual.ts:29-33, 61-69`, `sprite-utils.ts:41` |
| Edge-snap: a hardcoded list of decor IDs is offset by ±½ tile depending on rotation (0 → up, 180 → down, 90 → right, 270 → left) | beta `DecorVisual.ts:71-95`; live v1040 `main-*.js` @827276 has 6 IDs: `ColoredStringLights, StringLights, WindchimeMoon, WindchimeStar, PaperLantern, FanousLantern` |
| Valid rotations: `0, 90, 180, 270` and negatives `-360, -90, -180, -270` meaning "same angle, flipped horizontally" | `V14_QuinoaUserJson.ts:46-57` |
| Rotate cycles only `[0, ...Object.keys(rotationVariants)]`; decor without variants cannot rotate; flip negates the rotation | `orientDecor.ts:16-66`, `myAtoms.ts:478-488` |
| Variant resolution: variant for `abs(rotation)`; `flipH = rotation<0 XOR variant.flipH` | `QuinoaCanvasUtils.ts:20-54` |
| Rive-animated decor fall back to the static sprite `sprite/decor/<artboardName>` | live v1040 `main-*.js`: `$N(e){return V.from(J.Decor[e.artboardName])}` |
| Live manifest: `https://magicgarden.gg/version/<v>/assets/manifest.json`; `src` entries are objects `{src, resolution}`; the 2x atlases (`atlases/sprites-2x-0.json` + `related_multi_packs`) have `meta.scale: 1`, Dirt tile 256 px — this is the world-scale set. The 1x set is half-res (`scale: 0.5`) | fetched manifest + atlas JSON |
| Every one of the 103 `sprite/decor/*` frames in the 2x atlases has an `anchor` | fetched atlas JSON |
| `magicgarden.gg` sends no CORS headers; textures are KTX2 (GPU-compressed) | curl with `Origin` header |
| `https://mg-api.ariedam.fr/data` (Arie's Mod API): `decor` map with `name, rarity, eligibleShops, isOneTimePurchase, art` (sprite key or `{artboardName}`), `rotationVariants` (PNG URL + `flipH`), `upgrades[].sprite`, `released:false` on unreleased items; CORS `*` | fetched |
| `https://mg-api.ariedam.fr/assets/sprites/decor/<Name>.png`: untrimmed PNG at the atlas `sourceSize` (e.g. HayBale 271×472); all 103 exist; 3.3 MB total; **no** CORS | curl |
| Current game version is discoverable from `https://magicgarden.gg/` (`/version/<v>/assets/…` script URLs) | fetched |
| Sprite Customiser V2 already consumes `mg-api.ariedam.fr/data` and `/assets/sprite-data` | `MG-Sprite-Customiser-V2/src/api/client.ts` |

## 3. Decisions (from brainstorming)

- **Data source:** build-time snapshot committed by a GitHub Action (no runtime
  third-party dependency, no CORS proxy, no KTX2 decoding in the browser).
- **Scope:** decor only, including buildings (`eligibleShops: ["Tool"]`) and
  their upgrade-tier sprites.
- **Textures:** one PNG per sprite, lazy-loaded.
- **Code:** split `app.js` (1,018 lines) into ES modules, no build step.
- **Rotation model:** the game's (variants only, flip via negative rotation).
- **Custom assets:** IndexedDB + embedded in the export; visual anchor/scale editor.

## 4. Snapshot pipeline

### 4.1 Files

- `scripts/sync-game-assets.mjs` — Node ≥ 20, zero dependencies.
- `.github/workflows/sync-game-assets.yml` — `schedule: '0 */6 * * *'` +
  `workflow_dispatch`; `permissions: contents: write`; runs the script, commits
  `assets/decor-catalog.json` and `assets/sprites/decor/*.png` when `git status`
  is dirty, message `chore(assets): sync game v<version>`. Pages redeploys on
  the commit (branch deployment from `main`).
- Output: `assets/decor-catalog.json`, `assets/sprites/decor/<SpriteName>.png`.

### 4.2 Algorithm

1. **Version:** `GET https://magicgarden.gg/` → first `/version/(\d+)/assets/`.
2. **Atlas frames:** `GET /version/<v>/assets/manifest.json`; collect every
   `bundles[].assets[].src[]` object with `resolution === 2` whose `src` matches
   `^atlases/sprites-.*\.json$`; fetch each, follow `meta.related_multi_packs`
   (dedupe), keep frames whose key starts with `sprite/decor/` →
   `{ anchor, sourceSize, visualBaselineY? }`. Abort if zero decor frames.
3. **Catalog:** `GET https://mg-api.ariedam.fr/data` → `decor`. Skip entries with
   `released === false` or without `sprite`. Per entry:
   - `decorId` = key; `name`; `rarity`; `shops = eligibleShops ?? []`;
     `oneTime = isOneTimePurchase === true`.
   - base sprite key: `art` if string → strip `sprite/decor/`; else if
     `art.artboardName` → that; else PNG filename from `sprite` URL.
   - `rotationVariants`: for each `<deg>: {sprite, flipH?, flipV?}` → sprite
     name from the PNG URL filename (`…/decor/HayBaleSideways.png?v=…` →
     `HayBaleSideways`), copy `flipH`/`flipV` when `true`.
   - `tiers`: from `upgrades[]` entries that carry `sprite`, in array order →
     `{ label: "Lv <index+1>" (or `toCapacitySlots` when present → "<n> slots"), sprite }`.
   - Every sprite name must exist in the atlas frames; otherwise log
     `missing-frame` and drop that variant/tier (base sprite missing → drop the
     decor and log).
4. **Edge-snap IDs:** fetch the live `index-*.js` from the game index HTML, read
   its import list for the `main-*.js` chunk, fetch it, and match
   `/\[((?:`[A-Za-z]+`,?)+)\]\.includes\(\w+\.decorId\)/` where the list contains
   `StringLights`. On success write the extracted list; on failure reuse the
   previous catalog's `edgeSnapDecorIds` and log `edge-snap-fallback`. Initial
   fallback list: the six IDs above.
5. **PNGs:** for the union of referenced sprite names, `GET
   https://mg-api.ariedam.fr/assets/sprites/decor/<Name>.png` (up to 3 attempts,
   6 concurrent). Parse IHDR (bytes 16–24) and compare with the atlas
   `sourceSize`; mismatch → log `size-mismatch` (kept; the renderer scales by
   `sourceSize.w / png.w` — see §5.4). Write only when bytes differ. Delete PNGs
   in `assets/sprites/decor/` that are no longer referenced.
6. **Safety:** if a previous catalog exists and the new decor count is < 80 % of
   the old one, exit 1 without writing (protects against a partial API outage).
7. **Summary:** print (and append to `$GITHUB_STEP_SUMMARY` when set): version,
   decor added/removed, sprites added/removed, and the log lines from steps 3–5.
8. `--check` flag: run everything without writing; exit 1 if output would change.

### 4.3 `assets/decor-catalog.json`

```json
{
  "schemaVersion": 1,
  "gameVersion": "1063",
  "generatedAt": "2026-09-01T05:00:00Z",
  "tileSize": 256,
  "edgeSnapDecorIds": ["ColoredStringLights", "StringLights", "WindchimeMoon", "WindchimeStar", "PaperLantern", "FanousLantern"],
  "sprites": {
    "HayBale": { "file": "sprites/decor/HayBale.png", "w": 271, "h": 472, "anchor": { "x": 0.5, "y": 0.74 }, "visualBaselineY": 0.987 }
  },
  "decor": [
    {
      "decorId": "HayBale", "name": "Hay Bale", "rarity": "Common", "shops": ["Decor"], "oneTime": false,
      "sprite": "HayBale",
      "rotationVariants": { "90": { "sprite": "HayBaleSideways", "flipH": true }, "180": { "sprite": "HayBale", "flipH": true }, "270": { "sprite": "HayBaleSideways" } },
      "tiers": []
    },
    {
      "decorId": "PetHutch", "name": "Pet Hutch", "rarity": "Divine", "shops": ["Tool"], "oneTime": true,
      "sprite": "PetHutch", "rotationVariants": {},
      "tiers": [ { "label": "25 slots", "sprite": "PetHutch_1" }, { "label": "50 slots", "sprite": "PetHutch_2" }, { "label": "100 slots", "sprite": "PetHutch_3" } ]
    }
  ]
}
```

`decor` is sorted by `rarity` order (`Common, Uncommon, Rare, Legendary,
Mythical, Divine, Celestial`) then `name`, so the picker order is stable.
`visualBaselineY` is recorded for completeness and not used by the renderer.

### 4.4 Repo cleanup (same change)

Delete: `index.js`, `main.js` (committed game bundles, not referenced by
`index.html`), `manifest.json`, `scripts.txt`, `assets/decor-data.json`,
`assets/sprites-0.{json,webp}`, `assets/sprites-1.{json,webp}`,
`assets/flat-sprites.{json,webp}`. Keep `assets/map.json`, `assets/tiles.{json,webp}`.
Update `README.md` features (remove Mutations / Garden slot switching, add
catalog sync + custom assets) and `.claude/CLAUDE.md` repo map.

## 5. Runtime architecture

### 5.1 Module layout (`index.html` → `<script type="module" src="src/main.js">`)

PIXI 8 and `@pixi/tilemap` remain CDN globals. Every file stays under 500 lines.

| Module | Exports / responsibility |
|---|---|
| `src/main.js` | `init()`: load catalog + map in parallel, init PIXI app, build map, wire input/picker/io, load autosave, kick off texture preload. Shows loading states and a retry button on failure. |
| `src/constants.js` | `TILE_SIZE_WORLD = 256`, `GARDEN_SLOT`, `GARDEN_MARGIN`, zoom limits, `AUTOSAVE_KEY`, `DB_NAME`. |
| `src/state.js` | the shared `state` object and `dom` lookups (moved from `app.js:11-77`). |
| `src/catalog.js` | `loadCatalog(url)`, `listDecor({query, shop})`, `getDecor(id)`, `getSprite(name)`, `getRotations(id)` → sorted `[0, ...variantKeys]` (custom → `[0]`), `resolveVisual(id, rotation, tierIndex)` → `{ spriteKey, flipH, flipV, offset:{x,y}, scale }`. Custom assets register through `registerCustom(asset)` / `unregisterCustom(id)` and appear in `listDecor` with `custom: true`. |
| `src/textures.js` | `getTexture(spriteKey)` → `Promise<PIXI.Texture>` (PNG via `PIXI.Assets.load`, custom via blob URL), sets `defaultAnchor` from the catalog / asset; `preloadAll()` in the background with concurrency 4; `getThumbnail(spriteKey)` → cached 64×64 canvas; `invalidate(spriteKey)` for edited custom assets. |
| `src/decorSprite.js` | `createDecorSprite(entry, rotation, tierIndex)` → `Promise<PIXI.Container>`: sprite with texture, anchor, `scale.set(±s, ±s)` (flips), `position = offset`, container `label`; `calculateZIndex(worldY, bottomOffset)` unchanged from `app.js:419-422`. Never sets `angle`. |
| `src/map.js` | `buildTileIndex`, `computeRenderBounds`, `buildTilemap`, `gridToWorld`, `worldToGrid`, `getTileHit`, Tiled flag helpers (from `app.js:88-237, 866-913`). |
| `src/camera.js` | `calculateCameraTransform`, `calculateMinTileSize`, `updateCamera`, `zoomAt`, `focusGarden`, `screenToWorld` (from `app.js:239-311, 915`). |
| `src/input.js` | pointer/keyboard/wheel/context-menu handlers, paint mode, pinch, long-press (from `app.js:556-817`) with the rotation changes in §5.3. |
| `src/placement.js` | `placed` map ops: `setDecorAt`, `removeDecorAt`, `renderDecorSprites`, `clearDecorSprites`, `updateGhost`, autosave (from `app.js:424-534, 956-957`). Placed entry: `{ tileType, localIndex, decorId, rotation, tier, gridX, gridY }`. |
| `src/ui/picker.js` | decor modal: search, shop filter chips (`All, Decor, Tool, Snow, Rain, Thunder, Amber` — derived from catalog `shops`), rarity badge, tier selector for entries with `tiers`, "Custom" section with **Upload**, per-asset **Edit**/**Delete**, selection preview + rotation label. |
| `src/ui/modal.js` | `openModal`/`closeModal`/confirm helpers (from `app.js:917-922`). |
| `src/io.js` | `createExportPayload`, `applyImport`, `downloadText`, file picker (from `app.js:924-954`) with §6.4 changes. |
| `src/customAssets/store.js` | IndexedDB wrapper: `openDb`, `putAsset`, `getAsset`, `listAssets`, `deleteAsset`; blobs stored as `Blob`. |
| `src/customAssets/editor.js` | upload/edit dialog (§6.2). |

Import graph is acyclic: `main → {catalog, textures, map, camera, input, placement, picker, io, customAssets/*}`; `placement → decorSprite → {catalog, textures}`; `input → {placement, camera, map, state}`; `picker → {catalog, textures, customAssets/editor, state}`; `io → {placement, catalog, customAssets/store}`.

### 5.2 Rendering rules (game parity)

Given `decor`, `rotation` (signed), optional `tierIndex`:

1. `abs = rotation === -360 ? 0 : Math.abs(rotation)`; `flipped = rotation < 0`.
2. `variant = decor.rotationVariants[abs]`. If present: `spriteKey = variant.sprite`,
   `flipH = flipped ? !variant.flipH : !!variant.flipH`, `flipV = !!variant.flipV`.
   Else: `spriteKey = tier sprite (if tierIndex given) ?? decor.sprite`, `flipH = flipped`, `flipV = false`.
3. Sprite anchor = catalog `sprites[spriteKey].anchor`; `scale = sourceSize.w / texture.width`
   (1 for well-formed PNGs; guards `size-mismatch`). `scale.x *= flipH ? -1 : 1`, `scale.y *= flipV ? -1 : 1`.
4. If `decor.decorId ∈ edgeSnapDecorIds`: offset `(0, -128)` for `abs === 0`,
   `(0, +128)` for `180`, `(+128, 0)` for `90`, `(-128, 0)` for `270`.
5. Container position = tile centre (`gridToWorld`); `zIndex = calculateZIndex(worldY, container.getLocalBounds().maxY)`.
6. Custom assets: `spriteKey = asset.id`, no variants, `scale = (asset.widthTiles * 256) / asset.w`, anchor = `asset.anchor`, no edge-snap.

### 5.3 Rotation and flip UX

- `getRotations(id)`; R / double-tap advances to the next entry (wrapping);
  Shift+R goes back. For decor with no variants the list is `[0]` and the
  rotation label shows "Fixed".
- **F** (desktop) and a **Flip** button in the picker footer (both) toggle the
  sign: `0 ↔ -360`, otherwise `rotation ↔ -rotation`. Hovering a placed item and
  pressing F flips that item; R on a placed item advances its rotation.
- Rotation label: `Rotation: 90° (flipped)`.
- Autosave/import normalise legacy positive values: unchanged; values not in the
  game's picklist are clamped to `0`.

### 5.4 Texture loading

`createDecorSprite` awaits `getTexture`. Placement renders asynchronously; a
render token per tile key discards stale results if the tile changed while
loading. Picker thumbnails render as textures arrive (placeholder box first).
`preloadAll()` starts after first paint so the 3.3 MB set is cached quickly.

## 6. Custom assets

### 6.1 Store

IndexedDB `mg-decor-customiser`, object store `assets` keyed by `id`
(`custom:<uuid>`): `{ id, name, blob, mime, w, h, anchor: {x, y}, widthTiles, createdAt, updatedAt }`.
Limits: `image/png`, `image/webp`, `image/jpeg`, `image/gif` (first frame drawn
to a canvas and stored as PNG); max 2048 px on either side; max 2 MB source
file. Violations show an inline error in the dialog. Store failures
(private mode, quota) surface as a toast and leave the asset in memory for the
session only.

### 6.2 Editor dialog (`src/customAssets/editor.js`)

Opened from the picker's **Upload** button (new asset) or **Edit** (existing).

- File input (drag-and-drop onto the dialog too). After decode: shows `w×h px`.
- **Preview canvas** (fits the modal, ~420 px): draws a 3×3 grid of 256-world-px
  tiles at a zoom that fits, the centre tile highlighted, and the image composited
  exactly as `decorSprite` will render it (anchor pinned at the centre tile's
  centre, scaled by `widthTiles`). A crosshair marks the anchor.
- **Anchor**: drag the crosshair over the image (or drag the image) to move the
  anchor; numeric readout `x 0.50 · y 0.80`; presets **Typical decor (0.5, 0.8)**
  (default), **Bottom-centre (0.5, 1.0)**, **Centre (0.5, 0.5)**.
- **Width (tiles)**: number input, step 0.05, min 0.1, max 6; default `w / 256`
  (native pixels); presets **Native size**, **1 tile wide**. Height follows aspect.
- **Name**: defaults to the file name without extension.
- **Save** writes to the store, `catalog.registerCustom`, `textures.invalidate`,
  re-renders placed instances; **Cancel** discards. **Delete** (edit mode only)
  confirms, removes placements using the asset, unregisters, deletes from the store.

### 6.3 Picker integration

A **Custom** section at the top of the grid (collapsible) lists assets with
thumbnails; each card has Edit and Delete icons; the section header has
**Upload image**. Search matches custom names too. Custom entries participate in
selection/ghost/placement exactly like decor.

### 6.4 Export / import format

```json
{
  "tileObjects": { "<globalIdx>": { "objectType": "decor", "decorId": "HayBale", "rotation": -90 } },
  "boardwalkTileObjects": { },
  "customPlacements": { "<globalIdx>": { "assetId": "custom:…", "rotation": -360, "tileType": "dirt" } },
  "customAssets": { "custom:…": { "name": "My sign", "w": 300, "h": 200, "anchor": { "x": 0.5, "y": 0.8 }, "widthTiles": 1.2, "mime": "image/png", "dataUrl": "data:image/png;base64,…" } }
}
```

- `tileObjects` / `boardwalkTileObjects` contain only real decor, so the file
  still imports into Aries / the game. `tier` is not exported (the game derives
  building sprites from capacity level); it is kept in autosave only.
- Import: accepts the legacy shape (positive rotations, no custom blocks) and the
  new one. Custom assets in the file are written to the store (same id; the
  imported copy replaces a local one with different bytes), then placements are
  restored. Missing asset for a placement → skipped with a console warning and a
  count in a toast.
- Autosave (`localStorage`) stores the same shape **without** `customAssets`
  (blobs live in IndexedDB) and with `tier` on decor entries.

## 7. Error handling

- Catalog or map fetch failure → loading overlay error text + **Retry** button.
- Sprite PNG 404 → 64×64 magenta placeholder texture, console warning once per key; item stays selectable.
- IndexedDB unavailable → custom assets work for the session only; picker shows a one-line notice.
- Import parse errors → modal with the reason (replaces today's `alert`).

## 8. Verification plan

1. `node scripts/sync-game-assets.mjs` locally: catalog lists 60 released decor,
   103 sprites, `size-mismatch` count 0, `edgeSnapDecorIds` extracted (6 IDs);
   second run is a no-op; `--check` exits 0.
2. Serve the repo statically and load in Chrome: all thumbnails render; HayBale
   R-cycle shows `HayBale → HayBaleSideways(flipped) → HayBale(flipped) → HayBaleSideways`;
   StringLights at 0/90/180/270 is offset up/right/down/left by half a tile; F on a
   rock mirrors it and R does nothing; PetHutch tier selector switches sprites.
3. Export → clear → import round-trip preserves decor, signed rotations, custom
   placements and assets; an autosave from the previous version loads unchanged.
4. Custom flow: upload PNG, drag anchor, set width 1.5 tiles, save, place, flip,
   export, delete the asset (placements removed), import the file → asset restored.
5. Mobile: touch emulation — tap/long-press/double-tap/pinch and the Flip button.
6. Every `src/**` file < 500 lines; no reference to deleted files remains (`grep`).
7. Push, run the workflow via `workflow_dispatch`, confirm the commit and Pages redeploy.
