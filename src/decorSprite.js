// src/decorSprite.js — decor container construction with game-parity rules
// (spec §5.2). Never sets angle/rotation: orientation is flips + variant art.
import { resolveVisual } from './catalog.js';
import { getTexture } from './textures.js';

export function calculateZIndex(worldY, bottomOffset) {
  const tieBreaker = Math.min(bottomOffset / 1000, 0.9);
  return Math.floor(worldY * 10000) + 1 + tieBreaker;
}

export async function createDecorSprite(decorId, rotation = 0, tierIndex = null) {
  const visual = resolveVisual(decorId, rotation, tierIndex);
  if (!visual) return null;
  const PIXI = globalThis.PIXI;
  const texture = await getTexture(visual.spriteKey);
  const container = new PIXI.Container();
  container.label = `decor-${decorId}`;
  const sprite = new PIXI.Sprite(texture);
  sprite.anchor.set(visual.anchor.x, visual.anchor.y);
  // 1 texture px = 1 world px. The ratio is 1 for well-formed PNGs, guards
  // size-mismatch snapshots, and applies widthTiles scaling for custom assets
  // (worldWidth = widthTiles * 256). It also sizes the 64px placeholder.
  const scale = texture.width > 0 ? visual.worldWidth / texture.width : 1;
  sprite.scale.set(visual.flipH ? -scale : scale, visual.flipV ? -scale : scale);
  sprite.position.set(visual.offset.x, visual.offset.y); // edge-snap offset
  container.addChild(sprite);
  return container;
}
