'use strict';
// Nexus Notes – lokalne, prywatne notatki (IndexedDB + localStorage)

const DB_NAME = 'NexusDB';
const DB_VERSION = 2;
const STORE_NAME = 'notes';
const DEFAULT_AURA = '#3b82f6';
const LS = {
  settings: 'nexus-settings',
  folders: 'nexus-folders',
  workspaces: 'nexus-workspaces',
  templates: 'nexus-templates'
};

let db = null;
let notes = [];
let folders = [];
let workspaces = [];
let templates = [];
let editing = null; // { note, isNew }
let currentScreen = 'notes'; // notes | graph | editor
let currentView = 'all';
let currentLayout = 'grid';
let currentSort = 'updated';
let currentWorkspace = 'default';
let currentFolder = null;
let currentTag = null;
let searchQuery = '';
let isPreview = false;
let theme = 'dark';
let saveTimer = null;
let graphState = null;

const $ = (id) => document.getElementById(id);
const isMobile = () => window.matchMedia('(max-width: 900px)').matches;

/* ---------- Utils ---------- */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function readLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    showToast('Nie można zapisać ustawień (brak miejsca lub tryb prywatny)');
    return false;
  }
}

let toastTimer;
function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const diff = Date.now() - d;
  if (diff < 60000) return 'przed chwilą';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min temu`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} godz. temu`;
  return d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function plural(n, one, few, many) {
  if (n === 1) return one;
  const m10 = n % 10, m100 = n % 100;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function wsNotes() {
  return notes.filter((n) => (n.workspace || 'default') === currentWorkspace);
}

/* ---------- Settings ---------- */

function loadSettings() {
  const s = readLS(LS.settings, {});
  theme = s.theme === 'light' ? 'light' : 'dark';
  currentLayout = s.layout === 'list' ? 'list' : 'grid';
  currentSort = ['updated', 'created', 'title'].includes(s.sort) ? s.sort : 'updated';
  currentWorkspace = typeof s.workspace === 'string' ? s.workspace : 'default';
  sidebarCollapsed = !!s.sidebarCollapsed;
  applyTheme();
  document.querySelectorAll('.view-btn').forEach((b) => b.classList.toggle('active', b.dataset.layout === currentLayout));
  $('sortSelect').value = currentSort;
  document.body.classList.toggle('sidebar-collapsed', sidebarCollapsed);
}

let sidebarCollapsed = false;

function saveSettings() {
  writeLS(LS.settings, { theme, layout: currentLayout, sort: currentSort, workspace: currentWorkspace, sidebarCollapsed });
}

function applyTheme() {
  document.body.classList.toggle('light', theme === 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'light' ? '#f5f6f8' : '#0c0e12';
}

/* ---------- Database ---------- */

function initDB() {
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
      let store;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      } else {
        store = e.target.transaction.objectStore(STORE_NAME);
      }
      if (!store.indexNames.contains('updated')) store.createIndex('updated', 'updated', { unique: false });
      if (!store.indexNames.contains('workspace')) store.createIndex('workspace', 'workspace', { unique: false });
    };
  });
}

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve(null);
    let tx;
    try { tx = db.transaction(STORE_NAME, mode); } catch (e) { return reject(e); }
    let result;
    const req = fn(tx.objectStore(STORE_NAME));
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transakcja przerwana'));
  });
}

const putNote = (note) => idb('readwrite', (s) => s.put(note));
const deleteNoteFromDB = (id) => idb('readwrite', (s) => s.delete(id));

function normalizeNote(n) {
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
    folder: n.folder || '',
    workspace: n.workspace || 'default',
    attachments: Array.isArray(n.attachments) ? n.attachments.filter((a) => a && typeof a.data === 'string') : [],
    created: Number(n.created) || now,
    updated: Number(n.updated) || Number(n.created) || now
  };
}

async function loadNotes() {
  const all = await idb('readonly', (s) => s.getAll());
  if (all) notes = all.map(normalizeNote);
}

function getDefaultTemplates() {
  return [
    { id: 'meeting', name: 'Spotkanie', content: '# Spotkanie\n\n**Data:** {{date}}\n**Uczestnicy:** \n\n## Agenda\n- \n\n## Notatki\n\n## Następne kroki\n- [ ] ' },
    { id: 'journal', name: 'Dziennik', title: 'Dziennik {{date}}', tags: ['dziennik'], content: '# Dziennik {{date}}\n\n## Co się wydarzyło\n\n## Myśli\n\n## Wdzięczność\n- ' },
    { id: 'idea', name: 'Pomysł', content: '# Pomysł\n\n## Opis\n\n## Dlaczego ważny\n\n## Następne kroki\n- [ ] ' }
  ];
}

async function loadAll() {
  await loadNotes();
  const f = readLS(LS.folders, []);
  folders = Array.isArray(f) ? f.filter((x) => x && x.id && x.name) : [];
  const w = readLS(LS.workspaces, null);
  workspaces = Array.isArray(w) && w.length ? w.filter((x) => x && x.id && x.name) : [];
  if (!workspaces.find((x) => x.id === 'default')) workspaces.unshift({ id: 'default', name: 'Główna' });
  const t = readLS(LS.templates, null);
  templates = Array.isArray(t) && t.length ? t.filter((x) => x && x.id && x.name) : getDefaultTemplates();
  if (!workspaces.find((x) => x.id === currentWorkspace)) currentWorkspace = 'default';
}

const saveFolders = () => writeLS(LS.folders, folders);
const saveWorkspaces = () => writeLS(LS.workspaces, workspaces);
const saveTemplates = () => writeLS(LS.templates, templates);

/* ---------- Modal dialogs ---------- */

let modalState = null;

function openModal({ title, message, content, actions }) {
  return new Promise((resolve) => {
    closeModal(null);
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';
    const box = document.createElement('div');
    box.className = 'modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    if (title) {
      const h = document.createElement('h2');
      h.textContent = title;
      box.appendChild(h);
    }
    if (message) {
      const p = document.createElement('p');
      p.className = 'modal-message';
      p.textContent = message;
      box.appendChild(p);
    }
    if (content) box.appendChild(content);
    const bar = document.createElement('div');
    bar.className = 'modal-actions';
    (actions || []).forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'modal-btn ' + (a.kind || '');
      b.textContent = a.label;
      b.addEventListener('click', () => closeModal(a.value));
      bar.appendChild(b);
    });
    box.appendChild(bar);
    overlay.appendChild(box);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeModal(null); });
    document.body.appendChild(overlay);
    modalState = { overlay, resolve };
    const focusEl = box.querySelector('input,select') || bar.querySelector('.primary, .danger') || bar.lastElementChild;
    if (focusEl) setTimeout(() => focusEl.focus(), 30);
  });
}

