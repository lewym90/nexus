"""Symulacja klawiatury iOS: podstawiony window.visualViewport (Chromium go nie przesuwa jak Safari).
Sprawdza, że przy otwartej klawiaturze tytuł, pasek formatowania i kursor są widoczne, także gdy iOS przesunie widok.
Uruchom: python tests/keyboard.py  (katalog repo można podać jako argument; opcjonalnie CHROMIUM_PATH)"""
import sys, threading, http.server, os, functools
from playwright.sync_api import sync_playwright
import start_notes  # noqa: F401  (start od listy notatek)
ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Q, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_address[1]}/'
res = []
def check(name, cond, extra=''):
    res.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (' :: ' + str(extra) if not cond else ''))

W, H, VISIBLE = 430, 932, 596
FAKE = '''(() => { const v = new EventTarget(); Object.assign(v, { height: innerHeight, width: innerWidth, offsetTop: 0, offsetLeft: 0, scale: 1 });
  Object.defineProperty(window, 'visualViewport', { value: v });
  window.__kb = (h, top) => { v.height = h; v.offsetTop = top; v.dispatchEvent(new Event('resize')); v.dispatchEvent(new Event('scroll')); }; })()'''
LONG = '\n'.join(f'Linia {i} treści notatki' for i in range(120))

def layout(pg):
    return pg.evaluate('''() => { const g = id => document.getElementById(id).getBoundingClientRect(); const cs = getComputedStyle(document.documentElement);
      const t = document.getElementById('noteContent');
      return { vvTop: cs.getPropertyValue('--vv-top'), kb: cs.getPropertyValue('--kb'), open: document.documentElement.classList.contains('kb-open'),
        titleTop: g('noteTitle').top, toolTop: g('mdToolbar').top, taTop: g('noteContent').top, taBottom: g('noteContent').bottom, taH: t.clientHeight, sc: t.scrollTop, sh: t.scrollHeight,
        spacer: getComputedStyle(document.querySelector('.scroll-spacer')).display, meta: getComputedStyle(document.querySelector('.editor-meta')).display } }''')

with sync_playwright() as p:
    b = p.chromium.launch(**({'executable_path': os.environ['CHROMIUM_PATH']} if os.environ.get('CHROMIUM_PATH') else {}))
    ctx = b.new_context(viewport={'width': W, 'height': H}, is_mobile=True, has_touch=True, device_scale_factor=2)
    pg = ctx.new_page(); pg.add_init_script(FAKE)
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_selector('body[data-ready="1"]', state='attached')
    pg.evaluate(f'__kb({H}, 0)')
    pg.click('#newNoteBtn'); pg.fill('#noteTitle', 'Klawiatura'); pg.fill('#noteContent', LONG); pg.wait_for_timeout(1000)

    # kursor na końcu długiej notatki, iOS podnosi klawiaturę i przesuwa widok
    pg.evaluate('(() => { const t = document.getElementById("noteContent"); t.focus(); t.setSelectionRange(t.value.length, t.value.length); })()')
    for top in (0, VISIBLE // 2, H - VISIBLE):  # bez przesunięcia, częściowe, pełne
        pg.evaluate(f'__kb({VISIBLE}, {top})'); pg.wait_for_timeout(120)
        r = layout(pg); K = f'offset {top}: '
        check(K + 'klawiatura wykryta', r['open'], r)
        check(K + '--vv-top podąża za widokiem', r['vvTop'] == f'{top}px', r)
        check(K + 'tytuł widoczny', top <= r['titleTop'] < top + VISIBLE, r)
        check(K + 'pasek formatowania widoczny', top < r['toolTop'] < top + VISIBLE, r)
        check(K + 'pole kończy się nad klawiaturą', r['taBottom'] <= top + VISIBLE + 1, r)
        check(K + 'pole ma sensowną wysokość', r['taH'] > 200, r)
        check(K + 'kursor (koniec tekstu) w polu widzenia', r['sc'] + r['taH'] + 40 >= r['sh'], r)
        check(K + 'dokument nie przewija się', r['spacer'] == 'none' and r['meta'] == 'none', r)
        pg.evaluate(f'__kb({H}, 0)'); pg.evaluate('document.getElementById("noteContent").blur()'); pg.wait_for_timeout(120)
        pg.evaluate('(() => { const t = document.getElementById("noteContent"); t.scrollTop = 0; t.focus(); })()')

    # zamknięcie klawiatury przywraca układ
    pg.evaluate(f'__kb({H}, 0)'); pg.evaluate('document.getElementById("noteContent").blur()'); pg.wait_for_timeout(150)
    r = layout(pg)
    check('zamknięcie: układ wraca', not r['open'] and r['spacer'] != 'none' and r['meta'] != 'none' and r['kb'] == '0px', r)
    check('zamknięcie: nagłówek aplikacji wraca', pg.is_visible('.app-header'))

    # pole tagów pod treścią: widoczne nad klawiaturą, edytor pozostaje przewijalny
    pg.focus('#tagsInput'); pg.evaluate(f'__kb({VISIBLE}, 0)'); pg.wait_for_timeout(150)
    y = pg.evaluate('document.getElementById("tagsInput").getBoundingClientRect().bottom')
    check('tagi widoczne nad klawiaturą', 0 < y <= VISIBLE, y)
    pg.evaluate(f'__kb({H}, 0)'); pg.evaluate('document.getElementById("tagsInput").blur()'); pg.wait_for_timeout(120)

    # powiększenie palcami to nie klawiatura
    pg.evaluate('visualViewport.scale = 2; __kb(466, 0)'); pg.wait_for_timeout(120)
    check('pinch-zoom nie udaje klawiatury', not layout(pg)['open'])
    check('brak błędów JS', not errs, errs)
    b.close()
f = [n for n, ok in res if not ok]
print(f'\n{len(res) - len(f)}/{len(res)} passed'); print('FAILED:', f)
sys.exit(1 if f else 0)
