// Lista notatek: filtrowanie, renderowanie kart, gesty przesunięcia.
import { state, hooks, wsNotes, folderName, isLive, auraColor } from './state.js';
import { $, askConfirm } from './ui.js';
import { escapeHtml, formatDate, plainPreview, matchesQuery, highlightText, snippetAround } from './util.js';
import { passesFilters } from './search.js';
import { onCardClick, isSelecting, reapplySelection, startSelecting } from './select.js';
import { persist, trashNote, restoreNote, purgeNote } from './actions.js';

const VIEW_TITLES = { all: 'Wszystkie notatki', recent: 'Ostatnie', favorites: 'Ulubione', journal: 'Dziennik', archive: 'Archiwum', trash: 'Kosz' };
const EMPTY = {
  archive: ['Archiwum jest puste', 'Zarchiwizowane notatki pojawią się tutaj.'],
  trash: ['Kosz jest pusty', 'Usunięte notatki są tu przechowywane 30 dni.']
};

export function getFilteredNotes() {
  const v = state.currentView;
  const everywhere = state.searchFilters.scope === 'all' && (state.searchQuery || v === 'all');
  const base = everywhere ? state.notes : wsNotes();
  let list = base.filter((n) => (v === 'trash' ? !!n.deleted : v === 'archive' ? n.archived && !n.deleted : isLive(n)));
  list = list.filter((n) => passesFilters(n));
  if (state.currentFolder) list = list.filter((n) => n.folder === state.currentFolder);
  if (state.currentTag) {
    const t = state.currentTag.toLowerCase();
    list = list.filter((n) => n.tags.some((x) => x.toLowerCase() === t));
  }
  if (v === 'favorites') list = list.filter((n) => n.favorite);
  if (v === 'journal') list = list.filter((n) => n.tags.some((t) => t.toLowerCase() === 'dziennik') || n.title.toLowerCase().includes('dziennik'));
  if (state.searchQuery) {
    const q = state.searchQuery;
    const wsName = (id) => (state.workspaces.find((w) => w.id === (id || 'default')) || {}).name;
    list = list.filter((n) => matchesQuery([n.title, n.content, n.tags.join(' '), folderName(n.folder), ...n.attachments.map((a) => a.name), wsName(n.workspace)], q));
  }
  const cmp = (a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (state.currentSort === 'title') return (a.title || '').localeCompare(b.title || '', 'pl');
    if (state.currentSort === 'created') return b.created - a.created;
    return b.updated - a.updated;
  };
  if (v === 'recent') list = list.sort((a, b) => b.updated - a.updated).slice(0, 30);
  if (v === 'trash') return list.sort((a, b) => b.deleted - a.deleted);
  return list.sort(cmp);
}