function closeModal(value) {
  if (!modalState) return;
  const { overlay, resolve } = modalState;
  modalState = null;
  overlay.remove();
  resolve(value);
}

async function askText(title, placeholder = '', value = '') {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'modal-input';
  input.placeholder = placeholder;
  input.value = value;
  input.maxLength = 80;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); closeModal(input.value); }
  });
  const res = await openModal({
    title, content: input,
    actions: [{ label: 'Anuluj', value: null }, { label: 'OK', kind: 'primary', value: '__ok__' }]
  });
  if (res === null) return null;
  const v = (res === '__ok__' ? input.value : res).trim();
  return v || null;
}

async function askConfirm(title, message, okLabel = 'OK', danger = false) {
  const res = await openModal({
    title, message,
    actions: [{ label: 'Anuluj', value: false }, { label: okLabel, kind: danger ? 'danger' : 'primary', value: true }]
  });
  return res === true;
}

/* ---------- Filtering & rendering notes ---------- */

function folderName(id) {
  return folders.find((f) => f.id === id)?.name || '';
}

function getFilteredNotes() {
  let filtered = wsNotes();
  if (currentFolder) filtered = filtered.filter((n) => n.folder === currentFolder);
  if (currentTag) {
    const t = currentTag.toLowerCase();
    filtered = filtered.filter((n) => n.tags.some((x) => x.toLowerCase() === t));
  }
  if (currentView === 'favorites') filtered = filtered.filter((n) => n.favorite);
  if (currentView === 'journal') {
    filtered = filtered.filter((n) => n.tags.some((t) => t.toLowerCase() === 'dziennik') || n.title.toLowerCase().includes('dziennik'));
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter((n) =>
      n.title.toLowerCase().includes(q) ||
      n.content.toLowerCase().includes(q) ||
      n.tags.some((t) => t.toLowerCase().includes(q))
    );
  }
  const cmp = (a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (currentSort === 'title') return (a.title || '').localeCompare(b.title || '', 'pl');
    if (currentSort === 'created') return b.created - a.created;
    return b.updated - a.updated;
  };
  if (currentView === 'recent') {
    // "Ostatnie" = 30 ostatnio zmienionych, niezależnie od wybranego sortowania
    filtered = filtered.sort((a, b) => b.updated - a.updated).slice(0, 30);
  }
  return filtered.sort(cmp);
}

function plainPreview(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\[([^\]|\n]+)\|?([^\]\n]*)\]\]/g, (m, a, b) => b || a)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]\s+\[[ xX]\]|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

const VIEW_TITLES = { all: 'Wszystkie notatki', recent: 'Ostatnie', favorites: 'Ulubione', journal: 'Dziennik' };

function renderNotes() {
  const grid = $('notesGrid');
  const empty = $('emptyState');
  const filtered = getFilteredNotes();
  grid.classList.toggle('list-view', currentLayout === 'list');

  let title = VIEW_TITLES[currentView] || 'Notatki';
  if (currentFolder) title += ' · ' + folderName(currentFolder);
  $('viewTitle').textContent = title;

  const chips = [];
  if (currentTag) chips.push(`<button class="chip" data-clear="tag">#${escapeHtml(currentTag)} ✕</button>`);
  if (currentFolder) chips.push(`<button class="chip" data-clear="folder">📁 ${escapeHtml(folderName(currentFolder))} ✕</button>`);
  $('activeFilters').innerHTML = chips.join('');

  if (filtered.length === 0) {
    grid.innerHTML = '';
    const filteredOut = searchQuery || currentTag || currentFolder || currentView !== 'all';
    $('emptyTitle').textContent = filteredOut ? 'Nic tu nie ma' : 'Brak notatek';
    $('emptyText').textContent = searchQuery ? 'Żadna notatka nie pasuje do wyszukiwania.' :
      filteredOut ? 'Brak notatek w tym widoku.' : 'Stwórz pierwszą notatkę, aby rozpocząć.';
    empty.classList.add('show');
    return;
  }
  empty.classList.remove('show');

  grid.innerHTML = filtered.map((note, i) => `
    <article class="note-card ${note.pinned ? 'pinned' : ''}" data-id="${escapeHtml(note.id)}" tabindex="0" role="button"
      style="--card-aura: ${escapeHtml(note.aura)}; animation-delay: ${Math.min(i, 12) * 0.03}s">
      <h3>${escapeHtml(note.title || 'Bez tytułu')}</h3>
      <p>${escapeHtml(plainPreview(note.content)) || '&nbsp;'}</p>
      <div class="note-meta">
        <div class="note-tags">
          ${note.favorite ? '<span class="fav-star" title="Ulubiona">★</span>' : ''}
          ${note.tags.slice(0, 3).map((t) => `<span class="mini-tag">#${escapeHtml(t)}</span>`).join('')}
        </div>
        <span>${escapeHtml(formatDate(note.updated))}</span>
      </div>
    </article>
  `).join('');
}

/* Gesty swipe (delegacja zdarzeń) */
let suppressClickUntil = 0;
function setupGridInteractions() {
  const grid = $('notesGrid');

  grid.addEventListener('click', (e) => {
    if (Date.now() < suppressClickUntil) return;
    const card = e.target.closest('.note-card');
    if (card) openNote(card.dataset.id);
  });
  grid.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.note-card');
    if (card) { e.preventDefault(); openNote(card.dataset.id); }
  });

  let sx = 0, sy = 0, card = null, horizontal = null, dx = 0;
  grid.addEventListener('touchstart', (e) => {
    card = e.target.closest('.note-card');
    if (!card || e.touches.length !== 1) { card = null; return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; horizontal = null; dx = 0;
  }, { passive: true });
  grid.addEventListener('touchmove', (e) => {
    if (!card) return;
    dx = e.touches[0].clientX - sx;
    const dy = e.touches[0].clientY - sy;
    if (horizontal === null && (Math.abs(dx) > 12 || Math.abs(dy) > 12)) horizontal = Math.abs(dx) > Math.abs(dy) * 1.5;
    if (horizontal) {
      card.style.transition = 'none';
      card.style.transform = `translateX(${dx * 0.5}px)`;
      card.classList.toggle('swipe-fav', dx > 80);
      card.classList.toggle('swipe-del', dx < -80);
    }
  }, { passive: true });
  const end = async () => {
    if (!card) return;
    const c = card; card = null;
    c.style.transition = ''; c.style.transform = '';
    c.classList.remove('swipe-fav', 'swipe-del');
    if (!horizontal || Math.abs(dx) < 80) return;
    suppressClickUntil = Date.now() + 400;
    const note = notes.find((n) => n.id === c.dataset.id);
    if (!note) return;
    if (dx > 0) {
      note.favorite = !note.favorite;
      try { await putNote(note); } catch { showToast('Błąd zapisu'); }
      renderNotes();
      showToast(note.favorite ? 'Dodano do ulubionych' : 'Usunięto z ulubionych');
    } else if (await askConfirm('Usunąć notatkę?', `„${note.title || 'Bez tytułu'}” zostanie trwale usunięta.`, 'Usuń', true)) {
      await removeNote(note.id);
      renderAll();
      showToast('Usunięto');
    }
  };
  grid.addEventListener('touchend', end);
  grid.addEventListener('touchcancel', () => {
    if (card) { card.style.transition = ''; card.style.transform = ''; card.classList.remove('swipe-fav', 'swipe-del'); card = null; }
  });
}

async function removeNote(id) {
  try { await deleteNoteFromDB(id); } catch { showToast('Błąd usuwania'); return; }
  notes = notes.filter((n) => n.id !== id);
}

/* ---------- Sidebar lists ---------- */

function updateFolders() {
  const container = $('foldersList');
  const wsFolders = folders.filter((f) => (f.workspace || 'default') === currentWorkspace);
  container.innerHTML = `<div class="folder-item ${!currentFolder ? 'active' : ''}" data-folder="">Wszystkie</div>` +
    wsFolders.map((f) => `
      <div class="folder-item ${currentFolder === f.id ? 'active' : ''}" data-folder="${escapeHtml(f.id)}">
        <span class="folder-name">${escapeHtml(f.name)}</span>
        <span class="folder-tools">
          <button class="mini-btn" data-act="rename" aria-label="Zmień nazwę folderu" title="Zmień nazwę">✎</button>
          <button class="mini-btn" data-act="delete" aria-label="Usuń folder" title="Usuń folder">✕</button>
        </span>
      </div>`).join('');
}

function updateWorkspaces() {
  const html = workspaces.map((w) => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name)}</option>`).join('');
  document.querySelectorAll('.workspace-select').forEach((sel) => {
    sel.innerHTML = html;
    sel.value = currentWorkspace;
  });
  $('renameWorkspaceBtn').disabled = false;
  $('deleteWorkspaceBtn').disabled = currentWorkspace === 'default';
}

