// Lista notatek: filtrowanie, renderowanie kart, gesty przesunięcia.
import { state, hooks, wsNotes, folderName, isLive } from './state.js';
import { $, askConfirm } from './ui.js';
import { escapeHtml, formatDate, plainPreview } from './util.js';
import { persist, trashNote, restoreNote, purgeNote } from './actions.js';

const VIEW_TITLES = { all: 'Wszystkie notatki', recent: 'Ostatnie', favorites: 'Ulubione', journal: 'Dziennik', archive: 'Archiwum', trash: 'Kosz' };
const EMPTY = {
  archive: ['Archiwum jest puste', 'Zarchiwizowane notatki pojawią się tutaj.'],
  trash: ['Kosz jest pusty', 'Usunięte notatki są tu przechowywane 30 dni.']
};

export function getFilteredNotes() {
  const v = state.currentView;
  let list = wsNotes().filter((n) => (v === 'trash' ? !!n.deleted : v === 'archive' ? n.archived && !n.deleted : isLive(n)));
  if (state.currentFolder) list = list.filter((n) => n.folder === state.currentFolder);
  if (state.currentTag) {
    const t = state.currentTag.toLowerCase();
    list = list.filter((n) => n.tags.some((x) => x.toLowerCase() === t));
  }
  if (v === 'favorites') list = list.filter((n) => n.favorite);
  if (v === 'journal') list = list.filter((n) => n.tags.some((t) => t.toLowerCase() === 'dziennik') || n.title.toLowerCase().includes('dziennik'));
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    list = list.filter((n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q)));
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

  grid.innerHTML = filtered.map((note, i) => `
    <article class="note-card ${note.pinned ? 'pinned' : ''} ${note.deleted ? 'is-trashed' : ''}" data-id="${escapeHtml(note.id)}" tabindex="0" role="button"
      style="--card-aura: ${escapeHtml(note.aura)}; animation-delay: ${Math.min(i, 12) * 0.03}s">
      <h3>${escapeHtml(note.title || 'Bez tytułu')}</h3>
      <p>${escapeHtml(plainPreview(note.content)) || '&nbsp;'}</p>
      <div class="note-meta">
        <div class="note-tags">
          ${note.favorite ? '<span class="fav-star" title="Ulubiona">★</span>' : ''}
          ${note.attachments.length ? `<span class="mini-tag" title="Załączniki">📎${note.attachments.length}</span>` : ''}
          ${note.tags.slice(0, 3).map((t) => `<span class="mini-tag">#${escapeHtml(t)}</span>`).join('')}
        </div>
        <span>${note.deleted ? 'usunięto ' : ''}${escapeHtml(formatDate(note.deleted || note.updated))}</span>
      </div>
    </article>`).join('');
}

/* Gesty przesunięcia (delegacja zdarzeń) */
let suppressClickUntil = 0;

export function setupGridInteractions() {
  const grid = $('notesGrid');
  grid.addEventListener('click', (e) => {
    if (Date.now() < suppressClickUntil) return;
    const card = e.target.closest('.note-card');
    if (card) hooks.openNote(card.dataset.id);
  });
  grid.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.note-card');
    if (card) { e.preventDefault(); hooks.openNote(card.dataset.id); }
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
