// Paleta poleceń (Ctrl/⌘ K): polecenia aplikacji i szybkie przejście do notatek.
import { hooks, wsNotes, isLive } from './state.js';
import { escapeHtml, fold, highlightText } from './util.js';

let el = null, items = [], sel = 0, commands = [];

/** commands: [{ id, label, hint, keys, when?: () => bool, run: () => void }] */
export function registerCommands(list) { commands = list; }

const isOpen = () => !!el;

function build(q) {
  const f = fold(q.trim());
  const cmds = commands.filter((c) => (!c.when || c.when()) && (!f || fold(c.label + ' ' + (c.hint || '')).includes(f)))
    .map((c) => ({ kind: 'cmd', label: c.label, hint: c.hint, keys: c.keys, run: c.run }));
  const notes = f ? wsNotes().filter(isLive).filter((n) => fold(n.title || '').includes(f)).sort((a, b) => b.updated - a.updated).slice(0, 8)
    .map((n) => ({ kind: 'note', label: n.title || 'Bez tytułu', hint: 'Notatka', id: n.id })) : [];
  return f ? [...notes, ...cmds] : cmds;
}

function render() {
  const q = el.querySelector('input').value;
  items = build(q);
  sel = Math.min(sel, Math.max(0, items.length - 1));
  el.querySelector('.pal-list').innerHTML = items.length ? items.map((it, i) => `
    <button type="button" class="pal-item ${i === sel ? 'sel' : ''}" data-i="${i}" role="option" aria-selected="${i === sel}">
      <span class="pal-ico ${it.kind}">${it.kind === 'note' ? '▤' : '›'}</span>
      <span class="pal-label">${highlightText(it.label, q)}</span>
      ${it.keys ? `<kbd>${escapeHtml(it.keys)}</kbd>` : `<small>${escapeHtml(it.hint || '')}</small>`}
    </button>`).join('') : '<p class="pal-empty">Brak wyników</p>';
  const cur = el.querySelector('.pal-item.sel');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}

export function closePalette() {
  if (!el) return;
  el.remove();
  el = null;
}

function runItem(it) {
  closePalette();
  if (!it) return;
  if (it.kind === 'note') hooks.openNote(it.id);
  else it.run();
}

export function openPalette() {
  if (isOpen()) { el.querySelector('input').focus(); return; }
  sel = 0;
  el = document.createElement('div');
  el.className = 'palette-backdrop';
  el.innerHTML = `<div class="palette" role="dialog" aria-label="Paleta poleceń">
    <div class="pal-search"><span>⌘</span><input type="text" placeholder="Wpisz polecenie lub tytuł notatki…" aria-label="Polecenie" autocomplete="off" enterkeyhint="go"></div>
    <div class="pal-list" role="listbox"></div>
    <p class="pal-foot"><kbd>↑</kbd><kbd>↓</kbd> wybór · <kbd>Enter</kbd> wykonaj · <kbd>Esc</kbd> zamknij</p>
  </div>`;
  document.body.appendChild(el);
  const input = el.querySelector('input');
  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(1, items.length); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % Math.max(1, items.length); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); runItem(items[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); }
  });
  el.addEventListener('mousedown', (e) => { if (e.target === el) closePalette(); });
  el.querySelector('.pal-list').addEventListener('click', (e) => { const b = e.target.closest('.pal-item'); if (b) runItem(items[Number(b.dataset.i)]); });
  render();
  input.focus(); // od razu: pierwsze wpisane znaki nie mogą przepaść
}

export const paletteOpen = isOpen;
