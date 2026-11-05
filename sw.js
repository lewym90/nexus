// Service worker Nexus – działa pod dowolną ścieżką (np. GitHub Pages: /nexus/)
// Wszystkie aplikacje pod lewym90.github.io dzielą jedną pamięć podręczną i inne aplikacje potrafią ją czyścić.
// Dlatego: kasujemy wyłącznie własne wpisy (nexus-v*), a pliki mają kopię w osobnej bazie IndexedDB.
const CACHE_PREFIX = 'nexus-v';
const CACHE_NAME = CACHE_PREFIX + '7';
const MIRROR_DB = 'nexus-shell';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'js/main.js', 'js/util.js', 'js/storage.js', 'js/ui.js', 'js/state.js', 'js/db.js', 'js/markdown.js', 'js/nav.js',
  'js/actions.js', 'js/list.js', 'js/sidebar.js', 'js/editor.js', 'js/templates.js', 'js/io.js', 'js/graph.js', 'js/sync.js', 'js/syncui.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/icon-32.png',
  'icons/apple-touch-icon-120.png',
  'icons/apple-touch-icon-152.png',
  'icons/apple-touch-icon-167.png',
  'icons/apple-touch-icon.png'
];

function mirror(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(MIRROR_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('assets');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('assets', mode);
      const req = fn(tx.objectStore('assets'));
      tx.oncomplete = () => { db.close(); resolve(req.result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}

const assetKey = (url) => new URL(url).pathname;

async function remember(url, res) {
  const body = await res.clone().arrayBuffer();
  await mirror('readwrite', (s) => s.put({ body, type: res.headers.get('content-type') || '' }, assetKey(url)));
}

async function fromMirror(url) {
  try {
    const rec = await mirror('readonly', (s) => s.get(assetKey(url)));
    return rec ? new Response(rec.body, { headers: { 'Content-Type': rec.type } }) : null;
  } catch { return null; }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })));
    for (const u of ASSETS) {
      const res = await cache.match(u);
      if (res) await remember(new URL(u, self.location).href, res);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate: szybkie, działa offline, a aktualizacje docierają przy kolejnym uruchomieniu
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req, { ignoreSearch: true });
    const page = req.mode === 'navigate';
    const key = page ? new Request(new URL('./', self.location)) : req; // bez adresów z ?text=…: treść notatek nie trafia do pamięci
    const network = fetch(req).then(async (res) => {
      if (res && res.ok) { await cache.put(key, res.clone()); await remember(key.url, res).catch(() => {}); }
      return res;
    }).catch(() => null);
    if (cached) { event.waitUntil(network); return cached; }
    const saved = await fromMirror(key.url);
    if (saved) { event.waitUntil(network); return saved; } // inna aplikacja wyczyściła pamięć: kopia odtwarza się sama
    const res = await network;
    if (res) return res;
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
