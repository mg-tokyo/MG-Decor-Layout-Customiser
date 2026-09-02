// src/io.js — export/import payload building and parsing (spec §6.4), plus
// small DOM file helpers. Payload functions are pure and Node-testable.
import { CUSTOM_ID_PREFIX } from './constants.js';

export function createExportPayload({ placed, tileToGlobal, customAssets = null, includeTier = false }) {
  const tileObjects = {};
  const boardwalkTileObjects = {};
  const customPlacements = {};
  const usedAssets = new Set();

  for (const entry of placed.values()) {
    const globalIdx = tileToGlobal[entry.tileType]?.get(entry.localIndex);
    if (globalIdx === undefined) continue;
    if (entry.decorId.startsWith(CUSTOM_ID_PREFIX)) {
      customPlacements[String(globalIdx)] = {
        assetId: entry.decorId,
        rotation: entry.rotation,
        tileType: entry.tileType,
      };
      usedAssets.add(entry.decorId);
    } else {
      const obj = { objectType: 'decor', decorId: entry.decorId, rotation: entry.rotation };
      if (includeTier && entry.tier != null) obj.tier = entry.tier;
      (entry.tileType === 'dirt' ? tileObjects : boardwalkTileObjects)[String(globalIdx)] = obj;
    }
  }

  const payload = { tileObjects, boardwalkTileObjects };
  if (Object.keys(customPlacements).length > 0) payload.customPlacements = customPlacements;
  if (customAssets) {
    const filtered = {};
    for (const id of usedAssets) {
      if (customAssets[id]) filtered[id] = customAssets[id];
    }
    if (Object.keys(filtered).length > 0) payload.customAssets = filtered;
  }
  return payload;
}

export function parseImportPayload(payload, { globalToTile }) {
  const garden = payload?.garden ?? payload ?? {};
  const decor = [];
  const custom = [];
  let skipped = 0;

  const readBlock = (objs) => {
    if (!objs) return;
    for (const key of Object.keys(objs)) {
      const entry = objs[key];
      if (!entry) continue;
      if (entry.objectType !== 'decor') {
        skipped += 1; // plants/eggs from legacy files are intentionally dropped
        continue;
      }
      const tile = globalToTile.get(Number(key));
      if (!tile) {
        skipped += 1;
        continue;
      }
      decor.push({
        tileType: tile.tileType,
        localIndex: tile.localIndex,
        decorId: entry.decorId,
        rotation: entry.rotation ?? 0,
        tier: entry.tier ?? null,
      });
    }
  };
  readBlock(garden.tileObjects);
  readBlock(garden.boardwalkTileObjects);

  const customBlock = garden.customPlacements ?? payload?.customPlacements;
  if (customBlock) {
    for (const key of Object.keys(customBlock)) {
      const entry = customBlock[key];
      if (!entry || typeof entry.assetId !== 'string') continue;
      const tile = globalToTile.get(Number(key));
      if (!tile) {
        skipped += 1;
        continue;
      }
      custom.push({
        tileType: tile.tileType,
        localIndex: tile.localIndex,
        assetId: entry.assetId,
        rotation: entry.rotation ?? 0,
      });
    }
  }

  const assets = garden.customAssets ?? payload?.customAssets ?? null;
  return { decor, custom, assets, skipped };
}

// --- DOM helpers (not covered by node tests) --------------------------------

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function pickJsonFile(onLoad, onError) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        onLoad(JSON.parse(String(reader.result)));
      } catch {
        onError('The selected file is not valid JSON.');
      }
    };
    reader.onerror = () => onError('Could not read the selected file.');
    reader.readAsText(file);
  };
  input.click();
}
