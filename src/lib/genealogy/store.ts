import type { Dataset } from "./types";
import { APP_CONFIG, databaseNameFor } from "@/lib/app-config";
import { merge } from "./importer";

// A fresh database name keeps this independent copy empty even if the Lovable
// template was previously opened in the same browser profile.
export const DB_NAME = databaseNameFor(APP_CONFIG.id);
const STORE = "kv";
const KEY = "dataset";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadDataset(): Promise<Dataset | null> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(KEY);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { resolve((request.result as Dataset) ?? null); db.close(); };
  });
}

export async function saveDataset(ds: Dataset): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ ...ds, meta: { ...ds.meta, savedAt: new Date().toISOString() } }, KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/** Guarda una copia íntegra del dataset previo y la actualización en una sola transacción. */
export async function saveDatasetWithBackup(ds: Dataset, backupKey: string): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const current = store.get(KEY);
    current.onsuccess = () => {
      if (!current.result) {
        store.put({ ...ds, meta: { ...ds.meta, savedAt: new Date().toISOString() } }, KEY);
        return;
      }
      const backup = store.get(backupKey);
      backup.onsuccess = () => {
        if (backup.result === undefined) store.put(current.result, backupKey);
        store.put({ ...ds, meta: { ...ds.meta, savedAt: new Date().toISOString() } }, KEY);
      };
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error("La actualización y su respaldo se cancelaron.")); };
  });
}

/** Prepara una fusión exclusivamente aditiva cuando el Atlas publicado trae una actualización nueva. */
export function prepareBundledUpdate(current: Dataset, bundled: Dataset): { dataset: Dataset; backupKey: string | null } {
  const applied = new Set(current.meta.appliedUpdates ?? []);
  const pending = (bundled.meta.appliedUpdates ?? []).filter((marker) => !applied.has(marker));
  if (!pending.length) return { dataset: current, backupKey: null };
  const dataset = merge(current, bundled, "actualizacion-atlas-incluido", "atlas.json").ds;
  return { dataset, backupKey: `backup:antes-de-actualizacion:${pending.join("|")}` };
}

export async function seedDataset(): Promise<Dataset> {
  const mod = await import("@/data/atlas.json");
  return structuredClone((mod.default ?? mod) as unknown as Dataset);
}

