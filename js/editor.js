// Edytor notatki: autozapis, podgląd Markdown, pasek formatowania, załączniki (Blob), backlinki.
import { state, hooks, wsNotes, isLive, findNoteByTitle, DEFAULT_AURA } from './state.js';
import { $, showToast, askConfirm, openModal } from './ui.js';
import { escapeHtml, extractWikiTargets, parseTags, plural, generateId } from './util.js';
import { putNote, putBlob, deleteBlobs, getBlobURL, revokeBlobURL, normalizeNote } from './db.js';
import { renderMarkdown, isListLine, moveListBlock, shiftIndent } from './markdown.js';
import { setView, pushScreen, showNotes, goBack } from './nav.js';
import { trashNote, restoreNote, purgeNote, setArchived, persist } from './actions.js';

let saveTimer = null;

/* ---------- Otwieranie ---------- */

export function createDraft(opts = {}) {
  return normalizeNote({
    id: generateId(),
    title: opts.title || '',
    content: opts.content || '',
    tags: opts.tags || (state.currentTag ? [state.currentTag] : []),
    folder: state.currentFolder || '',
    workspace: state.currentWorkspace
  });
}

export function startNewNote(opts = {}) {
  hooks.closeSidebar();
  state.editing = { note: createDraft(opts), isNew: true };
  showEditor(true);
}

export function openNote(id) {
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;
  hooks.closeSidebar();
  state.editing = { note, isNew: false };
  showEditor(false);
}

function showEditor(focusTitle) {
  const { note } = state.editing;
  $('noteTitle').value = note.title;
  $('noteContent').value = note.content;
  $('tagsInput').value = note.tags.join(', ');
  hooks.updateFolderSelect(note.folder);
  setAura(note.aura);
  updateFlagIcons();
  renderAttachments();
  renderBacklinks();
  updateWordCount();
  $('saveStatus').textContent = '';
  state.isPreview = false;
  togglePreview();
  pushScreen('editor');
  setView('editor');
  if (focusTitle) $('noteTitle').focus();
}

function setAura(color) {
  document.querySelectorAll('.aura-dot').forEach((dot) => dot.classList.toggle('active', dot.dataset.color === color));
}

function updateFlagIcons() {
  const note = state.editing.note;
  const fav = $('favoriteBtn'), pin = $('pinBtn'), arc = $('archiveBtn');
  fav.classList.toggle('on-gold', note.favorite);
  fav.setAttribute('aria-pressed', String(note.favorite));
  fav.querySelector('svg').style.fill = note.favorite ? 'currentColor' : 'none';
  pin.classList.toggle('on-accent', note.pinned);
  pin.setAttribute('aria-pressed', String(note.pinned));
  pin.querySelector('svg').style.fill = note.pinned ? 'currentColor' : 'none';
  arc.classList.toggle('on-accent', note.archived);
  arc.setAttribute('aria-pressed', String(note.archived));
  arc.title = arc.ariaLabel = note.archived ? 'Przywróć z archiwum' : 'Archiwizuj';
  $('trashBanner').style.display = note.deleted ? '' : 'none';
  $('deleteBtn').title = $('deleteBtn').ariaLabel = note.deleted ? 'Usuń trwale' : 'Do kosza';
}

function updateWordCount() {
  const text = $('noteContent').value.trim();
  const words = text ? text.split(/\s+/).length : 0;
  $('wordCount').textContent = words ? `${words} ${plural(words, 'słowo', 'słowa', 'słów')} · ${text.length} znaków` : '';
}

/* ---------- Załączniki (Blob w IndexedDB) ---------- */

export function renderAttachments() {
  const list = $('attachmentsList');
  const atts = state.editing ? state.editing.note.attachments : [];
  list.innerHTML = atts.map((a, i) =>
    `<button class="att" data-idx="${i}" aria-label="Pokaż obraz ${escapeHtml(a.name || '')}"><img alt="${escapeHtml(a.name || 'obraz')}"></button>`).join('');
  atts.forEach(async (a, i) => {
    const url = await getBlobURL(a.id);
    const img = list.querySelector(`.att[data-idx="${i}"] img`);
    if (img && url) img.src = url;
  });
}

