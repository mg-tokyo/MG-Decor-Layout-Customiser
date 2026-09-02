// tests/sync-helpers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EDGE_SNAP_IDS,
  RARITY_ORDER,
  assertNotShrunk,
  baseSpriteName,
  buildCatalog,
  collectDecorFrames,
  extractEdgeSnapIds,
  findChunkPath,
  parseGameVersion,
  readPngSize,
  selectAtlasJsonPaths,
  spriteNameFromUrl,
  stripVolatile,
  tierLabel,
} from '../scripts/lib/sync-helpers.mjs';

test('parseGameVersion finds the version in script URLs', () => {
  const html = '<script type="module" src="/version/1063/assets/index-B2fKx9.js"></script>';
  assert.equal(parseGameVersion(html), '1063');
  assert.equal(parseGameVersion('<html>no version here</html>'), null);
  assert.equal(parseGameVersion(null), null);
});

test('selectAtlasJsonPaths keeps only 2x sprite atlas JSONs, deduped', () => {
  const manifest = {
    bundles: [
      {
        assets: [
          {
            src: [
              { src: 'atlases/sprites-2x-0.json', resolution: 2 },
              { src: 'atlases/sprites-1x-0.json', resolution: 1 },
            ],
          },
          { src: [{ src: 'atlases/tiles-2x.json', resolution: 2 }] },
          { src: [{ src: 'audio/music.json', resolution: 2 }] },
          { src: ['plain-string.json'] },
          { src: [{ src: 'atlases/sprites-2x-0.json', resolution: 2 }] },
        ],
      },
    ],
  };
  assert.deepEqual(selectAtlasJsonPaths(manifest, 2), ['atlases/sprites-2x-0.json']);
  assert.deepEqual(selectAtlasJsonPaths({}, 2), []);
});

test('collectDecorFrames extracts decor frames with anchors', () => {
  const atlases = {
    'atlases/sprites-2x-0.json': {
      frames: {
        'sprite/decor/HayBale': {
          frame: { x: 0, y: 0, w: 260, h: 470 },
          sourceSize: { w: 271, h: 472 },
          anchor: { x: 0.5, y: 0.74 },
          visualBaselineY: 0.987,
        },
        'sprite/plant/Sprout': { sourceSize: { w: 10, h: 10 }, anchor: { x: 0.5, y: 0.5 } },
        'sprite/decor/NoAnchor': { sourceSize: { w: 5, h: 5 } },
      },
    },
    'atlases/sprites-2x-1.json': {
      frames: {
        'sprite/decor/Rock': { sourceSize: { w: 100, h: 80 }, anchor: { x: 0.5, y: 0.6 } },
      },
    },
  };
  const frames = collectDecorFrames(atlases);
  assert.deepEqual([...frames.keys()].sort(), ['HayBale', 'Rock']);
  assert.deepEqual(frames.get('HayBale'), {
    w: 271, h: 472, anchor: { x: 0.5, y: 0.74 }, visualBaselineY: 0.987,
  });
  assert.deepEqual(frames.get('Rock'), { w: 100, h: 80, anchor: { x: 0.5, y: 0.6 } });
});

test('spriteNameFromUrl strips path, query and extension', () => {
  assert.equal(spriteNameFromUrl('https://mg-api.ariedam.fr/assets/sprites/decor/HayBaleSideways.png?v=3'), 'HayBaleSideways');
  assert.equal(spriteNameFromUrl('decor/Bench.png'), 'Bench');
  assert.equal(spriteNameFromUrl('Plain'), 'Plain');
});

test('baseSpriteName prefers art string, then artboardName, then sprite URL', () => {
  assert.equal(baseSpriteName({ art: 'sprite/decor/HayBale', sprite: 'x/Wrong.png' }), 'HayBale');
  assert.equal(baseSpriteName({ art: 'BareName', sprite: 'x/Wrong.png' }), 'BareName');
  assert.equal(baseSpriteName({ art: { artboardName: 'CoolCat' }, sprite: 'x/Wrong.png' }), 'CoolCat');
  assert.equal(baseSpriteName({ sprite: 'https://x/assets/sprites/decor/Bench.png?v=1' }), 'Bench');
});

