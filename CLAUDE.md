# CLAUDE.md — pamięć projektu (agent BADY → Shoper)

Ten plik czyta Claude Code automatycznie. Trzymaj go aktualnym; przy każdej zmianie
funkcjonalnej dopisz wpis do `CHANGELOG.md` (i podbij wersję).

## Co to jest
Autonomiczny agent: scrapuje **nowości z bady.pl**, pisze pod nie opis i opisy zdjęć,
i dodaje je jako **nieaktywne** produkty do panelu **Shoper** (`pamiatkizpolski.pl`),
do ręcznej akceptacji. Świadomie osobny od integratora/PIM (JD-PIM) — to inny gatunek:
agent przeglądarkowy, nie deterministyczny integrator SQL→API.

- Repo: `DzejkopAI/agent-bady-shoper`
- Uruchamiany docelowo na **VPS (Windows Server)**, co noc przez Task Scheduler (`run.bat`).
- Panel: `https://sklep5452789.homesklep.pl/admin`

## Sesja / logowanie (WAŻNE — 2FA)
Shoper wymusza 2FA, a sesji **nie da się** utrwalić przez `storageState`/cookies
(sesja to cookie sesyjne, którego Playwright nie zapisuje między procesami).
Rozwiązanie: **trwałe okno przeglądarki przez CDP**.
1. `npm run browser` (`src/browser.ts`) — startuje JEDNO okno (profil `.auth-profile`,
   port debug 9222). Zaloguj się raz (login+hasło+kod 2FA) i **zostaw otwarte**.
2. `npm start` podłącza się przez `chromium.connectOverCDP('http://127.0.0.1:9222')`
   i NIE zamyka okna → sesja żyje, brak powtórnego 2FA. Restart VPSa = zaloguj raz ponownie.

## Architektura
Playwright = **ręce** (nawigacja, scraping, wypełnianie, upload, zapis — deterministyczne).
Claude API = **mózg**, wywoływany TYLKO w `src/brain.ts` w 3 miejscach:
1. `writeListing` — opis sprzedażowy (humor, SEO) w strukturze `<p>` + `<ul>`.
2. `writeImageTexts` — wizja: patrzy na każde zdjęcie → Opis (SEO) + Opis (dostępność).
3. `mapCategory` — mapa kategorii, a gdy nie trafi — Claude wybiera z listy sklepu.

Pliki: `config.ts` (reguły), `types.ts`, `scrape.ts` (bady), `brain.ts` (Claude),
`panel.ts` (Shoper), `index.ts` (pętla). Instrukcja wdrożenia: `WINDOWS-VPS-SETUP.md`.

## Reguły produkcyjne (w `src/config.ts`)
1. Źródło: tylko `https://www.bady.pl/nowosci/`.
2. Deduplikacja: pomijać produkty już w sklepie (sklep aktywnie dodaje nowości z bady!).
3. Kod produktu = `BD ` + numer artykułu (np. `BD 2575`).
4. Producent zawsze `Pamiątki z Polski`.
5. Wszystkie zdjęcia (kwadratowe) + dla każdego Opis (SEO) i Opis (dostępność).
6. Opis: kreatywnie, marketingowo, z humorem, pod SEO.
7. Struktura opisu: `<p>` sprzedażowy + `<ul>` (Rozmiar, Tworzywo, hasła).
8. Aktywność OFF przy dodaniu.
9. Cena: NIE pobieramy z bady (brak loginu B2B) → placeholder > 0, korekta ręczna.

