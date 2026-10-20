// Eksport / import kopii zapasowej (JSON z załącznikami zakodowanymi base64).
import { state, hooks } from './state.js';
import { askConfirm, showToast } from './ui.js';
import { plural, todayStr, generateId } from './util.js';
import { normalizeNote, putNote, putBlob, getBlobRecord, blobToDataURL, dataURLToBlob, loadNotes } from './db.js';
import { saveFolders, saveWorkspaces } from './sidebar.js';
import { writeLS, LS } from './storage.js';

export async function buildBackup() {
  const notes = [];
  for (const n of state.notes) {
    const attachments = [];
    for (const a of n.attachments) {
      const rec = a.id ? await getBlobRecord(a.id) : null;
      if (rec && rec.blob) attachments.push({ name: a.name, type: a.type, data: await blobToDataURL(rec.blob) });
      else if (a.data) attachments.push({ name: a.name, type: a.type, data: a.data });
    }
    notes.push({ ...n, attachments });
  }
  return { app: 'nexus', version: 3, exportedAt: new Date().toISOString(), notes, folders: state.folders, workspaces: state.workspaces, templates: state.templates };
}

export async function exportData() {
  await hooks.saveCurrentNote();
  const payload = JSON.stringify(await buildBackup());
  const name = `nexus-backup-${todayStr()}.json`;
  const file = new File([payload], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Kopia zapasowa Nexus' });
      showToast('Wyeksportowano');
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  showToast('Wyeksportowano');
}

/** Importuje notatkę; załączniki z `data` zamienia na Blob-y. */
async function importNote(raw) {
  const note = normalizeNote({ ...raw, attachments: [] });
  for (const a of Array.isArray(raw.attachments) ? raw.attachments : []) {
    try {
      if (a.id && !a.data) { note.attachments.push(a); continue; }
      const blob = dataURLToBlob(a.data);
      const id = generateId();
      await putBlob({ id, noteId: note.id, name: a.name || 'obraz', type: a.type || blob.type, size: blob.size, blob });
      note.attachments.push({ id, name: a.name || 'obraz', type: a.type || blob.type, size: blob.size });
    } catch { /* pomiń uszkodzony załącznik */ }
  }
  await putNote(note);
}

export function importData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.onchange = async () => {
    const file = input.files[0];
    input.remove();
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.notes)) throw new Error('format');
      const incoming = data.notes.filter((n) => n && n.id).map((n) => ({ ...normalizeNote({ ...n, attachments: [] }), attachments: n.attachments }));
      const ok = await askConfirm('Zaimportować dane?',
        `Plik zawiera ${incoming.length} ${plural(incoming.length, 'notatkę', 'notatki', 'notatek')}. Zostaną scalone z istniejącymi (przy tym samym ID zostaje nowsza wersja).`, 'Importuj');
      if (!ok) return;
      let imported = 0;
      for (const n of incoming) {
        const cur = state.notes.find((x) => x.id === String(n.id));
        if (!cur || n.updated > cur.updated) { await importNote(n); imported++; }
      }
      const merge = (target, src) => { (Array.isArray(src) ? src : []).forEach((x) => { if (x && x.id && x.name && !target.find((y) => y.id === x.id)) target.push(x); }); };
      merge(state.folders, data.folders); merge(state.workspaces, data.workspaces); merge(state.templates, data.templates);
      saveFolders(); saveWorkspaces(); writeLS(LS.templates, state.templates);
      await loadNotes();
      hooks.renderAll();
      showToast(`Zaimportowano: ${imported}`);
    } catch {
      showToast('Błąd importu – nieprawidłowy plik');
    }
  };
  input.click();
}
