// src/input.js — pointer, touch, wheel and keyboard handling.
import { TILE_SIZE_WORLD } from './constants.js';
import { dom, state, isMobileDevice } from './state.js';
import { flipRotation, nextRotation } from './catalog.js';
import { focusGarden, screenToWorld, updateCamera, zoomAt } from './camera.js';
import { getTileHit, worldToGrid } from './map.js';
import { removeDecorAt, setDecorAt, tileKey, updateGhost } from './placement.js';
import { clearSelection, flipSelection, openPicker, rotateSelection } from './ui/picker.js';

export function initInput() {
  const stage = state.app.stage;
  const PIXI = globalThis.PIXI;
  const b = state.renderBounds;
  stage.eventMode = 'static';
  stage.hitArea = new PIXI.Rectangle(
    0, 0,
    (b.maxX - b.minX + 1) * TILE_SIZE_WORLD,
    (b.maxY - b.minY + 1) * TILE_SIZE_WORLD,
  );
  stage.on('pointerdown', handlePointerDown);
  stage.on('pointermove', handlePointerMove);
  stage.on('pointerup', handlePointerUp);
  stage.on('pointerupoutside', handlePointerUp);
  dom.canvasWrap.addEventListener('wheel', handleWheel, { passive: false });
  dom.canvasWrap.addEventListener('contextmenu', handleRightClick);
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('resize', updateCamera);
  dom.resetView.addEventListener('click', focusGarden);
  if (dom.closeTooltip) {
    dom.closeTooltip.addEventListener('click', () => {
      dom.controlsTooltip.style.display = 'none';
    });
  }
}

function hitAtScreen(global) {
  const worldPos = screenToWorld(global);
  const { gridX, gridY } = worldToGrid(worldPos.x, worldPos.y, state.renderBounds);
  const hit = getTileHit(gridX, gridY, state.mapData, state.tileIndex);
  return { hit, gridX, gridY };
}

function updateHoverOutline(hover) {
  state.lastHover = hover;
  if (state.hoverOutline) {
    state.hoverOutline.clear();
    if (hover && hover.valid) {
      const b = state.renderBounds;
      const x = (hover.gridX - b.minX) * TILE_SIZE_WORLD;
      const y = (hover.gridY - b.minY) * TILE_SIZE_WORLD;
      state.hoverOutline.rect(x, y, TILE_SIZE_WORLD, TILE_SIZE_WORLD);
      state.hoverOutline.stroke({
        width: 3,
        color: hover.tileType === 'boardwalk' ? 0x6ad2a6 : 0xff6b3d,
        alpha: 0.8,
      });
    }
  }
  void updateGhost();
}

function placeSelected(hit) {
  setDecorAt(hit.tileType, hit.localIndex, state.selectedDecorId, state.selectedRotation, state.selectedTier);
}

