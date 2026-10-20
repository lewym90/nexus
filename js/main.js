// Punkt wejścia: inicjalizacja, spinanie zdarzeń, parametry uruchomienia (skróty / udostępnianie).
import { state, hooks } from './state.js';
import { $, isMobile, showToast, closeModal, isModalOpen, askConfirm } from './ui.js';
import { readLS, LS } from './storage.js';
import { initDB, loadNotes, migrateLegacyAttachments, revokeAllBlobURLs } from './db.js';
import { findNoteByTitle } from './state.js';
import { todayStr, deriveQuickNote } from './util.js';
import { setView, pushScreen, showNotes, goBack } from './nav.js';
import { renderNotes, setupGridInteractions } from './list.js';
import {
  updateFolders, updateWorkspaces, updateTags, updateFolderSelect, closeSidebar, toggleSidebar, saveSettings,
  createFolder, renameFolder, deleteFolder, createWorkspace, renameWorkspace, deleteWorkspace, switchWorkspace
} from './sidebar.js';
import {
  registerEditorHooks, startNewNote, openNote, leaveEditor, saveCurrentNote, deleteCurrentNote, restoreCurrentNote, toggleArchiveCurrent,
  toggleFlag, togglePreview, onPreviewClick, setupTaskDrag, scheduleSave, onContentChanged, applyMarkdown, handleEditorKeys,
  addAttachments, showAttachment, openBacklink, setAuraFromUI
} from './editor.js';
import { loadTemplates, openTemplatePicker, saveAsTemplate, applyTemplateVars } from './templates.js';
import { exportData, importData } from './io.js';
import { initGraph, rebuildGraph, drawGraph, getGraph } from './graph.js';
import { emptyTrash, purgeExpired, purgeNote, createQuickNote, createNoteFrom } from './actions.js';

/* ---------- Ustawienia / motyw ---------- */

function applyTheme() {
  document.body.classList.toggle('light', state.theme === 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = state.theme === 'light' ? '#f5f6f8' : '#0c0e12';
}

function loadSettings() {
  const s = readLS(LS.settings, {});
  state.theme = s.theme === 'light' ? 'light' : 'dark';
  state.currentLayout = s.layout === 'list' ? 'list' : 'grid';
  state.currentSort = ['updated', 'created', 'title'].includes(s.sort) ? s.sort : 'updated';
  state.currentWorkspace = typeof s.workspace === 'string' ? s.workspace : 'default';
  state.sidebarCollapsed = !!s.sidebarCollapsed;
  applyTheme();
  document.querySelectorAll('.view-btn').forEach((b) => b.classList.toggle('active', b.dataset.layout === state.currentLayout));
  $('sortSelect').value = state.currentSort;
  document.body.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
}

async function loadAll() {
  await loadNotes();
  const f = readLS(LS.folders, []);
  state.folders = Array.isArray(f) ? f.filter((x) => x && x.id && x.name) : [];
  const w = readLS(LS.workspaces, null);
  state.workspaces = Array.isArray(w) && w.length ? w.filter((x) => x && x.id && x.name) : [];
  if (!state.workspaces.find((x) => x.id === 'default')) state.workspaces.unshift({ id: 'default', name: 'Główna' });
  loadTemplates();
  if (!state.workspaces.find((x) => x.id === state.currentWorkspace)) state.currentWorkspace = 'default';
}

function renderAll() {
  updateWorkspaces();
  updateFolders();
  updateTags();
  updateFolderSelect();
  renderNotes();
}

Object.assign(hooks, { renderAll, renderNotes, updateTags, updateFolderSelect, closeSidebar, redrawGraph: drawGraph });
registerEditorHooks();

/* ---------- Nowe notatki ---------- */

async function onNewNote() {
  if (state.currentScreen === 'editor') await leaveEditor();
  if (state.currentView === 'journal') {
    const title = 'Dziennik ' + todayStr();
    const existing = findNoteByTitle(title);
    if (existing) return openNote(existing.id);
    const t = state.templates.find((x) => x.id === 'journal');
    return startNewNote({ title, tags: ['dziennik'], content: applyTemplateVars(t ? t.content : '# {{date}}\n\n') });
  }
  if (state.currentView === 'trash' || state.currentView === 'archive') setNavView('all');
  startNewNote();
}

function setNavView(view) {
  state.currentView = view;
  document.querySelectorAll('.nav-item').forEach((i) => i.classList.toggle('active', i.dataset.view === view));
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text || !text.trim()) { showToast('Schowek jest pusty'); return; }
    await createQuickNote(text);
  } catch {
    showToast('Brak dostępu do schowka – wklej tekst w polu szybkiej notatki');
    $('quickInput').focus();
  }
}

