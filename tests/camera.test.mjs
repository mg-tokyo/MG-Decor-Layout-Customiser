// tests/camera.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateCameraTransform, calculateMinTileSize } from '../src/camera.js';

test('calculateCameraTransform clamps the target inside the map', () => {
  // zoom = 256/256 = 1; half viewport = 400x300; map 2000x2000.
  const t = calculateCameraTransform(100, 100, 800, 600, 256, 2000, 2000);
  assert.equal(t.scale, 1);
  assert.equal(t.clampedX, 400);
  assert.equal(t.clampedY, 300);
  assert.equal(t.x, -400 * 1 + 400);
  assert.equal(t.y, -300 * 1 + 300);
});

test('calculateCameraTransform enforces the fit-to-viewport minimum zoom', () => {
  // Map smaller than viewport: minZoom = max(800/500, 600/500) = 1.6.
  const t = calculateCameraTransform(0, 0, 800, 600, 256, 500, 500);
  assert.equal(t.scale, 1.6);
  assert.equal(t.clampedX, 250); // minX === maxX -> pinned to centre
  // Vertical: halfViewH = 300/1.6 = 187.5; maxY = 500 - 187.5 = 312.5 -> target 0 clamps up to 187.5.
  assert.equal(t.clampedY, 187.5);
});

test('calculateMinTileSize applies the absolute floor', () => {
  assert.equal(calculateMinTileSize(800, 600, 500, 500, 16), 1.6 * 256);
  assert.equal(calculateMinTileSize(800, 600, 100000, 100000, 16), 16);
  assert.equal(calculateMinTileSize(800, 600, 0, 0, 16), 16);
});
