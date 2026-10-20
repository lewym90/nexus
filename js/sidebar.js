// Panel boczny: foldery, przestrzenie robocze, tagi, otwieranie/zamykanie.
import { state, hooks, wsNotes, isLive } from './state.js';
import { $, isMobile, askText, askConfirm, showToast } from './ui.js';
import { escapeHtml, generateId, plural } from './util.js';
import { writeLS, LS } from './storage.js';
import { putNote } from './db.js';
import { showNotes } from './nav.js';

export const saveFolders = () => writeLS(LS.folders, state.folders);
export const saveWorkspaces = () => writeLS(LS.workspaces, state.workspaces);

export function saveSettings() {
  const s = state;
  writeLS(LS.settings, { theme: s.theme, layout: s.currentLayout, sort: s.currentSort, workspace: s.currentWorkspace, sidebarCollapsed: s.sidebarCollapsed });
}

export function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebarBackdrop').classList.remove('show');
}

export function toggleSidebar() {
  if (isMobile()) {
    const open = $('sidebar').classList.toggle('open');
    $('sidebarBackdrop').classList.toggle('show', open);
  } else {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    document.body.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
    saveSettings();
    if (state.currentScreen === 'graph') hooks.redrawGraph();
  }
}

export function updateFolders() {
  const wsFolders = state.folders.filter((f) => (f.workspace || 'default') === state.currentWorkspace);
  $('foldersList').innerHTML = `<div class="folder-item ${!state.currentFolder ? 'active' : ''}" data-folder="">Wszystkie</div>` +
    wsFolders.map((f) => `
      <div class="folder-item ${state.currentFolder === f.id ? 'active' : ''}" data-folder="${escapeHtml(f.id)}">
        <span class="folder-name">${escapeHtml(f.name)}</span>
        <span class="folder-tools">
          <button class="mini-btn" data-act="rename" aria-label="Zmień nazwę folderu" title="Zmień nazwę">✎</button>
          <button class="mini-btn" data-act="delete" aria-label="Usuń folder" title="Usuń folder">✕</button>
        </span>
      </div>`).join('');
}

export function updateWorkspaces() {
  const html = state.workspaces.map((w) => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name)}</option>`).join('');
  document.querySelectorAll('.workspace-select').forEach((sel) => { sel.innerHTML = html; sel.value = state.currentWorkspace; });
  $('deleteWorkspaceBtn').disabled = state.currentWorkspace === 'default';
}

export function updateTags() {
  const counts = new Map();
  wsNotes().filter(isLive).forEach((n) => n.tags.forEach((t) => {
    const k = t.toLowerCase();
    const cur = counts.get(k) || { name: t, count: 0 };
    cur.count++;
    counts.set(k, cur);
  }));
  const list = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pl')).slice(0, 30);
  $('tagsList').innerHTML = list.map((t) =>
    `<span class="tag-pill ${state.currentTag && state.currentTag.toLowerCase() === t.name.toLowerCase() ? 'active' : ''}" data-tag="${escapeHtml(t.name)}" role="button" tabindex="0">#${escapeHtml(t.name)} <small>${t.count}</small></span>`
  ).join('') || '<span class="muted small">Brak tagów</span>';
}

export function updateFolderSelect(selected) {
  const sel = $('folderSelect');
  const wsFolders = state.folders.filter((f) => (f.workspace || 'default') === state.currentWorkspace);
  const keep = selected !== undefined ? selected : sel.value;
  sel.innerHTML = '<option value="">Brak</option>' + wsFolders.map((f) => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)}</option>`).join('');
  sel.value = keep;
}

export async function createFolder() {
  const name = await askText('Nazwa folderu', 'np. Praca');
  if (!name) return;
  state.folders.push({ id: generateId(), name, workspace: state.currentWorkspace });
  saveFolders();
  updateFolders();
  updateFolderSelect();
}

export async function renameFolder(id) {
  const f = state.folders.find((x) => x.id === id);
  if (!f) return;
  const name = await askText('Zmień nazwę folderu', '', f.name);
  if (!name) return;
  f.name = name;
  saveFolders();
  hooks.renderAll();
}

export async function deleteFolder(id) {
  const f = state.folders.find((x) => x.id === id);
  if (!f) return;
  if (!(await askConfirm('Usunąć folder?', `Folder „${f.name}” zostanie usunięty. Notatki z niego nie zostaną skasowane.`, 'Usuń', true))) return;
  for (const n of state.notes.filter((n) => n.folder === id)) {
    n.folder = '';
    try { await putNote(n); } catch { /* ignoruj */ }
  }
  state.folders = state.folders.filter((x) => x.id !== id);
  if (state.currentFolder === id) state.currentFolder = null;
  saveFolders();
  hooks.renderAll();
}

export async function switchWorkspace(id) {
  if (!state.workspaces.find((w) => w.id === id)) id = 'default';
  if (state.currentScreen !== 'notes') await showNotes();
  state.currentWorkspace = id;
  state.currentFolder = null;
  state.currentTag = null;
  saveSettings();
  hooks.renderAll();
}

export async function createWorkspace() {
  const name = await askText('Nowa przestrzeń robocza', 'np. Praca');
  if (!name) return;
  const ws = { id: generateId(), name };
  state.workspaces.push(ws);
  saveWorkspaces();
  await switchWorkspace(ws.id);
}

export async function renameWorkspace() {
  const ws = state.workspaces.find((w) => w.id === state.currentWorkspace);
  const name = await askText('Zmień nazwę przestrzeni', '', ws.name);
  if (!name) return;
  ws.name = name;
  saveWorkspaces();
  updateWorkspaces();
}

export async function deleteWorkspace() {
  if (state.currentWorkspace === 'default') return;
  const ws = state.workspaces.find((w) => w.id === state.currentWorkspace);
  const count = wsNotes().length;
  const msg = `Przestrzeń „${ws.name}” zostanie usunięta. ${count ? `${count} ${plural(count, 'notatka zostanie przeniesiona', 'notatki zostaną przeniesione', 'notatek zostanie przeniesionych')} do „Główna”.` : ''}`;
  if (!(await askConfirm('Usunąć przestrzeń?', msg, 'Usuń', true))) return;
  const wsFolderIds = new Set(state.folders.filter((f) => f.workspace === ws.id).map((f) => f.id));
  for (const n of wsNotes()) {
    n.workspace = 'default';
    if (wsFolderIds.has(n.folder)) n.folder = '';
    try { await putNote(n); } catch { /* ignoruj */ }
  }
  state.folders = state.folders.filter((f) => f.workspace !== ws.id);
  state.workspaces = state.workspaces.filter((w) => w.id !== ws.id);
  saveFolders(); saveWorkspaces();
  await switchWorkspace('default');
}
