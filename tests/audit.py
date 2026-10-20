"""Audyt układu i artefaktów wizualnych w wielu rozmiarach ekranu. Uruchom: python tests/audit.py
Opcjonalnie: CHROMIUM_PATH, SHOTS=katalog (zapis zrzutów ekranu)."""
import sys, threading, http.server, os, urllib.parse
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.environ.get('SHOTS')

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def translate_path(self, path):
        p = urllib.parse.urlparse(path).path
        if p.startswith('/nexus/'): p = p[len('/nexus'):]
        return os.path.join(ROOT, p.lstrip('/'))
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8767), Q); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = 'http://127.0.0.1:8767/nexus/'
res = []
def check(name, cond, extra=''):
    res.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (' :: ' + str(extra) if not cond and extra != '' else ''))

SIZES = {'iphone': (393, 852, True), 'iphone-se': (320, 568, True), 'iphone-landscape': (852, 393, True), 'ipad': (820, 1180, True), 'desktop': (1280, 800, False)}
LONG = '\n\n'.join(f'Akapit {i} z dłuższym tekstem, który zawija się w kilku liniach i wymusza przewijanie notatki.' for i in range(40))

def shot(pg, name):
    if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, name + '.png'))

def overflow(pg):
    return pg.evaluate('''() => {
      const W = window.innerWidth, bad = [];
      document.querySelectorAll('.app-header *, .main-content *, .sidebar *, .modal *').forEach(e => {
        const r = e.getBoundingClientRect();
        if (r.width && getComputedStyle(e).position !== 'fixed' && (r.right > W + 1 || r.left < -1) && !e.closest('.md-toolbar, .table-wrap, pre, .graph-wrap, .sidebar:not(.open)')) bad.push(e.className || e.tagName);
      });
      return bad.slice(0, 5);
    }''')

def shell(pg, K):
    r = pg.evaluate('''() => { const g = s => document.querySelector(s).getBoundingClientRect(); const H = window.innerHeight, W = window.innerWidth;
      return { H, W, mainBottom: g('.main-content').bottom, mainRight: g('.main-content').right, sideBottom: g('.sidebar').bottom, headerTop: g('.app-header').top,
               scrollable: document.documentElement.scrollHeight - H } }''')
    check(K + 'main fills to bottom edge', abs(r['mainBottom'] - r['H']) < 1, r)
    check(K + 'main fills to right edge', abs(r['mainRight'] - r['W']) < 1, r)
    check(K + 'sidebar fills to bottom edge', abs(r['sideBottom'] - r['H']) < 1, r)
    check(K + 'document scrollable by hidden spacer (>=40px)', r['scrollable'] >= 40, r)
    pg.evaluate('window.scrollTo(0, 60)'); pg.wait_for_timeout(80)
    moved = pg.evaluate('''() => ({ y: scrollY, h: document.querySelector('.app-header').getBoundingClientRect().top, m: document.querySelector('.main-content').getBoundingClientRect().top })''')
    check(K + 'UI stays anchored while document scrolls', moved['y'] > 0 and moved['h'] == 0 and moved['m'] > 0 and moved['m'] < 120, moved)
    pg.evaluate('window.scrollTo(0, 0)')

