// Czyste funkcje pomocnicze (bez DOM) – testowane jednostkowo.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

export function unescapeHtml(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function plural(n, one, few, many) {
  if (n === 1) return one;
  const m10 = n % 10, m100 = n % 100;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function formatDate(ts, now = Date.now()) {
  if (!ts) return '';
  const d = new Date(ts);
  const diff = now - d;
  if (diff < 60000) return 'przed chwilą';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min temu`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} godz. temu`;
  return d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}

export function parseTags(str) {
  const seen = new Set();
  return String(str).split(',').map((t) => t.trim().replace(/^#+/, '')).filter((t) => {
    const k = t.toLowerCase();
    if (!t || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function plainPreview(md, max = 160) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\[([^\]|\n]+)\|?([^\]\n]*)\]\]/g, (m, a, b) => b || a)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, ' ')
    .replace(/\|/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]\s+\[[ xX]\]|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function extractWikiTargets(content) {
  const out = [];
  const re = /\[\[([^\]\n]+)\]\]/g;
  let m;
  while ((m = re.exec(content || ''))) {
    const target = m[1].split('|')[0].trim();
    if (target) out.push(target);
  }
  return out;
}

/** Tytuł i treść dla szybkiej notatki z jednej linii/schowka. */
export function deriveQuickNote(raw) {
  const text = String(raw || '').replace(/\r\n?/g, '\n').trim();
  if (!text) return null;
  const clean = (l) => l.replace(/^\s*(#{1,6}|>|[-*+]\s+\[[ xX]\]|[-*+]|\d+[.)])\s+/, '').trim();
  const lines = text.split('\n');
  if (lines.length === 1 && text.length <= 60) return { title: clean(text) || text, content: '' };
  let title = clean(lines.find((l) => clean(l)) || text);
  if (title.length > 60) title = title.slice(0, 59).trimEnd() + '…';
  return { title, content: text };
}

/**
 * Stan klawiatury ekranowej na podstawie visualViewport.
 * Klawiaturę poznajemy po zmniejszeniu widocznego obszaru (baseH − vvH). Przesunięcia offsetTop NIE wolno
 * tu odejmować: iOS przesuwa widok w górę o tyle, ile trzeba odsłonić kursor, i po odjęciu otwarta klawiatura
 * wyglądała jak zamknięta, a cały interfejs odjeżdżał za górną krawędź.
 */
export function keyboardMetrics(baseH, vvH, offsetTop) {
  const hidden = baseH - vvH;
  const top = Math.max(0, offsetTop);
  if (hidden <= 120) return { open: false, kb: 0, top: 0 }; // drobne różnice (pasek adresu itp.)
  return { open: true, kb: Math.max(0, hidden - top), top };
}

export const BACKUP_EVERY_DAYS = 7;
const DAY = 86400000;

/** Czy przypomnieć o kopii: są zmiany od ostatniej kopii i minęło co najmniej `days` dni. */
export function backupDue({ lastBackup = 0, snoozeUntil = 0, notes = [], now = Date.now(), days = BACKUP_EVERY_DAYS } = {}) {
  if (!notes.length || now < snoozeUntil) return false;
  if (!notes.some((n) => n.updated > lastBackup)) return false;
  const since = lastBackup || Math.min(...notes.map((n) => n.created));
  return now - since >= days * DAY;
}

export function backupAge(lastBackup, now = Date.now()) {
  if (!lastBackup) return 'nigdy';
  const days = Math.floor((now - lastBackup) / DAY);
  if (days <= 0) return 'dzisiaj';
  if (days === 1) return 'wczoraj';
  return `${days} dni temu`;
}
