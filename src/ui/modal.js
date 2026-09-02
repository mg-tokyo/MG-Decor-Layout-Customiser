// src/ui/modal.js — message and confirm dialogs (replaces the old alert()s).
import { dom } from '../state.js';

let pendingResolve = null;

export function initModal() {
  dom.modalClose.addEventListener('click', closeModal);
  dom.modal.addEventListener('click', (event) => {
    if (event.target === dom.modal) closeModal();
  });
}

export function closeModal() {
  dom.modal.classList.remove('show');
  dom.modal.setAttribute('aria-hidden', 'true');
  if (pendingResolve) {
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve(false);
  }
}

function open(title, text) {
  dom.modalTitle.textContent = title;
  dom.modalMessage.textContent = text;
  dom.modal.classList.add('show');
  dom.modal.setAttribute('aria-hidden', 'false');
}

export function showMessage(title, text) {
  pendingResolve = null;
  dom.modalPrimary.textContent = 'OK';
  dom.modalSecondary.style.display = 'none';
  dom.modalPrimary.onclick = closeModal;
  dom.modalSecondary.onclick = null;
  open(title, text);
}

export function confirmDialog(title, text, confirmLabel = 'Delete') {
  return new Promise((resolve) => {
    pendingResolve = resolve;
    dom.modalPrimary.textContent = confirmLabel;
    dom.modalSecondary.style.display = '';
    dom.modalSecondary.textContent = 'Cancel';
    dom.modalPrimary.onclick = () => {
      pendingResolve = null;
      closeModal();
      resolve(true);
    };
    dom.modalSecondary.onclick = closeModal; // closeModal resolves false
    open(title, text);
  });
}
