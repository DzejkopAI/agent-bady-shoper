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

## Architektura (od 0.3.0 — PRODUKCJA = REST API)
- **bady.pl = przeglądarka** (Playwright, **headless, bez profilu/2FA/CDP** — bady jest publiczne).
  Tylko scraping listy nowości + szczegółów + pobranie bajtów zdjęć (`scrape.ts`).
- **Shoper = REST API** (`src/shoper.ts`) — dedup, tworzenie nieaktywnego produktu, zdjęcia z opisami.
  Determinizm; koniec z SPA/2FA/CDP/selektorami.
- **Claude = mózg** (`src/brain.ts`, bez zmian): `writeListing` (opis `<p>`+`<ul>`),
  `writeImageTexts` (wizja → Opis SEO + dostępność), `mapCategory`.

Pliki: `config.ts` (reguły + API cfg), `types.ts`, `scrape.ts` (bady), `brain.ts` (Claude),
**`shoper.ts` (API — ścieżka produkcyjna)**, `index.ts` (pętla).
`panel.ts` + `browser.ts` = **LEGACY** (klikanie panelu przez CDP) — zostają jako referencja/fallback,
nieużywane przez `index.ts`. Sekcja „Selektory panelu" niżej dotyczy tylko tej starej ścieżki.

## Shoper REST API (src/shoper.ts) — potwierdzone na żywo (2026-08-06)
- Base: `SHOPER_API_BASE_URL` (adres sklepu bez `/admin`, np. `https://pamiatkizpolski.pl`).
  Auth: `Authorization: Bearer <SHOPER_API_TOKEN>` (ten sam token co PIM; fallback login+hasło → `/webapi/rest/auth`).
- **Dedup:** `GET /webapi/rest/products?filters={"stock.code":"<kod>"}` → `list.length>0` = istnieje (dokładnie, daje `product_id`).
- **Utworzenie (NIEAKTYWNE):** `POST /webapi/rest/products` z `producer_id:1`, `category_id`+`categories:[id]`,
  `tax_id:1`, `code`, `stock:{price,stock,code}`, `translations.pl_PL:{name,short_description,description, active:0}`.
  UWAGA: nieaktywność jest w `translations.active=0`, NIE w `stock.active` (API to odrzuca). Zwraca gołe `product_id`.
- **Zdjęcia:** `POST /webapi/rest/product-images` z `product_id`, `main`(1 dla pierwszego), `order`,
  **`content`=base64** obrazu, `translations.pl_PL:{name=Opis(SEO)/alt, description=Opis(dostępność)}`.
- **Kategorie:** mapa nazwa→id z `GET /categories` (cache). Fallback „Pozostałe" (id 5), gdy nazwa nie istnieje.
  „Magnesy"=6. **„Kubki" NIE istnieje** — do poprawy mapowanie/utworzyć kategorię.
- **Scope tokenu:** read + create + update; **BRAK delete** (`DELETE` → 403). `/producers` też poza scope → stały `producer_id=1`.

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

## Status (2026-08-06) — PEŁNY E2E PRZEZ API DZIAŁA
- Ścieżka produkcyjna = **API**. Potwierdzone na żywo: scrape bady (headless) → dedup (API) →
  Claude → `POST /products` (nieaktywny) → `POST /product-images` (base64 + opisy SEO/dostępność).
  Produkt testowy: 5394 (Kubek, w „Pozostałe" — fallback kategorii).
- **Do zrobienia / uwagi:**
  1. Mapowanie kategorii: „Kubki" nie istnieje w sklepie (idzie na fallback „Pozostałe"). Poprawić
     `CATEGORY_MAP`/`SHOP_CATEGORIES` w `config.ts` do realnych kategorii sklepu (są w `GET /categories`).
  2. Task Scheduler: nocny run **nie wymaga już okna CDP** (Shoper przez API, bady headless). Można
     rozważyć przełączenie zadania na „uruchom niezależnie od zalogowania" (headless chromium w usłudze).
  3. Ścieżka browser (`panel.ts`/`browser.ts`, `npm run browser`) = legacy/fallback.

## Uruchamianie (API)
`npm install` → `npx playwright install chromium` → `.env` z:
`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `SHOPER_API_BASE_URL`, `SHOPER_API_TOKEN`
(opc. `SHOPER_API_CLIENT_ID`, `SHOPER_FALLBACK_CATEGORY`, `SHOPER_PRODUCER_ID`), `MAX_PRODUCTS`
→ **`npm start`**. Token = ten sam co PIM (jego `config.json` → `shoper_api.access_token`).
Sekrety tylko w `.env` (gitignored). Po każdej działającej zmianie: `CHANGELOG.md` + commit/push;
lustro w Notion („Changelog — Agent BADY→Shoper").
