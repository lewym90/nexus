// Serwer synchronizacji Nexus. Bez zależności. Przechowuje wyłącznie zaszyfrowane bajty: klucza nie zna.
// Elementy: DATA_DIR/data/<klucz>, spis w DATA_DIR/index.json, kopie dzienne w DATA_DIR/backups/RRRR-MM-DD.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, unlinkSync, linkSync, readdirSync, rmSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';

const { PORT = '18872', TOKEN, ALLOWED_ORIGIN = 'https://lewym90.github.io', DATA_DIR = './data', KEEP_DAYS = '30', MAX_BYTES = String(30 * 1024 * 1024) } = process.env;
if (!TOKEN) { console.error('Brak zmiennej TOKEN'); process.exit(1); }

const DATA = join(DATA_DIR, 'data'), BACKUPS = join(DATA_DIR, 'backups'), INDEX = join(DATA_DIR, 'index.json');
mkdirSync(DATA, { recursive: true });
mkdirSync(BACKUPS, { recursive: true });
const db = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : { rev: 0, items: {} };

function atomic(path, content) {
  writeFileSync(`${path}.tmp`, content);
  renameSync(`${path}.tmp`, path); // stary plik zostaje nietknięty w kopiach (twarde dowiązania)
}
const saveIndex = () => atomic(INDEX, JSON.stringify(db));
const listing = (index, since) => Object.entries(index.items).filter(([, e]) => e.r > since).sort((a, b) => a[1].r - b[1].r).map(([k, e]) => ({ k, r: e.r, v: e.v, d: e.d ? 1 : 0 }));

/** Kopia dzienna: twarde dowiązania, więc nie zajmuje miejsca na niezmienione elementy. */
export function backup(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const dir = join(BACKUPS, day);
  const days = readdirSync(BACKUPS).sort();
  const lastDay = days[days.length - 1];
  const lastRev = lastDay ? JSON.parse(readFileSync(join(BACKUPS, lastDay, 'index.json'), 'utf8')).rev : 0;
  if (db.rev > lastRev && !existsSync(dir)) {
    const tmp = `${dir}.tmp`;
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(join(tmp, 'data'), { recursive: true });
    for (const [k, e] of Object.entries(db.items)) if (!e.d) linkSync(join(DATA, k), join(tmp, 'data', k));
    writeFileSync(join(tmp, 'index.json'), JSON.stringify(db));
    renameSync(tmp, dir);
  }
  const limit = new Date(now.getTime() - Number(KEEP_DAYS) * 86400000).toISOString().slice(0, 10);
  for (const d of readdirSync(BACKUPS)) if (d < limit) rmSync(join(BACKUPS, d), { recursive: true, force: true });
}

const same = (a = '', b = '') => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const VALID_KEY = /^[nbm]-[\w-]{1,120}$/, VALID_DAY = /^\d{4}-\d{2}-\d{2}$/;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > Number(MAX_BYTES)) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const cors = { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 'Access-Control-Allow-Headers': 'X-Token, Content-Type', 'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS', Vary: 'Origin' };
  const send = (code, obj = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...cors }); res.end(JSON.stringify(obj)); };
  const sendFile = (path) => { if (!existsSync(path)) return send(404, { error: 'not found' }); res.writeHead(200, { 'Content-Type': 'application/octet-stream', ...cors }); res.end(readFileSync(path)); };
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    if (req.method === 'OPTIONS') return send(204);
    if (req.method === 'GET' && url.pathname === '/health') return send(200, { ok: true });
    if (!same(req.headers['x-token'], TOKEN)) return send(401, { error: 'unauthorized' });

    if (req.method === 'GET' && url.pathname === '/changes') return send(200, { rev: db.rev, items: listing(db, Number(url.searchParams.get('since')) || 0) });

    if (parts[0] === 'item' && parts.length === 2 && VALID_KEY.test(parts[1])) {
      const k = parts[1], path = join(DATA, k), cur = db.items[k];
      if (req.method === 'GET') return cur && !cur.d ? sendFile(path) : send(404, { error: 'not found' });
      const v = Number(url.searchParams.get('v'));
      if (!Number.isFinite(v) || v <= 0) return send(400, { error: 'bad version' });
      if (req.method === 'PUT' || req.method === 'DELETE') {
        const body = req.method === 'PUT' ? await readBody(req) : null;
        if (cur && v < cur.v) return send(409, { v: cur.v });
        if (cur && v === cur.v) return send(200, { r: cur.r });
        if (body) atomic(path, body); else if (existsSync(path)) unlinkSync(path);
        db.items[k] = { r: ++db.rev, v, ...(body ? {} : { d: 1 }) };
        saveIndex();
        return send(200, { r: db.rev });
      }
    }

    if (req.method === 'GET' && parts[0] === 'backups') {
      if (parts.length === 1) return send(200, { days: readdirSync(BACKUPS).filter((d) => VALID_DAY.test(d)).sort().reverse() });
      if (VALID_DAY.test(parts[1]) && existsSync(join(BACKUPS, parts[1]))) {
        if (parts[2] === 'index') return send(200, { items: listing(JSON.parse(readFileSync(join(BACKUPS, parts[1], 'index.json'), 'utf8')), 0).filter((e) => !e.d) });
        if (parts[2] === 'item' && VALID_KEY.test(parts[3] || '')) return sendFile(join(BACKUPS, parts[1], 'data', parts[3]));
      }
    }
    return send(404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(e.message === 'too large' ? 413 : 500, { error: 'server error' });
  }
});

server.listen(Number(PORT), '127.0.0.1', () => {
  console.log(`Nexus sync: port ${PORT}`);
  backup();
  setInterval(() => { try { backup(); } catch (e) { console.error('Kopia:', e); } }, 3600000);
});
