// src/constants.js — shared constants. No side effects.

export const ASSET_BASE = './assets/';
export const CATALOG_URL = './assets/decor-catalog.json';
export const MAP_URL = './assets/map.json';

// Game world parity (beta DecorVisual.ts / sprite-utils.ts).
export const TILE_SIZE_WORLD = 256;

export const GARDEN_SLOT = 5;
export const GARDEN_MARGIN = 6;

export const ABS_MIN_TILE_SIZE = 16;
export const ABS_MAX_TILE_SIZE = 512;
export const DEFAULT_TILE_SIZE = 180;

export const AUTOSAVE_KEY = 'mg-decorcustomiser-autosave-v1';

// The game's rotation picklist (V14_QuinoaUserJson.ts:46-57):
// negative = horizontally flipped; -360 is "flipped 0 degrees".
export const VALID_ROTATIONS = [0, -360, 90, -90, 180, -180, 270, -270];

export const CUSTOM_ID_PREFIX = 'custom:';
export const CUSTOM_LIMITS = {
  maxSide: 2048,
  maxBytes: 2 * 1024 * 1024,
  types: ['image/png', 'image/webp', 'image/jpeg', 'image/gif'],
};
export const DB_NAME = 'mg-decor-customiser';
