# Nexus – kontynuacja pracy

Prywatne notatki PWA po polsku: czysty JS (moduły ES), bez frameworka i builda. Działa na GitHub Pages (`https://lewym90.github.io/nexus/`, gałąź `main`, katalog główny).

## Założenia
- Bez konta i śledzenia. Dane są na urządzeniu (IndexedDB + localStorage), a synchronizacja przez własny serwer jest opcjonalna i szyfrowana na urządzeniu: serwer nigdy nie widzi treści ani kodu.
- Zero zależności w aplikacji.
- Wstawiania obrazów w treść notatki ma nie być: obrazy to tylko załączniki.
- Główne urządzenie to iPhone (PWA z ekranu początkowego), więc zmiany układu trzeba sprawdzać też na telefonie.

## Stan
- Wersja: patrz `package.json`; cache service workera (`CACHE_NAME` w `sw.js`) podbijać przy każdym wydaniu.
- Testy: `npm test` (jednostkowe, E2E mobile i desktop, symulacja klawiatury, audyt układu). CI w GitHub Actions.
- Mapa plików: tabela „Struktura” w `README.md`.

## Synchronizacja
- Serwer: `server/index.mjs`, port 18872, trasa `/nexus-sync/` w `/etc/caddy/conf.d/nexus-sync.caddy`, dane w `/var/lib/nexus-sync`, usługa `nexus-sync`. Nigdy nie nadpisywać Caddyfile.
- Kod `https://serwer/nexus-sync#sekret`: z sekretu powstają token (SHA-256 `nexus-auth:`) i klucz AES-GCM (SHA-256 `nexus-enc:`). Na serwerze jest tylko token. Zgubiony kod oznacza niemożliwy do odczytania serwer, ale urządzenia zachowują dane.
- `js/sync.js`: najpierw pobieranie, potem wysyłanie. Zmiany wykrywa skrót względem mapy `map` w localStorage, więc kod notatek nic o synchronizacji nie wie. Przy otwartym edytorze pobieranie czeka.
- `tests/sync.py` uruchamia prawdziwy serwer i kilka urządzeń.

## Ważne pułapki
- Klawiatura iOS: `setupViewportSync` w `js/main.js`, obliczenia w `keyboardMetrics` (`js/util.js`). Nie odejmować `offsetTop` przy wykrywaniu klawiatury, bo iOS przesuwa widok i otwarta klawiatura wygląda wtedy jak zamknięta. `tests/keyboard.py` to tylko symulacja, nie zastępuje prawdziwego iPhone'a.
- `.scroll-spacer` chroni przed czarnym pasem u dołu na iOS, ale przy otwartej klawiaturze musi być wyłączony (`html.kb-open`).
- Aplikacja w przeglądarce nie może sama zapisać pliku na iPhonie, dlatego bez serwera kopia to przypomnienie plus eksport jednym dotknięciem. Po połączeniu z serwerem baner znika, bo kopie robi serwer.

## Znane błędy do naprawy
1. Podzadania w podglądzie lądują obok zadania-rodzica: `li.task` nie ma `flex-wrap: wrap`.
2. Listy numerowane: pusta linia zeruje numerację, a numer startowy jest ignorowany.
3. `__`, `*` i `~~` w adresach linków oraz w `[[tytułach]]` psują link (formatowanie inline działa po ich wstawieniu).
4. Gdy baza jest niedostępna, `run()` w `js/db.js` zwraca sukces i status pokazuje „Zapisano”.

## Mniejsze pomysły
- Zmiana tytułu notatki powinna aktualizować linki `[[...]]`.
- Powrót z notatki do grafu kasuje filtr, zoom i układ.
- Import nadpisujący notatkę zostawia jej stare obrazy w bazie.
- Service worker zapisuje w cache adresy z `?text=...`.
- Wyszukiwarka nie ignoruje polskich znaków.