function updateTags() {
  const counts = new Map();
  wsNotes().forEach((n) => n.tags.forEach((t) => {
    const k = t.toLowerCase();
    const cur = counts.get(k) || { name: t, count: 0 };
    cur.count++;
    counts.set(k, cur);
  }));
  const list = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pl')).slice(0, 30);
  $('tagsList').innerHTML = list.map((t) =>
    `<span class="tag-pill ${currentTag && currentTag.toLowerCase() === t.name.toLowerCase() ? 'active' : ''}" data-tag="${escapeHtml(t.name)}" role="button" tabindex="0">#${escapeHtml(t.name)} <small>${t.count}</small></span>`
  ).join('') || '<span class="muted small">Brak tagów</span>';
}

function updateFolderSelect(selected) {
  const sel = $('folderSelect');
  const wsFolders = folders.filter((f) => (f.workspace || 'default') === currentWorkspace);
  const keep = selected !== undefined ? selected : sel.value;
  sel.innerHTML = '<option value="">Brak</option>' + wsFolders.map((f) => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)}</option>`).join('');
  sel.value = keep;
}

function renderAll() {
  updateWorkspaces();
  updateFolders();
  updateTags();
  updateFolderSelect();
  renderNotes();
}

/* ---------- Markdown ---------- */

function extractWikiTargets(content) {
  const out = [];
  const re = /\[\[([^\]\n]+)\]\]/g;
  let m;
  while ((m = re.exec(content || ''))) {
    const target = m[1].split('|')[0].trim();
    if (target) out.push(target);
  }
  return out;
}

function findNoteByTitle(title, ws = currentWorkspace) {
  const t = String(title).trim().toLowerCase();
  return notes.find((n) => (n.workspace || 'default') === ws && (n.title || '').trim().toLowerCase() === t);
}

function inlineMd(src) {
  const codes = [];
  let s = String(src).replace(/\u0000/g, '');
  s = s.replace(/`([^`\n]+)`/g, (m, c) => { codes.push(`<code>${escapeHtml(c)}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  s = escapeHtml(s);
  s = s.replace(/\[\[([^\]\n]+)\]\]/g, (m, inner) => {
    const [target, label] = inner.split('|');
    const t = target.trim();
    const exists = !!findNoteByTitle(unescapeHtml(t));
    return `<a href="#" class="wiki-link${exists ? '' : ' missing'}" data-title="${t}">${(label || target).trim()}</a>`;
  });
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s](?:[^*\n]*[^*\s])?)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');
  s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => codes[+i]);
  return s;
}

function unescapeHtml(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function renderMarkdown(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null;
  const flushPara = () => { if (para.length) { out.push('<p>' + para.map(inlineMd).join('<br>') + '</p>'); para = []; } };
  const flushList = () => {
    if (list) { out.push(`<${list.type}${list.task ? ' class="task-list"' : ''}>${list.items.join('')}</${list.type}>`); list = null; }
  };
  const addItem = (type, html, task) => {
    if (!list || list.type !== type) { flushPara(); flushList(); list = { type, items: [], task: false }; }
    if (task) list.task = true;
    list.items.push(html);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if ((m = line.match(/^\s*```/))) {
      flushPara(); flushList();
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
    } else if (/^\s*$/.test(line)) {
      flushPara(); flushList();
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flushPara(); flushList();
      out.push(`<h${m[1].length}>${inlineMd(m[2])}</h${m[1].length}>`);
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara(); flushList();
      out.push('<hr>');
    } else if (/^\s*>/.test(line)) {
      flushPara(); flushList();
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      i--;
      out.push('<blockquote>' + q.map(inlineMd).join('<br>') + '</blockquote>');
    } else if ((m = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/))) {
      const checked = m[1] !== ' ';
      addItem('ul', `<li class="task"><input type="checkbox" data-line="${i}" ${checked ? 'checked' : ''}> <span class="${checked ? 'done' : ''}">${inlineMd(m[2])}</span></li>`, true);
    } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
      addItem('ul', `<li>${inlineMd(m[1])}</li>`);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      addItem('ol', `<li>${inlineMd(m[1])}</li>`);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara(); flushList();
  return out.join('\n');
}

