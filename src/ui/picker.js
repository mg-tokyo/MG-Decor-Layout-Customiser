// src/ui/picker.js — decor picker modal: search, shop filters, rarity badges,
// tier selector, custom-asset section, selection preview, rotate/flip UI.
import { dom, state, isMobileDevice } from '../state.js';
import {
  flipRotation,
  getDecor,
  getRotations,
  listCustom,
  listDecor,
  listShops,
  nextRotation,
  resolveVisual,
} from '../catalog.js';
import { getThumbnail } from '../textures.js';
import { updateGhost } from '../placement.js';

let activeShop = null;
let hooks = { openEditor: null, deleteAsset: null };

export function initPicker(options = {}) {
  hooks = { openEditor: options.openEditor ?? null, deleteAsset: options.deleteAsset ?? null };
  dom.searchDecor.addEventListener('input', () => renderDecorList());
  dom.decorBtn.addEventListener('click', openPicker);
  dom.closeDecorModal.addEventListener('click', closePicker);
  dom.decorModal.addEventListener('click', (event) => {
    if (event.target === dom.decorModal) closePicker();
  });
  dom.rotateBtn.addEventListener('click', () => rotateSelection(1));
  dom.flipBtn.addEventListener('click', flipSelection);
  dom.tierSelect.addEventListener('change', () => {
    state.selectedTier = Number(dom.tierSelect.value);
    void updateSelectionPreview();
    void updateGhost();
  });
  dom.uploadAssetBtn.addEventListener('click', () => {
    if (hooks.openEditor) hooks.openEditor(null);
  });
  renderShopFilters();
  updateRotationLabel();
}

export function openPicker() {
  dom.decorModal.style.display = 'flex';
  renderDecorList();
  if (!isMobileDevice()) dom.searchDecor.focus();
}

export function closePicker() {
  dom.decorModal.style.display = 'none';
}

function renderShopFilters() {
  dom.shopFilters.innerHTML = '';
  for (const shop of ['All', ...listShops()]) {
    const value = shop === 'All' ? null : shop;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'shop-chip' + (activeShop === value ? ' active' : '');
    chip.textContent = shop;
    chip.addEventListener('click', () => {
      activeShop = value;
      renderShopFilters();
      renderDecorList();
    });
    dom.shopFilters.appendChild(chip);
  }
}

// getThumbnail returns a SHARED cached canvas — draw a copy per card.
function attachThumbnail(container, spriteKey) {
  if (!spriteKey) return;
  const canvas = document.createElement('canvas');
  canvas.width = 60;
  canvas.height = 60;
  container.appendChild(canvas);
  void getThumbnail(spriteKey, 60).then((source) => {
    canvas.getContext('2d').drawImage(source, 0, 0);
  });
}

function buildDecorCard(entry) {
  const item = document.createElement('div');
  item.className = 'decor-item' + (state.selectedDecorId === entry.decorId ? ' active' : '');
  const thumb = document.createElement('div');
  thumb.className = 'decor-thumb';
  const visual = resolveVisual(entry.decorId, 0, entry.tiers?.length ? 0 : null);
  attachThumbnail(thumb, visual?.spriteKey);
  const label = document.createElement('small');
  label.textContent = entry.name;
  const badge = document.createElement('span');
  badge.className = `rarity-badge rarity-${String(entry.rarity ?? '').toLowerCase()}`;
  badge.textContent = entry.rarity ?? '';
  item.append(thumb, label, badge);
  item.addEventListener('click', () => selectDecor(entry.decorId));
  return item;
}