test('tierLabel uses toCapacitySlots when present', () => {
  assert.equal(tierLabel({ toCapacitySlots: 25 }, 0), '25 slots');
  assert.equal(tierLabel({}, 0), 'Lv 1');
  assert.equal(tierLabel({ sprite: 'x' }, 2), 'Lv 3');
});

test('readPngSize reads IHDR dimensions and rejects non-PNGs', () => {
  const png = new Uint8Array(26);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const dv = new DataView(png.buffer);
  dv.setUint32(16, 271);
  dv.setUint32(20, 472);
  assert.deepEqual(readPngSize(png), { w: 271, h: 472 });
  assert.equal(readPngSize(new Uint8Array([1, 2, 3])), null);
  assert.equal(readPngSize(new Uint8Array(0)), null);
});

test('extractEdgeSnapIds finds the StringLights list, any quote style', () => {
  const doubleQuoted = 'var q=["WindchimeMoon","StringLights","PaperLantern"].includes(e.decorId)?1:0;var z=["Foo","Bar"].includes(x.decorId);';
  assert.deepEqual(extractEdgeSnapIds(doubleQuoted), ['WindchimeMoon', 'StringLights', 'PaperLantern']);
  const backticked = 'const a=[`ColoredStringLights`,`StringLights`].includes(t.decorId);';
  assert.deepEqual(extractEdgeSnapIds(backticked), ['ColoredStringLights', 'StringLights']);
  assert.equal(extractEdgeSnapIds('["Foo","Bar"].includes(x.decorId)'), null);
  assert.equal(extractEdgeSnapIds('no arrays at all'), null);
});

test('findChunkPath finds a quoted chunk path by prefix', () => {
  assert.equal(
    findChunkPath('<script src="/version/1063/assets/index-B2fKx9.js"></script>', 'index-'),
    '/version/1063/assets/index-B2fKx9.js',
  );
  assert.equal(findChunkPath('import"./main-Cx9Yz.js";', 'main-'), './main-Cx9Yz.js');
  assert.equal(findChunkPath('nothing here', 'main-'), null);
});

test('assertNotShrunk applies the 80% floor', () => {
  assert.equal(assertNotShrunk(60, 60), true);
  assert.equal(assertNotShrunk(60, 48), true);
  assert.equal(assertNotShrunk(60, 47), false);
  assert.equal(assertNotShrunk(0, 0), true);
});

test('stripVolatile removes generatedAt only', () => {
  const cat = { schemaVersion: 1, generatedAt: 'now', decor: [] };
  assert.deepEqual(stripVolatile(cat), { schemaVersion: 1, decor: [] });
  assert.equal(cat.generatedAt, 'now');
});

test('DEFAULT_EDGE_SNAP_IDS matches the verified live list', () => {
  assert.deepEqual(DEFAULT_EDGE_SNAP_IDS, [
    'ColoredStringLights', 'StringLights', 'WindchimeMoon',
    'WindchimeStar', 'PaperLantern', 'FanousLantern',
  ]);
});

function fixtureFrames() {
  return new Map([
    ['HayBale', { w: 271, h: 472, anchor: { x: 0.5, y: 0.74 } }],
    ['HayBaleSideways', { w: 300, h: 400, anchor: { x: 0.5, y: 0.7 } }],
    ['PetHutch', { w: 500, h: 600, anchor: { x: 0.5, y: 0.8 } }],
    ['PetHutch_1', { w: 500, h: 600, anchor: { x: 0.5, y: 0.8 } }],
  ]);
}