async function showGraph() {
  closeSidebar();
  if (state.currentScreen === 'graph') return;
  if (state.currentScreen === 'editor') await leaveEditor();
  pushScreen('graph');
  setView('graph');
  rebuildGraph('');
}

/** Parametry uruchomienia: ?action=new|journal|clipboard oraz udostępnianie (?title=&text=&url=). */
async function handleLaunchParams() {
  const p = new URLSearchParams(location.search);
  if ([...p.keys()].length === 0) return;
  const action = p.get('action');
  const sTitle = p.get('title'), sText = p.get('text'), sUrl = p.get('url');
  try { history.replaceState(null, '', location.pathname); } catch { /* ignoruj */ }
  if (sTitle || sText || sUrl) {
    const content = [sText, sUrl].filter(Boolean).join('\n\n');
    const title = (sTitle || (deriveQuickNote(content) || {}).title || 'Udostępnione').slice(0, 80);
    const note = await createNoteFrom({ title, content, tags: [] });
    if (note) {
      renderAll();
      showToast('Dodano z udostępniania', { label: 'Otwórz', onClick: () => openNote(note.id) });
    }
    return;
  }
  if (action === 'new') startNewNote();
  else if (action === 'journal') { setNavView('journal'); renderAll(); await onNewNote(); }
  else if (action === 'clipboard') {
    if (await askConfirm('Nowa notatka ze schowka', 'Wkleić zawartość schowka jako nową notatkę?', 'Wklej')) await pasteFromClipboard();
  }
}

/* ---------- Zdarzenia ---------- */

