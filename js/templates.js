// Szablony notatek (domyślne + własne) i okno wyboru.
import { state } from './state.js';
import { $, openModal, closeModal, askText, showToast } from './ui.js';
import { escapeHtml, generateId, parseTags, todayStr } from './util.js';
import { readLS, writeLS, LS } from './storage.js';
import { startNewNote, leaveEditor, scheduleSave } from './editor.js';

export function getDefaultTemplates() {
  return [
    { id: 'meeting', name: 'Spotkanie', content: '# Spotkanie\n\n**Data:** {{date}}\n**Uczestnicy:** \n\n## Agenda\n- \n\n## Notatki\n\n## Następne kroki\n- [ ] ' },
    { id: 'journal', name: 'Dziennik', title: 'Dziennik {{date}}', tags: ['dziennik'], content: '# Dziennik {{date}}\n\n## Co się wydarzyło\n\n## Myśli\n\n## Wdzięczność\n- ' },
    { id: 'idea', name: 'Pomysł', content: '# Pomysł\n\n## Opis\n\n## Dlaczego ważny\n\n## Następne kroki\n- [ ] ' }
  ];
}

export function loadTemplates() {
  const t = readLS(LS.templates, null);
  state.templates = Array.isArray(t) && t.length ? t.filter((x) => x && x.id && x.name) : getDefaultTemplates();
}

const saveTemplates = () => writeLS(LS.templates, state.templates);
export const applyTemplateVars = (s) => String(s || '').replace(/\{\{date\}\}/g, todayStr());

export async function openTemplatePicker() {
  const wrap = document.createElement('div');
  wrap.className = 'choice-list';
  const render = () => {
    wrap.innerHTML = state.templates.map((t) => `
      <div class="choice" data-id="${escapeHtml(t.id)}">
        <button type="button" class="choice-main">${escapeHtml(t.name)}</button>
        <button type="button" class="mini-btn" data-del="${escapeHtml(t.id)}" aria-label="Usuń szablon" title="Usuń szablon">✕</button>
      </div>`).join('') || '<p class="muted">Brak szablonów</p>';
  };
  render();
  wrap.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { state.templates = state.templates.filter((t) => t.id !== del.dataset.del); saveTemplates(); render(); return; }
    const main = e.target.closest('.choice-main');
    if (main) closeModal(main.parentElement.dataset.id);
  });
  const id = await openModal({ title: 'Nowa notatka z szablonu', content: wrap, actions: [{ label: 'Zamknij', value: null }] });
  const t = state.templates.find((x) => x.id === id);
  if (!t) return;
  if (state.currentScreen === 'editor') await leaveEditor();
  startNewNote({ title: applyTemplateVars(t.title || t.name), content: applyTemplateVars(t.content), tags: t.tags ? [...t.tags] : undefined });
  scheduleSave();
}

export async function saveAsTemplate() {
  if (!state.editing) return;
  const name = await askText('Nazwa szablonu', 'np. Plan tygodnia', $('noteTitle').value.trim());
  if (!name) return;
  state.templates.push({ id: generateId(), name, content: $('noteContent').value, tags: parseTags($('tagsInput').value) });
  saveTemplates();
  showToast('Zapisano szablon');
}