/* ---------- Editor ---------- */

function setView(screen) {
  currentScreen = screen;
  ['notes', 'graph', 'editor'].forEach((v) => $(v + 'View').classList.toggle('active', v === screen));
  document.body.dataset.screen = screen;
  $('mainContent').scrollTop = 0;
}

function pushScreen(screen) {
  try {
    if (currentScreen === 'editor') history.replaceState({ screen }, '');
    else history.pushState({ screen }, '');
  } catch { /* np. file:// */ }
}

function createDraft(opts = {}) {
  return normalizeNote({
    id: generateId(),
    title: opts.title || '',
    content: opts.content || '',
    tags: opts.tags || (currentTag ? [currentTag] : []),
    folder: currentFolder || '',
    workspace: currentWorkspace
  });
}

function startNewNote(opts = {}) {
  closeSidebar();
  editing = { note: createDraft(opts), isNew: true };
  showEditor(true);
}

function openNote(id) {
  const note = notes.find((n) => n.id === id);
  if (!note) return;
  closeSidebar();
  editing = { note, isNew: false };
  showEditor(false);
}

function showEditor(focusTitle) {
  const { note } = editing;
  $('noteTitle').value = note.title;
  $('noteContent').value = note.content;
  $('tagsInput').value = note.tags.join(', ');
  updateFolderSelect(note.folder);
  setAura(note.aura);
  updateFavoriteIcon(note.favorite);
  updatePinIcon(note.pinned);
  renderAttachments();
  renderBacklinks();
  updateWordCount();
  $('saveStatus').textContent = '';
  isPreview = false;
  togglePreview();
  pushScreen('editor');
  setView('editor');
  if (focusTitle) $('noteTitle').focus();
}

function setAura(color) {
  document.querySelectorAll('.aura-dot').forEach((dot) => dot.classList.toggle('active', dot.dataset.color === color));
}

function updateFavoriteIcon(isFav) {
  const btn = $('favoriteBtn');
  btn.classList.toggle('on-gold', !!isFav);
  btn.setAttribute('aria-pressed', String(!!isFav));
  btn.querySelector('svg').style.fill = isFav ? 'currentColor' : 'none';
}

function updatePinIcon(isPinned) {
  const btn = $('pinBtn');
  btn.classList.toggle('on-accent', !!isPinned);
  btn.setAttribute('aria-pressed', String(!!isPinned));
  btn.querySelector('svg').style.fill = isPinned ? 'currentColor' : 'none';
}

function updateWordCount() {
  const text = $('noteContent').value.trim();
  const words = text ? text.split(/\s+/).length : 0;
  $('wordCount').textContent = `${words} ${plural(words, 'słowo', 'słowa', 'słów')} · ${text.length} znaków`;
}

function renderAttachments() {
  const atts = editing ? editing.note.attachments : [];
  $('attachmentsList').innerHTML = atts.map((a, i) =>
    `<button class="att" data-idx="${i}" aria-label="Pokaż obraz ${escapeHtml(a.name || '')}"><img src="${escapeHtml(a.data)}" alt="${escapeHtml(a.name || 'obraz')}"></button>`
  ).join('');
}

function renderBacklinks() {
  const box = $('backlinksBox');
  const title = (editing.note.title || '').trim().toLowerCase();
  const refs = title
    ? wsNotes().filter((n) => n.id !== editing.note.id && extractWikiTargets(n.content).some((t) => t.toLowerCase() === title))
    : [];
  box.style.display = refs.length ? '' : 'none';
  $('backlinksList').innerHTML = refs.map((n) => `<button class="chip" data-id="${escapeHtml(n.id)}">${escapeHtml(n.title || 'Bez tytułu')}</button>`).join('');
}

function togglePreview() {
  const ta = $('noteContent');
  const prev = $('markdownPreview');
  $('previewToggle').classList.toggle('on-accent', isPreview);
  $('mdToolbar').style.display = isPreview ? 'none' : '';
  if (isPreview) {
    prev.innerHTML = renderMarkdown(ta.value) || '<p class="muted">Pusta notatka</p>';
    prev.style.display = 'block';
    ta.style.display = 'none';
  } else {
    prev.style.display = 'none';
    ta.style.display = 'block';
  }
}

