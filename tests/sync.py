"""Test synchronizacji: prawdziwy serwer (server/index.mjs) i dwa niezależne urządzenia w przeglądarce. Uruchom: python tests/sync.py"""
import sys, threading, http.server, os, functools, subprocess, tempfile, time, hashlib, json, base64, urllib.request, shutil
from playwright.sync_api import sync_playwright
import start_notes  # noqa: F401  (start od listy notatek)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
web = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Q, directory=ROOT))
threading.Thread(target=web.serve_forever, daemon=True).start()
ORIGIN = f'http://127.0.0.1:{web.server_address[1]}'
DATA = tempfile.mkdtemp(prefix='nexus-sync-'); PORT = '18899'
SECRET = 'ab' * 32
TOKEN = hashlib.sha256(('nexus-auth:' + SECRET).encode()).hexdigest()
env = {**os.environ, 'TOKEN': TOKEN, 'PORT': PORT, 'DATA_DIR': DATA, 'ALLOWED_ORIGIN': ORIGIN}
srv = subprocess.Popen(['node', 'server/index.mjs'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL)
time.sleep(0.7)
API = f'http://127.0.0.1:{PORT}'; CODE = f'{API}#{SECRET}'
res = []
def check(name, cond, extra=''):
    res.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (' :: ' + str(extra) if not cond else ''))
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
TMP = tempfile.mkdtemp(); open(TMP + '/t.png', 'wb').write(PNG)

def device(b, errs):
    ctx = b.new_context(viewport={'width': 1280, 'height': 800}); pg = ctx.new_page()
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(ORIGIN + '/'); pg.wait_for_selector('body[data-ready="1"]', state='attached')
    return pg
def pair(pg):
    pg.click('#syncBtn'); pg.fill('#syncCodeInput', CODE); pg.click('#syncConnectBtn'); pg.wait_for_selector('.toast.show:has-text("Połączono")', timeout=8000); pg.wait_for_timeout(100)
def sync(pg): pg.evaluate('import("./js/sync.js").then(m => m.syncNow())'); pg.wait_for_timeout(350)
def titles(pg): return pg.evaluate('nexus.state.notes.map(n => n.title).sort()')
def new_note(pg, title, content):
    pg.click('#newNoteBtn'); pg.fill('#noteTitle', title); pg.fill('#noteContent', content); pg.wait_for_timeout(950); pg.click('#backBtn'); pg.wait_for_selector('#notesView.active')
def edit(pg, title, content):
    pg.locator(f'.note-card:has(h3:has-text("{title}"))').first.click(); pg.wait_for_selector('#editorView.active'); pg.fill('#noteContent', content); pg.wait_for_timeout(950); pg.click('#backBtn'); pg.wait_for_selector('#notesView.active')
def content(pg, title): return pg.evaluate('t => (nexus.state.notes.find(n => n.title === t) || {}).content', title)
def http(path, token=TOKEN):
    r = urllib.request.Request(API + path, headers={'X-Token': token})
    try:
        with urllib.request.urlopen(r) as f: return f.status, f.read()
    except urllib.error.HTTPError as e: return e.code, b''