export function renderNotes() {
  const grid = $('notesGrid');
  const empty = $('emptyState');
  const v = state.currentView;
  const filtered = getFilteredNotes();
  grid.classList.toggle('list-view', state.currentLayout === 'list');
  grid.classList.toggle('animate', state.animateNext);
  state.animateNext = false;

  let title = VIEW_TITLES[v] || 'Notatki';
  if (state.currentFolder) title += ' · ' + folderName(state.currentFolder);
  $('viewTitle').textContent = title;
  $('emptyTrashBtn').style.display = v === 'trash' && filtered.length ? '' : 'none';
  $('quickBar').style.display = v === 'trash' || v === 'archive' ? 'none' : '';
  const trashN = wsNotes().filter((n) => n.deleted).length;
  $('trashCount').textContent = trashN ? String(trashN) : '';

  const chips = [];
  if (state.currentTag) chips.push(`<button class="chip" data-clear="tag">#${escapeHtml(state.currentTag)} ✕</button>`);
  if (state.currentFolder) chips.push(`<button class="chip" data-clear="folder">📁 ${escapeHtml(folderName(state.currentFolder))} ✕</button>`);
  $('activeFilters').innerHTML = chips.join('');

  if (filtered.length === 0) {
    grid.innerHTML = '';
    const filteredOut = state.searchQuery || state.currentTag || state.currentFolder || v !== 'all';
    const [t, p] = state.searchQuery ? ['Nic tu nie ma', 'Żadna notatka nie pasuje do wyszukiwania.'] :
      EMPTY[v] || (filteredOut ? ['Nic tu nie ma', 'Brak notatek w tym widoku.'] : ['Brak notatek', 'Stwórz pierwszą notatkę, aby rozpocząć.']);
    $('emptyTitle').textContent = t;
    $('emptyText').textContent = p;
    const showCreate = v !== 'trash' && v !== 'archive';
    $('emptyNewBtn').style.display = showCreate ? '' : 'none';
    $('emptyTemplatesBtn').style.display = showCreate ? '' : 'none';
    empty.classList.add('show');
    return;
  }
  empty.classList.remove('show');

  const q = state.searchQuery;
  grid.innerHTML = filtered.map((note, i) => `
    <article class="note-card ${note.pinned ? 'pinned' : ''} ${note.deleted ? 'is-trashed' : ''} ${state.editing && state.editing.note.id === note.id ? 'selected' : ''}" data-id="${escapeHtml(note.id)}" tabindex="0" role="button"
      style="${auraColor(note.aura) ? `--card-aura: ${escapeHtml(auraColor(note.aura))}; ` : ''}animation-delay: ${Math.min(i, 12) * 0.03}s">
      <h3>${q ? highlightText(note.title || 'Bez tytułu', q) : escapeHtml(note.title || 'Bez tytułu')}</h3>
      <p>${(q ? highlightText(snippetAround(plainPreview(note.content, 100000), q), q) : escapeHtml(plainPreview(note.content))) || '&nbsp;'}</p>
      <div class="note-meta">
        <div class="note-tags">
          ${note.private ? '<span class="mini-tag private-tag" title="Tylko na tym urządzeniu">🔒 Prywatna</span>' : ''}
          ${note.favorite ? '<span class="fav-star" title="Ulubiona">★</span>' : ''}
          ${note.attachments.length ? `<span class="mini-tag" title="Załączniki">📎${note.attachments.length}</span>` : ''}
          ${state.searchFilters.scope === 'all' && (note.workspace || 'default') !== state.currentWorkspace ? `<span class="mini-tag ws-tag">${escapeHtml((state.workspaces.find((w) => w.id === (note.workspace || 'default')) || {}).name || '')}</span>` : ''}
          ${note.tags.slice(0, 3).map((t) => `<span class="mini-tag">#${escapeHtml(t)}</span>`).join('')}
        </div>
        <span>${note.deleted ? 'usunięto ' : ''}${escapeHtml(formatDate(note.deleted || note.updated))}</span>
      </div>
    </article>`).join('');
  if (isSelecting()) reapplySelection();
}

/* Gesty przesunięcia (delegacja zdarzeń) */
let suppressClickUntil = 0;

export function setupGridInteractions() {
  const grid = $('notesGrid');
  grid.addEventListener('click', (e) => {
    if (Date.now() < suppressClickUntil) return;
    const card = e.target.closest('.note-card');
    if (!card) return;
    if (onCardClick(card.dataset.id)) return;
    hooks.openNote(card.dataset.id);
  });
  // przytrzymanie karty: zaznaczanie wielu notatek
  let pressT = 0, pressCard = null;
  const cancelPress = () => { clearTimeout(pressT); pressCard = null; };
  grid.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('.note-card');
    if (!c || isSelecting() || state.currentView === 'trash') return;
    pressCard = c;
    pressT = setTimeout(() => { if (pressCard) { suppressClickUntil = Date.now() + 600; startSelecting(pressCard.dataset.id); if (navigator.vibrate) navigator.vibrate(15); } }, 550);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => grid.addEventListener(ev, cancelPress));
  grid.addEventListener('pointermove', (e) => { if (pressCard && (Math.abs(e.movementX) > 3 || Math.abs(e.movementY) > 3)) cancelPress(); });
  grid.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.note-card');
    if (card) { e.preventDefault(); hooks.openNote(card.dataset.id); }
  });

  let sx = 0, sy = 0, card = null, horizontal = null, dx = 0;
  grid.addEventListener('touchstart', (e) => {
    card = isSelecting() ? null : e.target.closest('.note-card');
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
  grid.addEventListener('touchend', async () => {
    if (!card) return;
    const c = card; card = null;
    c.style.transition = ''; c.style.transform = '';
    c.classList.remove('swipe-fav', 'swipe-del');
    if (!horizontal || Math.abs(dx) < 80) return;
    suppressClickUntil = Date.now() + 400;
    const note = state.notes.find((n) => n.id === c.dataset.id);
    if (!note) return;
    if (state.currentView === 'trash') {
      if (dx > 0) await restoreNote(note.id);
      else if (await purgeNote(note.id, { confirm: true })) { hooks.renderAll(); }
      return;
    }
    if (dx > 0) {
      note.favorite = !note.favorite;
      await persist(note);
      renderNotes();
    } else {
      await trashNote(note.id); // z możliwością cofnięcia
    }
  });
  grid.addEventListener('touchcancel', () => {
    if (card) { card.style.transition = ''; card.style.transform = ''; card.classList.remove('swipe-fav', 'swipe-del'); card = null; }
  });
}
