// src/placement.js — placed-decor map operations, async sprite rendering with
// staleness tokens, the ghost preview, and coalesced change notification.
import { state } from './state.js';
import { calculateZIndex, createDecorSprite } from './decorSprite.js';
import { gridToWorld } from './map.js';

const renderTokens = new Map(); // tile key -> Symbol of the latest render
let ghostToken = null;
let onChange = null;
let changeQueued = false;

export function setOnChange(fn) {
  onChange = fn;
}

// Coalesce bursts (paint mode, import loops) into one autosave/count update.
function notifyChange() {
  if (!onChange || changeQueued) return;
  changeQueued = true;
  queueMicrotask(() => {
    changeQueued = false;
    if (onChange) onChange();
  });
}

export function tileKey(tileType, localIndex) {
  return `${tileType}:${localIndex}`;
}

function destroySprite(key) {
  const sprite = state.sprites.get(key);
  if (sprite) {
    sprite.destroy({ children: true });
    state.sprites.delete(key);
  }
}

export async function renderPlacement(key) {
  const entry = state.placed.get(key);
  if (!entry || !state.world) return;
  const token = Symbol(key);
  renderTokens.set(key, token);
  const container = await createDecorSprite(entry.decorId, entry.rotation, entry.tier);
  // Stale if the tile changed (or was cleared) while the texture loaded.
  if (renderTokens.get(key) !== token || state.placed.get(key) !== entry) {
    if (container) container.destroy({ children: true });
    return;
  }
  destroySprite(key);
  if (!container) return;
  const pos = gridToWorld(entry.gridX, entry.gridY, state.renderBounds);
  container.position.set(pos.x, pos.y);
  container.zIndex = calculateZIndex(pos.y, container.getLocalBounds().maxY);
  state.world.addChild(container);
  state.sprites.set(key, container);
}

export function setDecorAt(tileType, localIndex, decorId, rotation, tier = null) {
  const globals = tileType === 'dirt' ? state.tileIndex.dirtGlobals : state.tileIndex.boardwalkGlobals;
  const globalIdx = globals[localIndex];
  if (globalIdx === undefined) return;
  const key = tileKey(tileType, localIndex);
  state.placed.set(key, {
    tileType,
    localIndex,
    decorId,
    rotation,
    tier,
    gridX: globalIdx % state.mapData.width,
    gridY: Math.floor(globalIdx / state.mapData.width),
  });
  void renderPlacement(key);
  notifyChange();
}

export function removeDecorAt(tileType, localIndex) {
  const key = tileKey(tileType, localIndex);
  if (!state.placed.has(key)) return;
  state.placed.delete(key);
  renderTokens.delete(key);
  destroySprite(key);
  notifyChange();
}

export function removePlacementsForDecor(decorId) {
  let removed = 0;
  for (const [key, entry] of [...state.placed.entries()]) {
    if (entry.decorId === decorId) {
      state.placed.delete(key);
      renderTokens.delete(key);
      destroySprite(key);
      removed += 1;
    }
  }
  if (removed > 0) notifyChange();
  return removed;
}

export function clearAll() {
  state.placed.clear();
  renderTokens.clear();
  for (const sprite of state.sprites.values()) sprite.destroy({ children: true });
  state.sprites.clear();
  notifyChange();
}

export function rerenderDecor(decorId) {
  for (const [key, entry] of state.placed.entries()) {
    if (entry.decorId === decorId) void renderPlacement(key);
  }
}

export async function updateGhost() {
  if (!state.overlay) return;
  const pointer = state.pointerState;
  const wantId = state.selectedDecorId;
  if (!wantId) {
    if (state.ghost) {
      state.overlay.removeChild(state.ghost.displayObject);
      state.ghost.displayObject.destroy({ children: true });
      state.ghost = null;
    }
    return;
  }
  if (pointer.isPanning || pointer.pointers.size > 1) {
    if (state.ghost) state.ghost.displayObject.visible = false;
    return;
  }
  const sig = `${wantId}|${state.selectedRotation}|${state.selectedTier ?? ''}`;
  if (!state.ghost || state.ghost.sig !== sig) {
    const token = Symbol('ghost');
    ghostToken = token;
    const container = await createDecorSprite(wantId, state.selectedRotation, state.selectedTier);
    if (ghostToken !== token) {
      if (container) container.destroy({ children: true });
      return;
    }
    if (state.ghost) {
      state.overlay.removeChild(state.ghost.displayObject);
      state.ghost.displayObject.destroy({ children: true });
      state.ghost = null;
    }
    if (!container) return;
    container.alpha = 0.6;
    state.overlay.addChild(container);
    state.ghost = { sig, displayObject: container };
  }
  const hover = state.lastHover;
  if (hover && hover.valid) {
    const pos = gridToWorld(hover.gridX, hover.gridY, state.renderBounds);
    state.ghost.displayObject.position.set(pos.x, pos.y);
    state.ghost.displayObject.visible = true;
  } else {
    state.ghost.displayObject.visible = false;
  }
}