try:
    with sync_playwright() as p:
        b = p.chromium.launch(**({'executable_path': os.environ['CHROMIUM_PATH']} if os.environ.get('CHROMIUM_PATH') else {}))
        errs = []
        A = device(b, errs); B = device(b, errs)
        new_note(A, 'Tajna notatka', 'treść nie do odczytania na serwerze')
        pair(A)
        check('serwer: bez tokenu odmowa', http('/changes?since=0', 'zly')[0] == 401)
        files = os.listdir(DATA + '/data'); raw = b''.join(open(DATA + '/data/' + f, 'rb').read() for f in files)
        check('serwer: dane zaszyfrowane', files and b'Tajna' not in raw and 'treść'.encode() not in raw, files)
        check('serwer: kodu nie ma w plikach', SECRET.encode() not in raw)
        new_note(B, 'Z drugiego', 'tekst B'); pair(B)
        check('B dostał notatkę A', 'Tajna notatka' in titles(B) and content(B, 'Tajna notatka') == 'treść nie do odczytania na serwerze', titles(B))
        sync(A); check('A dostał notatkę B (scalenie przy parowaniu)', 'Z drugiego' in titles(A), titles(A))
        edit(A, 'Tajna notatka', 'zmiana z A'); sync(A); sync(B)
        check('edycja dociera', content(B, 'Tajna notatka') == 'zmiana z A')
        A.click('#newNoteBtn'); A.fill('#noteTitle', 'Foto'); A.set_input_files('#attachmentInput', TMP + '/t.png'); A.wait_for_selector('#attachmentsList .att img[src^="blob:"]'); A.wait_for_timeout(200); A.click('#backBtn'); A.wait_for_selector('#notesView.active')
        sync(A); sync(B)
        B.locator('.note-card:has(h3:has-text("Foto"))').click(); B.wait_for_selector('#attachmentsList .att img[src^="blob:"]', timeout=4000)
        check('obraz dociera', B.locator('#attachmentsList .att').count() == 1); B.click('#backBtn'); B.wait_for_selector('#notesView.active')
        A.click('#newFolderBtn'); A.fill('.modal-input', 'Praca'); A.press('.modal-input', 'Enter'); A.wait_for_timeout(150); sync(A); sync(B)
        check('foldery docierają', B.locator('.folder-item:has-text("Praca")').count() == 1)
        # kosz i trwałe usunięcie
        A.locator('.note-card:has(h3:has-text("Z drugiego"))').click(); A.wait_for_selector('#editorView.active'); A.click('#deleteBtn'); A.wait_for_selector('#notesView.active'); A.wait_for_timeout(200)
        sync(A); sync(B)
        check('kosz dociera', B.evaluate('!!nexus.state.notes.find(n => n.title === "Z drugiego").deleted'))
        A.evaluate('(async()=>{const n=nexus.state.notes.find(n=>n.title==="Z drugiego");await nexus.actions.purgeNote(n.id);nexus.hooks.renderAll()})()'); A.wait_for_timeout(100)
        sync(A); sync(B)
        check('trwałe usunięcie dociera', 'Z drugiego' not in titles(B), titles(B))
        # usunięcie obrazu z notatki usuwa go z serwera
        # konflikt: ta sama notatka na obu, nikt nie traci tekstu
        edit(A, 'Tajna notatka', 'wersja A'); edit(B, 'Tajna notatka', 'wersja B')
        sync(A); B.wait_for_timeout(30); sync(B); sync(A)
        ta, tb = titles(A), titles(B)
        cs = B.evaluate('nexus.state.notes.filter(n => n.title.startsWith("Tajna")).map(n => n.content).sort()')
        check('konflikt: obie wersje ocalały', cs == ['wersja A', 'wersja B'], cs)
        check('konflikt: urządzenia zgodne', ta == tb and any('(konflikt)' in t for t in ta), (ta, tb))
        # otwarta notatka nie jest podmieniana
        edit(A, 'Foto', 'a1'); sync(A); sync(B)
        B.locator('.note-card:has(h3:has-text("Foto"))').click(); B.wait_for_selector('#editorView.active')
        edit(A, 'Foto', 'a2'); sync(A); sync(B)
        check('otwarta notatka nietknięta', B.input_value('#noteContent') == 'a1')
        B.click('#backBtn'); B.wait_for_selector('#notesView.active'); sync(B)
        check('po wyjściu z edytora zmiana dociera', content(B, 'Foto') == 'a2')
        # kopia serwera i przywracanie: symulacja kopii wczorajszej
        day = '2026-01-01'
        d = f'{DATA}/backups/{day}'; os.makedirs(d + '/data'); [shutil.copy(f'{DATA}/data/{f}', d + '/data') for f in os.listdir(DATA + '/data') if not f.endswith('.tmp')]; shutil.copy(DATA + '/index.json', d)
        edit(A, 'Foto', 'zepsute'); sync(A); sync(B)
        check('zmiana po kopii', content(B, 'Foto') == 'zepsute')
        check('lista kopii', day in json.loads(http('/backups')[1])['days'])
        A.evaluate(f'import("./js/sync.js").then(m => m.restoreBackup("{day}"))'); A.wait_for_timeout(800); sync(B)
        check('przywrócenie z kopii na wszystkich urządzeniach', content(A, 'Foto') == 'a2' and content(B, 'Foto') == 'a2', (content(A, 'Foto'), content(B, 'Foto')))
        # zgubiony telefon: nowe urządzenie dostaje wszystko
        C = device(b, errs); pair(C); C.wait_for_timeout(300)
        check('nowe urządzenie odzyskuje całość', sorted(titles(C)) == sorted(titles(A)), (titles(C), titles(A)))
        C.locator('.note-card:has(h3:has-text("Foto"))').click(); C.wait_for_selector('#attachmentsList .att img[src^="blob:"]', timeout=4000); check('nowe urządzenie: obraz', True); C.click('#backBtn')
        check('baner kopii wyłączony po połączeniu', not A.is_visible('#backupBanner'))
        check('panel boczny pokazuje stan', 'Zsynchronizowano' in A.inner_text('#backupInfo'), A.inner_text('#backupInfo'))
        # bez ręcznego wywołania: zapis notatki sam trafia na serwer
        rev0 = json.loads(http('/changes?since=0')[1])['rev']
        edit(A, 'Foto', 'automat'); A.wait_for_timeout(3600)
        check('automatyczne wysłanie po zapisie', json.loads(http('/changes?since=0')[1])['rev'] > rev0)
        A.locator('.note-card:has(h3:has-text("Foto"))').click(); A.wait_for_selector('#editorView.active'); r1 = json.loads(http('/changes?since=0')[1])['rev']; A.wait_for_timeout(3600)
        check('otwarty edytor nie zapętla wysyłania', json.loads(http('/changes?since=0')[1])['rev'] == r1); A.click('#backBtn'); A.wait_for_selector('#notesView.active')
        # notatki prywatne: nowa i istniejąca
        check('domyślnie dostępna wszędzie', A.evaluate('nexus.state.notes.every(n => !("private" in n))'))
        new_note(A, 'Publiczna', 'tekst do ukrycia'); sync(A); sync(B)
        check('zwykła notatka dociera', 'Publiczna' in titles(B))
        rev = json.loads(http('/changes?since=0')[1])['rev']
        A.click('#newNoteBtn'); A.click('#accessSeg [data-private="1"]'); A.fill('#noteTitle', 'Moja prywatna'); A.fill('#noteContent', 'sekret')
        check('nowa: przełącznik widoczny', A.is_visible('#privateBtn') and 'active' in A.get_attribute('#accessSeg [data-private="1"]', 'class'))
        A.set_input_files('#attachmentInput', TMP + '/t.png'); A.wait_for_selector('#attachmentsList .att img[src^="blob:"]'); A.wait_for_timeout(950); A.click('#backBtn'); A.wait_for_selector('#notesView.active'); sync(A); sync(B)
        check('nowa prywatna nie idzie na serwer', json.loads(http('/changes?since=0')[1])['rev'] == rev and 'Moja prywatna' not in titles(B))
        check('znaczek na karcie', A.locator('.note-card:has(h3:has-text("Moja prywatna")) .private-tag').count() == 1 and A.locator('.note-card:has(h3:has-text("Publiczna")) .private-tag').count() == 0)
        A.locator('.note-card:has(h3:has-text("Publiczna"))').click(); A.wait_for_selector('#editorView.active'); A.click('#privateBtn'); A.wait_for_selector('.modal'); A.click('.modal .modal-btn.danger'); A.wait_for_timeout(200)
        check('przycisk w nagłówku pokazuje stan', A.get_attribute('#privateBtn', 'aria-pressed') == 'true'); A.click('#backBtn'); A.wait_for_selector('#notesView.active'); sync(A); sync(B)
        check('istniejąca prywatna znika z drugiego urządzenia', 'Publiczna' not in titles(B), titles(B))
        check('...i zostaje na swoim', content(A, 'Publiczna') == 'tekst do ukrycia')
        items = json.loads(http('/changes?since=0')[1])['items']
        check('...i znika z serwera', not [f for f in os.listdir(DATA + '/data') if f in [i['k'] for i in items if i['d']]])
        A.reload(); A.wait_for_selector('body[data-ready="1"]', state='attached'); sync(A)
        check('prywatność trwa po restarcie', A.evaluate('nexus.state.notes.find(n => n.title === "Publiczna").private === true') and 'Moja prywatna' in titles(A))
        check('obraz prywatnej zostaje lokalnie', A.evaluate('(async()=>{const n=nexus.state.notes.find(n=>n.title==="Moja prywatna");const db=await new Promise(r=>{const q=indexedDB.open("NexusDB");q.onsuccess=()=>r(q.result)});const x=await new Promise(r=>{const q=db.transaction("blobs").objectStore("blobs").get(n.attachments[0].id);q.onsuccess=()=>r(q.result)});db.close();return !!(x&&x.blob)})()'))
        A.evaluate('(()=>{const n=nexus.state.notes.find(n=>n.title==="Moja prywatna");n.created=n.updated=Date.now()-9*864e5;nexus.hooks.renderAll()})()')
        check('baner przypomina o kopii prywatnych', A.is_visible('#backupBanner') and 'Prywatne' in A.inner_text('#backupText'), A.inner_text('#backupText'))
        # równoczesna zmiana na drugim urządzeniu nie nadpisuje prywatnej
        new_note(A, 'Wspólna', 'przed'); sync(A); sync(B)
        edit(B, 'Wspólna', 'zmiana z B')
        A.locator('.note-card:has(h3:has-text("Wspólna"))').first.click(); A.wait_for_selector('#editorView.active'); A.click('#privateBtn'); A.wait_for_selector('.modal'); A.click('.modal .modal-btn.danger'); A.wait_for_timeout(200); A.click('#backBtn'); A.wait_for_selector('#notesView.active')
        sync(B); sync(A); sync(B)
        check('prywatna odporna na zmiany z innego urządzenia', content(A, 'Wspólna') == 'przed' and A.evaluate('nexus.state.notes.find(n=>n.title==="Wspólna").private===true'), content(A, 'Wspólna'))
        check('zmiana z B zostaje na B', content(B, 'Wspólna') == 'zmiana z B', content(B, 'Wspólna'))
        A.locator('.note-card:has(h3:has-text("Wspólna"))').first.click(); A.wait_for_selector('#editorView.active'); A.click('#privateBtn'); A.wait_for_timeout(200); A.click('#backBtn'); A.wait_for_selector('#notesView.active'); sync(A); sync(B)
        A.locator('.note-card:has(h3:has-text("Publiczna"))').click(); A.wait_for_selector('#editorView.active'); A.click('#accessSeg [data-private="0"]'); A.wait_for_timeout(200); A.click('#backBtn'); A.wait_for_selector('#notesView.active'); sync(A); sync(B)
        check('z powrotem dostępna: wraca na drugie urządzenie', content(B, 'Publiczna') == 'tekst do ukrycia', titles(B))
        # zły kod
        D = device(b, errs); D.click('#syncBtn'); D.fill('#syncCodeInput', f'{API}#{"cd"*32}'); D.click('#syncConnectBtn'); D.wait_for_selector('.toast.show:has-text("odrzucił")', timeout=4000)
        check('zły kod odrzucony', D.evaluate('localStorage.getItem("nexus-sync")') is None)
        # po rozłączeniu i ponownym starcie
        A.reload(); A.wait_for_selector('body[data-ready="1"]', state='attached'); A.wait_for_timeout(300)
        check('po restarcie nadal działa', 'Foto' in titles(A) and A.evaluate('!!localStorage.getItem("nexus-sync")'))
        check('brak błędów JS', not errs, errs)
        b.close()
    # kopia dzienna robi się sama przy starcie serwera i zachowuje stan mimo późniejszych zmian
    srv.terminate(); srv.wait(); srv = subprocess.Popen(['node', 'server/index.mjs'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL); time.sleep(0.7)
    today = time.strftime('%Y-%m-%d', time.gmtime())
    idx = json.loads(http(f'/backups/{today}/index')[1])['items']
    check('serwer: automatyczna kopia dzienna', idx and json.loads(http('/backups')[1])['days'][0] == today, idx)
    k = idx[0]['k']; before = http(f'/backups/{today}/item/{k}')[1]
    put = urllib.request.Request(f'{API}/item/{k}?v={int(time.time()*1000)+99999}', data=b'nowe', method='PUT', headers={'X-Token': TOKEN}); urllib.request.urlopen(put)
    check('serwer: kopia nietknięta po zmianie', http(f'/backups/{today}/item/{k}')[1] == before and http(f'/item/{k}')[1] == b'nowe')
    old = urllib.request.Request(f'{API}/item/{k}?v=5', data=b'stare', method='PUT', headers={'X-Token': TOKEN})
    try: urllib.request.urlopen(old); code = 200
    except urllib.error.HTTPError as e: code = e.code
    check('serwer: starsza wersja odrzucona', code == 409 and http(f'/item/{k}')[1] == b'nowe')
    check('serwer: ścieżka spoza danych zablokowana', http('/item/..%2f..%2findex.json')[0] == 404 and http(f'/backups/{today}/item/..%2findex.json')[0] == 404)
finally:
    srv.terminate(); shutil.rmtree(DATA, ignore_errors=True)
f = [n for n, ok in res if not ok]
print(f'\n{len(res) - len(f)}/{len(res)} passed'); print('FAILED:', f)
sys.exit(1 if f else 0)
