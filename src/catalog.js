// src/catalog.js — decor catalog state + game-parity rotation and visual
// resolution (spec §5.2/§5.3). Pure data module: no PIXI, no DOM, no fetch.
import { CUSTOM_ID_PREFIX, TILE_SIZE_WORLD, VALID_ROTATIONS } from './constants.js';

// Edge-snap offsets in tile fractions, keyed by abs rotation
// (beta DecorVisual.ts:71-95): 0 -> up, 180 -> down, 90 -> right, 270 -> left.
const EDGE_SNAP_OFFSETS = {
  0: { x: 0, y: -0.5 },
  90: { x: 0.5, y: 0 },
  180: { x: 0, y: 0.5 },
  270: { x: -0.5, y: 0 },
};

let catalog = null;
const decorById = new Map();
const customById = new Map();

export function loadCatalog(data) {
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.decor) || !data.sprites) {
    throw new Error('Invalid decor catalog (unsupported schema)');
  }
  catalog = data;
  decorById.clear();
  for (const entry of data.decor) decorById.set(entry.decorId, entry);
}

export function getGameVersion() {
  return catalog?.gameVersion ?? null;
}

export function isCustomId(id) {
  return typeof id === 'string' && id.startsWith(CUSTOM_ID_PREFIX);
}

export function getSprite(name) {
  if (isCustomId(name)) {
    const asset = customById.get(name);
    return asset ? { file: null, w: asset.w, h: asset.h, anchor: asset.anchor } : null;
  }
  return catalog?.sprites[name] ?? null;
}

export function getDecor(id) {
  if (isCustomId(id)) return customById.get(id) ?? null;
  return decorById.get(id) ?? null;
}

export function registerCustom(asset) {
  customById.set(asset.id, {
    decorId: asset.id,
    name: asset.name,
    custom: true,
    w: asset.w,
    h: asset.h,
    anchor: { x: asset.anchor.x, y: asset.anchor.y },
    widthTiles: asset.widthTiles,
  });
}

export function unregisterCustom(id) {
  customById.delete(id);
}

export function listCustom() {
  return [...customById.values()];
}

export function listShops() {
  const shops = new Set();
  for (const entry of decorById.values()) {
    for (const shop of entry.shops) shops.add(shop);
  }
  return [...shops].sort();
}

export function listDecor({ query = '', shop = null } = {}) {
  const q = String(query).trim().toLowerCase();
  const out = [];
  for (const entry of decorById.values()) {
    if (shop && !entry.shops.includes(shop)) continue;
    if (q && !entry.name.toLowerCase().includes(q)) continue;
    out.push(entry);
  }
  return out; // catalog.decor is pre-sorted by rarity then name (sync pipeline)
}

// --- Rotation model (orientDecor.ts / myAtoms.ts:478-488) -------------------

export function getRotations(id) {
  const entry = getDecor(id);
  if (!entry || entry.custom) return [0];
  const keys = Object.keys(entry.rotationVariants ?? {})
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return [0, ...keys];
}

// Game-exact: the picklist holds only non-negative values, so a flipped
// (negative) current value indexOf()s to -1 and is treated as index 0 —
// rotating drops the flip, exactly like rotateDecorClockwise in the game.
export function nextRotation(id, current, dir = 1) {
  const list = getRotations(id);
  if (list.length < 2) return current; // variant-less decor cannot rotate
  let idx = list.indexOf(current);
  if (idx === -1) idx = 0;
  return list[(idx + dir + list.length) % list.length];
}

export function flipRotation(rotation) {
  if (rotation === 0) return -360;
  if (rotation === -360) return 0;
  return -rotation;
}

export function normalizeRotation(id, rotation) {
  if (!VALID_ROTATIONS.includes(rotation)) return 0;
  const abs = rotation === -360 ? 0 : Math.abs(rotation);
  return getRotations(id).includes(abs) ? rotation : 0;
}

// --- Visual resolution (spec §5.2) ------------------------------------------

export function resolveVisual(id, rotation = 0, tierIndex = null) {
  const entry = getDecor(id);
  if (!entry) return null;
  const flipped = rotation < 0;
  const abs = rotation === -360 ? 0 : Math.abs(rotation);

  if (entry.custom) {
    return {
      spriteKey: entry.decorId,
      anchor: { x: entry.anchor.x, y: entry.anchor.y },
      worldWidth: entry.widthTiles * TILE_SIZE_WORLD,
      flipH: flipped,
      flipV: false,
      offset: { x: 0, y: 0 },
      custom: true,
    };
  }

  let spriteKey = entry.sprite;
  let flipH = flipped;
  let flipV = false;
  const variant = (entry.rotationVariants ?? {})[abs];
  if (variant) {
    spriteKey = variant.sprite;
    flipH = flipped ? !variant.flipH : !!variant.flipH; // QuinoaCanvasUtils.ts:20-54
    flipV = !!variant.flipV;
  } else if (tierIndex != null && entry.tiers?.[tierIndex]) {
    spriteKey = entry.tiers[tierIndex].sprite;
  }

  const sprite = catalog.sprites[spriteKey];
  if (!sprite) return null;

  let offset = { x: 0, y: 0 };
  if (catalog.edgeSnapDecorIds.includes(entry.decorId)) {
    const o = EDGE_SNAP_OFFSETS[abs] ?? EDGE_SNAP_OFFSETS[0];
    offset = { x: o.x * TILE_SIZE_WORLD, y: o.y * TILE_SIZE_WORLD };
  }

  return {
    spriteKey,
    anchor: { x: sprite.anchor.x, y: sprite.anchor.y },
    worldWidth: sprite.w,
    flipH,
    flipV,
    offset,
    custom: false,
  };
}