function setupEventListeners() {
  setupGridInteractions();
  setupTaskDrag();
  initGraph();

  $('newNoteBtn').addEventListener('click', onNewNote);
  $('emptyNewBtn').addEventListener('click', onNewNote);
  $('emptyTemplatesBtn').addEventListener('click', openTemplatePicker);
  $('templatesBtn').addEventListener('click', () => { closeSidebar(); openTemplatePicker(); });
  $('saveTemplateBtn').addEventListener('click', saveAsTemplate);

  // szybkie przechwytywanie
  $('quickBar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = $('quickInput').value;
    if (!v.trim()) return;
    $('quickInput').value = '';
    await createQuickNote(v);
  });
  $('clipboardBtn').addEventListener('click', pasteFromClipboard);

  // edytor
  $('backBtn').addEventListener('click', goBack);
  $('deleteBtn').addEventListener('click', deleteCurrentNote);
  $('archiveBtn').addEventListener('click', toggleArchiveCurrent);
  $('restoreBtn').addEventListener('click', restoreCurrentNote);
  $('purgeBtn').addEventListener('click', deleteCurrentNote);
  $('favoriteBtn').addEventListener('click', () => toggleFlag('favorite'));
  $('pinBtn').addEventListener('click', () => toggleFlag('pinned'));
  $('previewToggle').addEventListener('click', () => { state.isPreview = !state.isPreview; togglePreview(); });
  $('markdownPreview').addEventListener('click', onPreviewClick);
  document.querySelectorAll('.aura-dot').forEach((dot) => dot.addEventListener('click', () => setAuraFromUI(dot.dataset.color)));
  $('folderSelect').addEventListener('change', scheduleSave);
  $('noteTitle').addEventListener('input', scheduleSave);
  $('tagsInput').addEventListener('input', scheduleSave);
  $('noteContent').addEventListener('input', onContentChanged);
  $('noteContent').addEventListener('keydown', handleEditorKeys);
  $('noteTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('noteContent').focus(); } });
  $('mdToolbar').addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); }); // zachowaj fokus/klawiaturę
  $('mdToolbar').addEventListener('click', (e) => { const b = e.target.closest('button[data-md]'); if (b) applyMarkdown(b.dataset.md); });
  $('attachmentInput').addEventListener('change', async (e) => { const files = [...e.target.files]; e.target.value = ''; await addAttachments(files); });
  $('attachmentsList').addEventListener('click', (e) => { const b = e.target.closest('.att'); if (b) showAttachment(Number(b.dataset.idx)); });
  $('backlinksList').addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) openBacklink(b.dataset.id); });

  // wyszukiwanie
  let searchTimer;
  const onSearch = async (e) => {
    state.searchQuery = e.target.value;
    $('searchInput').value = state.searchQuery;
    $('searchInputMobile').value = state.searchQuery;
    if (state.currentScreen !== 'notes') await showNotes();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderNotes, 60);
  };
  $('searchInput').addEventListener('input', onSearch);
  $('searchInputMobile').addEventListener('input', onSearch);

  // nawigacja boczna
  document.querySelectorAll('.nav-item').forEach((item) => item.addEventListener('click', async () => {
    setNavView(item.dataset.view);
    state.currentFolder = null;
    state.currentTag = null;
    state.animateNext = true;
    closeSidebar();
    if (state.currentScreen !== 'notes') await showNotes();
    renderAll();
  }));
  $('emptyTrashBtn').addEventListener('click', emptyTrash);

  $('foldersList').addEventListener('click', async (e) => {
    const item = e.target.closest('.folder-item');
    if (!item) return;
    const act = e.target.closest('[data-act]');
    if (act) return act.dataset.act === 'rename' ? renameFolder(item.dataset.folder) : deleteFolder(item.dataset.folder);
    state.currentFolder = item.dataset.folder || null;
    closeSidebar();
    if (state.currentScreen !== 'notes') await showNotes();
    renderAll();
  });

  const tagHandler = async (e) => {
    if (e.type === 'keydown' && e.key !== 'Enter') return;
    const pill = e.target.closest('.tag-pill');
    if (!pill) return;
    const same = state.currentTag && state.currentTag.toLowerCase() === pill.dataset.tag.toLowerCase();
    state.currentTag = same ? null : pill.dataset.tag;
    closeSidebar();
    if (state.currentScreen !== 'notes') await showNotes();
    updateTags();
    renderNotes();
  };
  $('tagsList').addEventListener('click', tagHandler);
  $('tagsList').addEventListener('keydown', tagHandler);
  $('activeFilters').addEventListener('click', (e) => {
    const c = e.target.closest('[data-clear]');
    if (!c) return;
    if (c.dataset.clear === 'tag') state.currentTag = null; else state.currentFolder = null;
    renderAll();
  });

  document.querySelectorAll('.view-btn').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('.view-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.currentLayout = btn.dataset.layout;
    saveSettings();
    renderNotes();
  }));
  $('sortSelect').addEventListener('change', (e) => { state.currentSort = e.target.value; saveSettings(); renderNotes(); });

  document.querySelectorAll('.workspace-select').forEach((sel) => sel.addEventListener('change', (e) => { closeSidebar(); switchWorkspace(e.target.value); }));
  $('newWorkspaceBtn').addEventListener('click', createWorkspace);
  $('renameWorkspaceBtn').addEventListener('click', renameWorkspace);
  $('deleteWorkspaceBtn').addEventListener('click', deleteWorkspace);
  $('newFolderBtn').addEventListener('click', createFolder);

  $('menuToggle').addEventListener('click', toggleSidebar);
  $('sidebarBackdrop').addEventListener('click', closeSidebar);
  $('themeToggle').addEventListener('click', () => {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    applyTheme();
    saveSettings();
    if (state.currentScreen === 'graph') drawGraph();
  });

  $('graphBtn').addEventListener('click', showGraph);
  $('closeGraphBtn').addEventListener('click', goBack);
  $('exportBtn').addEventListener('click', exportData);
  $('importBtn').addEventListener('click', importData);

  // historia przeglądarki / gest „wstecz”
  window.addEventListener('popstate', async (e) => {
    closeModal(null);
    let screen = (e.state && e.state.screen) || 'notes';
    if (state.currentScreen === 'editor') await leaveEditor();
    if (screen === 'editor') screen = 'notes';
    if (screen === 'graph') { setView('graph'); rebuildGraph(''); }
    else { setView('notes'); renderAll(); }
  });

  // zapis przy przejściu w tło / zamknięciu (ważne na iOS)
  const flush = () => { if (state.editing) saveCurrentNote(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', () => { flush(); revokeAllBlobURLs(); });

  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') {
      if (isModalOpen()) { closeModal(null); return; }
      if (isMobile() && $('sidebar').classList.contains('open')) { closeSidebar(); return; }
      if (state.currentScreen === 'editor' || state.currentScreen === 'graph') goBack();
      return;
    }
    if (isModalOpen()) return;
    const k = e.key.toLowerCase();
    if (mod && k === 'k') {
      e.preventDefault();
      (async () => {
        if (state.currentScreen !== 'notes') await showNotes();
        (isMobile() ? $('searchInputMobile') : $('searchInput')).focus();
      })();
    } else if (mod && k === 's') {
      e.preventDefault();
      if (state.editing) saveCurrentNote().then(() => showToast('Zapisano'));
    } else if (mod && k === 'n' && (e.altKey || !e.shiftKey)) {
      e.preventDefault();
      onNewNote();
    }
  });
}

