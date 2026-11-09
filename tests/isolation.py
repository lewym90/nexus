"""Nexus obok innych aplikacji na tym samym adresie: nie kasuje cudzych danych i przeżywa czyszczenie pamięci przez inne aplikacje."""
import sys, threading, http.server, os, urllib.parse
from playwright.sync_api import sync_playwright
import start_notes  # noqa: F401  (start od listy notatek)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def translate_path(self, path):
        p = urllib.parse.urlparse(path).path
        if p.startswith('/nexus/'): p = p[len('/nexus'):]
        return os.path.join(ROOT, p.lstrip('/'))
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Q); threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{srv.server_address[1]}'; URL = BASE + '/nexus/'
res = []
def check(name, cond, extra=''):
    res.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (' :: ' + str(extra) if not cond else ''))

with sync_playwright() as p:
    b = p.chromium.launch(**({'executable_path': os.environ['CHROMIUM_PATH']} if os.environ.get('CHROMIUM_PATH') else {}))
    ctx = b.new_context(); pg = ctx.new_page()
    pg.goto(BASE + '/LICENSE-nie-ma')  # strona innej aplikacji na tym samym adresie
    pg.evaluate('caches.open("kalendarz-v9").then(c => c.put("/kalendarz/x", new Response("cudze")))')
    pg.evaluate('localStorage.setItem("kalendarz", "cudze")')
    pg.goto(URL); pg.wait_for_selector('body[data-ready="1"]', state='attached')
    pg.evaluate('navigator.serviceWorker.ready.then(() => true)'); pg.wait_for_timeout(800)
    check('instalacja Nexusa nie rusza cudzej pamięci', 'kalendarz-v9' in pg.evaluate('caches.keys()'))
    pg.evaluate('(async () => { const c = await caches.open("nexus-v1"); await c.put("/nexus/stary", new Response("x")); })()')
    pg.evaluate('navigator.serviceWorker.getRegistration().then(r => r.update())'); pg.wait_for_timeout(300)
    pg.fill('#quickInput', 'Ważna notatka'); pg.press('#quickInput', 'Enter'); pg.wait_for_timeout(400)
    pg.goto(URL + '?text=tajna%20tresc'); pg.wait_for_selector('body[data-ready="1"]', state='attached'); pg.wait_for_timeout(500)
    urls = pg.evaluate('(async () => { const out = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(r.url); return out; })()')
    check('adresy z treścią nie trafiają do pamięci', not [u for u in urls if 'tajna' in u], urls)
    # inna aplikacja przy aktualizacji kasuje wszystko poza sobą
    pg.evaluate('caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k))))')
    ctx.set_offline(True); pg.reload(); pg.wait_for_selector('.note-card', timeout=6000)
    check('start offline po wyczyszczeniu pamięci przez inną aplikację', pg.locator('.note-card:has-text("Ważna notatka")').count() == 1)
    check('notatki nietknięte', pg.evaluate('nexus.state.notes.length') == 2)
    ctx.set_offline(False); pg.reload(); pg.wait_for_selector('.note-card'); pg.wait_for_timeout(600)
    check('pamięć odbudowana po powrocie sieci', len(pg.evaluate('caches.keys()')) >= 1)
    check('własne klucze localStorage z prefiksem', all(k.startswith('nexus-') or k == 'kalendarz' for k in pg.evaluate('Object.keys(localStorage)')))
    b.close()
f = [n for n, ok in res if not ok]
print(f'\n{len(res) - len(f)}/{len(res)} passed'); print('FAILED:', f)
sys.exit(1 if f else 0)
