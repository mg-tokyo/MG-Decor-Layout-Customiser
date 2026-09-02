// tests/map.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTileIndex,
  computeRenderBounds,
  getTileHit,
  gridToWorld,
  worldToGrid,
} from '../src/map.js';

function fixtureMap() {
  // 6x6 map, garden slot 05: dirt at globals 14,15 (grid 2,2 / 3,2),
  // boardwalk at global 21 (grid 3,3). A decoy slot-04 layer must be ignored.
  const data = (globals) => {
    const arr = new Array(36).fill(0);
    for (const g of globals) arr[g] = 1;
    return arr;
  };
  return {
    width: 6,
    height: 6,
    layers: [
      { type: 'tilelayer', class: 'DirtTiles', name: 'DirtTiles-04', data: data([7]) },
      { type: 'tilelayer', class: 'DirtTiles', name: 'DirtTiles-05', data: data([14, 15]) },
      { type: 'tilelayer', class: 'BoardwalkTiles', name: 'BoardwalkTiles-05', data: data([21]) },
    ],
  };
}

test('buildTileIndex indexes only the requested slot', () => {
  const idx = buildTileIndex(fixtureMap(), 5);
  assert.deepEqual(idx.dirtGlobals, [14, 15]);
  assert.deepEqual(idx.boardwalkGlobals, [21]);
  assert.deepEqual(idx.globalToTile.get(14), { tileType: 'dirt', localIndex: 0 });
  assert.deepEqual(idx.globalToTile.get(15), { tileType: 'dirt', localIndex: 1 });
  assert.deepEqual(idx.globalToTile.get(21), { tileType: 'boardwalk', localIndex: 0 });
  assert.equal(idx.globalToTile.get(7), undefined);
  assert.equal(idx.tileToGlobal.dirt.get(1), 15);
  assert.equal(idx.tileToGlobal.boardwalk.get(0), 21);
});

test('computeRenderBounds pads by the margin and clamps to the map', () => {
  const map = fixtureMap();
  const idx = buildTileIndex(map, 5);
  const b = computeRenderBounds(map, idx, 1);
  assert.deepEqual(
    { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY },
    { minX: 1, minY: 1, maxX: 4, maxY: 4 },
  );
  assert.deepEqual(
    { gMinX: b.gardenMinX, gMinY: b.gardenMinY, gMaxX: b.gardenMaxX, gMaxY: b.gardenMaxY },
    { gMinX: 2, gMinY: 2, gMaxX: 3, gMaxY: 3 },
  );
  const wide = computeRenderBounds(map, idx, 10); // margin larger than the map
  assert.deepEqual(
    { minX: wide.minX, minY: wide.minY, maxX: wide.maxX, maxY: wide.maxY },
    { minX: 0, minY: 0, maxX: 5, maxY: 5 },
  );
});

test('gridToWorld / worldToGrid round-trip through tile centres', () => {
  const map = fixtureMap();
  const idx = buildTileIndex(map, 5);
  const b = computeRenderBounds(map, idx, 1);
  const world = gridToWorld(2, 2, b);
  assert.deepEqual(world, { x: 1 * 256 + 128, y: 1 * 256 + 128 });
  assert.deepEqual(worldToGrid(world.x, world.y, b), { gridX: 2, gridY: 2 });
  assert.deepEqual(worldToGrid(0, 0, b), { gridX: 1, gridY: 1 });
});

test('getTileHit resolves placeable tiles and rejects everything else', () => {
  const map = fixtureMap();
  const idx = buildTileIndex(map, 5);
  assert.deepEqual(getTileHit(2, 2, map, idx), { tileType: 'dirt', localIndex: 0 });
  assert.deepEqual(getTileHit(3, 3, map, idx), { tileType: 'boardwalk', localIndex: 0 });
  assert.equal(getTileHit(0, 0, map, idx), null);
  assert.equal(getTileHit(-1, 2, map, idx), null);
  assert.equal(getTileHit(2, 99, map, idx), null);
});
