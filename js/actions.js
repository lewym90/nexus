// Operacje na cyklu życia notatek: kosz (z cofnięciem), archiwum, trwałe usuwanie, szybkie tworzenie.
import { state, hooks, TRASH_DAYS } from './state.js';
import { normalizeNote, putNote, purgeNoteRecord } from './db.js';
import { showToast, askConfirm } from './ui.js';
import { generateId, deriveQuickNote } from './util.js';

export async function persist(note) {
  try { await putNote(note); return true; }
  catch (e) { showToast(e && e.name === 'QuotaExceededError' ? 'Brak miejsca na zapis' : 'Błąd zapisu'); return false; }
}

const find = (id) => state.notes.find((n) => n.id === id);

export async function trashNote(id) {
  const note = find(id);
  if (!note) return;
  note.deleted = Date.now();
  await persist(note);
  hooks.renderAll();
  showToast('Przeniesiono do kosza', { label: 'Cofnij', onClick: () => restoreNote(id) });
}

export async function restoreNote(id) {
  const note = find(id);
  if (!note) return;
  note.deleted = 0;
  await persist(note);
  hooks.renderAll();
  showToast('Przywrócono notatkę');
}

export async function purgeNote(id, { confirm = false } = {}) {
  const note = find(id);
  if (!note) return false;
  if (confirm && !(await askConfirm('Usunąć trwale?', `„${note.title || 'Bez tytułu'}” zostanie bezpowrotnie usunięta.`, 'Usuń trwale', true))) return false;
  try { await purgeNoteRecord(note); } catch { showToast('Błąd usuwania'); return false; }
  state.notes = state.notes.filter((n) => n.id !== id);
  return true;
}

export async function setArchived(id, flag) {
  const note = find(id);
  if (!note) return;
  note.archived = !!flag;
  await persist(note);
  hooks.renderAll();
  showToast(flag ? 'Zarchiwizowano' : 'Przywrócono z archiwum', { label: 'Cofnij', onClick: () => setArchived(id, !flag) });
}

export async function emptyTrash() {
  const ws = state.currentWorkspace;
  const list = state.notes.filter((n) => n.deleted && (n.workspace || 'default') === ws);
  if (!list.length) return;
  if (!(await askConfirm('Opróżnić kosz?', `Trwale zostanie usuniętych: ${list.length}.`, 'Opróżnij', true))) return;
  for (const n of list) await purgeNote(n.id);
  hooks.renderAll();
  showToast('Kosz opróżniony');
}

/** Trwale usuwa notatki, które leżą w koszu dłużej niż TRASH_DAYS. */
export async function purgeExpired() {
  const limit = Date.now() - TRASH_DAYS * 86400000;
  for (const n of state.notes.filter((x) => x.deleted && x.deleted < limit)) await purgeNote(n.id);
}

/** Tworzy i zapisuje notatkę od razu (szybka notatka, schowek, udostępnianie). */
export async function createNoteFrom({ title = '', content = '', tags } = {}) {
  const t = tags || (state.currentTag ? [state.currentTag] : []);
  const note = normalizeNote({
    id: generateId(), title, content,
    tags: state.currentView === 'journal' && !t.includes('dziennik') ? [...t, 'dziennik'] : t,
    folder: state.currentFolder || '',
    workspace: state.currentWorkspace
  });
  state.notes.unshift(note);
  if (!(await persist(note))) { state.notes.shift(); return null; }
  return note;
}

export async function createQuickNote(raw, opts = {}) {
  const d = deriveQuickNote(raw);
  if (!d) return null;
  const note = await createNoteFrom({ ...d, ...opts });
  if (note) {
    hooks.renderAll();
    showToast('Dodano notatkę', { label: 'Otwórz', onClick: () => hooks.openNote(note.id) });
  }
  return note;
}

/** Przenosi notatki do przestrzeni. Folder zostaje tylko, jeśli należy do tej przestrzeni. */
export async function moveNotes(ids, wsId) {
  const keepFolders = new Set(state.folders.filter((f) => (f.workspace || 'default') === wsId).map((f) => f.id));
  let n = 0;
  for (const id of ids) {
    const note = find(id);
    if (!note || (note.workspace || 'default') === wsId) continue;
    note.workspace = wsId;
    if (note.folder && !keepFolders.has(note.folder)) note.folder = '';
    note.updated = Date.now();
    if (await persist(note)) n++;
  }
  return n;
}

export async function setFolder(ids, folderId) {
  let n = 0;
  for (const id of ids) {
    const note = find(id);
    if (!note) continue;
    note.folder = folderId;
    note.updated = Date.now();
    if (await persist(note)) n++;
  }
  return n;
}

export async function trashMany(ids) {
  for (const id of ids) {
    const note = find(id);
    if (note) { note.deleted = Date.now(); await persist(note); }
  }
  hooks.renderAll();
  showToast(`Przeniesiono do kosza: ${ids.length}`, { label: 'Cofnij', onClick: async () => { for (const id of ids) { const n = find(id); if (n) { n.deleted = 0; await persist(n); } } hooks.renderAll(); } });
}
