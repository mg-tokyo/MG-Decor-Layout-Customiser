// src/customAssets/editor.js — upload/edit dialog for custom assets (spec §6.2):
// live 3x3-tile preview rendered exactly as decorSprite will place it, drag to
// set the anchor, width-in-tiles scaling, presets, and delete flow.
import { CUSTOM_ID_PREFIX, CUSTOM_LIMITS, TILE_SIZE_WORLD } from '../constants.js';
import { dom, state } from '../state.js';
import { getDecor, registerCustom, unregisterCustom } from '../catalog.js';
import { invalidate, registerCustomBlob, removeCustomBlob } from '../textures.js';
import { deleteAsset, getAsset, putAsset } from './store.js';
import { removePlacementsForDecor, rerenderDecor, updateGhost } from '../placement.js';
import { clearSelection, renderDecorList, updateSelectionPreview } from '../ui/picker.js';
import { confirmDialog } from '../ui/modal.js';

let editing = null; // working copy: {id, name, blob, w, h, anchor, widthTiles, createdAt}
let bitmap = null; // decoded preview image
let isNew = true;

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function clampWidth(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(6, Math.max(0.1, value));
}

function showError(message) {
  dom.editorError.textContent = message;
  dom.editorError.hidden = !message;
}

function updateMeta() {
  dom.editorMeta.textContent = editing && editing.w > 0
    ? `${editing.w}×${editing.h} px`
    : 'No image selected — choose a file or drop one here.';
}

function updateAnchorLabel() {
  if (!editing) return;
  dom.editorAnchorLabel.textContent =
    `Anchor: x ${editing.anchor.x.toFixed(2)} · y ${editing.anchor.y.toFixed(2)}`;
}

async function decodeImageFile(file) {
  if (!CUSTOM_LIMITS.types.includes(file.type)) {
    throw new Error('Unsupported file type. Use PNG, WebP, JPEG or GIF.');
  }
  if (file.size > CUSTOM_LIMITS.maxBytes) {
    throw new Error('File is larger than 2 MB.');
  }
  const decoded = await createImageBitmap(file); // GIF: first frame
  if (decoded.width > CUSTOM_LIMITS.maxSide || decoded.height > CUSTOM_LIMITS.maxSide) {
    decoded.close();
    throw new Error('Image is larger than 2048 px on a side.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = decoded.width;
  canvas.height = decoded.height;
  canvas.getContext('2d').drawImage(decoded, 0, 0);
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image.'))), 'image/png'),
  );
  return { blob, bitmap: decoded, w: decoded.width, h: decoded.height };
}

function renderPreview() {
  const canvas = dom.editorCanvas;
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const zoom = size / (3 * TILE_SIZE_WORLD);
  ctx.clearRect(0, 0, size, size);

  // Centre tile highlight + 3x3 grid.
  ctx.fillStyle = 'rgba(106, 210, 166, 0.15)';
  ctx.fillRect(TILE_SIZE_WORLD * zoom, TILE_SIZE_WORLD * zoom, TILE_SIZE_WORLD * zoom, TILE_SIZE_WORLD * zoom);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i += 1) {
    const p = i * TILE_SIZE_WORLD * zoom;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  const cx = size / 2;
  const cy = size / 2;
  if (bitmap && editing && editing.w > 0) {
    // Composite exactly as decorSprite renders: anchor pinned at the centre
    // tile's centre, world width = widthTiles * 256.
    const scale = ((editing.widthTiles * TILE_SIZE_WORLD) / editing.w) * zoom;
    const drawW = editing.w * scale;
    const drawH = editing.h * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bitmap, cx - editing.anchor.x * drawW, cy - editing.anchor.y * drawH, drawW, drawH);
  }

  // Anchor crosshair at the tile centre.
  ctx.strokeStyle = '#ff6b3d';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy);
  ctx.lineTo(cx + 10, cy);
  ctx.moveTo(cx, cy - 10);
  ctx.lineTo(cx, cy + 10);
  ctx.stroke();

  updateAnchorLabel();
}

function setAnchor(x, y) {
  if (!editing) return;
  editing.anchor = { x, y };
  renderPreview();
}

function setWidthTiles(value) {
  if (!editing) return;
  editing.widthTiles = clampWidth(value);
  dom.editorWidth.value = String(Math.round(editing.widthTiles * 100) / 100);
  renderPreview();
}

async function useFile(file) {
  if (!editing) return;
  try {
    const decoded = await decodeImageFile(file);
    if (bitmap) bitmap.close();
    editing.blob = decoded.blob;
    editing.w = decoded.w;
    editing.h = decoded.h;
    bitmap = decoded.bitmap;
    if (!dom.editorName.value.trim()) {
      dom.editorName.value = file.name.replace(/\.[^.]+$/, '');
    }
    setWidthTiles(editing.w / TILE_SIZE_WORLD); // native size default
    showError('');
    updateMeta();
    renderPreview();
  } catch (err) {
    showError(err.message);
  }
}

