// scripts/lib/sync-helpers.mjs — pure helpers for the game-asset snapshot
// pipeline. No I/O, no globals: everything is unit-testable via node --test.

export const RARITY_ORDER = [
  'Common', 'Uncommon', 'Rare', 'Legendary', 'Mythical', 'Mythic', 'Divine', 'Celestial',
];

// Verified against live main-*.js (game v1040, offset ~827276). Used only when
// live extraction fails and no previous catalog exists.
export const DEFAULT_EDGE_SNAP_IDS = [
  'ColoredStringLights', 'StringLights', 'WindchimeMoon',
  'WindchimeStar', 'PaperLantern', 'FanousLantern',
];

export function parseGameVersion(html) {
  const m = /\/version\/(\d+)\/assets\//.exec(String(html ?? ''));
  return m ? m[1] : null;
}

export function selectAtlasJsonPaths(manifest, resolution = 2) {
  const out = new Set();
  for (const bundle of manifest?.bundles ?? []) {
    for (const asset of bundle.assets ?? []) {
      for (const item of asset.src ?? []) {
        if (!item || typeof item !== 'object') continue; // src entries are {src, resolution} objects
        if (item.resolution !== resolution) continue;
        if (typeof item.src === 'string' && /^atlases\/sprites-.*\.json$/.test(item.src)) {
          out.add(item.src);
        }
      }
    }
  }
  return [...out];
}

export function collectDecorFrames(atlasJsons) {
  const frames = new Map();
  for (const atlas of Object.values(atlasJsons ?? {})) {
    for (const [key, frame] of Object.entries(atlas?.frames ?? {})) {
      if (!key.startsWith('sprite/decor/')) continue;
      const name = key.slice('sprite/decor/'.length);
      const size = frame.sourceSize;
      if (!size || !frame.anchor) continue; // unusable without both; surfaces later as missing-frame
      const entry = {
        w: size.w,
        h: size.h,
        anchor: { x: frame.anchor.x, y: frame.anchor.y },
      };
      if (typeof frame.visualBaselineY === 'number') entry.visualBaselineY = frame.visualBaselineY;
      frames.set(name, entry);
    }
  }
  return frames;
}

export function spriteNameFromUrl(url) {
  const clean = String(url ?? '').split(/[?#]/)[0];
  const file = clean.split('/').pop() ?? '';
  return file.replace(/\.[a-z0-9]+$/i, '');
}

export function baseSpriteName(entry) {
  if (typeof entry.art === 'string' && entry.art) {
    return entry.art.startsWith('sprite/decor/')
      ? entry.art.slice('sprite/decor/'.length)
      : entry.art;
  }
  if (entry.art && typeof entry.art === 'object' && typeof entry.art.artboardName === 'string') {
    return entry.art.artboardName; // Rive decor falls back to sprite/decor/<artboardName>
  }
  return spriteNameFromUrl(entry.sprite);
}

export function tierLabel(upgrade, index) {
  return upgrade.toCapacitySlots != null ? `${upgrade.toCapacitySlots} slots` : `Lv ${index + 1}`;
}

function rarityRank(rarity) {
  const idx = RARITY_ORDER.indexOf(rarity);
  return idx === -1 ? RARITY_ORDER.length : idx;
}

export function buildCatalog({ gameVersion, decorApi, frames, edgeSnapDecorIds, generatedAt }) {
  const log = [];
  const decor = [];
  const referenced = new Set();

  for (const [decorId, entry] of Object.entries(decorApi)) {
    if (!entry || entry.released === false) continue;
    if (!entry.sprite) continue;

    const base = baseSpriteName(entry);
    if (!frames.has(base)) {
      log.push(`missing-frame ${decorId}: base sprite "${base}" — decor dropped`);
      continue;
    }
    referenced.add(base);

    const rotationVariants = {};
    for (const [deg, variant] of Object.entries(entry.rotationVariants ?? {})) {
      if (!variant || typeof variant.sprite !== 'string') continue;
      const name = spriteNameFromUrl(variant.sprite);
      if (!frames.has(name)) {
        log.push(`missing-frame ${decorId}: variant ${deg} sprite "${name}" — variant dropped`);
        continue;
      }
      referenced.add(name);
      const out = { sprite: name };
      if (variant.flipH === true) out.flipH = true;
      if (variant.flipV === true) out.flipV = true;
      rotationVariants[deg] = out;
    }

    const tiers = [];
    (entry.upgrades ?? []).forEach((upgrade, i) => {
      if (!upgrade || typeof upgrade.sprite !== 'string') return;
      const name = spriteNameFromUrl(upgrade.sprite);
      if (!frames.has(name)) {
        log.push(`missing-frame ${decorId}: tier ${i} sprite "${name}" — tier dropped`);
        return;
      }
      referenced.add(name);
      tiers.push({ label: tierLabel(upgrade, i), sprite: name });
    });

    decor.push({
      decorId,
      name: entry.name || decorId,
      rarity: entry.rarity || 'Common',
      shops: entry.eligibleShops ?? [],
      oneTime: entry.isOneTimePurchase === true,
      sprite: base,
      rotationVariants,
      tiers,
    });
  }

  decor.sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity) || a.name.localeCompare(b.name));

  const sprites = {};
  for (const name of [...referenced].sort()) {
    const frame = frames.get(name);
    sprites[name] = {
      file: `sprites/decor/${name}.png`,
      w: frame.w,
      h: frame.h,
      anchor: frame.anchor,
    };
    if (typeof frame.visualBaselineY === 'number') sprites[name].visualBaselineY = frame.visualBaselineY;
  }

  return {
    catalog: {
      schemaVersion: 1,
      gameVersion,
      generatedAt,
      tileSize: 256,
      edgeSnapDecorIds,
      sprites,
      decor,
    },
    log,
  };
}

export function readPngSize(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || sig.some((v, i) => b[i] !== v)) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}

export function extractEdgeSnapIds(text) {
  const re = /\[((?:["'`][A-Za-z]+["'`]\s*,?\s*){2,})\]\.includes\([\w$]+(?:\.[\w$]+)*\.decorId\)/g;
  let match;
  while ((match = re.exec(String(text ?? ''))) !== null) {
    const ids = [...match[1].matchAll(/["'`]([A-Za-z]+)["'`]/g)].map((m) => m[1]);
    if (ids.includes('StringLights')) return ids;
  }
  return null;
}

export function findChunkPath(text, prefix) {
  const re = new RegExp(`["'\`]([\\w./-]*${prefix}[\\w-]+\\.js)["'\`]`);
  const match = re.exec(String(text ?? ''));
  return match ? match[1] : null;
}

export function assertNotShrunk(oldCount, newCount) {
  return !(oldCount > 0 && newCount < oldCount * 0.8);
}

export function stripVolatile(catalog) {
  const { generatedAt, ...rest } = catalog;
  return rest;
}
