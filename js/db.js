// IndexedDB: notatki (store "notes") i załączniki jako Blob (store "blobs", od wersji 3).
import { DEFAULT_AURA, state } from './state.js';
import { generateId } from './util.js';

const DB_NAME = 'NexusDB';
const DB_VERSION = 3;
const NOTES = 'notes';
const BLOBS = 'blobs';

let db = null;

export function initDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB niedostępne'));
    let request;
    try { request = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { return reject(e); }
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Baza zablokowana przez inną kartę'));
    request.onsuccess = () => {
      db = request.result;
      db.onversionchange = () => { db.close(); db = null; };
      resolve();
    };
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      const tx = e.target.transaction;
      const store = database.objectStoreNames.contains(NOTES) ? tx.objectStore(NOTES) : database.createObjectStore(NOTES, { keyPath: 'id' });
      if (!store.indexNames.contains('updated')) store.createIndex('updated', 'updated', { unique: false });
      if (!store.indexNames.contains('workspace')) store.createIndex('workspace', 'workspace', { unique: false });
      const blobs = database.objectStoreNames.contains(BLOBS) ? tx.objectStore(BLOBS) : database.createObjectStore(BLOBS, { keyPath: 'id' });
      if (!blobs.indexNames.contains('noteId')) blobs.createIndex('noteId', 'noteId', { unique: false });
    };
  });
}

/** Uruchamia `fn(stores…)` w jednej transakcji; zwraca wynik żądania zwróconego z fn. */
function run(storeNames, mode, fn) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve(null);
    let tx;
    try { tx = db.transaction(storeNames, mode); } catch (e) { return reject(e); }
    const stores = storeNames.map((n) => tx.objectStore(n));
    let result;
    const req = fn(...stores);
    if (req && 'onsuccess' in req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transakcja przerwana'));
  });
}

export function normalizeNote(n) {
  const now = Date.now();
  return {
    ...n,
    id: String(n.id),
    title: typeof n.title === 'string' ? n.title : '',
    content: typeof n.content === 'string' ? n.content : '',
    tags: Array.isArray(n.tags) ? n.tags.map((t) => String(t).trim()).filter(Boolean) : [],
    aura: typeof n.aura === 'string' ? n.aura : DEFAULT_AURA,
    favorite: !!n.favorite,
    pinned: !!n.pinned,
    archived: !!n.archived,
    deleted: Number(n.deleted) || 0, // znacznik czasu przeniesienia do kosza (0 = nie w koszu)
    folder: n.folder || '',
    workspace: n.workspace || 'default',
    attachments: Array.isArray(n.attachments) ? n.attachments.filter((a) => a && (a.id || typeof a.data === 'string')) : [],
    created: Number(n.created) || now,
    updated: Number(n.updated) || Number(n.created) || now
  };
}

export const putNote = (note) => run([NOTES], 'readwrite', (s) => s.put(note));
export const deleteNoteRecord = (id) => run([NOTES], 'readwrite', (s) => s.delete(id));

export async function loadNotes() {
  const all = await run([NOTES], 'readonly', (s) => s.getAll());
  if (all) state.notes = all.map(normalizeNote);
}

/* ---------- Blob-y (załączniki) ---------- */

export const putBlob = (rec) => run([BLOBS], 'readwrite', (s) => s.put(rec));
export const getBlobRecord = (id) => run([BLOBS], 'readonly', (s) => s.get(id));

export function deleteBlobs(ids) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return Promise.resolve();
  return run([BLOBS], 'readwrite', (s) => { list.forEach((id) => s.delete(id)); });
}

const urlCache = new Map();
export async function getBlobURL(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const rec = await getBlobRecord(id);
  if (!rec || !rec.blob) return null;
  const url = URL.createObjectURL(rec.blob);
  urlCache.set(id, url);
  return url;
}
export function revokeBlobURL(id) {
  const u = urlCache.get(id);
  if (u) { URL.revokeObjectURL(u); urlCache.delete(id); }
}
export function revokeAllBlobURLs() {
  urlCache.forEach((u) => URL.revokeObjectURL(u));
  urlCache.clear();
}

export function dataURLToBlob(dataURL) {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataURL);
  if (!m) throw new Error('Nieprawidłowy data URL');
  const type = m[1] || 'application/octet-stream';
  const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Zamienia stare załączniki base64 ({data}) na rekordy Blob. Zwraca liczbę zmigrowanych notatek. */
export async function migrateLegacyAttachments(notes) {
  let migrated = 0;
  for (const note of notes) {
    if (!note.attachments.some((a) => !a.id && a.data)) continue;
    const next = [];
    for (const a of note.attachments) {
      if (a.id) { next.push(a); continue; }
      try {
        const blob = dataURLToBlob(a.data);
        const id = generateId();
        await putBlob({ id, noteId: note.id, name: a.name || 'obraz', type: a.type || blob.type, size: blob.size, blob });
        next.push({ id, name: a.name || 'obraz', type: a.type || blob.type, size: blob.size });
      } catch { /* uszkodzony załącznik – pomiń */ }
    }
    note.attachments = next;
    await putNote(note);
    migrated++;
  }
  return migrated;
}

/** Trwale usuwa notatkę razem z jej załącznikami. */
export async function purgeNoteRecord(note) {
  await deleteBlobs((note.attachments || []).map((a) => a.id));
  await deleteNoteRecord(note.id);
}
