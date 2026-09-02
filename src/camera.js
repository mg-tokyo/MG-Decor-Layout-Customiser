// src/camera.js — camera math (pure) + state-based camera operations.
import {
  ABS_MAX_TILE_SIZE,
  ABS_MIN_TILE_SIZE,
  DEFAULT_TILE_SIZE,
  TILE_SIZE_WORLD,
} from './constants.js';
import { state } from './state.js';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function calculateCameraTransform(targetX, targetY, viewportWidth, viewportHeight, tileSize, mapWidthPixels, mapHeightPixels) {
  let zoom = tileSize / TILE_SIZE_WORLD;
  const minZoomX = viewportWidth / mapWidthPixels;
  const minZoomY = viewportHeight / mapHeightPixels;
  const minZoom = Math.max(minZoomX, minZoomY);
  if (mapWidthPixels > 0 && mapHeightPixels > 0) {
    zoom = Math.max(zoom, minZoom);
  }
  const halfViewW = viewportWidth / zoom / 2;
  const halfViewH = viewportHeight / zoom / 2;
  const minX = halfViewW;
  const maxX = mapWidthPixels - halfViewW;
  const minY = halfViewH;
  const maxY = mapHeightPixels - halfViewH;
  let clampedX;
  let clampedY;
  if (minX > maxX) clampedX = mapWidthPixels / 2;
  else clampedX = Math.max(minX, Math.min(targetX, maxX));
  if (minY > maxY) clampedY = mapHeightPixels / 2;
  else clampedY = Math.max(minY, Math.min(targetY, maxY));
  const x = -clampedX * zoom + viewportWidth / 2;
  const y = -clampedY * zoom + viewportHeight / 2;
  return { scale: zoom, x, y, clampedX, clampedY };
}

export function calculateMinTileSize(viewportWidth, viewportHeight, mapWidthPixels, mapHeightPixels, absoluteMinTileSize) {
  if (mapWidthPixels <= 0 || mapHeightPixels <= 0) {
    return absoluteMinTileSize;
  }
  const minZoom = Math.max(viewportWidth / mapWidthPixels, viewportHeight / mapHeightPixels);
  return Math.max(absoluteMinTileSize, minZoom * TILE_SIZE_WORLD);
}

export function updateCamera() {
  if (!state.app || !state.camera) return;
  const { width, height } = state.app.renderer;
  const bounds = state.renderBounds;
  const mapWidth = (bounds.maxX - bounds.minX + 1) * TILE_SIZE_WORLD;
  const mapHeight = (bounds.maxY - bounds.minY + 1) * TILE_SIZE_WORLD;
  const minTileSize = calculateMinTileSize(width, height, mapWidth, mapHeight, ABS_MIN_TILE_SIZE);
  state.tileSize = clamp(state.tileSize, minTileSize, ABS_MAX_TILE_SIZE);
  const transform = calculateCameraTransform(
    state.targetCenter.x,
    state.targetCenter.y,
    width,
    height,
    state.tileSize,
    mapWidth,
    mapHeight,
  );
  state.camera.scale.set(transform.scale);
  state.camera.position.set(transform.x, transform.y);
  state.targetCenter.x = transform.clampedX;
  state.targetCenter.y = transform.clampedY;
}

export function screenToWorld(point) {
  return state.camera.toLocal(point);
}

export function zoomAt(screenPoint, newTileSize) {
  const before = screenToWorld(screenPoint);
  state.tileSize = clamp(newTileSize, ABS_MIN_TILE_SIZE, ABS_MAX_TILE_SIZE);
  updateCamera();
  const after = screenToWorld(screenPoint);
  state.targetCenter.x += before.x - after.x;
  state.targetCenter.y += before.y - after.y;
  updateCamera();
}

export function focusGarden() {
  const b = state.renderBounds;
  if (!b) return;
  state.targetCenter = {
    x: ((b.gardenMinX + b.gardenMaxX + 1) / 2 - b.minX) * TILE_SIZE_WORLD,
    y: ((b.gardenMinY + b.gardenMaxY + 1) / 2 - b.minY) * TILE_SIZE_WORLD,
  };
  state.tileSize = DEFAULT_TILE_SIZE;
  updateCamera();
}
