// Wyszukiwarka: filtry (data, dostęp, zakres), ostatnie i zapisane wyszukiwania. Wszystko lokalnie, bez serwera.
import { state, hooks } from './state.js';
import { $ } from './ui.js';
import { readLS, writeLS, LS } from './storage.js';
import { escapeHtml } from './util.js';

export const DEFAULT_FILTERS = { date: 'any', access: 'any', scope: 'ws' };
const DATE_LABEL = { today: 'dziś', 7: '7 dni', 30: '30 dni' };
const filtersActive = (f = state.searchFilters) => f.date !== 'any' || f.access !== 'any' || f.scope !== 'ws';

/** Czy notatka spełnia filtry wyszukiwania (bez treści zapytania). */
export function passesFilters(n, f = state.searchFilters, now = Date.now()) {
  if (f.access === 'private' && !n.private) return false;
  if (f.access === 'shared' && n.private) return false;
  if (f.date === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); if (n.updated < d.getTime()) return false; }
  else if (f.date !== 'any' && n.updated < now - Number(f.date) * 86400000) return false;
  return true;
}

const recent = () => readLS(LS.searches, []).filter((x) => typeof x === 'string');
const saved = () => readLS(LS.savedSearches, []).filter((x) => x && typeof x.q === 'string');

function describe(s) {
  const parts = [s.q || 'wszystko'];
  const f = { ...DEFAULT_FILTERS, ...s.filters };
  if (f.date !== 'any') parts.push(DATE_LABEL[f.date]);
  if (f.access !== 'any') parts.push(f.access === 'private' ? 'prywatne' : 'wspólne');
  if (f.scope === 'all') parts.push('wszystkie przestrzenie');
  return parts.join(' · ');
}

let rememberTimer = 0;
function rememberQuery(q) {
  clearTimeout(rememberTimer);
  if (q.trim().length < 2) return;
  rememberTimer = setTimeout(() => {
    const list = [q.trim(), ...recent().filter((x) => x.toLowerCase() !== q.trim().toLowerCase())].slice(0, 8);
    writeLS(LS.searches, list);
    renderSearchPanel();
  }, 1500);
}

export function renderSearchPanel() {
  const f = state.searchFilters;
  $('fDate').value = f.date; $('fAccess').value = f.access; $('fScope').value = f.scope;
  const focused = [$('searchInput'), $('searchInputMobile')].includes(document.activeElement);
  const active = !!state.searchQuery || filtersActive();
  document.body.classList.toggle('searching', active || focused);
  $('clearSearchBtn').style.display = active ? '' : 'none';
  $('saveSearchBtn').style.display = active ? '' : 'none';
  const chips = [
    ...saved().map((s, i) => `<span class="search-chip saved"><button type="button" data-saved="${i}">★ ${escapeHtml(s.name || describe(s))}</button><button type="button" class="chip-x" data-unsave="${i}" aria-label="Usuń zapisane wyszukiwanie">✕</button></span>`),
    ...(state.searchQuery ? [] : recent().map((q) => `<span class="search-chip"><button type="button" data-recent="${escapeHtml(q)}">${escapeHtml(q)}</button></span>`))
  ];
  $('searchChips').innerHTML = chips.length ? `<span class="muted search-chips-label">${state.searchQuery ? 'Zapisane' : 'Ostatnie i zapisane'}</span>` + chips.join('') : '';
}

export function setQuery(q, { remember = true } = {}) {
  state.searchQuery = q;
  $('searchInput').value = q;
  $('searchInputMobile').value = q;
  if (remember) rememberQuery(q);
  renderSearchPanel();
}

async function apply(q, filters) {
  state.searchFilters = { ...DEFAULT_FILTERS, ...filters };
  setQuery(q, { remember: false });
  if (state.currentScreen !== 'notes') await hooks.showNotes();
  hooks.renderNotes();
}

export function setupSearch() {
  state.searchFilters = { ...DEFAULT_FILTERS };
  const onFilter = () => {
    state.searchFilters = { date: $('fDate').value, access: $('fAccess').value, scope: $('fScope').value };
    renderSearchPanel();
    hooks.renderNotes();
  };
  ['fDate', 'fAccess', 'fScope'].forEach((id) => $(id).addEventListener('change', onFilter));
  $('clearSearchBtn').addEventListener('click', () => apply('', DEFAULT_FILTERS));
  $('saveSearchBtn').addEventListener('click', () => {
    const entry = { q: state.searchQuery, filters: { ...state.searchFilters } };
    entry.name = describe(entry);
    writeLS(LS.savedSearches, [entry, ...saved().filter((s) => describe(s) !== entry.name)].slice(0, 12));
    renderSearchPanel();
    hooks.toast('Zapisano wyszukiwanie');
  });
  $('searchChips').addEventListener('mousedown', (e) => e.preventDefault()); // klik nie zabiera fokusu polu wyszukiwania
  $('searchChips').addEventListener('click', (e) => {
    const r = e.target.closest('[data-recent]');
    if (r) return apply(r.dataset.recent, state.searchFilters);
    const s = e.target.closest('[data-saved]');
    if (s) { const x = saved()[Number(s.dataset.saved)]; if (x) apply(x.q, x.filters); return; }
    const u = e.target.closest('[data-unsave]');
    if (u) { const list = saved(); list.splice(Number(u.dataset.unsave), 1); writeLS(LS.savedSearches, list); renderSearchPanel(); }
  });
  for (const id of ['searchInput', 'searchInputMobile']) {
    $(id).addEventListener('focus', renderSearchPanel);
    $(id).addEventListener('blur', () => setTimeout(renderSearchPanel, 150));
  }
}
