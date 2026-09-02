// src/layoutIo.js — export/import/autosave orchestration.
// collectCustomAssets/importAssets are session stubs here; Task 13 replaces
// them with real IndexedDB-backed implementations.
import { AUTOSAVE_KEY } from './constants.js';
import { dom, state } from './state.js';
import { getDecor, normalizeRotation } from './catalog.js';
import { createExportPayload, downloadText, parseImportPayload, pickJsonFile } from './io.js';
import { clearAll, setDecorAt } from './placement.js';
import { showMessage } from './ui/modal.js';

// --- Custom-asset stubs (replaced in Task 13) --------------------------------

async function collectCustomAssets() {
  return null;
}

async function importAssets(assets) {
  void assets;
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
