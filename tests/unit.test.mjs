import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as U from '../js/util.js';
import { renderMarkdown, highlight, moveListBlock, shiftIndent, listBlockRange, isListLine } from '../js/markdown.js';
import { buildGraphData, layoutGraph } from '../js/graph.js';

/* ---------- util ---------- */
test('escapeHtml escapes all dangerous characters', () => {
  assert.equal(U.escapeHtml(`<img src="x" onerror='a'>&`), '&lt;img src=&quot;x&quot; onerror=&#39;a&#39;&gt;&amp;');
  assert.equal(U.escapeHtml(null), '');
  assert.equal(U.unescapeHtml(U.escapeHtml('<a href="x">&</a>')), '<a href="x">&</a>');
});

test('plural (polski)', () => {
  assert.deepEqual([1, 2, 5, 12, 22, 25].map((n) => U.plural(n, 'a', 'b', 'c')), ['a', 'b', 'c', 'c', 'b', 'c']);
});

test('parseTags: dedupe, trim, strip #', () => {
  assert.deepEqual(U.parseTags('#praca, projekt, Praca ,, '), ['praca', 'projekt']);
});

test('extractWikiTargets handles aliases', () => {
  assert.deepEqual(U.extractWikiTargets('a [[Druga]] b [[Trzecia|alias]] [[ ]]'), ['Druga', 'Trzecia']);
});

test('deriveQuickNote', () => {
  assert.deepEqual(U.deriveQuickNote('Kup mleko'), { title: 'Kup mleko', content: '' });
  assert.equal(U.deriveQuickNote('   '), null);
  const long = U.deriveQuickNote('# Nagłówek\nreszta tekstu');
  assert.equal(long.title, 'Nagłówek');
  assert.equal(long.content, '# Nagłówek\nreszta tekstu');
  const t = U.deriveQuickNote('x'.repeat(100));
  assert.ok(t.title.endsWith('…') && t.title.length === 60 && t.content.length === 100);
});

test('plainPreview strips markdown', () => {
  assert.equal(U.plainPreview('# T\n- [ ] zad **gruby** [[Link|alias]] `k`\n| a | b |\n|---|---|'), 'T zad gruby alias k a b');
});