/* ---------- Start ---------- */

/** Dopasowanie interfejsu do widocznego obszaru (klawiatura iOS): --kb = wysokość klawiatury, --vv-top = przesunięcie. */
function setupViewportSync() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement.style;
  let raf = 0;
  const sync = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const open = kb > 120; // ignoruj drobne różnice (pasek adresu itp.)
      root.setProperty('--kb', open ? kb + 'px' : '0px');
      root.setProperty('--vv-top', open ? Math.max(0, vv.offsetTop) + 'px' : '0px');
    });
  };
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
}

function hideSplash() {
  const s = $('splash');
  if (!s) return;
  s.classList.add('hide');
  setTimeout(() => s.remove(), 400);
}

async function init() {
  setTimeout(hideSplash, 4000); // zabezpieczenie na wypadek błędu startu
  setupViewportSync();
  loadSettings();
  try { await initDB(); } catch (e) { state.dbOk = false; console.error('IndexedDB:', e); }
  try { await loadAll(); } catch (e) { console.error(e); }
  try { await migrateLegacyAttachments(state.notes); } catch (e) { console.error('Migracja załączników:', e); }
  try { await purgeExpired(); } catch (e) { console.error(e); }
  setupEventListeners();
  try { history.replaceState(null, ''); } catch { /* ignoruj */ }
  renderAll();
  if (!state.dbOk) showToast('Pamięć lokalna niedostępna – notatki nie zostaną zachowane (tryb prywatny?)');
  if (state.dbOk && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  await handleLaunchParams();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) showToast('Dostępna nowa wersja – uruchom aplikację ponownie');
    });
  }
  window.nexus = { state, getGraph, hooks, actions: { purgeNote } }; // wygodne do debugowania i testów
  document.body.dataset.ready = '1';
  hideSplash();
}

init();