function parseTags(str) {
  const seen = new Set();
  return String(str).split(',').map((t) => t.trim().replace(/^#+/, '')).filter((t) => {
    const k = t.toLowerCase();
    if (!t || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function readEditorIntoNote(note) {
  note.title = $('noteTitle').value.trim();
  note.content = $('noteContent').value;
  note.tags = parseTags($('tagsInput').value);
  note.folder = $('folderSelect').value || '';
  const active = document.querySelector('.aura-dot.active');
  note.aura = active ? active.dataset.color : DEFAULT_AURA;
  note.workspace = note.workspace || currentWorkspace;
}

const noteSig = (n) => JSON.stringify([n.title, n.content, n.tags, n.folder, n.aura, n.attachments.length]);

function scheduleSave() {
  if (!editing) return;
  clearTimeout(saveTimer);
  $('saveStatus').textContent = '…';
  saveTimer = setTimeout(() => saveCurrentNote(), 800);
}

async function saveCurrentNote({ touch = false } = {}) {
  if (!editing) return;
  clearTimeout(saveTimer);
  const ed = editing;
  const note = ed.note;
  const before = noteSig(note);
  readEditorIntoNote(note);
  const changed = touch || before !== noteSig(note);

  if (ed.isNew) {
    if (!note.title && !note.content.trim() && !note.attachments.length) { $('saveStatus').textContent = ''; return; } // nie zapisuj pustych
    note.created = note.updated = Date.now();
    notes.unshift(note);
    ed.isNew = false;
  } else if (changed) {
    note.updated = Date.now();
  }
  try {
    await putNote(note);
    $('saveStatus').textContent = 'Zapisano';
  } catch (e) {
    $('saveStatus').textContent = '';
    showToast(e && e.name === 'QuotaExceededError' ? 'Brak miejsca na zapis' : 'Nie udało się zapisać notatki');
    return;
  }
  if (editing === ed) {
    updateTags();
    if (currentScreen !== 'editor') renderNotes();
  }
}

async function leaveEditor() {
  if (!editing) return;
  await saveCurrentNote();
  editing = null;
}

async function goBackFromEditor() {
  if (history.state && history.state.screen) history.back(); // popstate zajmie się resztą
  else await showNotes();
}

async function showNotes() {
  await leaveEditor();
  setView('notes');
  renderAll();
}

async function deleteCurrentNote() {
  if (!editing) return;
  const ed = editing;
  const label = ed.note.title || 'Bez tytułu';
  if (!(await askConfirm('Usunąć notatkę?', `„${label}” zostanie trwale usunięta.`, 'Usuń', true))) return;
  clearTimeout(saveTimer);
  if (!ed.isNew) await removeNote(ed.note.id);
  editing = null;
  if (history.state && history.state.screen) history.back();
  else { setView('notes'); renderAll(); }
  renderAll();
  showToast('Usunięto notatkę');
}

async function toggleFlag(flag) {
  if (!editing) return;
  const note = editing.note;
  note[flag] = !note[flag];
  if (flag === 'favorite') updateFavoriteIcon(note.favorite); else updatePinIcon(note.pinned);
  showToast(flag === 'pinned' ? (note.pinned ? 'Przypięto' : 'Odpięto') : (note.favorite ? 'Dodano do ulubionych' : 'Usunięto z ulubionych'));
  if (!editing.isNew) { try { await putNote(note); } catch { showToast('Błąd zapisu'); } }
}

/* Pasek formatowania */
function applyMarkdown(action) {
  const ta = $('noteContent');
  ta.focus();
  const { selectionStart: a, selectionEnd: b, value } = ta;
  const sel = value.slice(a, b);
  const setValue = (text, selStart, selEnd) => {
    ta.value = text;
    ta.setSelectionRange(selStart, selEnd);
    onContentChanged();
  };
  const wrap = (l, r, ph) => {
    const inner = sel || ph;
    setValue(value.slice(0, a) + l + inner + r + value.slice(b), a + l.length, a + l.length + inner.length);
  };
  const prefixLines = (prefix) => {
    const start = value.lastIndexOf('\n', a - 1) + 1;
    let end = value.indexOf('\n', b);
    if (end === -1) end = value.length;
    const block = value.slice(start, end).split('\n').map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : prefix + l)).join('\n');
    setValue(value.slice(0, start) + block + value.slice(end), start, start + block.length);
  };
  switch (action) {
    case 'bold': return wrap('**', '**', 'tekst');
    case 'italic': return wrap('*', '*', 'tekst');
    case 'code': return wrap('`', '`', 'kod');
    case 'link': return wrap('[[', ']]', 'Nazwa notatki');
    case 'h': return prefixLines('## ');
    case 'ul': return prefixLines('- ');
    case 'task': return prefixLines('- [ ] ');
    case 'quote': return prefixLines('> ');
  }
}

/* Kontynuacja list po Enter */
function handleListEnter(e) {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  const ta = e.target;
  if (ta.selectionStart !== ta.selectionEnd) return;
  const pos = ta.selectionStart;
  const lineStart = ta.value.lastIndexOf('\n', pos - 1) + 1;
  const line = ta.value.slice(lineStart, pos);
  const m = line.match(/^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)[.)] )(.*)$/);
  if (!m) return;
  e.preventDefault();
  if (m[4].trim() === '') { // pusty punkt – zakończ listę
    ta.setRangeText('', lineStart, pos, 'end');
  } else {
    let marker = m[2];
    if (m[3]) marker = `${parseInt(m[3], 10) + 1}${marker.includes(')') ? ')' : '.'} `;
    if (/\[[xX]\]/.test(marker)) marker = marker.replace(/\[[xX]\]/, '[ ]');
    ta.setRangeText('\n' + m[1] + marker, pos, pos, 'end');
  }
  onContentChanged();
}

function onContentChanged() {
  updateWordCount();
  scheduleSave();
}

/* Obrazy */
function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function imageToDataURL(file) {
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return readAsDataURL(file);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const MAX = 1600;
    const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1 && file.size < 400 * 1024) return await readAsDataURL(file);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return file.type === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85);
  } catch {
    return readAsDataURL(file);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function addAttachments(files) {
  if (!editing) return;
  let added = 0;
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    try {
      const data = await imageToDataURL(file);
      editing.note.attachments.push({ name: file.name, data, type: file.type });
      added++;
    } catch { showToast(`Nie udało się dodać: ${file.name}`); }
  }
  if (added) {
    renderAttachments();
    await saveCurrentNote({ touch: true });
    showToast(added === 1 ? 'Dodano obraz' : `Dodano obrazy: ${added}`);
  }
}

async function showAttachment(idx) {
  if (!editing) return;
  const a = editing.note.attachments[idx];
  if (!a) return;
  const img = document.createElement('img');
  img.src = a.data;
  img.alt = a.name || 'obraz';
  img.className = 'lightbox-img';
  const res = await openModal({
    title: a.name || 'Obraz', content: img,
    actions: [{ label: 'Usuń', kind: 'danger', value: 'del' }, { label: 'Zamknij', kind: 'primary', value: null }]
  });
  if (res === 'del' && editing) {
    editing.note.attachments.splice(idx, 1);
    renderAttachments();
    await saveCurrentNote({ touch: true });
  }
}

/* Linki [[…]] i checkboxy w podglądzie */
async function onPreviewClick(e) {
  const link = e.target.closest('.wiki-link');
  if (link) {
    e.preventDefault();
    const title = link.dataset.title;
    await saveCurrentNote();
    const target = findNoteByTitle(title);
    if (target) { editing = null; openNote(target.id); }
    else if (await askConfirm('Utworzyć notatkę?', `Notatka „${title}” jeszcze nie istnieje.`, 'Utwórz')) {
      editing = null;
      startNewNote({ title, tags: [] });
      await saveCurrentNote();
    }
    return;
  }
  const box = e.target.closest('input[type="checkbox"][data-line]');
  if (box) {
    const ta = $('noteContent');
    const lines = ta.value.split('\n');
    const i = Number(box.dataset.line);
    if (lines[i] !== undefined) {
      lines[i] = lines[i].replace(/\[([ xX])\]/, box.checked ? '[x]' : '[ ]');
      ta.value = lines.join('\n');
      $('markdownPreview').innerHTML = renderMarkdown(ta.value);
      scheduleSave();
    }
  }
}

/* ---------- Templates ---------- */

function applyTemplateVars(s) {
  return String(s || '').replace(/\{\{date\}\}/g, todayStr());
}

