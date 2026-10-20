// Współdzielony stan aplikacji + „haki” do wywołań między modułami (bez zależności cyklicznych).

export const DEFAULT_AURA = '#3b82f6';
export const TRASH_DAYS = 30;

export const state = {
  notes: [],
  folders: [],
  workspaces: [],
  templates: [],
  editing: null, // { note, isNew }
  currentScreen: 'notes', // notes | graph | editor
  currentView: 'all', // all | recent | favorites | journal | archive | trash
  currentLayout: 'grid',
  currentSort: 'updated',
  currentWorkspace: 'default',
  currentFolder: null,
  currentTag: null,
  searchQuery: '',
  isPreview: false,
  theme: 'dark',
  sidebarCollapsed: false,
  dbOk: true
};

/** Funkcje rejestrowane przez moduły: renderAll, showNotes, leaveEditor, openNote, startNewNote … */
export const hooks = {};

export const isLive = (n) => !n.deleted && !n.archived;
export const wsNotes = () => state.notes.filter((n) => (n.workspace || 'default') === state.currentWorkspace);
export const folderName = (id) => state.folders.find((f) => f.id === id)?.name || '';

export function findNoteByTitle(title, ws = state.currentWorkspace) {
  const t = String(title).trim().toLowerCase();
  return state.notes.find((n) => !n.deleted && (n.workspace || 'default') === ws && (n.title || '').trim().toLowerCase() === t);
}