test('todayStr / formatDate', () => {
  assert.equal(U.todayStr(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(U.formatDate(1000, 1000 + 30000), 'przed chwilą');
  assert.equal(U.formatDate(0), '');
});

test('keyboardMetrics: otwarta klawiatura także przy przesunięciu widoku', () => {
  assert.deepEqual(U.keyboardMetrics(932, 932, 0), { open: false, kb: 0, top: 0 });
  assert.deepEqual(U.keyboardMetrics(932, 900, 0), { open: false, kb: 0, top: 0 });
  assert.deepEqual(U.keyboardMetrics(932, 596, 0), { open: true, kb: 336, top: 0 });
  assert.deepEqual(U.keyboardMetrics(932, 596, 336), { open: true, kb: 0, top: 336 }); // pełne przesunięcie – przed poprawką: „zamknięta”
  assert.deepEqual(U.keyboardMetrics(932, 596, 100), { open: true, kb: 236, top: 100 });
});

test('backupDue: przypomina tylko o niezabezpieczonych zmianach', () => {
  const day = 86400000, now = 100 * day;
  const old = { created: 80 * day, updated: 80 * day };
  assert.equal(U.backupDue({ notes: [], now }), false);
  assert.equal(U.backupDue({ notes: [{ created: now - day, updated: now - day }], now }), false); // świeża baza
  assert.equal(U.backupDue({ notes: [old], now }), true); // brak kopii od 20 dni
  assert.equal(U.backupDue({ notes: [old], lastBackup: 90 * day, now }), false); // nic się nie zmieniło
  assert.equal(U.backupDue({ notes: [{ created: 1, updated: 96 * day }], lastBackup: 95 * day, now }), false); // za wcześnie
  assert.equal(U.backupDue({ notes: [{ created: 1, updated: 95 * day }], lastBackup: 92 * day, now, days: 7 }), true);
  assert.equal(U.backupDue({ notes: [old], snoozeUntil: now + 1, now }), false);
});

test('backupAge', () => {
  const day = 86400000;
  assert.deepEqual([0, 10 * day, 10 * day - day].map((x) => U.backupAge(x, 10.5 * day)), ['nigdy', 'dzisiaj', 'wczoraj']);
  assert.equal(U.backupAge(day, 10.5 * day), '9 dni temu');
});

test('parseSyncCode', () => {
  const s = 'ab'.repeat(32);
  assert.deepEqual(U.parseSyncCode(` https://1-2-3-4.sslip.io/nexus-sync#${s}\n`), { url: 'https://1-2-3-4.sslip.io/nexus-sync', secret: s });
  assert.equal(U.parseSyncCode('https://a.pl/x'), null);
  assert.equal(U.parseSyncCode('https://a.pl/x#krotki'), null);
  assert.equal(U.parseSyncCode(''), null);
});

test('encodeKey / decodeKey i hashText', () => {
  for (const id of ['legacy1', 'mh2x9a1b2', 'zażółć/../gęś']) {
    const k = U.encodeKey('n-', id);
    assert.match(k, /^n-[0-9a-f]+$/);
    assert.equal(U.decodeKey(k), id);
  }
  assert.equal(U.hashText('abc'), U.hashText('abc'));
  assert.notEqual(U.hashText('abc'), U.hashText('abd'));
});

/* ---------- markdown ---------- */
test('markdown never lets raw HTML through', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)> **b** [x](javascript:alert(1)) [ok](https://a.pl)');
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('href="javascript'));
  assert.ok(html.includes('<strong>b</strong>'));
  assert.ok(html.includes('href="https://a.pl" target="_blank" rel="noopener noreferrer"'));
});

test('markdown: headings, hr, quote, inline', () => {
  const html = renderMarkdown('# H1\n\n## H2\n\n---\n\n> cytat\n\n*kurs* ~~x~~ `a<b`');
  for (const s of ['<h1>H1</h1>', '<h2>H2</h2>', '<hr>', '<blockquote>cytat</blockquote>', '<em>kurs</em>', '<del>x</del>', '<code>a&lt;b</code>']) assert.ok(html.includes(s), s);
});

test('markdown: nested lists', () => {
  const html = renderMarkdown('- a\n  - b\n    - c\n- d');
  assert.equal(html.replace(/ data-line="\d+"/g, ''), '<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li><li>d</li></ul>');
});

test('markdown: ordered + mixed list types', () => {
  const html = renderMarkdown('1. a\n2. b\n- c');
  assert.ok(html.includes('<ol>') && html.includes('</ol><ul>'));
});

test('markdown: tasks carry line numbers and handles when interactive', () => {
  const html = renderMarkdown('x\n- [ ] a\n- [x] b', { interactive: true });
  assert.ok(html.includes('data-line="1"') && html.includes('data-line="2"'));
  assert.ok(html.includes('drag-handle') && html.includes('checked'));
  assert.ok(!renderMarkdown('- [ ] a').includes('drag-handle'));
});

test('markdown: tables with alignment and escaped pipe', () => {
  const html = renderMarkdown('| A | B |\n|:--|--:|\n| 1 | x\\|y |');
  assert.ok(html.includes('<th style="text-align:left">A</th>') && html.includes('<th style="text-align:right">B</th>'));
  assert.ok(html.includes('x|y'));
  // zwykły tekst z pionową kreską to nie tabela
  assert.ok(!renderMarkdown('a | b\nc').includes('<table'));
});

test('markdown: wiki links mark missing notes', () => {
  const html = renderMarkdown('[[Jest]] [[Brak|etykieta]]', { exists: (t) => t === 'Jest' });
  assert.ok(html.includes('class="wiki-link" data-title="Jest"'));
  assert.ok(html.includes('class="wiki-link missing" data-title="Brak">etykieta'));
});