def run(name, W, H, touch):
    with sync_playwright() as p:
        b = p.chromium.launch(**({'executable_path': os.environ['CHROMIUM_PATH']} if os.environ.get('CHROMIUM_PATH') else {}))
        ctx = b.new_context(viewport={'width': W, 'height': H}, is_mobile=touch, has_touch=touch, device_scale_factor=2 if touch else 1)
        pg = ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append('PAGEERR ' + str(e)))
        pg.on('console', lambda m: errs.append('CONSOLE ' + m.text) if m.type == 'error' else None)
        pg.on('requestfailed', lambda r: errs.append('REQFAIL ' + r.url))
        pg.on('response', lambda r: errs.append(f'HTTP {r.status} {r.url}') if r.status >= 400 else None)
        K = name + ': '
        pg.goto(URL); pg.wait_for_selector('body[data-ready="1"]', state='attached'); pg.wait_for_timeout(500)
        check(K + 'splash removed', pg.locator('#splash').count() == 0)
        shell(pg, K); check(K + 'empty list: no overflow', not overflow(pg), overflow(pg)); shot(pg, f'{name}_empty')
        mobile = pg.evaluate('matchMedia("(max-width: 900px)").matches')

        # edytor – pusty: brak podpowiedzi markdown / licznika
        pg.click('#newNoteBtn'); pg.wait_for_selector('#editorView.active'); pg.wait_for_timeout(200)
        ph = pg.get_attribute('#noteContent', 'placeholder')
        check(K + 'no markdown hint in placeholder', ph == 'Zacznij pisać…' and '*' not in ph and '[[' not in ph, ph)
        check(K + 'word counter hidden when empty', not pg.is_visible('#wordCount'))
        shell(pg, K + 'editor '); check(K + 'editor empty: no overflow', not overflow(pg), overflow(pg)); shot(pg, f'{name}_editor_empty')

        # edytor – długa treść: nagłówek przyklejony
        pg.fill('#noteTitle', 'Bardzo długi tytuł notatki, który musi się zawinąć w kilku liniach na wąskim ekranie telefonu')
        pg.fill('#noteContent', LONG); pg.wait_for_timeout(1000)
        pg.evaluate('document.querySelector(".main-content").scrollTop = 600'); pg.wait_for_timeout(100)
        st = pg.evaluate('''() => { const s = document.querySelector('.editor-sticky').getBoundingClientRect(), m = document.querySelector('.main-content').getBoundingClientRect(); return { sTop: s.top, mTop: m.top } }''')
        check(K + 'editor header sticks to top while scrolling', 'landscape' in name or abs(st['sTop'] - st['mTop']) < 2, st)  # poziomo: celowo niesticky (za mało miejsca)
        check(K + 'long content: no overflow', not overflow(pg), overflow(pg)); shot(pg, f'{name}_editor_long')
        pg.evaluate('document.querySelector(".main-content").scrollTop = 0')
        pg.click('#previewToggle'); pg.wait_for_timeout(100); check(K + 'preview: no overflow', not overflow(pg), overflow(pg))
        pg.click('#previewToggle'); pg.click('#backBtn'); pg.wait_for_selector('#notesView.active'); pg.wait_for_timeout(400)

        # lista z notatkami, tryb listy, widok kosza, sidebar
        for t in ['Pierwsza', 'Druga z bardzo długą nazwą która się nie mieści w jednej linii na małym ekranie telefonu']:
            pg.fill('#quickInput', t); pg.press('#quickInput', 'Enter'); pg.wait_for_timeout(150)
        pg.wait_for_timeout(500); check(K + 'list: no overflow', not overflow(pg), overflow(pg)); shot(pg, f'{name}_list')
        title_clip = pg.evaluate('[...document.querySelectorAll(".note-card h3")].some(h => h.scrollWidth > h.clientWidth + 1)')
        check(K + 'card titles wrap (no clipping)', not title_clip)
        pg.click('.view-btn[data-layout=list]'); pg.wait_for_timeout(100); check(K + 'list layout: no overflow', not overflow(pg), overflow(pg)); pg.click('.view-btn[data-layout=grid]')
        if mobile:
            pg.click('#menuToggle'); pg.wait_for_timeout(450)
            check(K + 'sidebar: no overflow', not overflow(pg), overflow(pg)); shot(pg, f'{name}_sidebar')
            sb = pg.evaluate('(() => { const r = document.querySelector(".sidebar").getBoundingClientRect(); return [r.top, r.bottom, innerHeight] })()')
            check(K + 'sidebar reaches bottom edge', abs(sb[1] - sb[2]) < 1, sb)
            pg.click('#sidebarBackdrop', position={'x': W - 6, 'y': H // 2}); pg.wait_for_timeout(450)
        # graf
        pg.click('#graphBtn'); pg.wait_for_selector('#graphView.active'); pg.wait_for_timeout(300)
        g = pg.evaluate('''() => { const c = document.getElementById('graphCanvas').getBoundingClientRect(), m = document.querySelector('.main-content').getBoundingClientRect(); return { cb: c.bottom, mb: m.bottom, h: c.height } }''')
        check(K + 'graph canvas fits inside screen', g['cb'] <= g['mb'] + 1 and g['h'] > 150, g); check(K + 'graph: no overflow', not overflow(pg), overflow(pg)); shot(pg, f'{name}_graph')
        pg.click('#closeGraphBtn'); pg.wait_for_selector('#notesView.active')
        # kosz
        pg.locator('.note-card').first.click(); pg.wait_for_selector('#editorView.active'); pg.click('#deleteBtn'); pg.wait_for_selector('#notesView.active'); pg.wait_for_timeout(300)
        shot(pg, f'{name}_toast_undo')
        # okno modalne
        pg.click('#newWorkspaceBtn') if not mobile else None
        if not mobile:
            pg.wait_for_selector('.modal'); r = pg.evaluate('(() => { const r = document.querySelector(".modal").getBoundingClientRect(); return [r.left, r.right, r.top, r.bottom, innerWidth, innerHeight] })()')
            check(K + 'modal inside viewport', r[0] >= 0 and r[1] <= r[4] and r[2] >= 0 and r[3] <= r[5], r); pg.keyboard.press('Escape')
        # jasny motyw
        pg.click('#themeToggle'); pg.wait_for_timeout(150); shot(pg, f'{name}_light'); check(K + 'light theme: no overflow', not overflow(pg), overflow(pg))
        errs_f = [e for e in errs if 'PAGEERR' in e or 'CONSOLE' in e or 'REQFAIL' in e or 'HTTP 4' in e or 'HTTP 5' in e]
        check(K + 'no console/page/network errors', not errs_f, errs_f)
        b.close()

for n, (w, h, t) in SIZES.items(): run(n, w, h, t)
f = [n for n, ok in res if not ok]
print(f'\n{len(res) - len(f)}/{len(res)} passed'); print('FAILED:', f)
sys.exit(1 if f else 0)
