// src/main.js — boot: fetch catalog + map, init PIXI, build the scene, wire UI.
import {
  ASSET_BASE,
  CATALOG_URL,
  GARDEN_MARGIN,
  GARDEN_SLOT,
  MAP_URL,
  TILE_SIZE_WORLD,
} from './constants.js';
import { dom, initDom, isMobileDevice, state } from './state.js';
import * as catalog from './catalog.js';
import { preloadAll, registerCustomBlob, setAssetVersion } from './textures.js';
import { isAvailable, listAssets } from './customAssets/store.js';
import { deleteAssetById, initEditor, openEditor } from './customAssets/editor.js';
import { buildTileIndex, buildTilemap, computeRenderBounds } from './map.js';
import { focusGarden } from './camera.js';
import { setOnChange } from './placement.js';
import { initModal } from './ui/modal.js';
import { initPicker, renderDecorList, updateRotationLabel } from './ui/picker.js';
import { initInput } from './input.js';
import { initLayoutIo, loadAutosave, saveAutosave } from './layoutIo.js';

function setLoading(text) {
  if (dom.loadingText) dom.loadingText.textContent = text;
  console.log('[Loading]', text);
}

function showLoading(show) {
  if (dom.loadingState) dom.loadingState.style.display = show ? 'grid' : 'none';
}

async function fetchJson(url) {
  const response = await fetch(`${url}?v=${Date.now()}`);
  if (!response.ok) throw new Error(`HTTP ${response.status} loading ${url}`);
  return response.json();
}

function drawOutlines() {
  const PIXI = globalThis.PIXI;
  const b = state.renderBounds;
  const outline = new PIXI.Graphics();
  outline.rect(
    (b.gardenMinX - b.minX) * TILE_SIZE_WORLD,
    (b.gardenMinY - b.minY) * TILE_SIZE_WORLD,
    (b.gardenMaxX - b.gardenMinX + 1) * TILE_SIZE_WORLD,
    (b.gardenMaxY - b.gardenMinY + 1) * TILE_SIZE_WORLD,
  );
  outline.stroke({ width: 6, color: 0xff3b2f, alpha: 0.9 });
  state.gardenOutline = outline;
  state.overlay.addChild(outline);
  state.hoverOutline = new PIXI.Graphics();
  state.overlay.addChild(state.hoverOutline);
}

async function loadCustomAssets() {
  const assets = await listAssets();
  for (const asset of assets) {
    catalog.registerCustom(asset);
    registerCustomBlob(asset.id, asset.blob);
  }
  if (!isAvailable()) dom.storageNotice.hidden = false;
}

async function init() {
  setLoading('Loading catalog…');
  showLoading(true);
  dom.retryBtn.hidden = true;
  try {
    const PIXI = globalThis.PIXI;
    const [catalogData, mapData] = await Promise.all([
      fetchJson(CATALOG_URL),
      fetchJson(MAP_URL),
    ]);
    catalog.loadCatalog(catalogData);
    setAssetVersion(catalogData.gameVersion);
    state.mapData = mapData;

    setLoading('Loading tiles…');
    PIXI.Assets.add({ alias: 'tiles', src: `${ASSET_BASE}tiles.json?v=${Date.now()}` });
    await PIXI.Assets.load('tiles');

    setLoading('Initialising renderer…');
    state.app = new PIXI.Application();
    await state.app.init({
      resizeTo: dom.canvasWrap,
      backgroundAlpha: 0,
      antialias: false,
      autoDensity: true,
    });
    dom.canvasWrap.appendChild(state.app.canvas);

    state.camera = new PIXI.Container();
    state.world = new PIXI.Container({ sortableChildren: true });
    state.overlay = new PIXI.Container({ sortableChildren: true });
    state.tileIndex = buildTileIndex(mapData, GARDEN_SLOT);
    state.renderBounds = computeRenderBounds(mapData, state.tileIndex, GARDEN_MARGIN);
    state.world.addChild(buildTilemap(mapData, state.renderBounds));
    state.camera.addChild(state.world, state.overlay);
    state.app.stage.addChild(state.camera);

    drawOutlines();
    focusGarden();

    dom.slotLabel.textContent = String(GARDEN_SLOT).padStart(2, '0');
    initModal();
    initEditor();
    initPicker({ openEditor, deleteAsset: deleteAssetById });
    await loadCustomAssets(); // before loadAutosave so custom placements resolve
    initInput();
    initLayoutIo();
    setOnChange(() => {
      saveAutosave();
      dom.placedCount.textContent = String(state.placed.size);
    });
    renderDecorList();
    updateRotationLabel();
    await loadAutosave();

    showLoading(false);
    preloadAll(Object.keys(catalogData.sprites)); // background-warm the sprite set
  } catch (err) {
    console.error('Initialisation failed:', err);
    setLoading(`Error: ${err.message || 'unknown error'}`);
    dom.retryBtn.hidden = false;
  }
}

initDom();
document.body.classList.add(isMobileDevice() ? 'mobile' : 'desktop');
dom.retryBtn.addEventListener('click', () => window.location.reload());
void init();
