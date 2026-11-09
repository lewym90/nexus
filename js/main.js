// Punkt wejścia: inicjalizacja, spinanie zdarzeń, parametry uruchomienia (skróty / udostępnianie).
import { state, hooks, wsNotes, isLive } from './state.js';
import { $, isMobile, showToast, closeModal, isModalOpen, askConfirm, openModal } from './ui.js';
import { readLS, LS } from './storage.js';
import { initDB, loadNotes, migrateLegacyAttachments, revokeAllBlobURLs } from './db.js';
import { findNoteByTitle } from './state.js';
import { todayStr, deriveQuickNote, keyboardMetrics } from './util.js';
import { setView, pushScreen, showNotes, goBack } from './nav.js';
import { renderNotes, setupGridInteractions } from './list.js';
import {
  updateFolders, updateWorkspaces, updateTags, updateFolderSelect, closeSidebar, toggleSidebar, saveSettings,
  createFolder, renameFolder, deleteFolder, createWorkspace, renameWorkspace, deleteWorkspace, switchWorkspace
} from './sidebar.js';
import {
  registerEditorHooks, startNewNote, openNote, leaveEditor, saveCurrentNote, deleteCurrentNote, restoreCurrentNote, toggleArchiveCurrent,
  toggleFlag, togglePreview, onPreviewClick, setupTaskDrag, scheduleSave, onContentChanged, applyMarkdown, handleEditorKeys,
  addAttachments, showAttachment, openBacklink, setAuraFromUI, revealCaret, setNotePrivate
} from './editor.js';
import { loadTemplates, openTemplatePicker, saveAsTemplate, applyTemplateVars } from './templates.js';
import { exportData, importData, renderBackup, snoozeBackup } from './io.js';
import { initSync, isPaired } from './sync.js';
import { openSyncPanel } from './syncui.js';
import { renderHome, renderTasks, setupHomeInteractions, collectTasks } from './home.js';

import { initGraph, rebuildGraph, drawGraph, getGraph } from './graph.js';
import { emptyTrash, purgeExpired, purgeNote, createQuickNote, createNoteFrom } from './actions.js';

/* ---------- Ustawienia / motyw ---------- */

const THEMES = [
  { id: 'auto', label: 'Automatyczny', hint: 'jak w systemie: jasny w dzień, ciemny wieczorem', swatch: 'linear-gradient(90deg, #f4f3ef 50%, #0d1117 50%)' },
  { id: 'dark', label: 'Ciemny premium', hint: '', swatch: '#0d1117' },
  { id: 'light', label: 'Jasny premium', hint: '', swatch: '#f4f3ef' },
  { id: 'oled', label: 'Czarny OLED', hint: 'oszczędza baterię na ekranach OLED', swatch: '#000' }
];
const systemDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const resolvedTheme = () => (state.theme === 'auto' ? (systemDark && !systemDark.matches ? 'light' : 'dark') : state.theme);