function handlePointerDown(event) {
  const ps = state.pointerState;
  ps.pointers.set(event.pointerId, { x: event.global.x, y: event.global.y });
  ps.startPos = { x: event.global.x, y: event.global.y };

  if (ps.spacebarHeld && state.selectedDecorId) {
    ps.paintMode = true;
    ps.isPanning = false;
    const { hit } = hitAtScreen(event.global);
    if (hit) {
      placeSelected(hit);
      ps.lastPaintedTile = tileKey(hit.tileType, hit.localIndex);
    }
    return;
  }

  ps.isPanning = false;
  ps.hasMoved = false;

  if (isMobileDevice()) {
    if (ps.longPressTimer) clearTimeout(ps.longPressTimer);
    ps.longPressTimer = setTimeout(() => {
      const { hit } = hitAtScreen(event.global);
      if (hit && !ps.hasMoved) {
        removeDecorAt(hit.tileType, hit.localIndex);
        ps.hasMoved = true; // suppress the tap on release
      }
    }, 600);
  }

  if (ps.pointers.size === 2) {
    ps.hasMoved = true;
    if (ps.longPressTimer) clearTimeout(ps.longPressTimer);
    const pts = [...ps.pointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    ps.pinching = { distance: dist, tileSize: state.tileSize };
    ps.isPanning = false;
  }
}

function handlePointerMove(event) {
  const ps = state.pointerState;

  if (ps.paintMode && state.selectedDecorId) {
    const { hit, gridX, gridY } = hitAtScreen(event.global);
    if (hit) {
      const key = tileKey(hit.tileType, hit.localIndex);
      if (key !== ps.lastPaintedTile) {
        placeSelected(hit);
        ps.lastPaintedTile = key;
      }
    }
    updateHoverOutline(hit ? { ...hit, gridX, gridY, valid: true } : { gridX, gridY, valid: false });
    return;
  }

  const pointer = ps.pointers.get(event.pointerId);
  if (!pointer) return;
  const dx = event.global.x - pointer.x;
  const dy = event.global.y - pointer.y;
  pointer.x = event.global.x;
  pointer.y = event.global.y;

  if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
    ps.hasMoved = true;
    if (ps.longPressTimer) {
      clearTimeout(ps.longPressTimer);
      ps.longPressTimer = null;
    }
  }

  if (ps.pinching && ps.pointers.size >= 2) {
    const pts = [...ps.pointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    const midpoint = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    zoomAt(midpoint, ps.pinching.tileSize * (dist / ps.pinching.distance));
    ps.isPanning = false;
    ps.hasMoved = true;
    return;
  }

  if (!ps.isPanning && Math.hypot(event.global.x - ps.startPos.x, event.global.y - ps.startPos.y) > 10) {
    ps.isPanning = true;
    ps.hasMoved = true;
  }

  if (ps.isPanning) {
    const zoom = state.camera.scale.x || 1;
    state.targetCenter.x -= dx / zoom;
    state.targetCenter.y -= dy / zoom;
    updateCamera();
  } else {
    const { hit, gridX, gridY } = hitAtScreen(event.global);
    updateHoverOutline(hit ? { ...hit, gridX, gridY, valid: true } : { gridX, gridY, valid: false });
  }
}

function handlePointerUp(event) {
  const ps = state.pointerState;
  if (ps.longPressTimer) {
    clearTimeout(ps.longPressTimer);
    ps.longPressTimer = null;
  }
  if (!ps.pointers.has(event.pointerId)) return;
  ps.pointers.delete(event.pointerId);
  if (ps.pointers.size < 2) ps.pinching = null;

  if (ps.paintMode) {
    ps.paintMode = false;
    ps.lastPaintedTile = null;
    return;
  }
  if (ps.isPanning) {
    ps.isPanning = false;
    ps.hasMoved = true;
    return;
  }
  if (ps.hasMoved) return;

  const now = Date.now();
  const isDouble = state.lastPointerUp && now - state.lastPointerUp < 300;
  state.lastPointerUp = now;

  const { hit } = hitAtScreen(event.global);
  if (!hit) return;
  const key = tileKey(hit.tileType, hit.localIndex);
  const existing = state.placed.get(key);

  if (isDouble && existing) {
    const next = nextRotation(existing.decorId, existing.rotation, 1);
    if (next !== existing.rotation) {
      setDecorAt(hit.tileType, hit.localIndex, existing.decorId, next, existing.tier);
    }
    return;
  }

  if (state.selectedDecorId) {
    placeSelected(hit);
  } else if (existing) {
    removeDecorAt(hit.tileType, hit.localIndex);
    void updateGhost();
  }
}

function handleRightClick(event) {
  event.preventDefault();
  const PIXI = globalThis.PIXI;
  const rect = dom.canvasWrap.getBoundingClientRect();
  const { hit } = hitAtScreen(new PIXI.Point(event.clientX - rect.left, event.clientY - rect.top));
  if (hit) removeDecorAt(hit.tileType, hit.localIndex);
}

function hoveredPlacement() {
  const hover = state.lastHover;
  if (!hover || !hover.valid) return null;
  const entry = state.placed.get(tileKey(hover.tileType, hover.localIndex));
  return entry ? { hover, entry } : null;
}

function handleKeyDown(event) {
  const target = event.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return; // typing in the search box / editor fields
  }
  const key = event.key.toLowerCase();

  if (key === ' ' && !event.repeat) {
    if (state.selectedDecorId) {
      event.preventDefault();
      state.pointerState.spacebarHeld = true;
    } else {
      clearSelection();
    }
    return;
  }

  if (key === 'escape') {
    clearSelection();
    return;
  }

  if (key === 'r') {
    const dir = event.shiftKey ? -1 : 1;
    const hovered = hoveredPlacement();
    if (hovered) {
      const { hover, entry } = hovered;
      const next = nextRotation(entry.decorId, entry.rotation, dir);
      if (next !== entry.rotation) {
        setDecorAt(hover.tileType, hover.localIndex, entry.decorId, next, entry.tier);
      }
      return;
    }
    rotateSelection(dir);
    return;
  }

  if (key === 'f') {
    const hovered = hoveredPlacement();
    if (hovered) {
      const { hover, entry } = hovered;
      setDecorAt(hover.tileType, hover.localIndex, entry.decorId, flipRotation(entry.rotation), entry.tier);
      return;
    }
    flipSelection();
    return;
  }

  if (key === 'd') {
    event.preventDefault();
    openPicker();
  }
}

function handleKeyUp(event) {
  if (event.key === ' ') {
    state.pointerState.spacebarHeld = false;
    state.pointerState.paintMode = false;
    state.pointerState.lastPaintedTile = null;
  }
}

function handleWheel(event) {
  event.preventDefault();
  zoomAt(
    { x: event.clientX, y: event.clientY },
    state.tileSize * (event.deltaY > 0 ? 0.92 : 1.08),
  );
}