async function openTemplatePicker() {
  const wrap = document.createElement('div');
  wrap.className = 'choice-list';
  const render = () => {
    wrap.innerHTML = templates.map((t) => `
      <div class="choice" data-id="${escapeHtml(t.id)}">
        <button type="button" class="choice-main">${escapeHtml(t.name)}</button>
        <button type="button" class="mini-btn" data-del="${escapeHtml(t.id)}" aria-label="Usuń szablon" title="Usuń szablon">✕</button>
      </div>`).join('') || '<p class="muted">Brak szablonów</p>';
  };
  render();
  wrap.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      templates = templates.filter((t) => t.id !== del.dataset.del);
      saveTemplates();
      render();
      return;
    }
    const main = e.target.closest('.choice-main');
    if (main) closeModal(main.parentElement.dataset.id);
  });
  const id = await openModal({ title: 'Nowa notatka z szablonu', content: wrap, actions: [{ label: 'Zamknij', value: null }] });
  const t = templates.find((x) => x.id === id);
  if (!t) return;
  const title = applyTemplateVars(t.title || t.name);
  if (currentScreen === 'editor') await leaveEditor();
  startNewNote({ title, content: applyTemplateVars(t.content), tags: t.tags ? [...t.tags] : undefined });
  scheduleSave();
}

async function saveAsTemplate() {
  if (!editing) return;
  const name = await askText('Nazwa szablonu', 'np. Plan tygodnia', $('noteTitle').value.trim());
  if (!name) return;
  templates.push({ id: generateId(), name, content: $('noteContent').value, tags: parseTags($('tagsInput').value) });
  saveTemplates();
  showToast('Zapisano szablon');
}

/* ---------- Folders & workspaces ---------- */

async function createFolder() {
  const name = await askText('Nazwa folderu', 'np. Praca');
  if (!name) return;
  folders.push({ id: generateId(), name, workspace: currentWorkspace });
  saveFolders();
  updateFolders();
  updateFolderSelect();
}

async function renameFolder(id) {
  const f = folders.find((x) => x.id === id);
  if (!f) return;
  const name = await askText('Zmień nazwę folderu', '', f.name);
  if (!name) return;
  f.name = name;
  saveFolders();
  renderAll();
}

async function deleteFolder(id) {
  const f = folders.find((x) => x.id === id);
  if (!f) return;
  if (!(await askConfirm('Usunąć folder?', `Folder „${f.name}” zostanie usunięty. Notatki z niego nie zostaną skasowane.`, 'Usuń', true))) return;
  for (const n of notes.filter((n) => n.folder === id)) {
    n.folder = '';
    try { await putNote(n); } catch { /* ignoruj */ }
  }
  folders = folders.filter((x) => x.id !== id);
  if (currentFolder === id) currentFolder = null;
  saveFolders();
  renderAll();
}

async function createWorkspace() {
  const name = await askText('Nowa przestrzeń robocza', 'np. Praca');
  if (!name) return;
  const ws = { id: generateId(), name };
  workspaces.push(ws);
  saveWorkspaces();
  switchWorkspace(ws.id);
}

async function renameWorkspace() {
  const ws = workspaces.find((w) => w.id === currentWorkspace);
  const name = await askText('Zmień nazwę przestrzeni', '', ws.name);
  if (!name) return;
  ws.name = name;
  saveWorkspaces();
  updateWorkspaces();
}

async function deleteWorkspace() {
  if (currentWorkspace === 'default') return;
  const ws = workspaces.find((w) => w.id === currentWorkspace);
  const count = wsNotes().length;
  if (!(await askConfirm('Usunąć przestrzeń?', `Przestrzeń „${ws.name}” zostanie usunięta. ${count ? `${count} ${plural(count, 'notatka zostanie przeniesiona', 'notatki zostaną przeniesione', 'notatek zostanie przeniesionych')} do „Główna”.` : ''}`, 'Usuń', true))) return;
  const wsFolderIds = new Set(folders.filter((f) => f.workspace === ws.id).map((f) => f.id));
  for (const n of wsNotes()) {
    n.workspace = 'default';
    if (wsFolderIds.has(n.folder)) n.folder = '';
    try { await putNote(n); } catch { /* ignoruj */ }
  }
  folders = folders.filter((f) => f.workspace !== ws.id);
  workspaces = workspaces.filter((w) => w.id !== ws.id);
  saveFolders(); saveWorkspaces();
  switchWorkspace('default');
}

async function switchWorkspace(id) {
  if (!workspaces.find((w) => w.id === id)) id = 'default';
  if (currentScreen !== 'notes') await showNotes();
  currentWorkspace = id;
  currentFolder = null;
  currentTag = null;
  saveSettings();
  renderAll();
}

/* ---------- Sidebar ---------- */

function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebarBackdrop').classList.remove('show');
}

function toggleSidebar() {
  if (isMobile()) {
    const open = $('sidebar').classList.toggle('open');
    $('sidebarBackdrop').classList.toggle('show', open);
  } else {
    sidebarCollapsed = !sidebarCollapsed;
    document.body.classList.toggle('sidebar-collapsed', sidebarCollapsed);
    saveSettings();
    if (currentScreen === 'graph') drawGraph();
  }
}

/* ---------- Graph ---------- */

function buildGraph(W, H) {
  const list = wsNotes();
  const byTitle = new Map();
  list.forEach((n) => { const k = (n.title || '').trim().toLowerCase(); if (k && !byTitle.has(k)) byTitle.set(k, n); });
  const nodes = list.map((n, i) => ({ id: n.id, title: n.title || 'Bez tytułu', aura: n.aura, deg: 0, i }));
  const index = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set();
  const links = [];
  list.forEach((n) => {
    extractWikiTargets(n.content).forEach((t) => {
      const target = byTitle.get(t.toLowerCase());
      if (!target || target.id === n.id) return;
      const key = n.id < target.id ? n.id + '|' + target.id : target.id + '|' + n.id;
      if (seen.has(key)) return;
      seen.add(key);
      links.push({ a: index.get(n.id), b: index.get(target.id) });
      index.get(n.id).deg++; index.get(target.id).deg++;
    });
  });
  // układ siłowy (deterministyczny)
  const N = nodes.length;
  const R = Math.min(W, H) * 0.32;
  nodes.forEach((n, k) => {
    const ang = (k / Math.max(N, 1)) * Math.PI * 2;
    n.x = W / 2 + Math.cos(ang) * R * (0.6 + 0.4 * ((k * 7) % 5) / 4);
    n.y = H / 2 + Math.sin(ang) * R * (0.6 + 0.4 * ((k * 3) % 5) / 4);
    n.vx = 0; n.vy = 0;
  });
  const iterations = N > 300 ? 60 : 220;
  const k = Math.sqrt((W * H) / Math.max(N, 1)) * 0.7;
  for (let it = 0; it < iterations; it++) {
    const t = 1 - it / iterations;
    for (let x = 0; x < N; x++) {
      for (let y = x + 1; y < N; y++) {
        const a = nodes[x], b = nodes[y];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.5; }
        const d = Math.sqrt(d2);
        const f = (k * k) / d;
        a.vx += (dx / d) * f; a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
    }
    links.forEach(({ a, b }) => {
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d * d) / k * 0.6;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    });
    nodes.forEach((n) => {
      n.vx += (W / 2 - n.x) * 0.9; n.vy += (H / 2 - n.y) * 0.9; // grawitacja
      const len = Math.sqrt(n.vx * n.vx + n.vy * n.vy) || 1;
      const lim = Math.min(len, 30 * t + 2);
      n.x += (n.vx / len) * lim; n.y += (n.vy / len) * lim;
      n.vx = 0; n.vy = 0;
    });
  }
  const pad = 40;
  nodes.forEach((n) => { n.x = Math.max(pad, Math.min(W - pad, n.x)); n.y = Math.max(pad, Math.min(H - pad - 10, n.y)); n.r = 9 + Math.min(n.deg, 8) * 2; });
  return { nodes, links, W, H };
}

