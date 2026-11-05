# Nexus

> Precyzyjne notatki. Prywatne. Lokalne.

Aplikacja do notatek działająca w przeglądarce (PWA). Bez konta i bez śledzenia. Dane są na urządzeniu (IndexedDB + localStorage), a opcjonalnie synchronizują się przez własny serwer, zaszyfrowane jeszcze na urządzeniu.

## Funkcje

**Notatki i Markdown**
- Podgląd Markdown: nagłówki, **tabele** (z wyrównaniem), **zagnieżdżone listy**, zadania `- [ ]` (klikane, **przeciągane** za uchwyt ⋮⋮ – razem z podpunktami), cytaty, linki, `~~przekreślenie~~`
- **Bloki kodu z podświetlaniem składni** (js/ts, python, bash, sql, css, json, yaml, html)
- Pasek formatowania (H, B, I, lista, zadanie, wcięcia ⇤ ⇥, tabela, blok kodu, cytat, `[[ ]]`), kontynuacja list po Enter, Tab / Shift+Tab zmienia wcięcie
- Linki `[[Tytuł]]` / `[[Tytuł|etykieta]]`, panel „Linkują tutaj"
- **Graf powiązań**: przesuwanie tła i węzłów, zoom (kółko / pinch / przyciski), dopasowanie widoku, filtr po tagu

**Porządek**
- Foldery i przestrzenie robocze (tworzenie, zmiana nazwy, usuwanie), tagi z licznikami, wyszukiwarka (Ctrl/⌘ K)
- **Kosz** (30 dni, z przyciskiem „Cofnij") i **Archiwum**; przypinanie, ulubione, kolory, sortowanie, siatka/lista
- **Dziennik** – „Nowa" w widoku Dziennik otwiera dzisiejszy wpis; szablony (też własne)

**Szybkie przechwytywanie**
- Pole „Szybka notatka…" nad listą (Enter), przycisk 📋 – nowa notatka ze schowka
- Skróty PWA (przytrzymaj ikonę): *Nowa notatka*, *Dziennik na dziś*, *Notatka ze schowka*; adresy `?action=new|journal|clipboard` (np. do aplikacji Skróty na iOS)
- **Udostępnianie do Nexusa** (Share Target) – działa w zainstalowanej PWA na Androidzie/Chrome; iOS nie wspiera tej funkcji, tam użyj schowka lub Skrótów

**Dane**
- Załączniki-obrazy zapisywane jako **Blob w IndexedDB** (automatycznie zmniejszane do 1600 px); stare notatki z base64 są migrowane przy starcie
- Eksport / import kopii JSON (z obrazami; import scala dane), działa offline, autozapis
- **Przypomnienie o kopii**: gdy od 7 dni są niezabezpieczone zmiany, nad listą pojawia się baner „Zrób kopię” (jedno dotknięcie, „Później” odkłada o 3 dni); data ostatniej kopii jest w panelu bocznym

**Synchronizacja i kopie na serwerze** (opcjonalne)
- Zmiany trafiają na własny serwer i na pozostałe urządzenia; działa też offline i nadrabia po powrocie sieci
- Szyfrowanie AES-GCM na urządzeniu: serwer widzi tylko zaszyfrowane bajty i nie zna kodu
- Ta sama notatka zmieniona na dwóch urządzeniach: wygrywa nowsza, druga zostaje jako kopia „(konflikt)”
- Serwer robi kopię raz na dobę i trzyma ją 30 dni; przywracanie w oknie *Synchronizacja*
- Domyślnie notatka jest na wszystkich urządzeniach. Kłódka w edytorze albo *Dostęp: Tylko to urządzenie* czyni ją prywatną, także istniejącą: znika z serwera i innych urządzeń, zostaje tylko tu i nie ma jej w kolejnych kopiach serwera. Dla takich notatek zostaje przypomnienie o eksporcie

Instalacja na serwerze (Ubuntu z Caddy, trasy w `/etc/caddy/conf.d`):

```bash
curl -fsSL https://raw.githubusercontent.com/lewym90/nexus/main/server/install.sh | sudo bash
```

Na końcu skrypt wypisuje kod. Wklej go w *Menu → Synchronizacja* na każdym urządzeniu i zapisz w menedżerze haseł: kodu nie da się odzyskać, a bez niego dane z serwera są nie do odczytania.

## Uruchomienie / publikacja (GitHub Pages)

1. Repozytorium → **Settings → Pages**
2. *Source:* **Deploy from a branch**, *Branch:* `main`, folder `/ (root)` → **Save**
3. Po ~1 minucie aplikacja jest pod adresem `https://<użytkownik>.github.io/nexus/`

Aplikacja używa wyłącznie ścieżek względnych, więc działa pod dowolnym podkatalogiem. Lokalnie wystarczy dowolny serwer statyczny, np. `python3 -m http.server` (Service Worker wymaga `http://localhost` lub HTTPS).

## Instalacja na iPhonie / iPadzie

Otwórz adres w Safari → **Udostępnij** → **Do ekranu początkowego**.

> Safari może usuwać dane stron nieużywanych przez dłuższy czas (jeśli aplikacja nie jest dodana do ekranu początkowego). Dlatego warto regularnie używać **Eksportuj** i trzymać kopię zapasową.

## Struktura

| Plik | Opis |
|---|---|
| `index.html`, `styles.css` | interfejs i style (ciemny/jasny motyw, responsywność) |
| `js/main.js` | start aplikacji, zdarzenia, parametry uruchomienia |
| `js/editor.js` | edytor, autozapis, załączniki, przeciąganie zadań |
| `js/list.js`, `js/sidebar.js`, `js/templates.js` | lista notatek, panel boczny, szablony |
| `js/actions.js` | kosz, archiwum, szybkie notatki |
| `js/sync.js`, `js/syncui.js` | synchronizacja z serwerem, szyfrowanie, okno ustawień |
| `server/` | serwer synchronizacji (Node, bez zależności) i instalator |
| `js/db.js` | IndexedDB (notatki + Blob-y), migracje |
| `js/markdown.js`, `js/graph.js`, `js/util.js` | renderer Markdown, graf, funkcje pomocnicze (testowane jednostkowo) |
| `js/io.js`, `js/nav.js`, `js/ui.js`, `js/state.js`, `js/storage.js` | eksport/import, nawigacja, okna/toasty, stan, localStorage |
| `sw.js`, `manifest.json` | tryb offline i PWA (skróty, share target) |
| `icons/` | ikona aplikacji z paczki (180/192/512 + rozmiary iPad, favicon, wersja maskable) |
| `tests/` | testy jednostkowe (Node) i E2E (Playwright) |

## Testy

```bash
npm run test:unit            # testy jednostkowe (Node 22, bez zależności)
pip install playwright && playwright install chromium
npm run test:e2e             # E2E: widok mobilny i desktop, serwowane spod /nexus/ jak GitHub Pages
```

`tests/keyboard.py` symuluje klawiaturę iOS (w tym przesunięcie widoku). `tests/audit.py` sprawdza układ w 5 rozmiarach ekranu (iPhone, SE, poziomo, iPad, desktop): wypełnienie całego ekranu, brak przepełnień, przyklejony nagłówek edytora.

Testy uruchamiają się też automatycznie w **GitHub Actions** (`.github/workflows/ci.yml`) po każdym pushu i pull requeście.
