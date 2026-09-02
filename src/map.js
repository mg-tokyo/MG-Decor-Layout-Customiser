// src/map.js — Tiled map indexing, grid/world conversion and tilemap build.
// The index/bounds/conversion functions are pure; buildTilemap is browser-only.
import { TILE_SIZE_WORLD } from './constants.js';

const FLIPPED_HORIZONTALLY_FLAG = 0x80000000;
const FLIPPED_VERTICALLY_FLAG = 0x40000000;
const FLIPPED_DIAGONALLY_FLAG = 0x20000000;
const TILE_ID_MASK = 0x1fffffff;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function createTileIndex() {
  return {
    dirtGlobals: [],
    boardwalkGlobals: [],
    globalToTile: new Map(),
    tileToGlobal: { dirt: new Map(), boardwalk: new Map() },
  };
}

export function buildTileIndex(mapData, slot) {
  const tileIndex = createTileIndex();
  const slotName = String(slot).padStart(2, '0');
  const layers = ['DirtTiles', 'BoardwalkTiles'].map((name) =>
    mapData.layers.find(
      (l) => (l.class === name || l.name.startsWith(name)) && l.name.endsWith(`-${slotName}`),
    ),
  );
  layers.forEach((layer, i) => {
    if (!layer || !layer.data) return;
    const type = i === 0 ? 'dirt' : 'boardwalk';
    layer.data.forEach((gid, idx) => {
      if (gid > 0) {
        const localIdx = tileIndex[`${type}Globals`].length;
        tileIndex[`${type}Globals`].push(idx);
        tileIndex.globalToTile.set(idx, { tileType: type, localIndex: localIdx });
        tileIndex.tileToGlobal[type].set(localIdx, idx);
      }
    });
  });
  return tileIndex;
}

export function computeRenderBounds(mapData, tileIndex, margin) {
  const allGlobals = tileIndex.dirtGlobals.concat(tileIndex.boardwalkGlobals);
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const idx of allGlobals) {
    const x = idx % mapData.width;
    const y = Math.floor(idx / mapData.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    minX: clamp(minX - margin, 0, mapData.width - 1),
    minY: clamp(minY - margin, 0, mapData.height - 1),
    maxX: clamp(maxX + margin, 0, mapData.width - 1),
    maxY: clamp(maxY + margin, 0, mapData.height - 1),
    gardenMinX: minX,
    gardenMinY: minY,
    gardenMaxX: maxX,
    gardenMaxY: maxY,
  };
}

export function gridToWorld(gridX, gridY, bounds) {
  return {
    x: (gridX - bounds.minX) * TILE_SIZE_WORLD + TILE_SIZE_WORLD / 2,
    y: (gridY - bounds.minY) * TILE_SIZE_WORLD + TILE_SIZE_WORLD / 2,
  };
}

export function worldToGrid(worldX, worldY, bounds) {
  return {
    gridX: Math.floor(worldX / TILE_SIZE_WORLD) + bounds.minX,
    gridY: Math.floor(worldY / TILE_SIZE_WORLD) + bounds.minY,
  };
}

export function getTileHit(gridX, gridY, mapData, tileIndex) {
  if (!mapData) return null;
  if (gridX < 0 || gridY < 0 || gridX >= mapData.width || gridY >= mapData.height) return null;
  return tileIndex.globalToTile.get(gridY * mapData.width + gridX) ?? null;
}

// --- Browser-only tilemap construction --------------------------------------

function getTileTexture(key) {
  const PIXI = globalThis.PIXI;
  const sheet = PIXI.Assets.get('tiles');
  return sheet?.textures?.[key] ?? PIXI.Texture.EMPTY;
}

function getAssetKeyFromPath(path) {
  const match = path.match(/(?:^|\/)(?:export-from-figma-to-this-folder\{ignore\}[^/]*)\/(.+)\./);
  if (match && match[1]) return match[1];
  const filename = path.split('/').pop();
  if (filename) return filename.split('.')[0];
  return path;
}

function getTileFlipFlags(gid) {
  return {
    flippedH: !!(gid & FLIPPED_HORIZONTALLY_FLAG),
    flippedV: !!(gid & FLIPPED_VERTICALLY_FLAG),
    flippedD: !!(gid & FLIPPED_DIAGONALLY_FLAG),
  };
}