function showGraph() {
  closeSidebar();
  if (currentScreen === 'graph') return;
  const go = () => { setView('graph'); drawGraph(); };
  if (currentScreen === 'editor') { leaveEditor().then(() => { pushScreen('graph'); go(); }); return; }
  pushScreen('graph');
  go();
}

function drawGraph() {
  const canvas = $('graphCanvas');
  const rect = canvas.getBoundingClientRect();
  const W = Math.max(200, Math.round(rect.width));
  const H = Math.max(240, Math.round(rect.height));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  graphState = buildGraph(W, H);
  const { nodes, links } = graphState;
  const css = getComputedStyle(document.body);
  const text = css.getPropertyValue('--text').trim() || '#f0f2f5';
  const muted = css.getPropertyValue('--text-muted').trim() || '#8a929e';
  const surface = css.getPropertyValue('--bg').trim() || '#0c0e12';

  ctx.clearRect(0, 0, W, H);
  if (!nodes.length) {
    ctx.fillStyle = muted; ctx.font = '15px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Brak notatek w tej przestrzeni', W / 2, H / 2);
  }
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(59,130,246,0.45)';
  links.forEach(({ a, b }) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); });
  nodes.forEach((n) => {
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fillStyle = surface;
    ctx.fill();
    ctx.lineWidth = n.deg ? 3 : 2;
    ctx.strokeStyle = n.aura || DEFAULT_AURA;
    ctx.globalAlpha = n.deg ? 1 : 0.6;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = text;
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    const label = n.title.length > 18 ? n.title.slice(0, 17) + '…' : n.title;
    ctx.fillText(label, n.x, n.y + n.r + 14);
  });
  $('graphInfo').textContent = `${nodes.length} ${plural(nodes.length, 'notatka', 'notatki', 'notatek')} · ${links.length} ${plural(links.length, 'powiązanie', 'powiązania', 'powiązań')} — dotknij węzła, aby otworzyć`;
}

function graphHit(e) {
  if (!graphState) return null;
  const rect = $('graphCanvas').getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  let best = null, bd = Infinity;
  graphState.nodes.forEach((n) => {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d <= n.r + 14 && d < bd) { best = n; bd = d; }
  });
  return best;
}

/* ---------- Export / Import ---------- */

async function exportData() {
  await saveCurrentNote();
  const payload = JSON.stringify({ app: 'nexus', version: 2, exportedAt: new Date().toISOString(), notes, folders, workspaces, templates });
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

function importData() {
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
      const incoming = data.notes.filter((n) => n && n.id).map(normalizeNote);
      const ok = await askConfirm('Zaimportować dane?',
        `Plik zawiera ${incoming.length} ${plural(incoming.length, 'notatkę', 'notatki', 'notatek')}. Zostaną scalone z istniejącymi (przy tym samym ID zostaje nowsza wersja).`, 'Importuj');
      if (!ok) return;
      let imported = 0;
      for (const n of incoming) {
        const cur = notes.find((x) => x.id === n.id);
        if (!cur || n.updated > cur.updated) { await putNote(n); imported++; }
      }
      const mergeById = (target, src) => {
        (Array.isArray(src) ? src : []).forEach((x) => { if (x && x.id && x.name && !target.find((y) => y.id === x.id)) target.push(x); });
      };
      mergeById(folders, data.folders); mergeById(workspaces, data.workspaces); mergeById(templates, data.templates);
      saveFolders(); saveWorkspaces(); saveTemplates();
      await loadNotes();
      renderAll();
      showToast(`Zaimportowano: ${imported}`);
    } catch {
      showToast('Błąd importu – nieprawidłowy plik');
    }
  };
  input.click();
}

/* ---------- New note logic ---------- */

async function onNewNote() {
  if (currentScreen === 'editor') await leaveEditor();
  if (currentView === 'journal') {
    const title = 'Dziennik ' + todayStr();
    const existing = findNoteByTitle(title);
    if (existing) return openNote(existing.id);
    const t = templates.find((x) => x.id === 'journal');
    return startNewNote({ title, tags: ['dziennik'], content: applyTemplateVars(t ? t.content : '# {{date}}\n\n') });
  }
  startNewNote();
}

/* ---------- Event wiring ---------- */