function fixtureDecorApi() {
  const png = (name) => `https://mg-api.ariedam.fr/assets/sprites/decor/${name}.png?v=1`;
  return {
    HayBale: {
      name: 'Hay Bale', rarity: 'Common', eligibleShops: ['Decor'],
      art: 'sprite/decor/HayBale', sprite: png('HayBale'),
      rotationVariants: {
        90: { sprite: png('HayBaleSideways'), flipH: true },
        180: { sprite: png('HayBale'), flipH: true },
        270: { sprite: png('HayBaleSideways') },
      },
    },
    Unreleased: { name: 'Secret', released: false, sprite: png('Secret') },
    NoSprite: { name: 'No Sprite' },
    Ghosty: { name: 'Ghosty', rarity: 'Rare', sprite: png('Ghosty') },
    PetHutch: {
      name: 'Pet Hutch', rarity: 'Divine', eligibleShops: ['Tool'], isOneTimePurchase: true,
      sprite: png('PetHutch'),
      upgrades: [
        { toCapacitySlots: 25, sprite: png('PetHutch_1') },
        { note: 'no sprite on this upgrade' },
        { toCapacitySlots: 50, sprite: png('MissingTierArt') },
      ],
    },
  };
}

test('buildCatalog filters, maps variants/tiers, logs missing frames, sorts', () => {
  const { catalog, log } = buildCatalog({
    gameVersion: '1063',
    decorApi: fixtureDecorApi(),
    frames: fixtureFrames(),
    edgeSnapDecorIds: DEFAULT_EDGE_SNAP_IDS,
    generatedAt: '2026-09-02T00:00:00Z',
  });

  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.gameVersion, '1063');
  assert.equal(catalog.tileSize, 256);
  assert.deepEqual(catalog.edgeSnapDecorIds, DEFAULT_EDGE_SNAP_IDS);

  // Unreleased (released:false), NoSprite (no sprite) and Ghosty (missing frame) are dropped.
  assert.deepEqual(catalog.decor.map((d) => d.decorId), ['HayBale', 'PetHutch']);
  assert.ok(log.some((l) => l.includes('missing-frame') && l.includes('Ghosty')));
  assert.ok(log.some((l) => l.includes('missing-frame') && l.includes('MissingTierArt')));

  const hay = catalog.decor[0];
  assert.equal(hay.name, 'Hay Bale');
  assert.equal(hay.rarity, 'Common');
  assert.deepEqual(hay.shops, ['Decor']);
  assert.equal(hay.oneTime, false);
  assert.equal(hay.sprite, 'HayBale');
  assert.deepEqual(hay.rotationVariants, {
    90: { sprite: 'HayBaleSideways', flipH: true },
    180: { sprite: 'HayBale', flipH: true },
    270: { sprite: 'HayBaleSideways' },
  });
  assert.deepEqual(hay.tiers, []);

  const hutch = catalog.decor[1];
  assert.equal(hutch.oneTime, true);
  assert.deepEqual(hutch.tiers, [{ label: '25 slots', sprite: 'PetHutch_1' }]);

  // Sprites map covers exactly the referenced names, with file paths + anchors.
  assert.deepEqual(Object.keys(catalog.sprites).sort(), ['HayBale', 'HayBaleSideways', 'PetHutch', 'PetHutch_1']);
  assert.deepEqual(catalog.sprites.HayBale, {
    file: 'sprites/decor/HayBale.png', w: 271, h: 472, anchor: { x: 0.5, y: 0.74 },
  });
});

test('buildCatalog sorts by rarity order then name', () => {
  const frames = new Map([
    ['A', { w: 1, h: 1, anchor: { x: 0.5, y: 0.5 } }],
    ['B', { w: 1, h: 1, anchor: { x: 0.5, y: 0.5 } }],
    ['C', { w: 1, h: 1, anchor: { x: 0.5, y: 0.5 } }],
  ]);
  const { catalog } = buildCatalog({
    gameVersion: '1', generatedAt: 'x', edgeSnapDecorIds: [], frames,
    decorApi: {
      Zed: { name: 'Zed', rarity: 'Common', sprite: 'x/A.png' },
      Abe: { name: 'Abe', rarity: 'Divine', sprite: 'x/B.png' },
      Moo: { name: 'Moo', rarity: 'Common', sprite: 'x/C.png' },
    },
  });
  assert.deepEqual(catalog.decor.map((d) => d.name), ['Moo', 'Zed', 'Abe']);
  assert.ok(RARITY_ORDER.indexOf('Common') < RARITY_ORDER.indexOf('Divine'));
});
