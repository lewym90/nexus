// Bezpieczny, lekki renderer Markdown (bez zależności). Czysty moduł – testowany jednostkowo.
import { escapeHtml, unescapeHtml } from './util.js';

/* ---------- Podświetlanie składni ---------- */

const KW = {
  js: 'const let var function return if else for while do switch case break continue new class extends import export from default async await try catch finally throw typeof instanceof in of this null undefined true false yield static super delete void',
  py: 'def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda None True False yield global nonlocal async await self',
  sh: 'if then else elif fi for do done while case esac function in echo export cd ls rm cp mv grep sed awk cat sudo git npm',
  sql: 'select from where insert into values update set delete create table drop alter join left right inner outer on group by order having limit as and or not null is in like distinct union primary key foreign references index',
  css: 'important',
  json: 'true false null',
  yaml: 'true false null yes no',
  html: ''
};
const C_COMMENT = '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/';
const DQ = '"(?:\\\\.|[^"\\\\\\n])*"';
const SQ = "'(?:\\\\.|[^'\\\\\\n])*'";
const BT = '`(?:\\\\.|[^`\\\\])*`';
const LANGS = {
  js: { kw: KW.js, comment: C_COMMENT, string: `${DQ}|${SQ}|${BT}` },
  py: { kw: KW.py, comment: '#[^\\n]*', string: `"""[\\s\\S]*?"""|${DQ}|${SQ}`, ci: false },
  sh: { kw: KW.sh, comment: '#[^\\n]*', string: `${DQ}|${SQ}` },
  sql: { kw: KW.sql, comment: '--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/', string: SQ, ci: true },
  css: { kw: KW.css, comment: '\\/\\*[\\s\\S]*?\\*\\/', string: `${DQ}|${SQ}` },
  json: { kw: KW.json, comment: '(?!)', string: DQ },
  yaml: { kw: KW.yaml, comment: '#[^\\n]*', string: `${DQ}|${SQ}` },
  html: { kw: KW.html, comment: '<!--[\\s\\S]*?-->', string: `${DQ}|${SQ}`, tag: true }
};
const ALIAS = {
  js: 'js', javascript: 'js', jsx: 'js', ts: 'js', typescript: 'js', tsx: 'js', java: 'js', c: 'js', cpp: 'js', cs: 'js', go: 'js', rust: 'js', php: 'js',
  py: 'py', python: 'py', sh: 'sh', bash: 'sh', zsh: 'sh', shell: 'sh', sql: 'sql', css: 'css', scss: 'css',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'yaml', html: 'html', xml: 'html', svg: 'html'
};
const reCache = {};

export function highlight(code, lang) {
  const key = ALIAS[String(lang || '').toLowerCase()];
  if (!key || code.length > 30000) return escapeHtml(code);
  const def = LANGS[key];
  if (!reCache[key]) {
    reCache[key] = new RegExp(
      [`(${def.comment})`, `(${def.string})`, def.tag ? '(<\\/?[A-Za-z][\\w-]*|\\/?>)' : '((?!))', '(\\b\\d+(?:\\.\\d+)?\\b)', '([A-Za-z_$][\\w$]*)'].join('|'), 'g');
  }
  const re = reCache[key];
  re.lastIndex = 0;
  const kws = new Set(def.kw.split(' ').filter(Boolean));
  let out = '', last = 0, m;
  while ((m = re.exec(code))) {
    if (m[0] === '') { re.lastIndex++; continue; }
    out += escapeHtml(code.slice(last, m.index));
    last = m.index + m[0].length;
    const t = escapeHtml(m[0]);
    if (m[1] !== undefined) out += `<span class="tok-c">${t}</span>`;
    else if (m[2] !== undefined) out += `<span class="tok-s">${t}</span>`;
    else if (m[3] !== undefined) out += `<span class="tok-t">${t}</span>`;
    else if (m[4] !== undefined) out += `<span class="tok-n">${t}</span>`;
    else if (kws.has(def.ci ? m[5].toLowerCase() : m[5])) out += `<span class="tok-k">${t}</span>`;
    else out += t;
  }
  return out + escapeHtml(code.slice(last));
}

/* ---------- Inline ---------- */

export function inlineMd(src, exists = () => true) {
  const codes = [];
  let s = String(src).replace(/\u0000/g, '');
  s = s.replace(/`([^`\n]+)`/g, (m, c) => { codes.push(`<code>${escapeHtml(c)}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  s = escapeHtml(s);
  s = s.replace(/\[\[([^\]\n]+)\]\]/g, (m, inner) => {
    const [target, label] = inner.split('|');
    const t = target.trim();
    return `<a href="#" class="wiki-link${exists(unescapeHtml(t)) ? '' : ' missing'}" data-title="${t}">${(label || target).trim()}</a>`;
  });
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s](?:[^*\n]*[^*\s])?)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => codes[+i]);
}

/* ---------- Bloki ---------- */

const RE_TASK = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/;
const RE_UL = /^(\s*)[-*+]\s+(.*)$/;
const RE_OL = /^(\s*)\d+[.)]\s+(.*)$/;
const RE_HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const RE_TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

export const isListLine = (l) => RE_TASK.test(l) || RE_UL.test(l) || RE_OL.test(l);
export const indentOf = (l) => (l.match(/^[ \t]*/)[0].replace(/\t/g, '    ')).length;

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; }
    else if (s[i] === '|') { cells.push(cur.trim()); cur = ''; }
    else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

