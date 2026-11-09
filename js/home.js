// Pulpit (ekran startowy) i widok Zadań zebranych ze wszystkich notatek.
import { state, hooks, wsNotes, isLive } from './state.js';
import { $ } from './ui.js';
import { escapeHtml, formatDate, plural } from './util.js';
import { persist } from './actions.js';
import { readLS, LS } from './storage.js';

const TASK_RE = /^(\s*)[-*+] \[( |x|X)\] (.*)$/;

const ICON = {
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>'
};

/** Wszystkie zadania z notatek bieżącej przestrzeni: { note, line, indent, done, text }. */
export function collectTasks(notes = wsNotes().filter(isLive)) {
  const out = [];
  for (const note of notes) {
    note.content.split('\n').forEach((raw, line) => {
      const m = TASK_RE.exec(raw);
      if (m && m[3].trim()) out.push({ note, line, indent: m[1].length, done: m[2] !== ' ', text: m[3].trim() });
    });
  }
  return out;
}

/** Zmienia stan zadania w treści notatki (tylko gdy linia nadal jest tym samym zadaniem). */
export async function toggleTask(noteId, line, text) {
  const note = state.notes.find((n) => n.id === noteId);
  if (!note) return false;
  const lines = note.content.split('\n');
  const m = TASK_RE.exec(lines[line] || '');
  if (!m || m[3].trim() !== text) return false;
  lines[line] = `${m[1]}- [${m[2] === ' ' ? 'x' : ' '}] ${m[3]}`;
  note.content = lines.join('\n');
  note.updated = Date.now();
  await persist(note);
  return true;
}

const taskRow = (t) => `
  <label class="task-row ${t.done ? 'is-done' : ''}" style="--indent:${Math.min(t.indent, 8) * 6}px">
    <input type="checkbox" ${t.done ? 'checked' : ''} data-task="${escapeHtml(t.note.id)}" data-line="${t.line}" data-text="${escapeHtml(t.text)}">
    <span class="task-text">${escapeHtml(t.text)}</span>
  </label>`;

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 5 ? 'Dobranoc' : h < 12 ? 'Dzień dobry' : h < 18 ? 'Miłego popołudnia' : 'Dobry wieczór';
}

export function renderHome() {
  const now = new Date();
  $('homeGreeting').textContent = greeting(now);
  $('homeDate').textContent = now.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const live = wsNotes().filter(isLive);
  const open = collectTasks(live).filter((t) => !t.done);
  $('homeTasksCount').textContent = open.length ? `${open.length} ${plural(open.length, 'otwarte', 'otwarte', 'otwartych')}` : 'Wszystko zrobione';

  const recent = [...live].sort((a, b) => b.updated - a.updated).slice(0, 5);
  $('homeRecent').innerHTML = recent.length ? recent.map((n) => `
    <button type="button" class="recent-row" data-open="${escapeHtml(n.id)}">
      <span class="recent-ico">${ICON.note}</span>
      <span class="recent-main"><strong>${escapeHtml(n.title || 'Bez tytułu')}</strong><small>${escapeHtml(formatDate(n.updated))}</small></span>
      ${n.favorite ? `<span class="recent-star" title="Ulubiona">${ICON.star}</span>` : ''}
    </button>`).join('') : '<p class="home-empty">Tu pojawią się Twoje ostatnie notatki.</p>';

  $('homeTasks').innerHTML = open.length ? open.slice(0, 4).map(taskRow).join('') +
    (open.length > 4 ? `<button type="button" class="link-btn" data-go="tasks">Pokaż wszystkie (${open.length})</button>` : '')
    : '<p class="home-empty">Brak otwartych zadań. Dodaj je w notatce: „☐ Zadanie” na pasku formatowania.</p>';
  $('homeTasksCard').classList.toggle('is-empty', !open.length);

  const projects = state.workspaces.filter((w) => w.id !== 'default');
  $('homeProjectsCard').style.display = projects.length ? '' : 'none';
  $('homeProjects').innerHTML = projects.map((w) => {
    const c = state.notes.filter((n) => (n.workspace || 'default') === w.id && isLive(n)).length;
    return `<button type="button" class="project-chip" data-ws="${escapeHtml(w.id)}"><span class="recent-ico">${ICON.folder}</span><span>${escapeHtml(w.name)}</span><small>${c}</small></button>`;
  }).join('');

  const sync = readLS(LS.sync, null);
  const dot = !sync ? 'off' : sync.error ? 'err' : 'ok';
  $('homeStatus').innerHTML = `<span class="status-dot ${dot}"></span>${escapeHtml(!sync ? 'Notatki tylko na tym urządzeniu' : sync.error ? 'Synchronizacja: ' + sync.error : sync.last ? 'Zsynchronizowano ' + formatDate(sync.last) : 'Łączenie z serwerem…')}`;
}

export function renderTasks() {
  const all = collectTasks();
  const showDone = !!state.tasksShowDone;
  const list = showDone ? all : all.filter((t) => !t.done);
  const groups = new Map();
  list.forEach((t) => { if (!groups.has(t.note.id)) groups.set(t.note.id, { note: t.note, items: [] }); groups.get(t.note.id).items.push(t); });
  const openCount = all.filter((t) => !t.done).length;
  $('tasksSummary').textContent = `${openCount} ${plural(openCount, 'otwarte zadanie', 'otwarte zadania', 'otwartych zadań')} · ${all.length - openCount} ${plural(all.length - openCount, 'ukończone', 'ukończone', 'ukończonych')}`;
  $('tasksDoneToggle').textContent = showDone ? 'Ukryj ukończone' : 'Pokaż ukończone';
  $('tasksList').innerHTML = groups.size ? [...groups.values()].sort((a, b) => b.note.updated - a.note.updated).map((g) => `
    <section class="task-group">
      <button type="button" class="task-note" data-open="${escapeHtml(g.note.id)}"><span class="recent-ico">${ICON.note}</span>${escapeHtml(g.note.title || 'Bez tytułu')}</button>
      ${g.items.map(taskRow).join('')}
    </section>`).join('') : `<div class="tasks-empty"><div class="empty-orb"></div><h2>${all.length ? 'Wszystko zrobione' : 'Brak zadań'}</h2><p>Zadania z wszystkich notatek zbierają się tutaj. Dodasz je w notatce przyciskiem „☐ Zadanie”.</p></div>`;
}

export function setupHomeInteractions() {
  const onClick = async (e) => {
    const open = e.target.closest('[data-open]');
    if (open) { hooks.openNote(open.dataset.open); return; }
    const ws = e.target.closest('[data-ws]');
    if (ws) { await hooks.switchWorkspace(ws.dataset.ws); return; }
  };
  const onChange = async (e) => {
    const cb = e.target.closest('input[data-task]');
    if (!cb) return;
    const ok = await toggleTask(cb.dataset.task, Number(cb.dataset.line), cb.dataset.text);
    if (!ok) cb.checked = !cb.checked;
    setTimeout(() => (state.currentScreen === 'tasks' ? renderTasks() : renderHome()), ok ? 350 : 0);
  };
  for (const id of ['homeView', 'tasksView']) {
    $(id).addEventListener('click', onClick);
    $(id).addEventListener('change', onChange);
  }
  $('tasksDoneToggle').addEventListener('click', () => { state.tasksShowDone = !state.tasksShowDone; renderTasks(); });
}
