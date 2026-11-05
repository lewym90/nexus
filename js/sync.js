// Synchronizacja z własnym serwerem. Dane są szyfrowane tutaj (AES-GCM); serwer widzi tylko klucz elementu i bajty.
// Elementy: n-<id> notatka, b-<id> obraz, m-folders / m-workspaces / m-templates. Przy konflikcie zmian wygrywa
// nowsza, a przegrana wersja notatki zostaje jako jej kopia. Zmiany wykrywa porównanie skrótu z ostatnim stanem (map).
import { state, hooks } from './state.js';
import { readLS, writeLS, LS } from './storage.js';
import { normalizeNote, putNote, putBlob, getBlobRecord, deleteBlobs, blobToDataURL, dataURLToBlob } from './db.js';
import { generateId, hashText, parseSyncCode, encodeKey, decodeKey } from './util.js';
import { purgeNote } from './actions.js';

const META = { 'm-folders': ['folders', LS.folders], 'm-workspaces': ['workspaces', LS.workspaces], 'm-templates': ['templates', LS.templates] };
const enc = new TextEncoder(), dec = new TextDecoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha = (s) => crypto.subtle.digest('SHA-256', enc.encode(s));

export const getSync = () => readLS(LS.sync, null);
export const isPaired = () => !!getSync();

async function credentials(secret) {
  const token = hex(await sha('nexus-auth:' + secret));
  const key = await crypto.subtle.importKey('raw', await sha('nexus-enc:' + secret), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { token, key };
}

async function seal(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv); out.set(new Uint8Array(ct), 12);
  return out;
}

async function open(key, bytes) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
  return dec.decode(pt);
}

function api(cfg, token) {
  const call = async (path, init = {}) => {
    const signal = AbortSignal.timeout ? AbortSignal.timeout(60000) : undefined; // uśpiony telefon nie może zablokować kolejnych prób
    const res = await fetch(cfg.url + path, { ...init, signal, headers: { 'X-Token': token } });
    if (res.status === 401) throw new Error('Serwer odrzucił kod');
    return res;
  };
  return {
    json: async (path) => { const r = await call(path); if (!r.ok) throw new Error('Błąd serwera ' + r.status); return r.json(); },
    bytes: async (path) => { const r = await call(path); if (!r.ok) throw new Error('Błąd serwera ' + r.status); return new Uint8Array(await r.arrayBuffer()); },
    write: async (k, v, body) => {
      const r = await call(`/item/${k}?v=${v}`, body ? { method: 'PUT', body } : { method: 'DELETE' });
      if (r.status === 409) return false; // serwer ma nowszą wersję: przyjdzie przy pobieraniu
      if (!r.ok) throw new Error('Błąd serwera ' + r.status);
      return true;
    }
  };
}

const noteSig = (n) => hashText(JSON.stringify(n));
const metaSig = (k) => hashText(JSON.stringify(state[META[k][0]]));

/* ---------- Pobieranie ---------- */

function storeNoteInState(note) {
  const i = state.notes.findIndex((n) => n.id === note.id);
  if (i >= 0) state.notes[i] = note; else state.notes.unshift(note);
}

async function applyNote(k, plain, map, entry) {
  const note = normalizeNote(JSON.parse(plain));
  const local = state.notes.find((n) => n.id === note.id);
  const localDirty = local && (!map[k] || map[k].sig !== noteSig(local)) && noteSig(local) !== noteSig(note);
  if (localDirty && (map[k] || local.updated > note.updated)) { // ta sama notatka zmieniona na dwóch urządzeniach: nic nie przepada
    const copy = normalizeNote({ ...local, id: generateId(), title: `${local.title || 'Bez tytułu'} (konflikt)`, attachments: [] });
    await putNote(copy);
    state.notes.unshift(copy);
  }
  await putNote(note);
  storeNoteInState(note);
  map[k] = { sig: noteSig(note), v: entry.v };
}

async function applyBlob(k, plain, map, entry) {
  const rec = JSON.parse(plain);
  await putBlob({ ...rec, id: decodeKey(k), blob: dataURLToBlob(rec.data), data: undefined });
  map[k] = { v: entry.v };
}

