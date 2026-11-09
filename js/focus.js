// Tryb Focus: zostaje tylko tytuł i treść notatki; szerokość kolumny jest zapamiętywana.
import { state } from './state.js';
import { $, showToast } from './ui.js';
import { readLS, writeLS, LS } from './storage.js';

const WIDTHS = [['narrow', 'Wąska'], ['medium', 'Średnia'], ['wide', 'Szeroka']];
const prefs = () => ({ width: 'medium', ...readLS(LS.focus, {}) });

function applyWidth() {
  const w = prefs().width;
  document.body.dataset.focusWidth = w;
  $('focusWidthBtn').textContent = 'Szerokość: ' + (WIDTHS.find((x) => x[0] === w) || WIDTHS[1])[1].toLowerCase();
}

export const isFocus = () => document.body.classList.contains('focus');

export function enterFocus() {
  if (state.currentScreen !== 'editor' || isFocus()) return;
  document.body.classList.add('focus');
  applyWidth();
  if (state.isPreview) $('previewToggle').click();
  $('noteContent').focus({ preventScroll: true });
  showToast('Tryb Focus – Esc lub „Zakończ”, aby wyjść');
}

export function exitFocus() {
  if (!isFocus()) return;
  document.body.classList.remove('focus');
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
}

export function setupFocus() {
  $('focusBtn').addEventListener('click', () => (isFocus() ? exitFocus() : enterFocus()));
  $('focusExitBtn').addEventListener('click', exitFocus);
  $('focusWidthBtn').addEventListener('click', () => {
    const i = WIDTHS.findIndex((x) => x[0] === prefs().width);
    writeLS(LS.focus, { ...prefs(), width: WIDTHS[(i + 1) % WIDTHS.length][0] });
    applyWidth();
  });
  const fs = $('focusFullBtn');
  if (!document.fullscreenEnabled) fs.style.display = 'none'; // iPhone: aplikacja z ekranu początkowego i tak zajmuje cały ekran
  fs.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  });
  applyWidth();
}