test('highlight: tokens and escaping', () => {
  const h = highlight('const a = "<b>"; // x\nlet n = 42', 'js');
  assert.ok(h.includes('<span class="tok-k">const</span>'));
  assert.ok(h.includes('<span class="tok-s">&quot;&lt;b&gt;&quot;</span>'));
  assert.ok(h.includes('<span class="tok-c">// x</span>'));
  assert.ok(h.includes('<span class="tok-n">42</span>'));
  assert.equal(highlight('<i>', 'unknown'), '&lt;i&gt;');
  assert.ok(highlight('SELECT * FROM t', 'sql').includes('<span class="tok-k">SELECT</span>'));
  assert.ok(highlight('<div class="a">', 'html').includes('tok-t'));
});

test('list ops: isListLine / listBlockRange', () => {
  assert.ok(isListLine('  - a') && isListLine('1. a') && !isListLine('tekst'));
  assert.deepEqual(listBlockRange(['- a', '  - a1', '    - a11', '- b'], 0), [0, 3]);
});

test('moveListBlock moves item with children', () => {
  const text = '- a\n  - a1\n- b\n- c';
  assert.equal(moveListBlock(text, 0, 3, true), '- b\n- c\n- a\n  - a1');
  assert.equal(moveListBlock(text, 3, 0, false), '- c\n- a\n  - a1\n- b');
  assert.equal(moveListBlock(text, 0, 1, true), null); // na własne dziecko
  assert.equal(moveListBlock(text, 0, 0, true), null);
  assert.equal(moveListBlock('x\n- a', 0, 1, true), null);
});

test('moveListBlock keeps text before/after list intact', () => {
  assert.equal(moveListBlock('P\n- [ ] 1\n- [ ] 2\n- [ ] 3\nK', 3, 1, false), 'P\n- [ ] 3\n- [ ] 1\n- [ ] 2\nK');
});

test('shiftIndent indents and outdents selected lines', () => {
  assert.equal(shiftIndent('- a\n- b', 4, 4, 2).text, '- a\n  - b');
  assert.equal(shiftIndent('- a\n  - b', 4, 6, -2).text, '- a\n- b');
  assert.equal(shiftIndent('- a\n- b', 0, 7, 2).text, '  - a\n  - b');
  assert.equal(shiftIndent('- a', 0, 0, -2).text, '- a');
});

/* ---------- graf ---------- */
const mk = (id, title, content = '', tags = []) => ({ id, title, content, tags, aura: '#3b82f6' });

test('buildGraphData: links, dedupe, self-links, tag filter', () => {
  const notes = [mk('1', 'A', '[[B]] [[b]] [[A]]', ['x']), mk('2', 'B', '[[A]]', ['x']), mk('3', 'C', '[[Nie ma]]', ['y'])];
  const all = buildGraphData(notes, '');
  assert.equal(all.nodes.length, 3);
  assert.equal(all.links.length, 1); // A–B tylko raz, bez pętli i bez nieistniejących
  assert.equal(all.nodes.find((n) => n.id === '1').deg, 1);
  const x = buildGraphData(notes, 'X');
  assert.deepEqual(x.nodes.map((n) => n.id), ['1', '2']);
  assert.equal(buildGraphData(notes, 'zzz').nodes.length, 0);
});

test('layoutGraph keeps nodes finite and separated', () => {
  const notes = Array.from({ length: 12 }, (_, i) => mk(String(i), 'N' + i, i ? `[[N${i - 1}]]` : ''));
  const { nodes, links } = buildGraphData(notes, '');
  layoutGraph(nodes, links, 800, 600);
  for (const n of nodes) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y));
  const minD = Math.min(...nodes.flatMap((a, i) => nodes.slice(i + 1).map((b) => Math.hypot(a.x - b.x, a.y - b.y))));
  assert.ok(minD > 5, 'węzły nie nakładają się: ' + minD);
});