function renderCustomSection() {
  dom.customSection.hidden = !hooks.openEditor;
  if (!hooks.openEditor) return;
  const query = dom.searchDecor.value.trim().toLowerCase();
  const assets = listCustom().filter((a) => !query || a.name.toLowerCase().includes(query));
  dom.customList.innerHTML = '';
  for (const asset of assets) {
    const item = document.createElement('div');
    item.className = 'decor-item' + (state.selectedDecorId === asset.decorId ? ' active' : '');
    const thumb = document.createElement('div');
    thumb.className = 'decor-thumb';
    attachThumbnail(thumb, asset.decorId);
    const label = document.createElement('small');
    label.textContent = asset.name;
    const actions = document.createElement('div');
    actions.className = 'custom-actions';
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn-icon small';
    editBtn.textContent = '✎';
    editBtn.title = 'Edit';
    editBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      hooks.openEditor(asset.decorId);
    });
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-icon small';
    delBtn.textContent = '\u{1F5D1}';
    delBtn.title = 'Delete';
    delBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (hooks.deleteAsset) void hooks.deleteAsset(asset.decorId);
    });
    actions.append(editBtn, delBtn);
    item.append(thumb, label, actions);
    item.addEventListener('click', () => selectDecor(asset.decorId));
    dom.customList.appendChild(item);
  }
}

export function renderDecorList() {
  renderCustomSection();
  const entries = listDecor({ query: dom.searchDecor.value, shop: activeShop });
  dom.decorList.innerHTML = '';
  for (const entry of entries) dom.decorList.appendChild(buildDecorCard(entry));
}

function renderTierSelect() {
  const entry = state.selectedDecorId ? getDecor(state.selectedDecorId) : null;
  const tiers = entry && !entry.custom ? entry.tiers ?? [] : [];
  dom.tierRow.hidden = tiers.length === 0;
  dom.tierSelect.innerHTML = '';
  tiers.forEach((tier, i) => {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = tier.label;
    dom.tierSelect.appendChild(option);
  });
  if (tiers.length > 0) dom.tierSelect.value = String(state.selectedTier ?? 0);
}

export function selectDecor(id) {
  const entry = getDecor(id);
  if (!entry) return;
  state.selectedDecorId = id;
  state.selectedRotation = 0;
  state.selectedTier = !entry.custom && entry.tiers?.length ? 0 : null;
  dom.selectedName.textContent = entry.name;
  renderTierSelect();
  updateRotationLabel();
  void updateSelectionPreview();
  closePicker();
  renderDecorList();
  void updateGhost();
}

export function clearSelection() {
  state.selectedDecorId = null;
  state.selectedRotation = 0;
  state.selectedTier = null;
  dom.selectedName.textContent = 'None selected';
  renderTierSelect();
  updateRotationLabel();
  void updateSelectionPreview();
  renderDecorList();
  void updateGhost();
}

export function rotateSelection(dir = 1) {
  if (!state.selectedDecorId) return;
  const next = nextRotation(state.selectedDecorId, state.selectedRotation, dir);
  if (next === state.selectedRotation) return;
  state.selectedRotation = next;
  updateRotationLabel();
  void updateSelectionPreview();
  void updateGhost();
}

export function flipSelection() {
  if (!state.selectedDecorId) return;
  state.selectedRotation = flipRotation(state.selectedRotation);
  updateRotationLabel();
  void updateSelectionPreview();
  void updateGhost();
}

export function updateRotationLabel() {
  const rotation = state.selectedRotation;
  const abs = rotation === -360 ? 0 : Math.abs(rotation);
  const flipped = rotation < 0 ? ' (flipped)' : '';
  const fixed = state.selectedDecorId && getRotations(state.selectedDecorId).length < 2
    ? ' — fixed'
    : '';
  dom.rotationLabel.textContent = `Rotation: ${abs}°${flipped}${fixed}`;
}

export async function updateSelectionPreview() {
  const id = state.selectedDecorId;
  dom.selectionPreview.innerHTML = '';
  if (!id) return;
  const visual = resolveVisual(id, state.selectedRotation, state.selectedTier);
  if (!visual) return;
  const source = await getThumbnail(visual.spriteKey, 48);
  if (state.selectedDecorId !== id) return; // selection changed while loading
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 48;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.translate(visual.flipH ? 48 : 0, visual.flipV ? 48 : 0);
  ctx.scale(visual.flipH ? -1 : 1, visual.flipV ? -1 : 1);
  ctx.drawImage(source, 0, 0);
  ctx.restore();
  dom.selectionPreview.innerHTML = '';
  dom.selectionPreview.appendChild(canvas);
}
