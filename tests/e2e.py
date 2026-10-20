"""Testy end-to-end Nexus (Playwright). Uruchom: python tests/e2e.py mobile|desktop
Serwuje repozytorium pod /nexus/ (jak GitHub Pages w podkatalogu). Opcjonalnie CHROMIUM_PATH i SHOTS=katalog."""
import sys, threading, http.server, functools, json, base64, os, tempfile, urllib.parse
from playwright.sync_api import sync_playwright
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP=tempfile.mkdtemp(prefix='nexus-e2e-')
SHOTS=os.environ.get('SHOTS')
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
    def translate_path(self,path):
        p=urllib.parse.urlparse(path).path
        if p.startswith('/nexus/'): p=p[len('/nexus'):]
        elif p=='/nexus': p='/'
        return os.path.join(ROOT,p.lstrip('/'))
srv=http.server.ThreadingHTTPServer(('127.0.0.1',8766),Q); threading.Thread(target=srv.serve_forever,daemon=True).start()
URL='http://127.0.0.1:8766/nexus/'
res=[]
def check(name,cond,extra=''):
    res.append((name,bool(cond))); print(('PASS ' if cond else 'FAIL ')+name+(' :: '+str(extra) if (extra and not cond) else ''))

PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
open(TMP+'/t.png','wb').write(PNG)

def shot(pg,name):
    if SHOTS: os.makedirs(SHOTS,exist_ok=True); pg.screenshot(path=os.path.join(SHOTS,name))

def menu(pg,kind,want):
    if kind!='mobile': return
    is_open=pg.eval_on_selector('#sidebar','e=>e.classList.contains("open")')
    if want and not is_open: pg.click('#menuToggle'); pg.wait_for_timeout(450)
    if not want and is_open: pg.click('#sidebarBackdrop',position={'x':380,'y':500}); pg.wait_for_timeout(450)

def vis_cards(pg): return pg.locator('.note-card').count()

def nav(pg,kind,view):
    menu(pg,kind,True); pg.click(f'.nav-item[data-view={view}]'); pg.wait_for_timeout(250); menu(pg,kind,False)

def make_note(pg,kind,title,content='',tags=''):
    menu(pg,kind,False); pg.click('#newNoteBtn'); pg.wait_for_selector('#editorView.active')
    pg.fill('#noteTitle',title)
    if content: pg.fill('#noteContent',content)
    if tags: pg.fill('#tagsInput',tags)
    pg.wait_for_timeout(1000); pg.click('#backBtn'); pg.wait_for_selector('#notesView.active')