/** Klasa motywu trafia na <html> i <body>: tło dokumentu (także pod paskami systemu) ma kolor motywu. */
function applyTheme() {
  const t = resolvedTheme();
  for (const el of [document.documentElement, document.body]) {
    el.classList.toggle('light', t === 'light');
    el.classList.toggle('oled', t === 'oled');
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = { light: '#f4f3ef', oled: '#000000' }[t] || '#0d1117';
  if (state.currentScreen === 'graph') drawGraph();
}
if (systemDark) systemDark.addEventListener('change', () => { if (state.theme === 'auto') applyTheme(); });

function chooseTheme() {
  const list = document.createElement('div');
  list.className = 'choice-list theme-choice';
  THEMES.forEach((t) => {
    const row = document.createElement('div');
    row.className = 'choice' + (state.theme === t.id ? ' current' : '');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice-main';
    b.dataset.theme = t.id;
    b.innerHTML = `<span class="swatch" style="background:${t.swatch}"></span><span><strong>${t.label}</strong>${t.hint ? `<br><small class="muted">${t.hint}</small>` : ''}</span>`;
    b.addEventListener('click', () => {
      state.theme = t.id;
      applyTheme();
      saveSettings();
      closeModal(null);
    });
    row.appendChild(b);
    list.appendChild(row);
  });
  openModal({ title: 'Motyw', content: list, actions: [{ label: 'Zamknij', value: null }] });
}

function loadSettings() {
  const s = readLS(LS.settings, {});
  state.theme = s.themeV === 2 && ['auto', 'dark', 'light', 'oled'].includes(s.theme) ? s.theme : 'auto';
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
  renderBackup();
  renderNavCounts();
  if (state.currentScreen === 'home') renderHome();
  if (state.currentScreen === 'tasks') renderTasks();
}

function renderNavCounts() {
  const live = wsNotes().filter(isLive);
  const counts = {
    all: live.length,
    recent: Math.min(live.length, 30),
    favorites: live.filter((n) => n.favorite).length,
    journal: live.filter((n) => n.tags.some((t) => t.toLowerCase() === 'dziennik') || n.title.toLowerCase().includes('dziennik')).length,
    archive: wsNotes().filter((n) => n.archived && !n.deleted).length,
    tasks: collectTasks(live).filter((t) => !t.done).length
  };
  document.querySelectorAll('[data-count]').forEach((el) => { const c = counts[el.dataset.count]; el.textContent = c ? String(c) : ''; });
}

/** Ikonka chmury w nagłówku: zielona = zsynchronizowano, czerwona = problem, szara = brak serwera. */
function updateSyncStatus() {
  renderBackup();
  const sync = readLS(LS.sync, null);
  const dot = $('syncDot');
  dot.className = 'status-dot ' + (!sync ? 'off' : sync.error ? 'err' : 'ok');
  $('syncStatusBtn').title = !sync ? 'Synchronizacja wyłączona' : sync.error ? 'Synchronizacja: ' + sync.error : 'Zsynchronizowano';
  if (state.currentScreen === 'home') renderHome();
}

Object.assign(hooks, { isPaired, syncStatus: updateSyncStatus, switchWorkspace, renderAll, renderNotes, updateTags, updateFolderSelect, closeSidebar, redrawGraph: drawGraph });
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

async function showScreen(screen, render) {
  closeSidebar();
  if (state.currentScreen === screen) { render(); return; }
  if (state.currentScreen === 'editor') await leaveEditor();
  pushScreen(screen);
  setView(screen);
  render();
}
const showHome = () => showScreen('home', () => { renderNavCounts(); renderHome(); });
const showTasks = () => showScreen('tasks', renderTasks);

/** Przyciski z data-go: dolny pasek, kafelki Pulpitu, menu boczne. */
async function go(target) {
  if (target === 'home') return showHome();
  if (target === 'tasks') return showTasks();
  if (target === 'graph') return showGraph();
  if (target === 'more') return toggleSidebar();
  if (target === 'notes' || target === 'search') {
    closeSidebar();
    if (target === 'notes') { setNavView('all'); state.currentFolder = null; state.currentTag = null; }
    if (state.currentScreen !== 'notes') { pushScreen('notes'); await showNotes(); } else renderAll();
    if (target === 'search') (isMobile() ? $('searchInputMobile') : $('searchInput')).focus();
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
  $('privateBtn').addEventListener('click', () => setNotePrivate(!state.editing?.note.private));
  $('accessSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-private]'); if (b) setNotePrivate(b.dataset.private === '1'); });
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
  document.querySelectorAll('.nav-item[data-view]').forEach((item) => item.addEventListener('click', async () => {
    setNavView(item.dataset.view);
    state.currentFolder = null;
    state.currentTag = null;
    state.animateNext = true;
    closeSidebar();
    if (state.currentScreen !== 'notes') { pushScreen('notes'); await showNotes(); }
    renderAll();
  }));
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-go]');
    if (t) { e.preventDefault(); go(t.dataset.go); return; }
    if (e.target.closest('[data-act="theme"]')) { closeSidebar(); chooseTheme(); }
  });
  $('tileNew').addEventListener('click', async () => { setNavView('all'); await onNewNote(); });
  $('tileJournal').addEventListener('click', async () => { setNavView('journal'); await onNewNote(); });
  $('syncStatusBtn').addEventListener('click', () => openSyncPanel(initSync));
  setupHomeInteractions();
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

  $('closeGraphBtn').addEventListener('click', goBack);
  $('exportBtn').addEventListener('click', exportData);
  $('backupNowBtn').addEventListener('click', exportData);
  $('backupLaterBtn').addEventListener('click', snoozeBackup);
  $('syncBtn').addEventListener('click', () => { closeSidebar(); openSyncPanel(initSync); });
  $('importBtn').addEventListener('click', importData);

  // historia przeglądarki / gest „wstecz”
  window.addEventListener('popstate', async (e) => {
    closeModal(null);
    let screen = (e.state && e.state.screen) || 'notes';
    if (state.currentScreen === 'editor') await leaveEditor();
    if (screen === 'editor') screen = 'notes';
    if (screen === 'graph') { setView('graph'); rebuildGraph(''); }
    else if (screen === 'home' || screen === 'tasks') { setView(screen); renderAll(); }
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

/**
 * Dopasowanie interfejsu do widocznego obszaru (klawiatura iOS): --kb = wysokość klawiatury, --vv-top = przesunięcie.
 * html.kb-open = klawiatura otwarta, html.kb-text = dodatkowo pisanie w treści notatki (edytor zajmuje cały widoczny obszar).
 */
function setupViewportSync() {
  const vv = window.visualViewport;
  if (!vv) return;
  const html = document.documentElement;
  const isField = (el) => !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !['file', 'checkbox'].includes(el.type)));
  let baseH = Math.max(window.innerHeight, vv.height);
  let wasOpen = false, wasText = false, raf = 0;
  const sync = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const active = document.activeElement;
      const field = isField(active);
      if (!field) baseH = Math.max(window.innerHeight, vv.height); // poza polem tekstowym klawiatury nie ma
      const m = keyboardMetrics(baseH, vv.height, vv.offsetTop);
      const open = m.open && field && vv.scale < 1.05; // powiększenie palcami też zmniejsza visualViewport
      const text = open && active.id === 'noteContent';
      html.style.setProperty('--kb', open ? m.kb + 'px' : '0px');
      html.style.setProperty('--vv-top', open ? m.top + 'px' : '0px');
      html.classList.toggle('kb-open', open);
      html.classList.toggle('kb-text', text);
      if (open && window.scrollY) window.scrollTo(0, 0);
      if (!open && wasOpen) window.scrollTo(0, 0);
      if (text) $('mainContent').scrollTop = 0; // iOS potrafi przewinąć także element z overflow: hidden
      if (text && !wasText) revealCaret(active);
      if (open && !text && (!wasOpen || wasText)) active.scrollIntoView({ block: 'center' });
      wasOpen = open; wasText = text;
    });
  };
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  document.addEventListener('focusin', () => {
    if (!wasOpen) baseH = Math.max(window.innerHeight, vv.height); // klawiatura dopiero się wysunie: to pełna wysokość
    sync();
  });
  document.addEventListener('focusout', sync);
  window.addEventListener('orientationchange', () => { baseH = window.innerHeight; sync(); });
}

const splashShown = performance.now();
function hideSplash() {
  const s = $('splash');
  if (!s) return;
  const wait = 700 - (performance.now() - splashShown); // znak marki zdąży się pokazać, ale start nie jest wstrzymywany
  if (wait > 0) { setTimeout(hideSplash, wait); return; }
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
  // Start: Pulpit (testy i ustawienie mogą wybrać listę notatek)
  const start = (() => { try { return localStorage.getItem('nexus-start') === 'notes' ? 'notes' : 'home'; } catch { return 'home'; } })();
  setView(start);
  try { history.replaceState({ screen: start }, ''); } catch { /* ignoruj */ }
  renderAll();
  updateSyncStatus();
  if (!state.dbOk) showToast('Pamięć lokalna niedostępna – notatki nie zostaną zachowane (tryb prywatny?)');
  if (state.dbOk && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  await handleLaunchParams();
  initSync();

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