function canvasToBlob(canvas, type, q) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, q));
}

async function imageToBlob(file) {
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const MAX = 1600;
    const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1 && file.size < 400 * 1024) return file;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = file.type === 'image/png' ? await canvasToBlob(c, 'image/png') : await canvasToBlob(c, 'image/jpeg', 0.85);
    return blob || file;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function addAttachments(files) {
  const ed = state.editing;
  if (!ed) return;
  let added = 0;
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    try {
      const blob = await imageToBlob(file);
      const id = generateId();
      await putBlob({ id, noteId: ed.note.id, name: file.name, type: blob.type || file.type, size: blob.size, blob });
      ed.note.attachments.push({ id, name: file.name, type: blob.type || file.type, size: blob.size });
      added++;
    } catch { showToast(`Nie udało się dodać: ${file.name}`); }
  }
  if (added) {
    renderAttachments();
    await saveCurrentNote({ touch: true });
    showToast(added === 1 ? 'Dodano obraz' : `Dodano obrazy: ${added}`);
  }
}

export async function showAttachment(idx) {
  const ed = state.editing;
  const a = ed && ed.note.attachments[idx];
  if (!a) return;
  const img = document.createElement('img');
  img.src = (await getBlobURL(a.id)) || '';
  img.alt = a.name || 'obraz';
  img.className = 'lightbox-img';
  const res = await openModal({
    title: a.name || 'Obraz', content: img,
    actions: [{ label: 'Usuń', kind: 'danger', value: 'del' }, { label: 'Zamknij', kind: 'primary', value: null }]
  });
  if (res === 'del' && state.editing === ed) {
    ed.note.attachments.splice(idx, 1);
    revokeBlobURL(a.id);
    await deleteBlobs([a.id]);
    renderAttachments();
    await saveCurrentNote({ touch: true });
  }
}

/* ---------- Backlinki, podgląd ---------- */

function renderBacklinks() {
  const box = $('backlinksBox');
  const title = (state.editing.note.title || '').trim().toLowerCase();
  const refs = title
    ? wsNotes().filter((n) => !n.deleted && n.id !== state.editing.note.id && extractWikiTargets(n.content).some((t) => t.toLowerCase() === title))
    : [];
  box.style.display = refs.length ? '' : 'none';
  $('backlinksList').innerHTML = refs.map((n) => `<button class="chip" data-id="${escapeHtml(n.id)}">${escapeHtml(n.title || 'Bez tytułu')}</button>`).join('');
}

const mdOpts = () => ({ exists: (t) => !!findNoteByTitle(t), interactive: true });

function renderPreview() {
  $('markdownPreview').innerHTML = renderMarkdown($('noteContent').value, mdOpts()) || '<p class="muted">Pusta notatka</p>';
}

export function togglePreview() {
  const ta = $('noteContent');
  const prev = $('markdownPreview');
  $('previewToggle').classList.toggle('on-accent', state.isPreview);
  $('mdToolbar').style.display = state.isPreview ? 'none' : '';
  if (state.isPreview) {
    renderPreview();
    prev.style.display = 'block';
    ta.style.display = 'none';
  } else {
    prev.style.display = 'none';
    ta.style.display = 'block';
  }
}

export async function onPreviewClick(e) {
  const link = e.target.closest('.wiki-link');
  if (link) {
    e.preventDefault();
    const title = link.dataset.title;
    await saveCurrentNote();
    const target = findNoteByTitle(title);
    if (target) { state.editing = null; openNote(target.id); }
    else if (await askConfirm('Utworzyć notatkę?', `Notatka „${title}” jeszcze nie istnieje.`, 'Utwórz')) {
      state.editing = null;
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
      renderPreview();
      scheduleSave();
    }
  }
}