function setupEventListeners() {
  setupGridInteractions();

  $('newNoteBtn').addEventListener('click', onNewNote);
  $('emptyNewBtn').addEventListener('click', onNewNote);
  $('emptyTemplatesBtn').addEventListener('click', openTemplatePicker);
  $('templatesBtn').addEventListener('click', () => { closeSidebar(); openTemplatePicker(); });
  $('saveTemplateBtn').addEventListener('click', saveAsTemplate);

  $('backBtn').addEventListener('click', goBackFromEditor);
  $('deleteBtn').addEventListener('click', deleteCurrentNote);
  $('favoriteBtn').addEventListener('click', () => toggleFlag('favorite'));
  $('pinBtn').addEventListener('click', () => toggleFlag('pinned'));
  $('previewToggle').addEventListener('click', () => { isPreview = !isPreview; togglePreview(); });
  $('markdownPreview').addEventListener('click', onPreviewClick);

  document.querySelectorAll('.aura-dot').forEach((dot) => dot.addEventListener('click', () => { setAura(dot.dataset.color); scheduleSave(); }));
  $('folderSelect').addEventListener('change', scheduleSave);
  $('noteTitle').addEventListener('input', scheduleSave);
  $('tagsInput').addEventListener('input', scheduleSave);
  $('noteContent').addEventListener('input', onContentChanged);
  $('noteContent').addEventListener('keydown', handleListEnter);
  $('noteTitle').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('noteContent').focus(); }
  });

  $('mdToolbar').addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); }); // zachowaj fokus/klawiaturę
  $('mdToolbar').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-md]');
    if (b) applyMarkdown(b.dataset.md);
  });

  $('attachmentInput').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    await addAttachments(files);
  });
  $('attachmentsList').addEventListener('click', (e) => {
    const b = e.target.closest('.att');
    if (b) showAttachment(Number(b.dataset.idx));
  });
  $('backlinksList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    await saveCurrentNote();
    editing = null;
    openNote(b.dataset.id);
  });

  // Wyszukiwanie (pole w nagłówku + pole mobilne)
  const onSearch = async (e) => {
    searchQuery = e.target.value;
    $('searchInput').value = searchQuery;
    $('searchInputMobile').value = searchQuery;
    if (currentScreen !== 'notes') await showNotes();
    renderNotes();
  };
  $('searchInput').addEventListener('input', onSearch);
  $('searchInputMobile').addEventListener('input', onSearch);

  // Nawigacja boczna
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', async () => {
      document.querySelectorAll('.nav-item').forEach((i) => i.classList.remove('active'));
      item.classList.add('active');
      currentView = item.dataset.view;
      currentFolder = null;
      currentTag = null;
      closeSidebar();
      if (currentScreen !== 'notes') await showNotes();
      renderAll();
    });
  });

  $('foldersList').addEventListener('click', async (e) => {
    const item = e.target.closest('.folder-item');
    if (!item) return;
    const act = e.target.closest('[data-act]');
    if (act) {
      e.stopPropagation();
      return act.dataset.act === 'rename' ? renameFolder(item.dataset.folder) : deleteFolder(item.dataset.folder);
    }
    currentFolder = item.dataset.folder || null;
    closeSidebar();
    if (currentScreen !== 'notes') await showNotes();
    renderAll();
  });

  const tagHandler = async (e) => {
    if (e.type === 'keydown' && e.key !== 'Enter') return;
    const pill = e.target.closest('.tag-pill');
    if (!pill) return;
    currentTag = currentTag && currentTag.toLowerCase() === pill.dataset.tag.toLowerCase() ? null : pill.dataset.tag;
    closeSidebar();
    if (currentScreen !== 'notes') await showNotes();
    updateTags();
    renderNotes();
  };
  $('tagsList').addEventListener('click', tagHandler);
  $('tagsList').addEventListener('keydown', tagHandler);

  $('activeFilters').addEventListener('click', (e) => {
    const c = e.target.closest('[data-clear]');
    if (!c) return;
    if (c.dataset.clear === 'tag') currentTag = null; else currentFolder = null;
    renderAll();
  });

  document.querySelectorAll('.view-btn').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('.view-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentLayout = btn.dataset.layout;
    saveSettings();
    renderNotes();
  }));
  $('sortSelect').addEventListener('change', (e) => { currentSort = e.target.value; saveSettings(); renderNotes(); });

  document.querySelectorAll('.workspace-select').forEach((sel) => sel.addEventListener('change', (e) => { closeSidebar(); switchWorkspace(e.target.value); }));
  $('newWorkspaceBtn').addEventListener('click', createWorkspace);
  $('renameWorkspaceBtn').addEventListener('click', renameWorkspace);
  $('deleteWorkspaceBtn').addEventListener('click', deleteWorkspace);
  $('newFolderBtn').addEventListener('click', createFolder);

  $('menuToggle').addEventListener('click', toggleSidebar);
  $('sidebarBackdrop').addEventListener('click', closeSidebar);
  $('themeToggle').addEventListener('click', () => {
    theme = theme === 'light' ? 'dark' : 'light';
    applyTheme();
    saveSettings();
    if (currentScreen === 'graph') drawGraph();
  });

  $('graphBtn').addEventListener('click', showGraph);
  $('closeGraphBtn').addEventListener('click', () => (history.state && history.state.screen ? history.back() : showNotes()));
  $('graphCanvas').addEventListener('click', async (e) => {
    const n = graphHit(e);
    if (n) openNote(n.id);
  });
  $('graphCanvas').addEventListener('mousemove', (e) => { e.target.style.cursor = graphHit(e) ? 'pointer' : 'default'; });
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (currentScreen === 'graph') drawGraph(); }, 150);
  });

  $('exportBtn').addEventListener('click', exportData);
  $('importBtn').addEventListener('click', importData);

  // Historia przeglądarki / gest "wstecz"
  window.addEventListener('popstate', async (e) => {
    if (modalState) closeModal(null);
    let screen = (e.state && e.state.screen) || 'notes';
    if (currentScreen === 'editor') await leaveEditor();
    if (screen === 'editor') screen = 'notes';
    if (screen === 'graph') { setView('graph'); drawGraph(); }
    else { setView('notes'); renderAll(); }
  });

  // Zapis przy opuszczeniu strony / przejściu w tło (ważne na iOS)
  const flush = () => { if (editing) saveCurrentNote(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);

  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') {
      if (modalState) { closeModal(null); return; }
      if (isMobile() && $('sidebar').classList.contains('open')) { closeSidebar(); return; }
      if (currentScreen === 'editor') goBackFromEditor();
      else if (currentScreen === 'graph') $('closeGraphBtn').click();
      return;
    }
    if (modalState) return;
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      (async () => {
        if (currentScreen !== 'notes') await showNotes();
        (isMobile() ? $('searchInputMobile') : $('searchInput')).focus();
      })();
    } else if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (editing) saveCurrentNote().then(() => showToast('Zapisano'));
    } else if (mod && (e.key.toLowerCase() === 'n') && (e.altKey || !e.shiftKey)) {
      e.preventDefault();
      onNewNote();
    }
  });
}

/* ---------- Init ---------- */

async function init() {
  loadSettings();
  let dbOk = true;
  try {
    await initDB();
  } catch (e) {
    dbOk = false;
    console.error('IndexedDB:', e);
  }
  try { await loadAll(); } catch (e) { console.error(e); }
  setupEventListeners();
  try { history.replaceState(null, ''); } catch { /* ignoruj */ }
  renderAll();
  if (!dbOk) showToast('Pamięć lokalna niedostępna – notatki nie zostaną zachowane (tryb prywatny?)');
  if (dbOk && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) showToast('Dostępna nowa wersja – uruchom aplikację ponownie');
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
