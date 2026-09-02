// tests/catalog.test.mjs
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  flipRotation,
  getDecor,
  getRotations,
  getSprite,
  isCustomId,
  listCustom,
  listDecor,
  listShops,
  loadCatalog,
  nextRotation,
  normalizeRotation,
  registerCustom,
  resolveVisual,
  unregisterCustom,
} from '../src/catalog.js';

function fixtureCatalog() {
  const sprite = (name, w, h, ax = 0.5, ay = 0.7) => [
    name, { file: `sprites/decor/${name}.png`, w, h, anchor: { x: ax, y: ay } },
  ];
  return {
    schemaVersion: 1,
    gameVersion: '1063',
    generatedAt: '2026-09-02T00:00:00Z',
    tileSize: 256,
    edgeSnapDecorIds: ['StringLights'],
    sprites: Object.fromEntries([
      sprite('HayBale', 271, 472, 0.5, 0.74),
      sprite('HayBaleSideways', 300, 400),
      sprite('Rock', 100, 80, 0.5, 0.6),
      sprite('StringLights', 256, 300, 0.5, 0.5),
      sprite('PetHutch', 500, 600, 0.5, 0.8),
      sprite('PetHutch_1', 500, 600, 0.5, 0.8),
    ]),
    decor: [
      {
        decorId: 'HayBale', name: 'Hay Bale', rarity: 'Common', shops: ['Decor'], oneTime: false,
        sprite: 'HayBale',
        rotationVariants: {
          90: { sprite: 'HayBaleSideways', flipH: true },
          180: { sprite: 'HayBale', flipH: true },
          270: { sprite: 'HayBaleSideways' },
        },
        tiers: [],
      },
      {
        decorId: 'Rock', name: 'Rock', rarity: 'Common', shops: ['Decor'], oneTime: false,
        sprite: 'Rock', rotationVariants: {}, tiers: [],
      },
      {
        decorId: 'StringLights', name: 'String Lights', rarity: 'Rare', shops: ['Decor'], oneTime: false,
        sprite: 'StringLights',
        rotationVariants: {
          90: { sprite: 'StringLights' },
          180: { sprite: 'StringLights' },
          270: { sprite: 'StringLights' },
        },
        tiers: [],
      },
      {
        decorId: 'PetHutch', name: 'Pet Hutch', rarity: 'Divine', shops: ['Tool'], oneTime: true,
        sprite: 'PetHutch', rotationVariants: {},
        tiers: [{ label: '25 slots', sprite: 'PetHutch_1' }],
      },
    ],
  };
}

beforeEach(() => {
  loadCatalog(fixtureCatalog());
  for (const asset of listCustom()) unregisterCustom(asset.decorId);
});

test('loadCatalog rejects malformed data', () => {
  assert.throws(() => loadCatalog(null));
  assert.throws(() => loadCatalog({ schemaVersion: 2, decor: [] }));
});

test('lookups: getDecor / getSprite / listShops / listDecor', () => {
  assert.equal(getDecor('HayBale').name, 'Hay Bale');
  assert.equal(getDecor('Nope'), null);
  assert.deepEqual(getSprite('Rock'), {
    file: 'sprites/decor/Rock.png', w: 100, h: 80, anchor: { x: 0.5, y: 0.6 },
  });
  assert.equal(getSprite('Nope'), null);
  assert.deepEqual(listShops(), ['Decor', 'Tool']);
  assert.deepEqual(listDecor({}).map((d) => d.decorId), ['HayBale', 'Rock', 'StringLights', 'PetHutch']);
  assert.deepEqual(listDecor({ shop: 'Tool' }).map((d) => d.decorId), ['PetHutch']);
  assert.deepEqual(listDecor({ query: 'hay' }).map((d) => d.decorId), ['HayBale']);
});

test('getRotations: [0, ...variantKeys] sorted; [0] without variants', () => {
  assert.deepEqual(getRotations('HayBale'), [0, 90, 180, 270]);
  assert.deepEqual(getRotations('Rock'), [0]);
  assert.deepEqual(getRotations('Nope'), [0]);
});

test('nextRotation matches orientDecor: cycles picklist, drops flip (indexOf(-x) === -1 -> 0)', () => {
  assert.equal(nextRotation('HayBale', 0, 1), 90);
  assert.equal(nextRotation('HayBale', 90, 1), 180);
  assert.equal(nextRotation('HayBale', 270, 1), 0);
  assert.equal(nextRotation('HayBale', 0, -1), 270);
  // Flipped current values are not in the picklist -> treated as index 0.
  assert.equal(nextRotation('HayBale', -90, 1), 90);
  assert.equal(nextRotation('HayBale', -360, 1), 90);
  // Variant-less decor cannot rotate at all.
  assert.equal(nextRotation('Rock', 0, 1), 0);
  assert.equal(nextRotation('Rock', -360, 1), -360);
});