/** Przeciąganie zadań/elementów listy w podglądzie (mysz i dotyk). */
export function setupTaskDrag() {
  const prev = $('markdownPreview');
  let drag = null;
  const clear = () => prev.querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
  prev.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.drag-handle');
    if (!h) return;
    const li = h.closest('li');
    drag = { from: Number(li.dataset.line), li, target: null, after: false };
    prev.setPointerCapture(e.pointerId);
    li.classList.add('dragging');
    e.preventDefault();
  });
  prev.addEventListener('pointermove', (e) => {
    if (!drag) return;
    clear();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const li = el && el.closest('#markdownPreview li[data-line]');
    if (li && li !== drag.li && !drag.li.contains(li)) {
      const r = li.getBoundingClientRect();
      drag.after = e.clientY > r.top + r.height / 2;
      drag.target = Number(li.dataset.line);
      li.classList.add(drag.after ? 'drop-after' : 'drop-before');
    } else drag.target = null;
  });
  const end = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.li.classList.remove('dragging');
    clear();
    if (d.target == null) return;
    const ta = $('noteContent');
    const res = moveListBlock(ta.value, d.from, d.target, d.after);
    if (res != null) { ta.value = res; renderPreview(); scheduleSave(); }
  };
  prev.addEventListener('pointerup', end);
  prev.addEventListener('pointercancel', end);
}

/* ---------- Zapis ---------- */

function readEditorIntoNote(note) {
  note.title = $('noteTitle').value.trim();
  note.content = $('noteContent').value;
  note.tags = parseTags($('tagsInput').value);
  note.folder = $('folderSelect').value || '';
  const active = document.querySelector('.aura-dot.active');
  note.aura = active ? active.dataset.color : DEFAULT_AURA;
  note.workspace = note.workspace || state.currentWorkspace;
}

const noteSig = (n) => JSON.stringify([n.title, n.content, n.tags, n.folder, n.aura, n.attachments.length]);

export function scheduleSave() {
  if (!state.editing) return;
  clearTimeout(saveTimer);
  $('saveStatus').textContent = '…';
  saveTimer = setTimeout(() => saveCurrentNote(), 800);
}

