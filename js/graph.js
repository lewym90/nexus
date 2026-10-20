// Graf powiązań: układ siłowy, przesuwanie tła, przeciąganie węzłów, zoom (kółko / pinch), filtr po tagu.
import { state, hooks, wsNotes, isLive, DEFAULT_AURA } from './state.js';
import { $ } from './ui.js';
import { extractWikiTargets, plural } from './util.js';

let g = null; // { nodes, links, W, H, view:{x,y,k}, tag }
const MIN_K = 0.25, MAX_K = 4;

export const getGraph = () => g; // dla testów

export function layoutGraph(nodes, links, W, H) {
  const N = nodes.length;
  const R = Math.min(W, H) * 0.32;
  nodes.forEach((n, k) => {
    const ang = (k / Math.max(N, 1)) * Math.PI * 2;
    n.x = W / 2 + Math.cos(ang) * R * (0.6 + 0.4 * ((k * 7) % 5) / 4);
    n.y = H / 2 + Math.sin(ang) * R * (0.6 + 0.4 * ((k * 3) % 5) / 4);
    n.vx = 0; n.vy = 0;
  });
  const iterations = N > 300 ? 60 : 220;
  const k = Math.sqrt((W * H) / Math.max(N, 1)) * 0.7;
  for (let it = 0; it < iterations; it++) {
    const t = 1 - it / iterations;
    for (let x = 0; x < N; x++) {
      for (let y = x + 1; y < N; y++) {
        const a = nodes[x], b = nodes[y];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = ((x * 31 + y) % 7) - 3; dy = ((x * 17 + y) % 5) - 2; d2 = dx * dx + dy * dy || 1; }
        const d = Math.sqrt(d2);
        const f = (k * k) / d;
        a.vx += (dx / d) * f; a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
    }
    links.forEach(({ a, b }) => {
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = ((d * d) / k) * 0.6;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    });
    nodes.forEach((n) => {
      n.vx += (W / 2 - n.x) * 0.9; n.vy += (H / 2 - n.y) * 0.9;
      const len = Math.sqrt(n.vx * n.vx + n.vy * n.vy) || 1;
      const lim = Math.min(len, 30 * t + 2);
      n.x += (n.vx / len) * lim; n.y += (n.vy / len) * lim;
      n.vx = 0; n.vy = 0;
    });
  }
}

/** Buduje węzły i krawędzie dla bieżącej przestrzeni (bez archiwum i kosza), opcjonalnie tylko z danym tagiem. */
export function buildGraphData(notes, tag) {
  const t = tag ? tag.toLowerCase() : null;
  const list = notes.filter((n) => !t || n.tags.some((x) => x.toLowerCase() === t));
  const byTitle = new Map();
  list.forEach((n) => { const key = (n.title || '').trim().toLowerCase(); if (key && !byTitle.has(key)) byTitle.set(key, n); });
  const nodes = list.map((n) => ({ id: n.id, title: n.title || 'Bez tytułu', aura: n.aura, deg: 0 }));
  const index = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set();
  const links = [];
  list.forEach((n) => {
    extractWikiTargets(n.content).forEach((target) => {
      const to = byTitle.get(target.toLowerCase());
      if (!to || to.id === n.id) return;
      const key = n.id < to.id ? n.id + '|' + to.id : to.id + '|' + n.id;
      if (seen.has(key)) return;
      seen.add(key);
      const a = index.get(n.id), b = index.get(to.id);
      links.push({ a, b });
      a.deg++; b.deg++;
    });
  });
  nodes.forEach((n) => { n.r = 9 + Math.min(n.deg, 8) * 2; });
  return { nodes, links };
}

function fitView() {
  const { nodes, W, H } = g;
  if (!nodes.length) { g.view = { x: 0, y: 0, k: 1 }; return; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  nodes.forEach((n) => { x0 = Math.min(x0, n.x - n.r - 60); x1 = Math.max(x1, n.x + n.r + 60); y0 = Math.min(y0, n.y - n.r - 12); y1 = Math.max(y1, n.y + n.r + 30); });
  const k = Math.max(MIN_K, Math.min(MAX_K, 1.2, Math.min(W / (x1 - x0), H / (y1 - y0))));
  g.view = { k, x: W / 2 - ((x0 + x1) / 2) * k, y: H / 2 - ((y0 + y1) / 2) * k };
}

function canvasSize() {
  const rect = $('graphCanvas').getBoundingClientRect();
  return { W: Math.max(200, Math.round(rect.width)), H: Math.max(240, Math.round(rect.height)) };
}

function fillTagSelect() {
  const sel = $('graphTag');
  const counts = new Map();
  wsNotes().filter(isLive).forEach((n) => n.tags.forEach((t) => { const k = t.toLowerCase(); counts.set(k, counts.get(k) || { name: t, c: 0 }); counts.get(k).c++; }));
  const cur = g && g.tag ? g.tag : '';
  sel.innerHTML = '<option value="">Wszystkie tagi</option>' +
    [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, 'pl')).map((t) => `<option value="${t.name.replace(/"/g, '&quot;')}">#${t.name.replace(/</g, '&lt;')} (${t.c})</option>`).join('');
  sel.value = cur;
  if (sel.value !== cur) sel.value = '';
}

/** Przelicza układ (po wejściu do grafu, zmianie filtra, rozmiaru okna). */
export function rebuildGraph(tag) {
  const { W, H } = canvasSize();
  const keepTag = tag !== undefined ? tag : g ? g.tag : '';
  const data = buildGraphData(wsNotes().filter(isLive), keepTag);
  layoutGraph(data.nodes, data.links, W, H);
  g = { ...data, W, H, view: { x: 0, y: 0, k: 1 }, tag: keepTag };
  fitView();
  fillTagSelect();
  drawGraph();
}