test('flipRotation: 0 <-> -360, otherwise sign toggle', () => {
  assert.equal(flipRotation(0), -360);
  assert.equal(flipRotation(-360), 0);
  assert.equal(flipRotation(90), -90);
  assert.equal(flipRotation(-270), 270);
});

test('normalizeRotation clamps values outside the picklist to 0', () => {
  assert.equal(normalizeRotation('HayBale', 90), 90);
  assert.equal(normalizeRotation('HayBale', -90), -90);
  assert.equal(normalizeRotation('HayBale', 45), 0);
  assert.equal(normalizeRotation('HayBale', 450), 0);
  assert.equal(normalizeRotation('Rock', 90), 0); // legacy positive rotation on variant-less decor
  assert.equal(normalizeRotation('Rock', -360), -360); // flip is always valid
});

test('resolveVisual: variants, flip XOR, base fallback', () => {
  const at0 = resolveVisual('HayBale', 0);
  assert.deepEqual(
    { spriteKey: at0.spriteKey, flipH: at0.flipH, flipV: at0.flipV, worldWidth: at0.worldWidth },
    { spriteKey: 'HayBale', flipH: false, flipV: false, worldWidth: 271 },
  );
  assert.deepEqual(at0.anchor, { x: 0.5, y: 0.74 });
  assert.deepEqual(at0.offset, { x: 0, y: 0 });

  const at90 = resolveVisual('HayBale', 90);
  assert.equal(at90.spriteKey, 'HayBaleSideways');
  assert.equal(at90.flipH, true); // variant.flipH
  const atNeg90 = resolveVisual('HayBale', -90);
  assert.equal(atNeg90.flipH, false); // flipped XOR variant.flipH
  const atNeg360 = resolveVisual('HayBale', -360);
  assert.equal(atNeg360.spriteKey, 'HayBale');
  assert.equal(atNeg360.flipH, true); // flipped base
  const rockFlip = resolveVisual('Rock', -360);
  assert.equal(rockFlip.flipH, true);
  assert.equal(rockFlip.worldWidth, 100);
  assert.equal(resolveVisual('Nope', 0), null);
});

test('resolveVisual: edge-snap offsets in world px', () => {
  assert.deepEqual(resolveVisual('StringLights', 0).offset, { x: 0, y: -128 });
  assert.deepEqual(resolveVisual('StringLights', 90).offset, { x: 128, y: 0 });
  assert.deepEqual(resolveVisual('StringLights', 180).offset, { x: 0, y: 128 });
  assert.deepEqual(resolveVisual('StringLights', 270).offset, { x: -128, y: 0 });
  assert.deepEqual(resolveVisual('StringLights', -90).offset, { x: 128, y: 0 });
  assert.deepEqual(resolveVisual('StringLights', -360).offset, { x: 0, y: -128 });
  assert.deepEqual(resolveVisual('HayBale', 0).offset, { x: 0, y: 0 });
});

test('resolveVisual: tier sprite used when no variant applies', () => {
  assert.equal(resolveVisual('PetHutch', 0, 0).spriteKey, 'PetHutch_1');
  assert.equal(resolveVisual('PetHutch', 0, null).spriteKey, 'PetHutch');
  assert.equal(resolveVisual('PetHutch', 0, 5).spriteKey, 'PetHutch'); // out-of-range tier -> base
});

test('custom assets: register/list/resolve/unregister', () => {
  const asset = {
    id: 'custom:abc', name: 'My Sign', w: 300, h: 200,
    anchor: { x: 0.5, y: 0.8 }, widthTiles: 1.5,
  };
  registerCustom(asset);
  assert.equal(isCustomId('custom:abc'), true);
  assert.equal(isCustomId('HayBale'), false);
  assert.equal(getDecor('custom:abc').custom, true);
  assert.deepEqual(listCustom().map((a) => a.decorId), ['custom:abc']);
  assert.deepEqual(getRotations('custom:abc'), [0]);
  const visual = resolveVisual('custom:abc', -360);
  assert.deepEqual(visual, {
    spriteKey: 'custom:abc',
    anchor: { x: 0.5, y: 0.8 },
    worldWidth: 1.5 * 256,
    flipH: true,
    flipV: false,
    offset: { x: 0, y: 0 },
    custom: true,
  });
  assert.deepEqual(getSprite('custom:abc'), { file: null, w: 300, h: 200, anchor: { x: 0.5, y: 0.8 } });
  unregisterCustom('custom:abc');
  assert.equal(getDecor('custom:abc'), null);
});