function applyMeta(k, plain, map, entry) {
  const [field, lsKey] = META[k];
  const incoming = JSON.parse(plain);
  if (map[k]) state[field] = incoming;
  else { // pierwsze połączenie: połącz z tym, co już jest na urządzeniu
    const known = new Set(incoming.map((x) => x.id));
    state[field] = [...incoming, ...state[field].filter((x) => !known.has(x.id))];
  }
  writeLS(lsKey, state[field]);
  map[k] = { sig: hashText(JSON.stringify(incoming)), v: entry.v }; // po scaleniu skrót się różni, więc wynik pójdzie na serwer
}

async function pull(cfg, client, key) {
  const { rev, items } = await client.json(`/changes?since=${cfg.cursor}`);
  const map = cfg.map;
  let changed = false;
  for (const e of items) {
    if (state.editing) return changed; // użytkownik otworzył notatkę: dokończymy po wyjściu z edytora
    const cur = map[e.k];
    if (cur && e.v <= cur.v) continue; // własna zmiana albo już znana
    if (e.k.startsWith('n-') && state.notes.find((n) => n.id === decodeKey(e.k))?.private) { // prywatnej nic nie nadpisuje ani nie usuwa
      map[e.k] = { d: 1, v: e.v };
      continue;
    }
    if (e.d) {
      if (e.k.startsWith('n-')) {
        const id = decodeKey(e.k), local = state.notes.find((n) => n.id === id);
        if (local && cur && cur.sig !== noteSig(local)) continue; // tu są nowsze zmiany: notatka zostaje i wróci na serwer
        if (local) await purgeNote(id);
      } else if (e.k.startsWith('b-')) await deleteBlobs([decodeKey(e.k)]);
      map[e.k] = { d: 1, v: e.v };
    } else {
      const plain = await open(key, await client.bytes(`/item/${e.k}`));
      if (e.k.startsWith('n-')) await applyNote(e.k, plain, map, e);
      else if (e.k.startsWith('b-')) await applyBlob(e.k, plain, map, e);
      else if (META[e.k]) applyMeta(e.k, plain, map, e);
    }
    changed = true;
  }
  cfg.cursor = rev;
  return changed;
}

/* ---------- Wysyłanie ---------- */

async function push(cfg, client, key) {
  const map = cfg.map, now = Date.now();
  const versionFor = (k, fallback) => (map[k] ? Math.max(now, map[k].v + 1) : fallback); // nowy element zachowuje własną datę
  const referenced = new Set();
  const notes = state.notes.filter((n) => !n.private); // prywatne nie wychodzą z urządzenia, a wcześniej wysłane znikają z serwera
  const editing = state.editing && !state.editing.note.private ? state.editing.note : null;
  if (editing) editing.attachments.forEach((a) => a.id && referenced.add(a.id));

  for (const n of notes) {
    for (const a of n.attachments) {
      if (!a.id) continue;
      referenced.add(a.id);
      const k = encodeKey('b-', a.id);
      if (map[k] && !map[k].d) continue;
      const rec = await getBlobRecord(a.id);
      if (!rec || !rec.blob) continue;
      const { blob, ...meta } = rec;
      const v = versionFor(k, n.updated);
      if (await client.write(k, v, await seal(key, JSON.stringify({ ...meta, data: await blobToDataURL(blob) })))) map[k] = { v };
    }
    const k = encodeKey('n-', n.id), sig = noteSig(n);
    if (map[k] && map[k].sig === sig) continue;
    const v = versionFor(k, n.updated);
    if (await client.write(k, v, await seal(key, JSON.stringify(n)))) map[k] = { sig, v };
  }

  for (const k of Object.keys(META)) {
    const sig = metaSig(k);
    if (map[k] && map[k].sig === sig) continue;
    const v = versionFor(k, 1);
    if (await client.write(k, v, await seal(key, JSON.stringify(state[META[k][0]])))) map[k] = { sig, v };
  }

  const alive = new Set(notes.map((n) => n.id));
  if (editing) alive.add(editing.id);
  for (const [k, e] of Object.entries(map)) {
    if (e.d) continue;
    const gone = k.startsWith('n-') ? !alive.has(decodeKey(k)) : k.startsWith('b-') ? !referenced.has(decodeKey(k)) : false;
    if (!gone) continue;
    const v = Math.max(now, e.v + 1);
    if (await client.write(k, v, null)) map[k] = { d: 1, v };
  }
}

/* ---------- Sterowanie ---------- */

let running = false, again = false, timer = 0;
const setStatus = (text) => { if (hooks.syncStatus) hooks.syncStatus(text); };

