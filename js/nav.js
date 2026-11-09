// Przełączanie ekranów (lista / graf / edytor) i integracja z historią przeglądarki.
import { state, hooks } from './state.js';
import { $ } from './ui.js';

export function setView(screen) {
  state.currentScreen = screen;
  if (screen === 'notes') state.animateNext = true;
  ['home', 'notes', 'tasks', 'graph', 'editor'].forEach((v) => $(v + 'View').classList.toggle('active', v === screen));
  document.body.dataset.screen = screen;
  if (screen !== 'editor') document.body.classList.remove('focus');
  if (screen !== 'notes' && screen !== 'editor' && document.body.classList.contains('selecting')) document.getElementById('selectCancelBtn').click();
  $('mainContent').scrollTop = 0;
  ['notesView', 'editorView'].forEach((id) => { $(id).scrollTop = 0; });
}

export function pushScreen(screen) {
  try {
    if (state.currentScreen === 'editor') history.replaceState({ screen }, '');
    else history.pushState({ screen }, '');
  } catch { /* np. file:// */ }
}

export async function showNotes() {
  await hooks.leaveEditor();
  setView('notes');
  hooks.renderAll();
}

/** Wstecz: przez historię, jeśli jest wpis ekranu; inaczej bezpośrednio do listy. */
export async function goBack() {
  if (history.state && history.state.screen) history.back();
  else await showNotes();
}
