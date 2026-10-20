# Nexus

> Precyzyjne notatki. Prywatne. Lokalne.

Aplikacja do notatek działająca w całości w przeglądarce (PWA). Bez konta, bez serwera, bez śledzenia – dane zostają na Twoim urządzeniu (IndexedDB + localStorage).

## Funkcje

- **Markdown** z podglądem: nagłówki, listy, zadania `- [ ]` (klikane w podglądzie), cytaty, kod, linki, `~~przekreślenie~~`
- **Pasek formatowania** (H, B, I, lista, zadanie, cytat, kod, `[[ ]]`) i automatyczna kontynuacja list po Enter
- **Linki między notatkami** `[[Tytuł]]` / `[[Tytuł|etykieta]]`, panel „Linkują tutaj" i **graf powiązań** (dotknij węzła, aby otworzyć)
- **Foldery** (tworzenie, zmiana nazwy, usuwanie) i **przestrzenie robocze** (tworzenie, zmiana nazwy, usuwanie)
- **Tagi** z licznikami i filtrowaniem, wyszukiwarka (Ctrl/⌘ K)
- Widok siatki / listy, sortowanie, przypinanie, ulubione, kolory notatek
- **Dziennik** – jedno dotknięcie „Nowa" w widoku Dziennik otwiera dzisiejszy wpis
- **Szablony** (w tym własne – „Zapisz jako szablon")
- **Załączniki-obrazy** (automatycznie zmniejszane do 1600 px)
- Gesty: przesunięcie karty w prawo = ulubione, w lewo = usuń (z potwierdzeniem)
- Motyw jasny/ciemny, działa offline, autozapis
- Eksport / import kopii zapasowej JSON (import scala dane, nie nadpisuje)

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
| `index.html` | struktura interfejsu |
| `styles.css` | style (motyw ciemny/jasny, responsywność) |
| `app.js` | cała logika aplikacji |
| `sw.js` | Service Worker (praca offline) |
| `manifest.json` | manifest PWA |
