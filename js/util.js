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

/** Krótki skrót tekstu (cyrb53) do wykrywania zmian przy synchronizacji. */
export function hashText(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

/** Kod parowania: https://serwer/nexus-sync#sekret */
export function parseSyncCode(code) {
  const m = /^(https?:\/\/[^\s#]+?)\/?#([a-f0-9]{32,128})$/i.exec(String(code || '').trim());
  return m ? { url: m[1], secret: m[2].toLowerCase() } : null;
}

/** Klucz elementu na serwerze: prefiks + identyfikator w bezpiecznym alfabecie (hex). */
export function encodeKey(prefix, id) {
  return prefix + [...new TextEncoder().encode(String(id))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function decodeKey(k) {
  const bytes = k.slice(2).match(/../g) || [];
  return new TextDecoder().decode(new Uint8Array(bytes.map((h) => parseInt(h, 16))));
}

/* ---------- Wyszukiwanie ---------- */

/** Mała litera bez polskich i innych znaków diakrytycznych, znak w znak (długość bez zmian). */
export function fold(str) {
  let out = '';
  for (const ch of String(str)) {
    const f = ch.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace('ł', 'l');
    out += f.length === ch.length ? f : ch.toLowerCase().length === ch.length ? ch.toLowerCase() : ch;
  }
  return out;
}

/** Słowa zapytania (każde musi wystąpić). */
export const queryTerms = (q) => fold(q).split(/\s+/).filter(Boolean);

export function matchesQuery(fields, q) {
  const terms = queryTerms(q);
  if (!terms.length) return true;
  const hay = fold(fields.filter(Boolean).join('\n'));
  return terms.every((t) => hay.includes(t));
}

/** Tekst z zaznaczonymi trafieniami (<mark>), bezpieczny do wstawienia jako HTML. */
export function highlightText(text, q) {
  const terms = queryTerms(q);
  text = String(text);
  if (!terms.length) return escapeHtml(text);
  const f = fold(text);
  const marks = new Array(text.length).fill(false);
  for (const t of terms) {
    let i = f.indexOf(t);
    while (i !== -1) { for (let k = i; k < i + t.length; k++) marks[k] = true; i = f.indexOf(t, i + t.length); }
  }
  let out = '', open = false;
  for (let i = 0; i < text.length; i++) {
    if (marks[i] && !open) { out += '<mark>'; open = true; }
    if (!marks[i] && open) { out += '</mark>'; open = false; }
    out += escapeHtml(text[i]);
  }
  return out + (open ? '</mark>' : '');
}

/** Fragment tekstu wokół pierwszego trafienia (do podglądu na karcie). */
export function snippetAround(text, q, max = 160) {
  text = String(text);
  const terms = queryTerms(q);
  const f = fold(text);
  const at = terms.map((t) => f.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (at === undefined || at < max * 0.6) return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
  const start = Math.max(0, at - Math.round(max * 0.35));
  const part = text.slice(start, start + max);
  return '…' + part.trimStart() + (start + max < text.length ? '…' : '');
}
