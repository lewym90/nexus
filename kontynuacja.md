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

## Wygląd (ETAP I, porcja 1)
- Motywy: auto (wg systemu), ciemny, jasny, OLED; klasa `light`/`oled` na `<html>` i `<body>`, tokeny kolorów na górze `styles.css`.
- Złoto stonowane w interfejsie (`--accent`), jaskrawe tylko w ikonie i przyciskach (`--gold-grad`).
- Czcionki w `fonts/` (OFL): Inter (treść), Manrope (nagłówki), JetBrains Mono (kod), Michroma (znak słowny NEXUS).
- Ikona: `icons/` z oryginału użytkownika (N z piórem i zawiniętym rogiem, czarny margines pod zaokrąglenie iOS); zakładka 16/32 px z płaskiego N z orbitą; `brand/logo.webp` na ekranie startowym i w pustych widokach; `brand/og.jpg` w podglądzie linku.
- Kolory notatek: zapisane wartości bez zmian, wyświetlane stonowane (`AURA_DISPLAY` w `js/state.js`); dawny niebieski = bez koloru.
- Układ wg renderów: telefon (<768 px) – dolny pasek Pulpit/Notatki/Szukaj/Graf/Więcej, złoty „+” nad paskiem, nagłówek menu–NEXUS–szukaj; tablet (768–1099) – stałe menu boczne + treść; laptop (≥1100) – trzy kolumny: menu, lista, notatka (`isWide` w `js/editor.js`, CSS na dole `styles.css`).
- Start na Pulpicie (`js/home.js`): kafelki, ostatnie notatki, zadania, projekty (= przestrzenie poza domyślną), status synchronizacji. Testy starsze startują od listy (`tests/start_notes.py`, klucz `nexus-start`).
- Zadania: zbierane z linii `- [ ]` wszystkich notatek, odhaczanie zmienia treść notatki.
- Wyszukiwarka (`js/search.js`, `fold`/`matchesQuery`/`highlightText` w `js/util.js`): bez polskich znaków, wiele słów, tytuł+treść+tagi+folder+nazwy załączników+przestrzeń; filtry data/dostęp/zakres; ostatnie (zapamiętywane po 1,5 s bez pisania) i zapisane wyszukiwania w localStorage.
- Tryb Focus (`js/focus.js`): tylko tytuł i treść, szerokość wąska/średnia/szeroka (zapamiętana), pełny ekran tam, gdzie przeglądarka pozwala; Esc kończy.
- Paleta poleceń (`js/palette.js`): Ctrl/⌘ K, „⌘ K” w wyszukiwarce, „Polecenia” w menu; polecenia i notatki po tytule.
- Przełączanie notatek bez czekania na zapis (`detachEditor` w `js/editor.js`): pola nowej notatki są gotowe od razu.
- Czytelność (11.2026, po uwagach użytkownika: „za dużo ikonek, nie wiem, co robią”): w notatce tylko „Podgląd” i „Więcej” z podpisami, reszta w menu z pełnymi nazwami; pasek formatowania z napisami; podpisy w nagłówku od 1200 px. Zasada: każdy nowy przycisk ma podpis albo trafia do menu z nazwą.
- Przestrzenie jako lista w menu bocznym (bez selecta w nagłówku). Przenoszenie: pole „Przestrzeń” w notatce, „Więcej → Przenieś do przestrzeni…”, tryb „Zaznacz” na liście (też przytrzymanie karty) z przeniesieniem do przestrzeni/folderu i usuwaniem (`js/select.js`).
- ETAP I zakończony. Dalej ETAP II: historia wersji, rozbudowana synchronizacja (lista urządzeń, kolejka zmian), przywracanie pojedynczej notatki z kopii, karta odzyskiwania klucza, ekran „Gdzie są moje dane”.

## Synchronizacja
- Serwer: `server/index.mjs`, port wybierany przez instalator od 18872 (zapisany w `/etc/nexus-sync.env`), trasa `/nexus-sync/` w `/etc/caddy/conf.d/nexus-sync.caddy`, dane w `/var/lib/nexus-sync`, usługa `nexus-sync`. Nigdy nie nadpisywać Caddyfile.
- Kod `https://serwer/nexus-sync#sekret`: z sekretu powstają token (SHA-256 `nexus-auth:`) i klucz AES-GCM (SHA-256 `nexus-enc:`). Na serwerze jest tylko token. Zgubiony kod oznacza niemożliwy do odczytania serwer, ale urządzenia zachowują dane.
- `js/sync.js`: najpierw pobieranie, potem wysyłanie. Zmiany wykrywa skrót względem mapy `map` w localStorage, więc kod notatek nic o synchronizacji nie wie. Przy otwartym edytorze pobieranie czeka.
- Notatka prywatna: pole `private: true`, a brak pola znaczy „wszędzie” (dzięki temu istniejące notatki nie wysyłają się od nowa). `push` pomija prywatne, a wcześniej wysłane usuwa z serwera; pobieranie i przywracanie kopii ich nie nadpisują.
- `tests/sync.py` uruchamia prawdziwy serwer i kilka urządzeń.

## Współistnienie z innymi aplikacjami
- Wszystkie PWA pod `lewym90.github.io` dzielą Cache Storage, localStorage i IndexedDB. Większość innych aplikacji przy aktualizacji kasuje wszystkie cudze cache.
- Nexus kasuje tylko `nexus-v*`, ma kopię plików w bazie `nexus-shell`, a klucze localStorage mają prefiks `nexus-`. Test: `tests/isolation.py`.
- Przycisk resetu w innej aplikacji (zakupy, warsztat, nawigacja, operatszacunkowy, egida, Rezonans) wyrejestrowuje service workery całego adresu. Nexus wraca do działania offline po pierwszym uruchomieniu z siecią, a notatki są bezpieczne.
- Instalator: sprawdza port (w użyciu albo zapisany w konfiguracji innej aplikacji) i trasę, cofa zmiany w conf.d przy błędzie Caddy, limity usługi 256 MB i 50% CPU.

## Ważne pułapki
- Klawiatura iOS: `setupViewportSync` w `js/main.js`, obliczenia w `keyboardMetrics` (`js/util.js`). Nie odejmować `offsetTop` przy wykrywaniu klawiatury, bo iOS przesuwa widok i otwarta klawiatura wygląda wtedy jak zamknięta. `tests/keyboard.py` to tylko symulacja, nie zastępuje prawdziwego iPhone'a.
- `.scroll-spacer` chroni przed czarnym pasem u dołu na iOS, ale przy otwartej klawiaturze musi być wyłączony (`html.kb-open`).
- Aplikacja w przeglądarce nie może sama zapisać pliku na iPhonie, dlatego bez serwera kopia to przypomnienie plus eksport jednym dotknięciem. Po połączeniu z serwerem baner znika, bo kopie robi serwer.

## Mniejsze pomysły
- Zmiana tytułu notatki powinna aktualizować linki `[[...]]`.
- Powrót z notatki do grafu kasuje filtr, zoom i układ.
- Import nadpisujący notatkę zostawia jej stare obrazy w bazie.