function bindCanvasDrag() {
  let dragFrom = null;
  dom.editorCanvas.addEventListener('pointerdown', (event) => {
    if (!editing || !bitmap) return;
    dragFrom = { x: event.clientX, y: event.clientY };
    dom.editorCanvas.setPointerCapture(event.pointerId);
  });
  dom.editorCanvas.addEventListener('pointermove', (event) => {
    if (!dragFrom || !editing || !bitmap) return;
    const rect = dom.editorCanvas.getBoundingClientRect();
    const pxScale = dom.editorCanvas.width / rect.width; // CSS-scaled canvas
    const zoom = dom.editorCanvas.width / (3 * TILE_SIZE_WORLD);
    const scale = ((editing.widthTiles * TILE_SIZE_WORLD) / editing.w) * zoom;
    const drawW = editing.w * scale;
    const drawH = editing.h * scale;
    const dx = (event.clientX - dragFrom.x) * pxScale;
    const dy = (event.clientY - dragFrom.y) * pxScale;
    dragFrom = { x: event.clientX, y: event.clientY };
    // Dragging moves the IMAGE under the fixed crosshair.
    editing.anchor.x = clamp01(editing.anchor.x - dx / drawW);
    editing.anchor.y = clamp01(editing.anchor.y - dy / drawH);
    renderPreview();
  });
  const end = () => {
    dragFrom = null;
  };
  dom.editorCanvas.addEventListener('pointerup', end);
  dom.editorCanvas.addEventListener('pointercancel', end);
}

async function save() {
  if (!editing || !editing.blob) {
    showError('Choose an image first.');
    return;
  }
  const asset = {
    id: editing.id,
    name: dom.editorName.value.trim() || 'Custom asset',
    blob: editing.blob,
    mime: 'image/png',
    w: editing.w,
    h: editing.h,
    anchor: { x: editing.anchor.x, y: editing.anchor.y },
    widthTiles: clampWidth(editing.widthTiles),
    createdAt: editing.createdAt,
    updatedAt: Date.now(),
  };
  const persisted = await putAsset(asset);
  if (!persisted) dom.storageNotice.hidden = false;
  registerCustom(asset);
  registerCustomBlob(asset.id, asset.blob);
  invalidate(asset.id);
  rerenderDecor(asset.id);
  if (state.selectedDecorId === asset.id) void updateSelectionPreview();
  void updateGhost();
  renderDecorList();
  closeEditor();
}

export async function deleteAssetById(id) {
  const info = getDecor(id);
  let count = 0;
  for (const entry of state.placed.values()) {
    if (entry.decorId === id) count += 1;
  }
  const label = info?.name ?? 'this asset';
  const question = count > 0
    ? `Delete "${label}" and remove ${count} placed instance(s)?`
    : `Delete "${label}"?`;
  const ok = await confirmDialog('Delete custom asset', question);
  if (!ok) return false;
  removePlacementsForDecor(id);
  if (state.selectedDecorId === id) clearSelection();
  unregisterCustom(id);
  removeCustomBlob(id);
  await deleteAsset(id);
  renderDecorList();
  return true;
}

export function initEditor() {
  dom.editorCancel.addEventListener('click', closeEditor);
  dom.editorModal.addEventListener('click', (event) => {
    if (event.target === dom.editorModal) closeEditor();
  });
  dom.editorFile.addEventListener('change', () => {
    const file = dom.editorFile.files && dom.editorFile.files[0];
    if (file) void useFile(file);
  });
  dom.editorModal.addEventListener('dragover', (event) => event.preventDefault());
  dom.editorModal.addEventListener('drop', (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) void useFile(file);
  });
  dom.editorWidth.addEventListener('input', () => {
    if (!editing) return;
    editing.widthTiles = clampWidth(Number(dom.editorWidth.value));
    renderPreview();
  });
  dom.editorPresetDecor.addEventListener('click', () => setAnchor(0.5, 0.8));
  dom.editorPresetBottom.addEventListener('click', () => setAnchor(0.5, 1));
  dom.editorPresetCenter.addEventListener('click', () => setAnchor(0.5, 0.5));
  dom.editorPresetNative.addEventListener('click', () => {
    if (editing && editing.w > 0) setWidthTiles(editing.w / TILE_SIZE_WORLD);
  });
  dom.editorPresetOneTile.addEventListener('click', () => setWidthTiles(1));
  dom.editorSave.addEventListener('click', () => {
    void save();
  });
  dom.editorDelete.addEventListener('click', async () => {
    if (editing && (await deleteAssetById(editing.id))) closeEditor();
  });
  bindCanvasDrag();
}

export async function openEditor(assetId = null) {
  isNew = !assetId;
  if (assetId) {
    const stored = await getAsset(assetId);
    if (!stored) return;
    editing = {
      id: stored.id,
      name: stored.name,
      blob: stored.blob,
      w: stored.w,
      h: stored.h,
      anchor: { x: stored.anchor.x, y: stored.anchor.y },
      widthTiles: stored.widthTiles,
      createdAt: stored.createdAt ?? Date.now(),
    };
    bitmap = await createImageBitmap(stored.blob);
  } else {
    editing = {
      id: `${CUSTOM_ID_PREFIX}${crypto.randomUUID()}`,
      name: '',
      blob: null,
      w: 0,
      h: 0,
      anchor: { x: 0.5, y: 0.8 }, // typical decor preset (spec §6.2)
      widthTiles: 1,
      createdAt: Date.now(),
    };
    bitmap = null;
  }
  dom.editorTitle.textContent = isNew ? 'Upload custom asset' : 'Edit custom asset';
  dom.editorDelete.hidden = isNew;
  dom.editorName.value = editing.name;
  dom.editorWidth.value = String(Math.round(editing.widthTiles * 100) / 100);
  dom.editorFile.value = '';
  showError('');
  updateMeta();
  renderPreview();
  dom.editorModal.style.display = 'flex';
}

export function closeEditor() {
  dom.editorModal.style.display = 'none';
  if (bitmap) {
    bitmap.close();
    bitmap = null;
  }
  editing = null;
}