export async function syncNow() {
  if (!navigator.onLine && navigator.onLine !== undefined) return false;
  const initial = getSync();
  if (!initial) return false;
  if (running) { again = true; return false; }
  running = true;
  let ok = false;
  try {
    const cfg = initial;
    const { token, key } = await credentials(cfg.secret);
    const client = api(cfg, token);
    if (state.editing && hooks.saveCurrentNote) await hooks.saveCurrentNote();
    // Otwartej notatki nie podmieniamy pod palcami: pobieranie czeka na wyjście z edytora.
    let changed = false;
    if (!state.editing) changed = await pull(cfg, client, key);
    await push(cfg, client, key);
    cfg.last = Date.now();
    delete cfg.error;
    if (getSync()) writeLS(LS.sync, cfg);
    if (changed && !state.editing) hooks.renderAll();
    ok = true;
  } catch (e) {
    console.error('Synchronizacja:', e);
    const cur = getSync();
    if (cur) writeLS(LS.sync, { ...cur, error: e.name === 'OperationError' ? 'Zły kod: nie można odszyfrować danych' : e.message || 'Brak połączenia' });
  } finally {
    running = false;
    setStatus();
    if (again) { again = false; scheduleSync(500); }
  }
  return ok;
}

export function scheduleSync(ms = 3000) {
  if (!isPaired()) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, ms);
}

export async function pairDevice(code) {
  const parsed = parseSyncCode(code);
  if (!parsed) throw new Error('Nieprawidłowy kod');
  const { token } = await credentials(parsed.secret);
  const res = await fetch(parsed.url + '/changes?since=0', { headers: { 'X-Token': token } });
  if (res.status === 401) throw new Error('Serwer odrzucił kod');
  if (!res.ok) throw new Error('Serwer nie odpowiada');
  writeLS(LS.sync, { ...parsed, cursor: 0, map: {}, last: 0 });
  return syncNow();
}

export function unpair() {
  clearTimeout(timer);
  try { localStorage.removeItem(LS.sync); } catch { /* ignoruj */ }
}

export const syncCode = () => { const c = getSync(); return c ? `${c.url}#${c.secret}` : ''; };

export async function listBackups() {
  const cfg = getSync();
  const { token } = await credentials(cfg.secret);
  return (await api(cfg, token).json('/backups')).days;
}

/** Przywraca stan z kopii dziennej: wersje z kopii zastępują obecne, notatki spoza kopii zostają. */
export async function restoreBackup(day) {
  const cfg = getSync();
  const { token, key } = await credentials(cfg.secret);
  const client = api(cfg, token);
  const { items } = await client.json(`/backups/${day}/index`);
  const now = Date.now();
  let restored = 0;
  const privateBlobs = new Set(state.notes.filter((n) => n.private).flatMap((n) => n.attachments.map((a) => a.id)));
  for (const e of items.filter((x) => x.k.startsWith('b-') && !privateBlobs.has(decodeKey(x.k)))) {
    const rec = JSON.parse(await open(key, await client.bytes(`/backups/${day}/item/${e.k}`)));
    await putBlob({ ...rec, id: decodeKey(e.k), blob: dataURLToBlob(rec.data), data: undefined });
    cfg.map[e.k] = { d: 1, v: cfg.map[e.k]?.v || 0 }; // wymusza ponowne wysłanie obrazu
  }
  for (const e of items.filter((x) => !x.k.startsWith('b-'))) {
    const plain = await open(key, await client.bytes(`/backups/${day}/item/${e.k}`));
    if (e.k.startsWith('n-')) {
      const note = normalizeNote(JSON.parse(plain));
      if (state.notes.find((n) => n.id === note.id)?.private) continue; // prywatna nie wraca na serwer przez kopię
      await putNote(note);
      storeNoteInState(note);
      cfg.map[e.k] = { sig: '', v: Math.max(now, cfg.map[e.k]?.v || 0) };
      restored++;
    } else if (META[e.k]) {
      state[META[e.k][0]] = JSON.parse(plain);
      writeLS(META[e.k][1], state[META[e.k][0]]);
      cfg.map[e.k] = { sig: '', v: Math.max(now, cfg.map[e.k]?.v || 0) };
    }
  }
  writeLS(LS.sync, cfg);
  hooks.renderAll();
  await syncNow();
  return restored;
}

export function initSync() {
  hooks.dataChanged = () => { if (!running) scheduleSync(); }; // zapisy samej synchronizacji nie uruchamiają kolejnej
  if (!isPaired()) return;
  syncNow();
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); else if (state.editing) scheduleSync(0); });
  window.addEventListener('online', () => syncNow());
}