def features(pg,ctx,kind,K):
    # ---- kosz: poprzednio usunięta notatka „Spotkanie” jest w koszu, można cofnąć
    pg.click('.toast-action'); pg.wait_for_timeout(300)
    check(K+'undo restores trashed note',pg.locator('.note-card:has(h3:has-text("Spotkanie"))').count()==1)
    menu(pg,kind,False)
    pg.locator('.note-card:has(h3:has-text("Spotkanie"))').click(); pg.wait_for_selector('#editorView.active')
    pg.click('#deleteBtn'); pg.wait_for_selector('#notesView.active'); pg.wait_for_timeout(300)
    check(K+'trashed note hidden from All',pg.locator('.note-card:has(h3:has-text("Spotkanie"))').count()==0)
    nav(pg,kind,'trash')
    check(K+'trash view lists it',pg.locator('.note-card').count()==1 and pg.is_visible('#emptyTrashBtn'))
    check(K+'trash count badge',pg.inner_text('#trashCount')=='1')
    pg.locator('.note-card').click(); pg.wait_for_selector('#editorView.active')
    check(K+'trash banner visible',pg.is_visible('#trashBanner'))
    pg.click('#restoreBtn'); pg.wait_for_timeout(300)
    check(K+'banner hides after restore',not pg.is_visible('#trashBanner'))
    pg.click('#backBtn'); pg.wait_for_selector('#notesView.active')
    nav(pg,kind,'all')
    check(K+'restored note back in All',pg.locator('.note-card:has(h3:has-text("Spotkanie"))').count()==1)
    # trwałe usunięcie z potwierdzeniem
    pg.locator('.note-card:has(h3:has-text("Spotkanie"))').click(); pg.wait_for_selector('#editorView.active')
    pg.click('#deleteBtn'); pg.wait_for_selector('#notesView.active'); pg.wait_for_timeout(200)
    nav(pg,kind,'trash'); pg.locator('.note-card').click(); pg.wait_for_selector('#editorView.active')
    pg.click('#purgeBtn'); pg.wait_for_selector('.modal'); pg.click('.modal .modal-btn.danger'); pg.wait_for_selector('#notesView.active'); pg.wait_for_timeout(300)
    check(K+'purge removes permanently',pg.evaluate('nexus.state.notes.filter(n=>n.title==="Spotkanie").length')==0)
    # opróżnij kosz
    nav(pg,kind,'all'); make_note(pg,kind,'Do kosza 1','x'); make_note(pg,kind,'Do kosza 2','y')
    for ttl in ['Do kosza 1','Do kosza 2']:
        menu(pg,kind,False); pg.locator(f'.note-card:has(h3:has-text("{ttl}"))').click(); pg.wait_for_selector('#editorView.active'); pg.click('#deleteBtn'); pg.wait_for_selector('#notesView.active'); pg.wait_for_timeout(200)
    nav(pg,kind,'trash')
    check(K+'two in trash',vis_cards(pg)==2)
    pg.click('#emptyTrashBtn'); pg.wait_for_selector('.modal'); pg.click('.modal .modal-btn.danger'); pg.wait_for_timeout(400)
    check(K+'empty trash',vis_cards(pg)==0 and 'pusty' in pg.inner_text('#emptyTitle'))
    # wygasanie kosza (>30 dni) przy starcie
    nav(pg,kind,'all'); make_note(pg,kind,'Stara w koszu','z')
    pg.evaluate('(async()=>{const n=nexus.state.notes.find(n=>n.title==="Stara w koszu"); n.deleted=Date.now()-31*86400000; const db=await new Promise(r=>{const q=indexedDB.open("NexusDB");q.onsuccess=()=>r(q.result)}); await new Promise(r=>{const tx=db.transaction("notes","readwrite"); tx.objectStore("notes").put(n); tx.oncomplete=r}); db.close();})()')
    pg.reload(); pg.wait_for_selector('body[data-ready="1"]',state='attached')
    check(K+'expired trash purged on start',pg.evaluate('nexus.state.notes.filter(n=>n.title==="Stara w koszu").length')==0)

    # ---- archiwum
    make_note(pg,kind,'Do archiwum','a')
    menu(pg,kind,False); pg.locator('.note-card:has(h3:has-text("Do archiwum"))').click(); pg.wait_for_selector('#editorView.active')
    pg.click('#archiveBtn'); pg.wait_for_selector('#notesView.active'); pg.wait_for_timeout(300)
    check(K+'archived hidden from All',pg.locator('.note-card:has(h3:has-text("Do archiwum"))').count()==0)
    nav(pg,kind,'archive')
    check(K+'archive view lists it',pg.locator('.note-card:has(h3:has-text("Do archiwum"))').count()==1)
    check(K+'archived excluded from graph/tags data',pg.evaluate('nexus.state.notes.find(n=>n.title==="Do archiwum").archived')==True)
    pg.locator('.note-card').click(); pg.wait_for_selector('#editorView.active'); pg.click('#archiveBtn'); pg.wait_for_selector('#notesView.active'); pg.wait_for_timeout(300)
    nav(pg,kind,'all')
    check(K+'unarchived back in All',pg.locator('.note-card:has(h3:has-text("Do archiwum"))').count()==1)

    # ---- szybka notatka
    menu(pg,kind,False)
    pg.fill('#quickInput','Kup mleko'); pg.press('#quickInput','Enter'); pg.wait_for_timeout(300)
    check(K+'quick note created',pg.locator('.note-card:has(h3:has-text("Kup mleko"))').count()==1)
    check(K+'quick input cleared',pg.input_value('#quickInput')=='')
    pg.fill('#quickInput','To jest bardzo długa pierwsza linia szybkiej notatki która przekracza sześćdziesiąt znaków na pewno'); pg.press('#quickInput','Enter'); pg.wait_for_timeout(300)
    check(K+'long quick note has truncated title + content',pg.evaluate('(()=>{const n=nexus.state.notes.find(n=>n.title.startsWith("To jest bardzo"));return n&&n.title.endsWith("…")&&n.content.length>60})()'))
    # schowek
    ctx.grant_permissions(['clipboard-read','clipboard-write'])
    pg.evaluate('navigator.clipboard.writeText("Z schowka\\nlinia druga")'); pg.click('#clipboardBtn'); pg.wait_for_timeout(500)
    check(K+'note from clipboard',pg.evaluate('nexus.state.notes.some(n=>n.title==="Z schowka"&&n.content.includes("linia druga"))'))

    # ---- parametry uruchomienia
    pg.goto(URL+'?action=new'); pg.wait_for_selector('#editorView.active')
    check(K+'?action=new opens editor and cleans URL','action' not in pg.url)
    pg.goto(URL+'?title=Tytu%C5%82&text=Tre%C5%9B%C4%87%20z%20share&url=https%3A%2F%2Fexample.com'); pg.wait_for_selector('.note-card'); pg.wait_for_timeout(400)
    check(K+'share target creates note',pg.evaluate('nexus.state.notes.some(n=>n.title==="Tytuł"&&n.content.includes("Treść z share")&&n.content.includes("https://example.com"))') and '?' not in pg.url)
    pg.goto(URL+'?action=journal'); pg.wait_for_selector('#editorView.active')
    check(K+'?action=journal opens today entry',pg.input_value('#noteTitle').startswith('Dziennik 20'))
    pg.click('#backBtn'); pg.wait_for_selector('#notesView.active'); menu(pg,kind,True); pg.click('.nav-item[data-view=all]'); pg.wait_for_timeout(200); menu(pg,kind,False)

    # ---- markdown: tabele, zagnieżdżone listy, kod
    menu(pg,kind,False); pg.click('#newNoteBtn'); pg.wait_for_selector('#editorView.active'); pg.fill('#noteTitle','MD test')
    md='| Imię | Wiek |\n|:--|--:|\n| Ala | 7 |\n| Ola | 9 |\n\n- A\n  - A1\n    - A11\n- B\n\n```js\nconst x = "a"; // c\n```\n\n- [ ] t1\n- [ ] t2\n- [ ] t3'
    pg.fill('#noteContent',md.replace('\\n','\n')); pg.click('#previewToggle'); pg.wait_for_timeout(150)
    check(K+'table rendered',pg.locator('#markdownPreview table th').count()==2 and pg.locator('#markdownPreview table td').count()==4)
    check(K+'table alignment','text-align:right' in pg.inner_html('#markdownPreview'))
    check(K+'nested list rendered',pg.locator('#markdownPreview ul ul ul li').count()==1)
    check(K+'code highlighted',pg.locator('#markdownPreview pre .tok-k').count()==1 and pg.locator('#markdownPreview pre .tok-s').count()==1 and pg.locator('#markdownPreview pre .tok-c').count()==1)
    shot(pg,f'shot_{kind}_md.png')
    # przeciąganie zadań: t3 nad t1
    h3=pg.locator('#markdownPreview li.task:has-text("t3") .drag-handle').bounding_box(); t1=pg.locator('#markdownPreview li.task:has-text("t1")').bounding_box()
    pg.mouse.move(h3['x']+h3['width']/2,h3['y']+h3['height']/2); pg.mouse.down()
    pg.mouse.move(t1['x']+20,t1['y']+3,steps=6); pg.mouse.up(); pg.wait_for_timeout(200)
    order=pg.input_value('#noteContent').split('\n')[-3:]
    check(K+'task drag reorders',order==['- [ ] t3','- [ ] t1','- [ ] t2'],order)
    # edytor: tabela i wcięcia z paska
    pg.click('#previewToggle'); pg.fill('#noteContent','- a\n- b'); pg.evaluate('document.getElementById("noteContent").setSelectionRange(4,7)')
    pg.click('#mdToolbar [data-md=indent]')
    check(K+'toolbar indent',pg.input_value('#noteContent')=='- a\n  - b',repr(pg.input_value('#noteContent')))
    pg.click('#mdToolbar [data-md=outdent]')
    check(K+'toolbar outdent',pg.input_value('#noteContent')=='- a\n- b')
    pg.fill('#noteContent',''); pg.click('#mdToolbar [data-md=table]')
    check(K+'toolbar table template','| Kolumna 1 |' in pg.input_value('#noteContent'))
    pg.wait_for_timeout(1000); pg.click('#backBtn'); pg.wait_for_selector('#notesView.active')

    # ---- załączniki jako Blob + migracja
    menu(pg,kind,False); pg.click('#newNoteBtn'); pg.wait_for_selector('#editorView.active'); pg.fill('#noteTitle','Z obrazem')
    pg.set_input_files('#attachmentInput',TMP+'/t.png'); pg.wait_for_selector('#attachmentsList .att img[src^="blob:"]'); pg.wait_for_timeout(300)
    info=pg.evaluate('(async()=>{const n=nexus.state.notes.find(n=>n.title==="Z obrazem");const db=await new Promise(r=>{const q=indexedDB.open("NexusDB");q.onsuccess=()=>r(q.result)});const rec=await new Promise(r=>{const q=db.transaction("blobs").objectStore("blobs").get(n.attachments[0].id);q.onsuccess=()=>r(q.result)});db.close();return {hasData:"data" in n.attachments[0],isBlob:rec&&rec.blob instanceof Blob,noteId:rec&&rec.noteId===n.id}})()')
    check(K+'attachment stored as Blob (no base64 in note)',info['isBlob'] and not info['hasData'] and info['noteId'],info)
    pg.click('#backBtn'); pg.wait_for_selector('#notesView.active')
    check(K+'card shows attachment count',pg.locator('.note-card:has(h3:has-text("Z obrazem")) .mini-tag:has-text("📎1")').count()==1)
    # eksport zawiera obraz; import odtwarza Blob
    menu(pg,kind,True)
    with pg.expect_download() as d: pg.click('#exportBtn')
    data=json.load(open(d.value.path())); n=[x for x in data['notes'] if x['title']=='Z obrazem'][0]
    check(K+'export embeds image as data URL',n['attachments'][0]['data'].startswith('data:image/png;base64,'))
    # migracja starego formatu (base64 w notatce)
    legacy={'id':'legacy1','title':'Stara z obrazem','content':'x','tags':[],'created':1,'updated':1,'attachments':[{'name':'old.png','type':'image/png','data':'data:image/png;base64,'+base64.b64encode(PNG).decode()}]}
    pg.evaluate('async(n)=>{const db=await new Promise(r=>{const q=indexedDB.open("NexusDB");q.onsuccess=()=>r(q.result)});await new Promise(r=>{const tx=db.transaction("notes","readwrite");tx.objectStore("notes").put(n);tx.oncomplete=r});db.close();}',legacy)
    pg.reload(); pg.wait_for_selector('body[data-ready="1"]',state='attached')
    mig=pg.evaluate('(async()=>{const n=nexus.state.notes.find(n=>n.id==="legacy1");const a=n.attachments[0];const db=await new Promise(r=>{const q=indexedDB.open("NexusDB");q.onsuccess=()=>r(q.result)});const rec=await new Promise(r=>{const q=db.transaction("blobs").objectStore("blobs").get(a.id);q.onsuccess=()=>r(q.result)});db.close();return {id:!!a.id,data:"data" in a,blob:rec&&rec.blob.size>0}})()')
    check(K+'legacy base64 attachment migrated to Blob',mig['id'] and not mig['data'] and mig['blob'],mig)

    # ---- graf: pan / zoom / filtr tagów
    make_note(pg,kind,'G1','[[G2]]','graf')
    make_note(pg,kind,'G2','','graf')
    make_note(pg,kind,'G3','','inne')
    menu(pg,kind,False); pg.click('#graphBtn'); pg.wait_for_selector('#graphView.active'); pg.wait_for_timeout(250)
    total=pg.evaluate('nexus.getGraph().nodes.length')
    pg.select_option('#graphTag','graf'); pg.wait_for_timeout(250)
    check(K+'graph tag filter',pg.evaluate('nexus.getGraph().nodes.length')==2 and pg.evaluate('nexus.getGraph().links.length')==1 and total>2,(total,))
    pg.select_option('#graphTag',''); pg.wait_for_timeout(250)
    check(K+'graph filter reset',pg.evaluate('nexus.getGraph().nodes.length')==total)
    box=pg.locator('#graphCanvas').bounding_box(); k0=pg.evaluate('nexus.getGraph().view.k'); x0=pg.evaluate('nexus.getGraph().view.x')
    # puste miejsce: róg płótna
    cx,cy=box['x']+8,box['y']+8
    pg.mouse.move(cx,cy); pg.mouse.down(); pg.mouse.move(cx+60,cy+40,steps=5); pg.mouse.up(); pg.wait_for_timeout(100)
    check(K+'graph pan',abs(pg.evaluate('nexus.getGraph().view.x')-x0-60)<2,(x0,pg.evaluate('nexus.getGraph().view.x')))
    pg.click('#graphZoomIn'); pg.wait_for_timeout(100)
    check(K+'graph zoom in button',pg.evaluate('nexus.getGraph().view.k')>k0)
    pg.click('#graphFit'); pg.wait_for_timeout(100)
    check(K+'graph fit resets zoom',abs(pg.evaluate('nexus.getGraph().view.k')-k0)<1e-6)
    if kind=='desktop':
        pg.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2); pg.mouse.wheel(0,-300); pg.wait_for_timeout(150)
        check(K+'graph wheel zoom',pg.evaluate('nexus.getGraph().view.k')>k0)
    if kind=='mobile':
        cdp=pg.context.new_cdp_session(pg)
        kk=pg.evaluate('nexus.getGraph().view.k'); mx=box['x']+box['width']/2; my=box['y']+box['height']/2
        P=lambda dx:[{'x':mx-dx,'y':my,'id':1},{'x':mx+dx,'y':my,'id':2}]
        cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':P(40)})
        for dx in (60,80,100,120): cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':P(dx)})
        cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]}); pg.wait_for_timeout(150)
        check(K+'graph pinch zoom',pg.evaluate('nexus.getGraph().view.k')>kk*1.5,(kk,pg.evaluate('nexus.getGraph().view.k')))
        pg.click('#graphFit'); pg.wait_for_timeout(100)
    # przeciąganie węzła
    nd=pg.evaluate('(()=>{const g=nexus.getGraph();const n=g.nodes[0];return {id:n.id,x:n.x,y:n.y,sx:n.x*g.view.k+g.view.x,sy:n.y*g.view.k+g.view.y}})()')
    pg.mouse.move(box['x']+nd['sx'],box['y']+nd['sy']); pg.mouse.down(); pg.mouse.move(box['x']+nd['sx']+40,box['y']+nd['sy']+30,steps=5); pg.mouse.up(); pg.wait_for_timeout(100)
    moved=pg.evaluate('(id=>{const n=nexus.getGraph().nodes.find(n=>n.id===id);return [n.x,n.y]})',nd['id'])
    check(K+'graph node drag moves node and does not open note',moved[0]!=nd['x'] and pg.is_visible('#graphView'))
    pg.click('#closeGraphBtn'); pg.wait_for_selector('#notesView.active')