export async function saveCurrentNote({ touch = false } = {}) {
  const ed = state.editing;
  if (!ed) return;
  clearTimeout(saveTimer);
  const note = ed.note;
  const before = noteSig(note);
  readEditorIntoNote(note);
  const changed = touch || before !== noteSig(note);

  if (ed.isNew) {
    if (!note.title && !note.content.trim() && !note.attachments.length) { $('saveStatus').textContent = ''; return; } // puste szkice nie są zapisywane
    note.created = note.updated = Date.now();
    state.notes.unshift(note);
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
  if (state.editing === ed) {
    hooks.updateTags();
    if (state.currentScreen !== 'editor') hooks.renderNotes();
  }
}

export async function leaveEditor() {
  if (!state.editing) return;
  await saveCurrentNote();
  state.editing = null;
}

/* ---------- Kosz / archiwum / flagi ---------- */

export async function deleteCurrentNote() {
  const ed = state.editing;
  if (!ed) return;
  const note = ed.note;
  clearTimeout(saveTimer);
  if (ed.isNew) {
    await deleteBlobs(note.attachments.map((a) => a.id));
    state.editing = null;
    await goBack();
    return;
  }
  if (note.deleted) {
    if (!(await purgeNote(note.id, { confirm: true }))) return;
    state.editing = null;
    await goBack();
    hooks.renderAll();
    showToast('Usunięto trwale');
    return;
  }
  await saveCurrentNote();
  state.editing = null;
  await goBack();
  await trashNote(note.id);
}

export async function restoreCurrentNote() {
  const ed = state.editing;
  if (!ed) return;
  await restoreNote(ed.note.id);
  updateFlagIcons();
}

export async function toggleArchiveCurrent() {
  const ed = state.editing;
  if (!ed) return;
  if (ed.isNew) { ed.note.archived = !ed.note.archived; updateFlagIcons(); return; }
  await saveCurrentNote();
  const flag = !ed.note.archived;
  state.editing = null;
  await goBack();
  await setArchived(ed.note.id, flag);
}

export async function toggleFlag(flag) {
  const ed = state.editing;
  if (!ed) return;
  const note = ed.note;
  note[flag] = !note[flag];
  updateFlagIcons();
  showToast(flag === 'pinned' ? (note.pinned ? 'Przypięto' : 'Odpięto') : (note.favorite ? 'Dodano do ulubionych' : 'Usunięto z ulubionych'));
  if (!ed.isNew) await persist(note);
}

/* ---------- Pasek formatowania ---------- */

export function onContentChanged() {
  updateWordCount();
  scheduleSave();
}

export function applyMarkdown(action) {
  const ta = $('noteContent');
  ta.focus();
  const { selectionStart: a, selectionEnd: b, value } = ta;
  const sel = value.slice(a, b);
  const setValue = (text, s, e) => { ta.value = text; ta.setSelectionRange(s, e); onContentChanged(); };
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
  const insertBlock = (text) => {
    const needNl = a > 0 && value[a - 1] !== '\n' ? '\n' : '';
    const ins = needNl + text + '\n';
    setValue(value.slice(0, a) + ins + value.slice(b), a + ins.length, a + ins.length);
  };
  switch (action) {
    case 'bold': return wrap('**', '**', 'tekst');
    case 'italic': return wrap('*', '*', 'tekst');
    case 'code': return wrap('`', '`', 'kod');
    case 'link': return wrap('[[', ']]', 'Nazwa notatki');
    case 'codeblock': return wrap('```\n', '\n```', 'kod');
    case 'h': return prefixLines('## ');
    case 'ul': return prefixLines('- ');
    case 'task': return prefixLines('- [ ] ');
    case 'quote': return prefixLines('> ');
    case 'table': return insertBlock('| Kolumna 1 | Kolumna 2 |\n| --- | --- |\n|  |  |');
    case 'indent':
    case 'outdent': {
      const r = shiftIndent(value, a, b, action === 'indent' ? 2 : -2);
      return setValue(r.text, a === b ? Math.max(r.start, a + (action === 'indent' ? 2 : -2)) : r.start, a === b ? Math.max(r.start, a + (action === 'indent' ? 2 : -2)) : r.end);
    }
  }
}

/** Enter kontynuuje listy; Tab/Shift+Tab zmienia wcięcie elementu listy. */
export function handleEditorKeys(e) {
  const ta = e.target;
  if (e.isComposing) return;
  if (e.key === 'Tab') {
    const lineStart = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    const lineEnd = ta.value.indexOf('\n', ta.selectionStart);
    const line = ta.value.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    if (isListLine(line)) { e.preventDefault(); applyMarkdown(e.shiftKey ? 'outdent' : 'indent'); }
    return;
  }
  if (e.key !== 'Enter' || e.shiftKey) return;
  if (ta.selectionStart !== ta.selectionEnd) return;
  const pos = ta.selectionStart;
  const lineStart = ta.value.lastIndexOf('\n', pos - 1) + 1;
  const line = ta.value.slice(lineStart, pos);
  const m = line.match(/^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)[.)] )(.*)$/);
  if (!m) return;
  e.preventDefault();
  if (m[4].trim() === '') {
    ta.setRangeText('', lineStart, pos, 'end');
  } else {
    let marker = m[2];
    if (m[3]) marker = `${parseInt(m[3], 10) + 1}${marker.includes(')') ? ')' : '.'} `;
    if (/\[[xX]\]/.test(marker)) marker = marker.replace(/\[[xX]\]/, '[ ]');
    ta.setRangeText('\n' + m[1] + marker, pos, pos, 'end');
  }
  onContentChanged();
}

export function setAuraFromUI(color) {
  setAura(color);
  scheduleSave();
}

export function registerEditorHooks() {
  hooks.openNote = openNote;
  hooks.startNewNote = startNewNote;
  hooks.leaveEditor = leaveEditor;
  hooks.saveCurrentNote = saveCurrentNote;
}

export async function openBacklink(id) {
  await saveCurrentNote();
  state.editing = null;
  openNote(id);
}