function renderTable(header, sep, rows, im) {
  const aligns = splitRow(sep).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''));
  const cell = (tag, c, i) => `<${tag}${aligns[i] ? ` style="text-align:${aligns[i]}"` : ''}>${im(c)}</${tag}>`;
  const head = splitRow(header).map((c, i) => cell('th', c, i)).join('');
  const body = rows.map((r) => {
    const cells = splitRow(r);
    return '<tr>' + aligns.map((_, i) => cell('td', cells[i] ?? '', i)).join('') + '</tr>';
  }).join('');
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function buildList(items, interactive) {
  let out = '';
  const stack = [];
  for (const it of items) {
    while (stack.length && it.indent < stack[stack.length - 1].indent) out += '</li></' + stack.pop().type + '>';
    const top = stack[stack.length - 1];
    if (!top || it.indent > top.indent) {
      out += `<${it.type}>`;
      stack.push({ indent: it.indent, type: it.type });
    } else {
      out += '</li>';
      if (top.type !== it.type) { out += `</${top.type}><${it.type}>`; top.type = it.type; }
    }
    if (it.task) {
      out += `<li class="task" data-line="${it.line}">${interactive ? '<span class="drag-handle" aria-label="Przeciągnij zadanie" title="Przeciągnij">⋮⋮</span>' : ''}` +
        `<input type="checkbox" data-line="${it.line}" ${it.checked ? 'checked' : ''}> <span class="${it.checked ? 'done' : ''}">${it.html}</span>`;
    } else {
      out += `<li data-line="${it.line}">${it.html}`;
    }
  }
  while (stack.length) out += '</li></' + stack.pop().type + '>';
  return out;
}

/**
 * @param {string} text
 * @param {{exists?: (title:string)=>boolean, interactive?: boolean}} opts
 */
export function renderMarkdown(text, { exists = () => true, interactive = false } = {}) {
  const im = (s) => inlineMd(s, exists);
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = [];
  const flushPara = () => { if (para.length) { out.push('<p>' + para.map(im).join('<br>') + '</p>'); para = []; } };
  const flushList = () => { if (list.length) { out.push(buildList(list, interactive)); list = []; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if ((m = line.match(/^\s*```\s*([\w+-]*)/))) {
      flushPara(); flushList();
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      out.push(`<pre><code${m[1] ? ` class="lang-${escapeHtml(m[1])}"` : ''}>${highlight(code.join('\n'), m[1])}</code></pre>`);
    } else if (/^\s*$/.test(line)) {
      flushPara(); flushList();
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flushPara(); flushList();
      out.push(`<h${m[1].length}>${im(m[2])}</h${m[1].length}>`);
    } else if (RE_HR.test(line)) {
      flushPara(); flushList();
      out.push('<hr>');
    } else if (line.includes('|') && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('|')) {
      flushPara(); flushList();
      const header = line, sep = lines[i + 1];
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(lines[i++]);
      i--;
      out.push(renderTable(header, sep, rows, im));
    } else if (/^\s*>/.test(line)) {
      flushPara(); flushList();
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      i--;
      out.push('<blockquote>' + q.map(im).join('<br>') + '</blockquote>');
    } else if ((m = line.match(RE_TASK))) {
      flushPara();
      list.push({ type: 'ul', indent: indentOf(m[1]), task: true, checked: m[2] !== ' ', html: im(m[3]), line: i });
    } else if ((m = line.match(RE_UL))) {
      flushPara();
      list.push({ type: 'ul', indent: indentOf(m[1]), html: im(m[2]), line: i });
    } else if ((m = line.match(RE_OL))) {
      flushPara();
      list.push({ type: 'ol', indent: indentOf(m[1]), html: im(m[2]), line: i });
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara(); flushList();
  return out.join('\n');
}

/* ---------- Operacje na listach (przeciąganie zadań, wcięcia) ---------- */

/** Zakres [start, end) linii elementu listy wraz z jego zagnieżdżonymi dziećmi. */
export function listBlockRange(lines, i) {
  const base = indentOf(lines[i]);
  let end = i + 1;
  while (end < lines.length && isListLine(lines[end]) && indentOf(lines[end]) > base) end++;
  return [i, end];
}

/**
 * Przenosi element listy (z dziećmi) z linii `from` przed/za element `to`.
 * Zwraca nowy tekst albo null, gdy ruch jest nieprawidłowy.
 */
export function moveListBlock(text, from, to, after) {
  const lines = String(text).split('\n');
  if (!lines[from] || !lines[to] || !isListLine(lines[from]) || !isListLine(lines[to])) return null;
  const [s, e] = listBlockRange(lines, from);
  if (to >= s && to < e) return null; // upuszczono na samego siebie / własne dzieci
  const [, tEnd] = listBlockRange(lines, to);
  let insertAt = after ? tEnd : to;
  const block = lines.slice(s, e);
  lines.splice(s, e - s);
  if (insertAt > s) insertAt -= block.length;
  lines.splice(insertAt, 0, ...block);
  return lines.join('\n');
}

/** Zmienia wcięcie linii w zakresie o `delta` spacji (+2 / −2). */
export function shiftIndent(text, selStart, selEnd, delta) {
  const start = text.lastIndexOf('\n', selStart - 1) + 1;
  let end = text.indexOf('\n', selEnd);
  if (end === -1) end = text.length;
  const lines = text.slice(start, end).split('\n').map((l) => {
    if (delta > 0) return '  '.repeat(delta / 2) + l;
    const lead = l.match(/^ */)[0].length;
    return l.slice(Math.min(lead, -delta));
  });
  const block = lines.join('\n');
  return { text: text.slice(0, start) + block + text.slice(end), start, end: start + block.length };
}
