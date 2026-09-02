// src/customAssets/store.js — IndexedDB persistence for custom assets with an
// in-memory fallback (private mode / quota errors degrade to session-only).
import { DB_NAME } from '../constants.js';

const STORE = 'assets';
const memory = new Map();
let dbPromise = null;
let broken = false;

export function isAvailable() {
  return typeof indexedDB !== 'undefined' && !broken;
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch (err) {
      reject(err);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

async function withStore(mode, fn) {
  if (!isAvailable()) return undefined;
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error ?? new Error('transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
    });
  } catch (err) {
    console.warn('[customAssets] IndexedDB unavailable — session-only storage:', err);
    broken = true;
    return undefined;
  }
}

export async function putAsset(asset) {
  memory.set(asset.id, asset);
  const key = await withStore('readwrite', (store) => store.put(asset));
  return key !== undefined;
}

export async function getAsset(id) {
  const stored = await withStore('readonly', (store) => store.get(id));
  return stored ?? memory.get(id) ?? null;
}

export async function listAssets() {
  const rows = await withStore('readonly', (store) => store.getAll());
  if (Array.isArray(rows)) {
    for (const asset of rows) memory.set(asset.id, asset);
    return rows;
  }
  return [...memory.values()];
}

export async function deleteAsset(id) {
  memory.delete(id);
  await withStore('readwrite', (store) => store.delete(id));
}
