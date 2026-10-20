// Dostęp do localStorage z odpornością na uszkodzone dane.
import { showToast } from './ui.js';

export const LS = {
  settings: 'nexus-settings',
  folders: 'nexus-folders',
  workspaces: 'nexus-workspaces',
  templates: 'nexus-templates'
};

export function readLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    showToast('Nie można zapisać ustawień (brak miejsca lub tryb prywatny)');
    return false;
  }
}