function tiledFlipsToGroupD8(flippedH, flippedV, flippedD) {
  const PIXI = globalThis.PIXI;
  let group = PIXI.groupD8.E;
  if (flippedD) group = PIXI.groupD8.add(group, PIXI.groupD8.MAIN_DIAGONAL);
  if (flippedH) group = PIXI.groupD8.add(group, PIXI.groupD8.MIRROR_HORIZONTAL);
  if (flippedV) group = PIXI.groupD8.add(group, PIXI.groupD8.MIRROR_VERTICAL);
  return group;
}

function getTextureForGid(gid, tilesets) {
  const PIXI = globalThis.PIXI;
  const tileId = gid & TILE_ID_MASK;
  if (!tilesets) return null;
  let tileset;
  for (let i = tilesets.length - 1; i >= 0; i -= 1) {
    if (tilesets[i].firstgid <= tileId) {
      tileset = tilesets[i];
      break;
    }
  }
  if (!tileset) return null;
  const localId = tileId - tileset.firstgid;
  if (tileset.image) {
    const baseTexture = getTileTexture(getAssetKeyFromPath(tileset.image));
    if (baseTexture === PIXI.Texture.EMPTY) return null;
    const margin = tileset.margin || 0;
    const spacing = tileset.spacing || 0;
    const tileX = margin + (localId % tileset.columns) * (tileset.tilewidth + spacing);
    const tileY = margin + Math.floor(localId / tileset.columns) * (tileset.tileheight + spacing);
    return new PIXI.Texture({
      source: baseTexture.source,
      frame: new PIXI.Rectangle(tileX, tileY, tileset.tilewidth, tileset.tileheight),
    });
  }
  if (tileset.tiles) {
    const tile = tileset.tiles.find((t) => t.id === localId);
    if (!tile || !tile.image) return null;
    const tex = getTileTexture(getAssetKeyFromPath(tile.image));
    return tex === PIXI.Texture.EMPTY ? null : tex;
  }
  return null;
}

export function buildTilemap(mapData, bounds) {
  const PIXI = globalThis.PIXI;
  const b = bounds;
  const tilemap = PIXI.tilemap && PIXI.tilemap.CompositeTilemap
    ? new PIXI.tilemap.CompositeTilemap()
    : new PIXI.Container();
  const assets = {
    wood: [getTileTexture('tile/WoodPlatform_A'), getTileTexture('tile/WoodPlatform_B')],
    dirt: ['A', 'B', 'C'].map((suffix) => getTileTexture(`tile/Dirt_${suffix}`)),
  };
  const layers = mapData.layers.filter(
    (l) =>
      l.type === 'tilelayer' &&
      l.data &&
      l.name !== 'Override' &&
      (l.visible || l.class === 'BoardwalkTiles' || l.name.includes('BoardwalkTiles') || l.class === 'DirtTiles'),
  );
  for (const layer of layers) {
    const isBW = layer.class === 'BoardwalkTiles' || (layer.name && layer.name.includes('BoardwalkTiles'));
    const isDirt = layer.class === 'DirtTiles';
    for (let y = b.minY; y <= b.maxY; y += 1) {
      for (let x = b.minX; x <= b.maxX; x += 1) {
        const gid = layer.data[y * mapData.width + x];
        if (!gid) continue;
        const texture = isBW
          ? assets.wood[(x + y) % 2]
          : isDirt
            ? assets.dirt[(x + y * 3) % 3]
            : getTextureForGid(gid, mapData.tilesets);
        if (!texture || texture === PIXI.Texture.EMPTY) continue;
        const worldX = (x - b.minX) * TILE_SIZE_WORLD;
        const worldY = (y - b.minY) * TILE_SIZE_WORLD - (texture.height - TILE_SIZE_WORLD);
        if (tilemap.tile) {
          const flips = getTileFlipFlags(gid);
          tilemap.tile(texture, worldX, worldY, {
            rotate: isBW ? PIXI.groupD8.E : tiledFlipsToGroupD8(flips.flippedH, flips.flippedV, flips.flippedD),
          });
        } else {
          const sprite = new PIXI.Sprite(texture);
          sprite.position.set(worldX, worldY);
          tilemap.addChild(sprite);
        }
      }
    }
  }
  return tilemap;
}