## Selektory panelu — POTWIERDZONE na żywo (2026-08-06)
- Logowanie: `input[name=login]`, `input[name=password]`, `button[type=submit]` (ale docelowo
  logujemy się ręcznie raz przez `npm run browser` — patrz „Sesja / logowanie").
- Formularz `/products/add` (deep-link działa): `#name`, `#code`, `#weight`, `#price`,
  `#active` (checkbox — klik przez JS), `#in_stock`.
- **Combosy `a-dropdown a-select`** (Producent/Kategoria): wrappery mają NIESPÓJNE id —
  Kategoria `div#category`, Producent `div#producer-container` (input ma id `producer`).
  Dlatego widget = `.a-dropdown` ZAWIERAJĄCY `input#<id>`. Wzorzec: klik `[data-test-id=dropdown-toggler]`
  → wpisz w `input.control_s` („Szukaj") → klik opcji o DOKŁADNYM tekscie (`getByText(v,{exact})`).
- Opisy: `tinymce.get('tinymce-content'|'tinymce-short-content').setContent(html); .save()`.
- Zdjęcia: `input[type=file]` (setInputFiles, wiele naraz). Zapis: „Zapisz i wróć do listy".
- **Deduplikacja**: in-page `fetch` → `POST {admin}/stock/table?_search=<kod>`, body
  `{filters:[{name:"filter_search",values:[kod]}],columns:[...],page:1,limit:20}`; liczba
  `checkbox_stock_\d+` w odpowiedzi > 0 ⇒ istnieje. (`#filter_search` szuka po nazwie/ID/kodzie.)
- **Lista `/stock/list`** = SPA `#main-list` (klasa `aurora-loader` = trwa ładowanie, poczekaj
  aż zniknie). Wiersz produktu = `a.link[href*="/products/edit/id/<ID>"]` (pokazuje ID i nazwę, NIE kod).
- **Odczyt ID nowego produktu**: filtr listy po kodzie → **max ID** z linków (świeżo dodany;
  filtr over-matchuje warianty, a kodu nie widać w wierszu).
- **Galeria (opisy zdjęć)** — działa: deep-link `/products/edit/id/<ID>` ODBIJA na listę, więc
  wchodzimy przez filtr listy + klik `a.link` (router SPA). Edycja ma lewe menu `li.sidemenu__link`
  z sekcjami `div.tab-page` ukrytymi `display:none` → klik zakładki „Galeria". Komórki:
  `td.inline-edit[data-label="Opis (SEO)"]` i `[data-label="Opis (dostępność)"]` (Shoper inline-edit:
  klik → `textarea` → commit przez blur).
- tsx/esbuild: `page.addInitScript("globalThis.__name = globalThis.__name || (fn=>fn)")` —
  bez tego nazwane funkcje w `page.evaluate` wywalają `ReferenceError: __name is not defined`.

## Status (2026-08-06) — PEŁNY E2E DZIAŁA
- Cały przepływ potwierdzony na żywo: login (CDP) → scrape → dedup → Claude → formularz
  (Producent/Kategoria/TinyMCE/upload) → zapis → **opisy zdjęć w galerii** → poprawne ID.
  Produkty testowe: 5382, 5383 (nieaktywne).
- **Do zrobienia:** `HEADFUL` nie dotyczy (używamy trwałego okna CDP); ustaw `MAX_PRODUCTS=3`,
  dopnij harmonogram (Task Scheduler) — z zastrzeżeniem, że okno `npm run browser` musi być
  uruchomione i zalogowane (sesja + 2FA) przed nocnym `npm start`.

## Uruchamianie
`npm install` → `npx playwright install chromium` → `.env` (ANTHROPIC_API_KEY,
SHOPER_ADMIN_URL/LOGIN/PASSWORD, ANTHROPIC_MODEL, MAX_PRODUCTS) →
**`npm run browser`** (zaloguj się raz z 2FA, zostaw okno) → **`npm start`** (podłącza się przez CDP).
Sekrety tylko w `.env` (gitignored). Po każdej działającej zmianie: wpis w `CHANGELOG.md`,
commit + push; lustro w Notion („Changelog — Agent BADY→Shoper").

## Wersja „na serio" (na później)
Klikanie panelu jest łamliwe. Docelowo pewniejsze: **Shoper REST API**
(`POST /webapi/rest/products` + upload + pola alt/SEO). Wtedy „ręce" = API, a `brain.ts` bez zmian.
