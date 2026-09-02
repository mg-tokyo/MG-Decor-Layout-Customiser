# MG Decor Layout Customiser

## TL;DR
Isometric garden decoration planner for Magic Garden. Drag-and-drop decor placement on a tile grid with sprite rendering.

## Architecture type
Web app — vanilla JavaScript ES modules, HTML/CSS, no build step; GitHub Action keeps game data in sync

## Repo map
- `index.html` — main page (loads `src/main.js` as an ES module)
- `src/` — runtime ES modules (catalog, textures, decorSprite, placement, map, camera, input, io, layoutIo, state, constants, `ui/`, `customAssets/`)
- `scripts/sync-game-assets.mjs` + `scripts/lib/` — game asset snapshot pipeline (Node ≥ 20, zero deps)
- `scripts/dev-server.mjs` — local static server (`npm run dev`)
- `tests/` — `node --test` suites for the pure modules
- `.github/workflows/sync-game-assets.yml` — 6-hourly catalog/sprite sync, commits to `main`
- `styles.css` — styling
- `assets/decor-catalog.json` — generated decor catalog (do not hand-edit)
- `assets/sprites/decor/` — generated per-decor PNGs (do not hand-edit)
- `assets/map.json`, `assets/tiles.{json,webp}` — garden map + tile atlas

## Deployment
Hosted via GitHub Pages at `mg-tokyo.github.io`. Remote: `mg-tokyo/MG-Decor-Layout-Customiser`.
