// src/state.js — the shared mutable state and DOM lookup table.
// No DOM access at module scope: initDom() runs once from main.js.
import { DEFAULT_TILE_SIZE } from './constants.js';

export const state = {
  app: null,
  camera: null,
  world: null,
  overlay: null,
  mapData: null,
  renderBounds: null,
  tileIndex: null,
  tileSize: DEFAULT_TILE_SIZE,
  targetCenter: { x: 0, y: 0 },
  selectedDecorId: null,
  selectedRotation: 0,
  selectedTier: null,
  gardenOutline: null,
  hoverOutline: null,
  ghost: null,
  placed: new Map(), // key "tileType:localIndex" -> {tileType, localIndex, decorId, rotation, tier, gridX, gridY}
  sprites: new Map(), // same key -> PIXI.Container
  pointerState: {
    pointers: new Map(),
    pinching: null,
    startPos: null,
    isPanning: false,
    spacebarHeld: false,
    paintMode: false,
    lastPaintedTile: null,
    hasMoved: false,
    longPressTimer: null,
  },
  lastHover: null,
  lastPointerUp: 0,
};

export const dom = {};

const DOM_IDS = [
  'canvasWrap', 'loadingState', 'loadingText', 'retryBtn',
  'decorList', 'customList', 'customSection', 'searchDecor', 'shopFilters',
  'selectedName', 'rotationLabel', 'tierRow', 'tierSelect',
  'rotateBtn', 'flipBtn', 'uploadAssetBtn', 'storageNotice',
  'placedCount', 'slotLabel', 'exportBtn', 'importBtn', 'resetView',
  'decorBtn', 'decorModal', 'closeDecorModal',
  'modal', 'modalTitle', 'modalMessage', 'modalPrimary', 'modalSecondary', 'modalClose',
  'controlsTooltip', 'closeTooltip', 'selectionPreview',
  'editorModal', 'editorTitle', 'editorFile', 'editorCanvas', 'editorMeta',
  'editorAnchorLabel', 'editorWidth', 'editorName', 'editorError',
  'editorPresetDecor', 'editorPresetBottom', 'editorPresetCenter',
  'editorPresetNative', 'editorPresetOneTile',
  'editorSave', 'editorCancel', 'editorDelete',
];

export function initDom() {
  for (const id of DOM_IDS) dom[id] = document.getElementById(id);
}

export function isMobileDevice() {
  return (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints && navigator.maxTouchPoints > 1)
  );
}