def run(kind):
    with sync_playwright() as p:
        b=p.chromium.launch(**({'executable_path':os.environ['CHROMIUM_PATH']} if os.environ.get('CHROMIUM_PATH') else {}))
        if kind=='mobile':
            ctx=b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=2,accept_downloads=True)
        else:
            ctx=b.new_context(viewport={'width':1280,'height':800},accept_downloads=True)
        pg=ctx.new_page()
        errs=[]
        pg.on('pageerror',lambda e:errs.append('PAGEERR '+str(e)))
        pg.on('console',lambda m: errs.append('CONSOLE '+m.text) if m.type=='error' else None)
        pg.on('requestfailed',lambda r:errs.append('REQFAIL '+r.url))
        pg.on('response',lambda r: errs.append(f'HTTP {r.status} {r.url}') if r.status>=400 else None)
        pg.goto(URL); pg.wait_for_selector('#emptyState.show')
        K=kind+': '
        check(K+'no errors at start',not errs,errs)
        check(K+'empty state shown',pg.is_visible('#emptyState'))
        check(K+'editor hidden',not pg.is_visible('#editorView'))
        shot(pg,f'shot_{kind}_empty.png')
        # sidebar mobile
        if kind=='mobile':
            check(K+'sidebar hidden initially',not pg.is_visible('#sidebar') or pg.eval_on_selector('#sidebar','e=>e.getBoundingClientRect().right<=0'))
            pg.click('#menuToggle'); pg.wait_for_timeout(450)
            check(K+'sidebar opens',pg.eval_on_selector('#sidebar','e=>e.getBoundingClientRect().left>=0'))
            shot(pg,f'shot_{kind}_sidebar.png')
            pg.click('#sidebarBackdrop',position={'x':380,'y':400}); pg.wait_for_timeout(450)
            check(K+'sidebar closes by backdrop',pg.eval_on_selector('#sidebar','e=>e.getBoundingClientRect().right<=0'))
        # header overflow
        ov=pg.evaluate('document.documentElement.scrollWidth>window.innerWidth || document.body.scrollWidth>window.innerWidth')
        check(K+'no horizontal overflow',not ov)
        hdr=pg.evaluate('(()=>{const r=document.querySelector(".header-right").getBoundingClientRect();return r.right<=window.innerWidth})()')
        check(K+'header-right inside viewport',hdr)

        # new empty note then back => nothing saved
        pg.click('#newNoteBtn'); pg.wait_for_selector('#editorView.active')
        check(K+'editor visible, list hidden',pg.is_visible('#editorView') and not pg.is_visible('#notesGrid'))
        menu(pg,kind,False); pg.click('#backBtn'); pg.wait_for_selector('#notesView.active')
        check(K+'empty note not saved',pg.locator('.note-card').count()==0)

        # create note with XSS payload
        pg.click('#newNoteBtn'); pg.wait_for_selector('#editorView.active')
        pg.fill('#noteTitle','Pierwsza <b>notatka</b>')
        pg.fill('#noteContent','# Nagłówek\n\n- punkt <img src=x onerror="window.__xss=1">\n\nTekst **gruby** i *kursywa* z [[Druga]] oraz `kod`\n\n- [ ] zadanie')
        pg.fill('#tagsInput','#praca, projekt, Praca')
        pg.wait_for_timeout(1300)
        check(K+'autosave status',pg.inner_text('#saveStatus')=='Zapisano',pg.inner_text('#saveStatus'))
        shot(pg,f'shot_{kind}_editor.png')
        # preview
        pg.click('#previewToggle'); pg.wait_for_timeout(100)
        html=pg.inner_html('#markdownPreview')
        check(K+'preview h1',('<h1>' in html))
        check(K+'preview strong/em/code','<strong>gruby</strong>' in html and '<em>kursywa</em>' in html and '<code>kod</code>' in html,html)
        check(K+'preview escapes html','<img' not in html.replace('&lt;img','') ,html)
        check(K+'no xss executed',pg.evaluate('window.__xss')is None)
        check(K+'wiki link rendered',pg.locator('#markdownPreview a.wiki-link.missing').count()==1)
        shot(pg,f'shot_{kind}_preview.png')
        # checkbox toggle
        pg.click('#markdownPreview input[type=checkbox]'); pg.wait_for_timeout(100)
        check(K+'checkbox toggles source',('- [x] zadanie' in pg.input_value('#noteContent')))
        # click missing wiki link -> create note Druga
        pg.click('#markdownPreview a.wiki-link'); pg.wait_for_selector('.modal')
        pg.click('.modal .modal-btn.primary'); pg.wait_for_timeout(300)
        check(K+'wiki link created note',pg.input_value('#noteTitle')=='Druga')
        pg.fill('#noteContent','Wracam do [[Pierwsza <b>notatka</b>]]')
        pg.wait_for_timeout(1200)
        check(K+'backlinks visible for Druga (Pierwsza links to it)',pg.is_visible('#backlinksBox') and pg.locator('#backlinksList .chip').count()==1)
        menu(pg,kind,False); pg.click('#backBtn'); pg.wait_for_selector('#notesView.active')
        check(K+'2 cards',pg.locator('.note-card').count()==2,pg.locator('.note-card').count())
        card_html=pg.inner_html('#notesGrid')
        check(K+'card html escaped','&lt;b&gt;notatka&lt;/b&gt;' in card_html,card_html[:300])
        check(K+'tags deduped (praca,projekt)',pg.locator('.mini-tag').count()==2,pg.locator('.mini-tag').count())
        shot(pg,f'shot_{kind}_list.png')

        # persistence
        pg.reload(); pg.wait_for_selector('.note-card')
        check(K+'persist after reload',pg.locator('.note-card').count()==2)

        # search
        sel='#searchInputMobile' if kind=='mobile' else '#searchInput'
        menu(pg,kind,False); pg.fill(sel,'wracam'); pg.wait_for_timeout(100)
        check(K+'search filters',pg.locator('.note-card').count()==1)
        pg.fill(sel,'zzz'); pg.wait_for_timeout(100)
        check(K+'search empty state',pg.is_visible('#emptyState'))
        pg.fill(sel,''); pg.wait_for_timeout(100)

        # tag filter via sidebar
        menu(pg,kind,True)
        menu(pg,kind,True); pg.click('.tag-pill[data-tag="praca"]'); pg.wait_for_timeout(300)
        check(K+'tag filter',pg.locator('.note-card').count()==1)
        check(K+'tag chip present',pg.locator('.chip[data-clear=tag]').count()==1)
        pg.click('.chip[data-clear=tag]'); pg.wait_for_timeout(100)
        check(K+'tag filter cleared',pg.locator('.note-card').count()==2)

        # folders
        menu(pg,kind,True)
        menu(pg,kind,True); pg.click('#newFolderBtn'); pg.wait_for_selector('.modal'); pg.fill('.modal-input','Praca'); pg.press('.modal-input','Enter'); pg.wait_for_timeout(200)
        check(K+'folder created',pg.locator('.folder-item').count()==2)
        # assign to first note
        menu(pg,kind,False); pg.locator('.note-card').first.click(); pg.wait_for_selector('#editorView.active')
        pg.select_option('#folderSelect',label='Praca'); pg.wait_for_timeout(1100)
        menu(pg,kind,False); pg.click('#backBtn'); pg.wait_for_selector('#notesView.active')
        menu(pg,kind,True)
        menu(pg,kind,True); pg.click('.folder-item[data-folder]:not([data-folder=""]) .folder-name'); pg.wait_for_timeout(300)
        check(K+'folder filter',pg.locator('.note-card').count()==1)
        # rename folder
        menu(pg,kind,True)
        menu(pg,kind,True); pg.click('.folder-item.active [data-act=rename]'); pg.wait_for_selector('.modal'); pg.fill('.modal-input','Projekty'); pg.press('.modal-input','Enter'); pg.wait_for_timeout(200)
        check(K+'folder renamed','Projekty' in pg.inner_text('#foldersList'))
        menu(pg,kind,True); pg.click('.folder-item.active [data-act=delete]'); pg.wait_for_selector('.modal'); pg.click('.modal .modal-btn.danger'); pg.wait_for_timeout(300)
        check(K+'folder deleted, notes kept',pg.locator('.note-card').count()==2 and pg.locator('.folder-item').count()==1)

        # recent / favorites views
        menu(pg,kind,True)
        menu(pg,kind,True); pg.click('.nav-item[data-view=favorites]'); pg.wait_for_timeout(200)
        check(K+'favorites empty',pg.locator('.note-card').count()==0)
        menu(pg,kind,True); pg.click('.nav-item[data-view=all]'); pg.wait_for_timeout(200)

        # favorite + pin in editor
        menu(pg,kind,False); pg.locator('.note-card').nth(1).click(); pg.wait_for_selector('#editorView.active')
        pg.click('#favoriteBtn'); pg.click('#pinBtn'); pg.wait_for_timeout(200)
        menu(pg,kind,False); pg.click('#backBtn'); pg.wait_for_selector('#notesView.active')
        check(K+'pinned first + star',pg.locator('.note-card').first.get_attribute('class').find('pinned')>=0 and pg.locator('.fav-star').count()==1)
        menu(pg,kind,True)
        menu(pg,kind,True); pg.click('.nav-item[data-view=favorites]'); pg.wait_for_timeout(200)
        check(K+'favorites shows 1',pg.locator('.note-card').count()==1)
        menu(pg,kind,True); pg.click('.nav-item[data-view=all]'); pg.wait_for_timeout(200)

        # backlinks
        menu(pg,kind,False); pg.locator('.note-card:has(h3:has-text("Pierwsza"))').click(); pg.wait_for_selector('#editorView.active')
        check(K+'backlinks visible',pg.is_visible('#backlinksBox') and pg.locator('#backlinksList .chip').count()==1)
        pg.click('#backlinksList .chip'); pg.wait_for_timeout(200)
        check(K+'backlink opens Druga',pg.input_value('#noteTitle')=='Druga')
        menu(pg,kind,False); pg.click('#backBtn'); pg.wait_for_selector('#notesView.active')
        check(K+'history back from editor-chain works',pg.is_visible('#notesView'))

        # graph
        pg.click('#graphBtn'); pg.wait_for_selector('#graphView.active'); pg.wait_for_timeout(200)
        info=pg.inner_text('#graphInfo')
        check(K+'graph 2 notes 1 link',info.startswith('2 notatki · 1 powiązanie'),info)
        check(K+'graph canvas sized',pg.evaluate('document.getElementById("graphCanvas").width')>300)
        shot(pg,f'shot_{kind}_graph.png')
        pos=pg.evaluate('(()=>{const r=document.getElementById("graphCanvas").getBoundingClientRect();return [r.left,r.top]})()')
        # click on a node: compute via exposed global? graphState is module-level let (script global lexical) -> accessible by eval name
        n=pg.evaluate('(()=>{const g=nexus.getGraph();const n=g.nodes[0];return {x:n.x*g.view.k+g.view.x,y:n.y*g.view.k+g.view.y}})()')
        pg.mouse.click(pos[0]+n['x'],pos[1]+n['y']); pg.wait_for_selector('#editorView.active',timeout=2000)
        check(K+'graph node opens note',pg.is_visible('#editorView'))
        pg.go_back() if False else pg.evaluate('history.back()'); pg.wait_for_timeout(400)
        check(K+'back from editor returns to graph',pg.is_visible('#graphView'))
        pg.click('#closeGraphBtn'); pg.wait_for_selector('#notesView.active')

        # workspaces
        menu(pg,kind,True)
        menu(pg,kind,True); pg.click('#newWorkspaceBtn'); pg.wait_for_selector('.modal'); pg.fill('.modal-input','Dom'); pg.press('.modal-input','Enter'); pg.wait_for_timeout(300)
        check(K+'workspace created & switched',pg.locator('.note-card').count()==0 and 'Dom' in pg.inner_text('#workspaceSelectSide'))
        menu(pg,kind,True)
        menu(pg,kind,False); pg.click('#newNoteBtn'); pg.wait_for_selector('#editorView.active'); pg.fill('#noteTitle','Notatka domowa'); pg.wait_for_timeout(1100)
        menu(pg,kind,False); pg.click('#backBtn'); pg.wait_for_selector('#notesView.active')
        check(K+'note in new workspace',pg.locator('.note-card').count()==1)
        menu(pg,kind,True)
        menu(pg,kind,True); pg.select_option('#workspaceSelectSide' if kind=='mobile' else '#workspaceSelect',label='Główna'); pg.wait_for_timeout(300)
        check(K+'switch back, 2 notes',pg.locator('.note-card').count()==2)
        menu(pg,kind,True); pg.select_option('#workspaceSelectSide' if kind=='mobile' else '#workspaceSelect',label='Dom'); pg.wait_for_timeout(300)
        menu(pg,kind,True)
        menu(pg,kind,True); pg.click('#deleteWorkspaceBtn'); pg.wait_for_selector('.modal'); pg.click('.modal .modal-btn.danger'); pg.wait_for_timeout(400)
        check(K+'workspace deleted, notes moved to Główna',pg.locator('.note-card').count()==3,pg.locator('.note-card').count())

        # journal
        menu(pg,kind,True)
        menu(pg,kind,True); pg.click('.nav-item[data-view=journal]'); pg.wait_for_timeout(200)
        pg.click('#newNoteBtn'); pg.wait_for_selector('#editorView.active')
        t=pg.input_value('#noteTitle'); check(K+'journal entry prefilled',t.startswith('Dziennik 20') and 'Co się wydarzyło' in pg.input_value('#noteContent'),t)
        pg.wait_for_timeout(1100); menu(pg,kind,False); pg.click('#backBtn'); pg.wait_for_selector('#notesView.active')
        check(K+'journal list shows entry',pg.locator('.note-card').count()==1)
        pg.click('#newNoteBtn'); pg.wait_for_selector('#editorView.active')
        check(K+'journal new again opens same day entry',pg.input_value('#noteTitle')==t)
        menu(pg,kind,False); pg.click('#backBtn'); pg.wait_for_selector('#notesView.active')
        menu(pg,kind,True)
        menu(pg,kind,True); pg.click('.nav-item[data-view=all]'); pg.wait_for_timeout(200)

        # templates
        menu(pg,kind,True)
        menu(pg,kind,True); pg.click('#templatesBtn'); pg.wait_for_selector('.modal')
        pg.click('.choice-main:has-text("Spotkanie")'); pg.wait_for_selector('#editorView.active')
        check(K+'template applied',('## Agenda' in pg.input_value('#noteContent')) and pg.input_value('#noteTitle')=='Spotkanie')
        # list continuation & toolbar
        pg.fill('#noteContent','- a'); pg.focus('#noteContent'); pg.keyboard.press('End'); pg.keyboard.press('Enter'); pg.keyboard.type('b')
        check(K+'list continues on Enter',pg.input_value('#noteContent')=='- a\n- b',repr(pg.input_value('#noteContent')))
        pg.keyboard.press('Enter'); pg.keyboard.press('Enter')
        check(K+'empty bullet ends list',pg.input_value('#noteContent')=='- a\n- b\n',repr(pg.input_value('#noteContent')))
        pg.fill('#noteContent','hello'); pg.evaluate('document.getElementById("noteContent").setSelectionRange(0,5)')
        pg.click('#mdToolbar [data-md=bold]')
        check(K+'toolbar bold',pg.input_value('#noteContent')=='**hello**',pg.input_value('#noteContent'))
        # attachments
        pg.set_input_files('#attachmentInput',TMP+'/t.png'); pg.wait_for_selector('#attachmentsList .att'); pg.wait_for_timeout(300)
        check(K+'attachment added',pg.locator('#attachmentsList .att').count()==1)
        pg.click('#attachmentsList .att'); pg.wait_for_selector('.modal'); shot(pg,f'shot_{kind}_lightbox.png'); pg.click('.modal .modal-btn.danger'); pg.wait_for_timeout(300)
        check(K+'attachment removed',pg.locator('#attachmentsList .att').count()==0)
        # save as template
        pg.click('#saveTemplateBtn'); pg.wait_for_selector('.modal'); pg.fill('.modal-input','Mój szablon'); pg.press('.modal-input','Enter'); pg.wait_for_timeout(200)
        check(K+'template saved','Mój szablon' in json.loads(pg.evaluate('localStorage.getItem("nexus-templates")'))[-1]['name'])
        # delete note
        pg.click('#deleteBtn'); pg.wait_for_selector('#notesView.active'); pg.wait_for_selector('.toast.show .toast-action')
        pg.wait_for_timeout(1500)
        check(K+'deleted note stays deleted (no resurrection)',pg.locator('.note-card:has-text("Spotkanie")').count()==0)
        features(pg,ctx,kind,K)

        # theme
        menu(pg,kind,False); pg.click('#themeToggle'); pg.wait_for_timeout(100)
        check(K+'light theme',pg.evaluate('document.body.classList.contains("light")'))
        shot(pg,f'shot_{kind}_light.png')
        pg.reload(); pg.wait_for_selector('.note-card')
        check(K+'theme persisted',pg.evaluate('document.body.classList.contains("light")'))
        menu(pg,kind,False); pg.click('#themeToggle')

        # layout list
        menu(pg,kind,False); pg.click('.view-btn[data-layout=list]'); pg.wait_for_timeout(100)
        check(K+'list layout',pg.evaluate('document.getElementById("notesGrid").classList.contains("list-view")'))
        pg.click('.view-btn[data-layout=grid]')

        # export / import
        menu(pg,kind,True)
        with pg.expect_download() as d: menu(pg,kind,True); pg.click('#exportBtn')
        path=d.value.path(); data=json.load(open(path))
        check(K+'export has notes',len(data['notes'])==pg.evaluate('nexus.state.notes.length') and data['version']==3,len(data['notes']))
        # import into modified state: delete a note then import -> restored
        pg.evaluate('(async()=>{const n=nexus.state.notes.find(n=>!n.deleted&&!n.archived); await nexus.actions.purgeNote(n.id); nexus.hooks.renderAll();})()'); pg.wait_for_timeout(200)
        n_before=pg.locator('.note-card').count()
        with pg.expect_file_chooser() as fc: menu(pg,kind,True); pg.click('#importBtn')
        fc.value.set_files(path); pg.wait_for_selector('.modal'); pg.click('.modal .modal-btn.primary'); pg.wait_for_timeout(500)
        check(K+'import merges/restores',pg.locator('.note-card').count()==n_before+1,(n_before,pg.locator('.note-card').count()))
        # bad import
        open(TMP+'/bad.json','w').write('{"x":1}')
        with pg.expect_file_chooser() as fc: menu(pg,kind,True); pg.click('#importBtn')
        fc.value.set_files(TMP+'/bad.json'); pg.wait_for_timeout(300)
        check(K+'bad import rejected','Błąd importu' in pg.inner_text('#toast'))

        # corrupted localStorage must not break startup
        pg.evaluate('localStorage.setItem("nexus-templates","{oops"); localStorage.setItem("nexus-folders","null"); localStorage.setItem("nexus-settings","garbage")')
        errs.clear(); pg.reload(); pg.wait_for_selector('.note-card')
        check(K+'survives corrupted localStorage',not [e for e in errs if 'PAGEERR' in e],errs)

        # swipe (mobile only)
        if kind=='mobile':
            js='''([sel,dx])=>{const el=document.querySelector(sel);const r=el.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;
              const mk=(t,cx)=>new Touch({identifier:1,target:el,clientX:cx,clientY:y});
              el.dispatchEvent(new TouchEvent('touchstart',{touches:[mk(0,x)],bubbles:true,cancelable:true}));
              el.dispatchEvent(new TouchEvent('touchmove',{touches:[mk(0,x+dx/2)],bubbles:true,cancelable:true}));
              el.dispatchEvent(new TouchEvent('touchmove',{touches:[mk(0,x+dx)],bubbles:true,cancelable:true}));
              el.dispatchEvent(new TouchEvent('touchend',{touches:[],changedTouches:[mk(0,x+dx)],bubbles:true,cancelable:true}));}'''
            pg.evaluate(js,['.note-card:last-child',150]); pg.wait_for_timeout(300)
            check(K+'swipe right favorites',pg.locator('.fav-star').count()>=1 and pg.locator('#editorView.active').count()==0)
            c=pg.locator('.note-card').count()
            pg.evaluate(js,['.note-card:last-child',-150]); pg.wait_for_selector('.toast.show .toast-action'); pg.wait_for_timeout(300)
            check(K+'swipe left trashes with undo',pg.locator('.note-card').count()==c-1)

        # offline
        pg.wait_for_timeout(500)
        ctx.set_offline(True); pg.reload(); pg.wait_for_selector('.note-card',timeout=5000)
        check(K+'works offline',pg.locator('.note-card').count()>=1)
        ctx.set_offline(False)
        final=[e for e in errs if 'PAGEERR' in e or 'CONSOLE' in e]
        check(K+'no js errors overall',not final,final)
        b.close()

run(sys.argv[1])
f=[n for n,ok in res if not ok]
print(f'\n{len(res)-len(f)}/{len(res)} passed'); print('FAILED:',f)
sys.exit(1 if f else 0)
