// tests/io.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExportPayload, parseImportPayload } from '../src/io.js';

function fixtureIndex() {
  // 4-wide map; dirt local 0/1 -> global 5/6, boardwalk local 0 -> global 9.
  return {
    tileToGlobal: {
      dirt: new Map([[0, 5], [1, 6]]),
      boardwalk: new Map([[0, 9]]),
    },
    globalToTile: new Map([
      [5, { tileType: 'dirt', localIndex: 0 }],
      [6, { tileType: 'dirt', localIndex: 1 }],
      [9, { tileType: 'boardwalk', localIndex: 0 }],
    ]),
  };
}

function placedFixture() {
  const placed = new Map();
  placed.set('dirt:0', { tileType: 'dirt', localIndex: 0, decorId: 'HayBale', rotation: -90, tier: null, gridX: 1, gridY: 1 });
  placed.set('boardwalk:0', { tileType: 'boardwalk', localIndex: 0, decorId: 'PetHutch', rotation: 0, tier: 2, gridX: 1, gridY: 2 });
  placed.set('dirt:1', { tileType: 'dirt', localIndex: 1, decorId: 'custom:abc', rotation: -360, tier: null, gridX: 2, gridY: 1 });
  return placed;
}

test('createExportPayload splits decor / custom, keys by global index', () => {
  const { tileToGlobal } = fixtureIndex();
  const payload = createExportPayload({ placed: placedFixture(), tileToGlobal });
  assert.deepEqual(payload.tileObjects, {
    5: { objectType: 'decor', decorId: 'HayBale', rotation: -90 },
  });
  assert.deepEqual(payload.boardwalkTileObjects, {
    9: { objectType: 'decor', decorId: 'PetHutch', rotation: 0 },
  });
  assert.deepEqual(payload.customPlacements, {
    6: { assetId: 'custom:abc', rotation: -360, tileType: 'dirt' },
  });
  assert.equal(payload.customAssets, undefined);
});

test('createExportPayload includeTier adds tier; default omits it (Aries compatibility)', () => {
  const { tileToGlobal } = fixtureIndex();
  const withTier = createExportPayload({ placed: placedFixture(), tileToGlobal, includeTier: true });
  assert.equal(withTier.boardwalkTileObjects[9].tier, 2);
  assert.equal(withTier.tileObjects[5].tier, undefined); // null tier stays omitted
  const without = createExportPayload({ placed: placedFixture(), tileToGlobal });
  assert.equal(without.boardwalkTileObjects[9].tier, undefined);
});

test('createExportPayload embeds only used custom assets', () => {
  const { tileToGlobal } = fixtureIndex();
  const customAssets = {
    'custom:abc': { name: 'Used', dataUrl: 'data:image/png;base64,AA==' },
    'custom:zzz': { name: 'Unused', dataUrl: 'data:image/png;base64,BB==' },
  };
  const payload = createExportPayload({ placed: placedFixture(), tileToGlobal, customAssets });
  assert.deepEqual(Object.keys(payload.customAssets), ['custom:abc']);
  const noCustom = new Map([['dirt:0', placedFixture().get('dirt:0')]]);
  const p2 = createExportPayload({ placed: noCustom, tileToGlobal, customAssets });
  assert.equal(p2.customAssets, undefined);
  assert.equal(p2.customPlacements, undefined);
});

test('parseImportPayload round-trips an export', () => {
  const { tileToGlobal, globalToTile } = fixtureIndex();
  const payload = createExportPayload({
    placed: placedFixture(), tileToGlobal, includeTier: true,
    customAssets: { 'custom:abc': { name: 'Used', dataUrl: 'data:,x' } },
  });
  const parsed = parseImportPayload(payload, { globalToTile });
  assert.deepEqual(parsed.decor, [
    { tileType: 'dirt', localIndex: 0, decorId: 'HayBale', rotation: -90, tier: null },
    { tileType: 'boardwalk', localIndex: 0, decorId: 'PetHutch', rotation: 0, tier: 2 },
  ]);
  assert.deepEqual(parsed.custom, [
    { tileType: 'dirt', localIndex: 1, assetId: 'custom:abc', rotation: -360 },
  ]);
  assert.deepEqual(Object.keys(parsed.assets), ['custom:abc']);
  assert.equal(parsed.skipped, 0);
});

test('parseImportPayload accepts legacy shapes and counts skips', () => {
  const { globalToTile } = fixtureIndex();
  // Legacy autosave / Aries file: no custom blocks, plants present, positive rotations.
  const legacy = {
    tileObjects: {
      5: { objectType: 'decor', decorId: 'Rock', rotation: 90 },
      6: { objectType: 'plant', species: 'Carrot', slots: [] },
      7: { objectType: 'decor', decorId: 'Bench', rotation: 0 }, // 7 not a placeable tile
    },
    boardwalkTileObjects: {},
  };
  const parsed = parseImportPayload(legacy, { globalToTile });
  assert.deepEqual(parsed.decor, [
    { tileType: 'dirt', localIndex: 0, decorId: 'Rock', rotation: 90, tier: null },
  ]);
  assert.equal(parsed.assets, null);
  assert.equal(parsed.skipped, 2); // the plant and the unknown tile

  // Game-export wrapper: { garden: { tileObjects: ... } }.
  const wrapped = { garden: { tileObjects: { 9: { objectType: 'decor', decorId: 'X' } }, boardwalkTileObjects: {} } };
  const p2 = parseImportPayload(wrapped, { globalToTile });
  assert.deepEqual(p2.decor, [{ tileType: 'boardwalk', localIndex: 0, decorId: 'X', rotation: 0, tier: null }]);

  // Garbage in the custom block is skipped, not fatal.
  const junk = { tileObjects: {}, boardwalkTileObjects: {}, customPlacements: { 99: { assetId: 'custom:x' }, 5: null } };
  const p3 = parseImportPayload(junk, { globalToTile });
  assert.deepEqual(p3.custom, []);
  assert.equal(p3.skipped, 1); // global 99 unknown; the null entry is ignored silently
});
