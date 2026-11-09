// Zaznaczanie wielu notatek na liście: przeniesienie do przestrzeni lub folderu, usunięcie.
import { state, hooks } from './state.js';
import { $, showToast, openModal, closeModal } from './ui.js';
import { moveNotes, setFolder, trashMany } from './actions.js';

export const selection = new Set();
export const isSelecting = () => document.body.classList.contains('selecting');

function refresh() {
  $('selectCount').textContent = `Zaznaczono: ${selection.size}`;
  ['selectMoveBtn', 'selectFolderBtn', 'selectDeleteBtn'].forEach((id) => { $(id).disabled = !selection.size; });
  document.querySelectorAll('#notesGrid .note-card').forEach((c) => c.classList.toggle('is-selected', selection.has(c.dataset.id)));
}

export function startSelecting(firstId) {
  selection.clear();
  if (firstId) selection.add(firstId);
  document.body.classList.add('selecting');
  $('selectModeBtn').textContent = 'Gotowe';
  refresh();
}

export function stopSelecting() {
  selection.clear();
  document.body.classList.remove('selecting');
  $('selectModeBtn').textContent = 'Zaznacz';
  refresh();
}

/** Zwraca true, jeśli kliknięcie karty zostało obsłużone jako zaznaczenie. */
export function onCardClick(id) {
  if (!isSelecting()) return false;
  if (selection.has(id)) selection.delete(id); else selection.add(id);
  refresh();
  return true;
}

async function pick(title, options, message) {
  const list = document.createElement('div');
  list.className = 'choice-list';
  options.forEach(([value, label]) => {
    const row = document.createElement('div');
    row.className = 'choice';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice-main';
    b.dataset.value = value;
    b.textContent = label;
    b.addEventListener('click', () => closeModal(value));
    row.appendChild(b);
    list.appendChild(row);
  });
  return openModal({ title, message, content: list, actions: [{ label: 'Anuluj', value: null }] });
}

export function setupSelection() {
  $('selectModeBtn').addEventListener('click', () => (isSelecting() ? stopSelecting() : startSelecting()));
  $('selectCancelBtn').addEventListener('click', stopSelecting);
  $('selectAllBtn').addEventListener('click', () => {
    const ids = [...document.querySelectorAll('#notesGrid .note-card')].map((c) => c.dataset.id);
    const all = ids.every((id) => selection.has(id));
    ids.forEach((id) => (all ? selection.delete(id) : selection.add(id)));
    refresh();
  });
  $('selectMoveBtn').addEventListener('click', async () => {
    const others = state.workspaces.filter((w) => w.id !== state.currentWorkspace);
    if (!others.length) { showToast('Najpierw załóż drugą przestrzeń: menu → Przestrzenie → „+ Nowa przestrzeń”'); return; }
    const ws = await pick(`Przenieś ${selection.size} do przestrzeni`, others.map((w) => [w.id, w.name]));
    if (!ws) return;
    const n = await moveNotes([...selection], ws);
    const name = (state.workspaces.find((w) => w.id === ws) || {}).name || '';
    stopSelecting();
    hooks.renderAll();
    showToast(`Przeniesiono do „${name}”: ${n}`, { label: 'Przejdź', onClick: () => hooks.switchWorkspace(ws) });
  });
  $('selectFolderBtn').addEventListener('click', async () => {
    const folders = state.folders.filter((f) => (f.workspace || 'default') === state.currentWorkspace);
    const f = await pick(`Przenieś ${selection.size} do folderu`, [['__none', 'Bez folderu'], ...folders.map((x) => [x.id, x.name])],
      folders.length ? '' : 'W tej przestrzeni nie ma jeszcze folderów. Założysz je w menu: Foldery → „+ Nowy folder”.');
    if (!f) return;
    const n = await setFolder([...selection], f === '__none' ? '' : f);
    stopSelecting();
    hooks.renderAll();
    showToast(f === '__none' ? `Wyjęto z folderów: ${n}` : `Przeniesiono do folderu: ${n}`);
  });
  $('selectDeleteBtn').addEventListener('click', async () => {
    const ids = [...selection];
    stopSelecting();
    await trashMany(ids);
  });
}

/** Po odświeżeniu listy zaznaczenie zostaje (np. po synchronizacji). */
export const reapplySelection = refresh;
