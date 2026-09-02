// src/layoutIo.js — export/import/autosave orchestration.
// collectCustomAssets/importAssets are session stubs here; Task 13 replaces
// them with real IndexedDB-backed implementations.
import { AUTOSAVE_KEY, CUSTOM_ID_PREFIX } from './constants.js';
import { dom, state } from './state.js';
import { getDecor, isCustomId, normalizeRotation, registerCustom } from './catalog.js';
import { createExportPayload, downloadText, parseImportPayload, pickJsonFile } from './io.js';
import { clearAll, setDecorAt } from './placement.js';
import { invalidate, registerCustomBlob } from './textures.js';
import { getAsset, putAsset } from './customAssets/store.js';
import { renderDecorList } from './ui/picker.js';
import { showMessage } from './ui/modal.js';

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not encode asset'));
    reader.readAsDataURL(blob);
  });
}

// Serialise every custom asset used by a current placement (spec §6.4).
async function collectCustomAssets() {
  const used = new Set();
  for (const entry of state.placed.values()) {
    if (isCustomId(entry.decorId)) used.add(entry.decorId);
  }
  if (used.size === 0) return null;
  const out = {};
  for (const id of used) {
    const asset = await getAsset(id);
    if (!asset) continue;
    try {
      out[id] = {
        name: asset.name,
        w: asset.w,
        h: asset.h,
        anchor: { x: asset.anchor.x, y: asset.anchor.y },
        widthTiles: asset.widthTiles,
        mime: 'image/png',
        dataUrl: await blobToDataUrl(asset.blob),
      };
    } catch (err) {
      console.warn(`[export] could not embed custom asset ${id}:`, err);
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

// Restore embedded assets: same id, imported bytes win over a local copy.
async function importAssets(assets) {
  if (!assets) return;
  for (const [id, data] of Object.entries(assets)) {
    if (!id.startsWith(CUSTOM_ID_PREFIX) || !data || typeof data.dataUrl !== 'string') continue;
    try {
      const blob = await (await fetch(data.dataUrl)).blob();
      const asset = {
        id,
        name: String(data.name || 'Custom asset'),
        blob,
        mime: 'image/png',
        w: Number(data.w) || 0,
        h: Number(data.h) || 0,
        anchor: {
          x: Number(data.anchor?.x ?? 0.5),
          y: Number(data.anchor?.y ?? 0.8),
        },
        widthTiles: Number(data.widthTiles) || 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await putAsset(asset);
      registerCustom(asset);
      registerCustomBlob(id, blob);
      invalidate(id);
    } catch (err) {
      console.warn(`[import] could not restore custom asset ${id}:`, err);
    }
  }
  renderDecorList();
}

// -----------------------------------------------------------------------------

export function initLayoutIo() {
  dom.exportBtn.addEventListener('click', () => {
    void exportLayout();
  });
  dom.importBtn.addEventListener('click', importLayout);
}

export async function exportLayout() {
  const customAssets = await collectCustomAssets();
  const payload = createExportPayload({
    placed: state.placed,
    tileToGlobal: state.tileIndex.tileToGlobal,
    customAssets,
  });
  downloadText('decor-layout.json', JSON.stringify(payload, null, 2));
}

export function importLayout() {
  pickJsonFile(
    (json) => {
      void applyImport(json);
    },
    (message) => showMessage('Import failed', message),
  );
}

export async function applyImport(payload, { silent = false } = {}) {
  const parsed = parseImportPayload(payload, { globalToTile: state.tileIndex.globalToTile });
  if (parsed.decor.length === 0 && parsed.custom.length === 0 && !parsed.assets) {
    if (!silent) showMessage('Import failed', 'No decor placements found in this file.');
    return;
  }
  let skipped = parsed.skipped;
  await importAssets(parsed.assets);
  clearAll();
  for (const p of parsed.decor) {
    if (!getDecor(p.decorId)) {
      skipped += 1;
      continue;
    }
    setDecorAt(p.tileType, p.localIndex, p.decorId, normalizeRotation(p.decorId, p.rotation), p.tier);
  }
  for (const p of parsed.custom) {
    if (!getDecor(p.assetId)) {
      skipped += 1; // asset not registered (missing from store / file)
      continue;
    }
    setDecorAt(p.tileType, p.localIndex, p.assetId, normalizeRotation(p.assetId, p.rotation), null);
  }
  if (skipped > 0) {
    if (silent) {
      console.warn(`[import] ${skipped} object(s) skipped while restoring`);
    } else {
      showMessage(
        'Import finished',
        `${skipped} object(s) could not be restored (unknown decor, missing custom assets, or unsupported object types).`,
      );
    }
  }
}

export function saveAutosave() {
  try {
    const payload = createExportPayload({
      placed: state.placed,
      tileToGlobal: state.tileIndex.tileToGlobal,
      includeTier: true, // autosave keeps tiers; shared exports do not (spec §6.4)
    });
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
  } catch {
    // Quota / private mode — autosave is best-effort.
  }
}

export async function loadAutosave() {
  try {
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (saved) await applyImport(JSON.parse(saved), { silent: true });
  } catch {
    // Corrupt autosave — start clean.
  }
}