export function drawGraph() {
  if (!g) return;
  const canvas = $('graphCanvas');
  const { W, H } = canvasSize();
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  g.W = W; g.H = H;
  const ctx = canvas.getContext('2d');
  const css = getComputedStyle(document.body);
  const text = css.getPropertyValue('--text').trim() || '#f0f2f5';
  const muted = css.getPropertyValue('--text-muted').trim() || '#8a929e';
  const surface = css.getPropertyValue('--bg').trim() || '#0c0e12';
  const { nodes, links, view } = g;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!nodes.length) {
    ctx.fillStyle = muted; ctx.font = '15px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(g.tag ? 'Brak notatek z tym tagiem' : 'Brak notatek w tej przestrzeni', W / 2, H / 2);
  }
  ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.x, dpr * view.y);
  ctx.lineWidth = 1.5 / view.k;
  ctx.strokeStyle = 'rgba(59,130,246,0.45)';
  links.forEach(({ a, b }) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); });
  nodes.forEach((n) => {
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fillStyle = surface;
    ctx.fill();
    ctx.lineWidth = (n.deg ? 3 : 2) / view.k;
    ctx.strokeStyle = n.aura || DEFAULT_AURA;
    ctx.globalAlpha = n.deg ? 1 : 0.6;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (view.k > 0.45) {
      ctx.fillStyle = text;
      ctx.font = `${12 / view.k}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(n.title.length > 18 ? n.title.slice(0, 17) + '…' : n.title, n.x, n.y + n.r + 14 / view.k);
    }
  });
  $('graphInfo').textContent = `${nodes.length} ${plural(nodes.length, 'notatka', 'notatki', 'notatek')} · ${links.length} ${plural(links.length, 'powiązanie', 'powiązania', 'powiązań')} — dotknij węzła, aby otworzyć; przeciągnij tło lub węzeł; zoom: pinch / kółko`;
}

function toWorld(sx, sy) { return { x: (sx - g.view.x) / g.view.k, y: (sy - g.view.y) / g.view.k }; }

function hit(sx, sy) {
  if (!g) return null;
  const w = toWorld(sx, sy);
  let best = null, bd = Infinity;
  g.nodes.forEach((n) => {
    const d = Math.hypot(n.x - w.x, n.y - w.y);
    if (d <= n.r + 12 / g.view.k && d < bd) { best = n; bd = d; }
  });
  return best;
}

function zoomAt(sx, sy, factor) {
  const v = g.view;
  const k = Math.max(MIN_K, Math.min(MAX_K, v.k * factor));
  const f = k / v.k;
  v.x = sx - (sx - v.x) * f;
  v.y = sy - (sy - v.y) * f;
  v.k = k;
  drawGraph();
}

export function initGraph() {
  const canvas = $('graphCanvas');
  const pointers = new Map();
  let drag = null; // { node } | { pan:true }
  let start = null; // { x, y, t, node }
  let pinch = null;

  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  canvas.addEventListener('pointerdown', (e) => {
    if (!g) return;
    canvas.setPointerCapture(e.pointerId);
    const p = pos(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      drag = null; start = null;
      return;
    }
    const node = hit(p.x, p.y);
    start = { x: p.x, y: p.y, t: Date.now(), node, moved: false };
    drag = node ? { node } : { pan: true };
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!g) return;
    const p = pos(e);
    if (!pointers.has(e.pointerId)) { canvas.style.cursor = hit(p.x, p.y) ? 'pointer' : 'grab'; return; }
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      g.view.x += mx - pinch.mx; g.view.y += my - pinch.my;
      zoomAt(mx, my, d / pinch.d);
      pinch = { d, mx, my };
      return;
    }
    if (!drag || !start) return;
    if (!start.moved && Math.hypot(p.x - start.x, p.y - start.y) > 6) start.moved = true;
    if (!start.moved) return;
    if (drag.node) {
      drag.node.x += (p.x - prev.x) / g.view.k;
      drag.node.y += (p.y - prev.y) / g.view.k;
    } else {
      g.view.x += p.x - prev.x;
      g.view.y += p.y - prev.y;
    }
    drawGraph();
  });

  const end = (e) => {
    const wasPinch = pointers.size === 2;
    pointers.delete(e.pointerId);
    if (wasPinch) { pinch = null; drag = null; start = null; return; }
    if (start && !start.moved && start.node && e.type === 'pointerup' && Date.now() - start.t < 600) hooks.openNote(start.node.id);
    drag = null; start = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  canvas.addEventListener('wheel', (e) => {
    if (!g) return;
    e.preventDefault();
    const p = pos(e);
    zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  $('graphZoomIn').addEventListener('click', () => g && zoomAt(g.W / 2, g.H / 2, 1.3));
  $('graphZoomOut').addEventListener('click', () => g && zoomAt(g.W / 2, g.H / 2, 1 / 1.3));
  $('graphFit').addEventListener('click', () => { if (g) { fitView(); drawGraph(); } });
  $('graphRelayout').addEventListener('click', () => rebuildGraph());
  $('graphTag').addEventListener('change', (e) => rebuildGraph(e.target.value));

  let t;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => { if (state.currentScreen === 'graph') { const keep = g && g.tag; rebuildGraph(keep || ''); } }, 150);
  });
}
