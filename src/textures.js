// src/textures.js — texture, placeholder and thumbnail loading with caching.
// PIXI and document are only touched inside functions so Node can import this.
import { ASSET_BASE } from './constants.js';
import { getSprite, isCustomId } from './catalog.js';

let assetVersion = '';
const texturePromises = new Map(); // spriteKey -> Promise<Texture>
const thumbnailPromises = new Map(); // `${spriteKey}@${size}` -> Promise<canvas>
const customBlobs = new Map(); // custom asset id -> Blob (PNG)
let placeholderTexture = null;

export function setAssetVersion(version) {
  assetVersion = version ? String(version) : '';
}

export function registerCustomBlob(id, blob) {
  customBlobs.set(id, blob);
}

export function removeCustomBlob(id) {
  customBlobs.delete(id);
  invalidate(id);
}

function getPlaceholder() {
  if (placeholderTexture) return placeholderTexture;
  const PIXI = globalThis.PIXI;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ff00ff';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillRect(32, 32, 32, 32);
  placeholderTexture = PIXI.Texture.from(canvas);
  placeholderTexture.label = 'placeholder';
  return placeholderTexture;
}

export function isPlaceholder(texture) {
  return texture?.label === 'placeholder';
}

async function loadTexture(spriteKey) {
  const PIXI = globalThis.PIXI;
  if (isCustomId(spriteKey)) {
    const blob = customBlobs.get(spriteKey);
    if (!blob) throw new Error(`no blob registered for ${spriteKey}`);
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    return PIXI.Texture.from(canvas);
  }
  const sprite = getSprite(spriteKey);
  if (!sprite || !sprite.file) throw new Error(`unknown sprite ${spriteKey}`);
  const src = `${ASSET_BASE}${sprite.file}${assetVersion ? `?v=${assetVersion}` : ''}`;
  return PIXI.Assets.load({ alias: `decor/${spriteKey}`, src });
}

export function getTexture(spriteKey) {
  let promise = texturePromises.get(spriteKey);
  if (!promise) {
    promise = loadTexture(spriteKey).catch((err) => {
      console.warn(`[textures] placeholder for "${spriteKey}":`, err?.message ?? err);
      return getPlaceholder();
    });
    texturePromises.set(spriteKey, promise);
  }
  return promise;
}

export function invalidate(spriteKey) {
  texturePromises.delete(spriteKey);
  for (const key of [...thumbnailPromises.keys()]) {
    if (key === spriteKey || key.startsWith(`${spriteKey}@`)) thumbnailPromises.delete(key);
  }
}

// Returns a SHARED cached canvas: callers must drawImage() it into their own
// canvas rather than appending it (a canvas element can live in one DOM spot).
export function getThumbnail(spriteKey, size = 64) {
  const cacheKey = `${spriteKey}@${size}`;
  let promise = thumbnailPromises.get(cacheKey);
  if (!promise) {
    promise = (async () => {
      const texture = await getTexture(spriteKey);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const source = texture.source?.resource;
      if (source) {
        const f = texture.frame;
        const scale = Math.min((size - 4) / f.width, (size - 4) / f.height);
        const drawW = f.width * scale;
        const drawH = f.height * scale;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(
          source,
          f.x, f.y, f.width, f.height,
          (size - drawW) / 2, (size - drawH) / 2, drawW, drawH,
        );
      }
      return canvas;
    })();
    thumbnailPromises.set(cacheKey, promise);
  }
  return promise;
}

export function preloadAll(keys, concurrency = 4) {
  const queue = [...keys];
  const worker = async () => {
    while (queue.length > 0) {
      await getTexture(queue.shift());
    }
  };
  void Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
}
