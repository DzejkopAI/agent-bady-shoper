# Changelog — Agent BADY → Shoper

Źródło prawdy = to repo (`DzejkopAI/agent-bady-shoper`). Strona w Notion jest lustrem.
Format wpisu: `## <wersja> — <RRRR-MM-DD>`. Konwencja: patch per ukończony krok.

## 1.1.0 — 2026-08-19
- **Backfill zdjęć (jednorazowe uzupełnienie istniejących produktów).** Dla produktów już w sklepie (kody `BD`), które na bady mają WIĘCEJ zdjęć niż u nas, dociągamy brakujące ujęcia z opisami:
  - `src/backfill.ts` — dry-run/raport zakresu (sklep vs bady, po WSZYSTKICH produktach BD). Do bady **tylko Playwright, łagodnie** (WAF banuje IP przy serii gołych `fetch`/dużej równoległości).
  - `src/backfill-apply.ts` — wizja `pickImagesToAdd` decyduje per zdjęcie (pomija duplikaty i **warianty tła/koloru/rozdzielczości**; dopuszcza **ładne rewersy** typu mapa/grafika; odrzuca brzydki techniczny tył: magnes, zapięcie przypinki, spód). Upload `POST /product-images` z Opisem SEO+dostępności, `main=0`, `order` po istniejących.
  - **Safeguard na serie:** strony‑serie bady grupują RODZEŃSTWO (inne wzory/kolory/produkty) w jednej galerii → pomijamy produkt gdy bady ma ≥8 zdjęć, twardy limit 4 dodane/produkt. Deterministyczny bezpiecznik (add→skip) na sformułowania odrzucenia; UWAGA: w JS `\b` nie działa z „ł/ó", w regexach podłańcuchy.
- **`src/enrich-seo.ts`** — uzupełnia Opis (SEO)=name + Opis (dostępność)=description na zdjęciach mających zamiast opisu nazwę pliku/hash/pusto (wizja Claude, `PUT /product-images/{gfx_id}`; nie nadpisuje realnych opisów). Tryby `--codes`, `--from-dodane`, **`--all-bd`** (wszystkie produkty BD), **`--non-bd`**, **`--all`** (cały katalog); pula workerów (`--conc`). Wykrywa wyczerpanie kredytów Anthropic (HTTP 400 „credit balance too low"), pisze to wprost i **przerywa run** — wznowienie tym samym poleceniem jest idempotentne (pomija już opisane).
- **Scope tokenu — sprostowanie:** `DELETE /product-images/{gfx_id}` **działa** (200), `PUT` też — można sprzątać/aktualizować zdjęcia przez API (tylko `DELETE /products` nadal 403).
- `brain.ts`: reguły wizji doprecyzowane (warianty tła OUT, ładne rewersy IN). `scrape.ts`: `foto_add` łapie wszystkie warianty dodatkowych zdjęć (poprawka trafia też do ścieżki nocnej — nowe produkty biorą komplet ujęć).
- **Przebieg jednorazowy (wykonany 2026-08-19/20):** backfill brakujących zdjęć dla produktów BD (po wizji; rodzeństwo serii posprzątane przez API — 55 zdjęć) + **enrich Opis SEO/dostępności na WSZYSTKICH zdjęciach w sklepie** (3713 produktów = 2436 BD + 1268 nie‑BD; ~9 tys. zdjęć opisanych). Operacja jednorazowa — NIE część nocnego runu.

## 1.0.2 — 2026-08-18
- **Fix: zdjęcia `.png` (nie tylko `.jpg`)** — `scrape.ts` budował adres dużego zdjęcia na sztywno z `.jpg`, a bady miewa `.png` → pobranie 404 → produkt pomijany jako „brak zdjęć" (i nic nie trafiało do sklepu, bez błędu w Schedulerze). Teraz bierzemy realne `src` z zachowaniem rozszerzenia (preferuj `fotob`, fallback z `fotom/fotos`; dodatkowe z `foto_add`).
- **Fix: media_type obrazu do Claude** — `brain.ts` wysyłał wizję zawsze jako `image/jpeg`; PNG powodował 400 z Anthropic. Wykrywamy typ z bajtów (magic bytes: png/jpeg/gif/webp).
- Potwierdzone na żywo: dodane 5 nowości (m.in. „Magnes Warszawa z zawieszką", poliresynowe) + mail powiadomienia.

## 1.0.1 — 2026-08-06
- **EAN scrapowany i czyszczony** — bady podaje EAN ze spacjami („590 17208 2152 2"); `scrape.ts` czyści do samych cyfr (`5901720821522`), dzięki czemu `POST /products` ustawia `ean` poprawnie. (Produkty z ery browsera nie miały EAN — panel.ts go nie wpisywał.)
- **Opisy z większym polotem** — prompt `writeListing` w `brain.ts` podkręcony: dowcip, gra słów, hook w pierwszym zdaniu, żartobliwe punkty — przy zachowaniu struktury `<p>`+`<ul>` i SEO (bez emoji/wykrzykników na siłę).

## 1.0.0 — 2026-08-06
- **Rdzeń gotowy.** Agent w pełni działa produkcyjnie: scrape bady.pl (headless) → wykluczenia →
  dedup (API, dokładny) → Claude (opis + opisy zdjęć + kategoria) → `POST /products` (nieaktywny) →
  `POST /product-images` (base64 + opisy SEO/dostępność) → **e-mail „co dodałem"**. Nocne zadanie
  `BadyAgent-Nightly` (Task Scheduler, 03:00). Zero 2FA/CDP/SPA/selektorów.
- **Powiadomienia e-mail (SMTP)** — nowy `src/notify.ts` (nodemailer, STARTTLS+login, wzorzec z JD-PIM;
  nigdy nie wywala runu). `index.ts` wysyła podsumowanie (tekst + HTML z linkami do edycji) **tylko gdy
  coś dodano**. `npm run test-mail` do testu. Konfiguracja w `.env`: `MAIL_ENABLED`, `SMTP_*`, `MAIL_TO`
  (poświadczenia współdzielone z PIM — konto stany-wapro@bady.pl). Potwierdzone: mail dochodzi.
- `.env.example` uzupełniony o wszystkie realne zmienne (Shoper API, wykluczenia, SMTP); sekcja LEGACY oddzielona.

## 0.3.1 — 2026-08-06
- **Kategorie dopasowane do REALNYCH nazw sklepu** (z `GET /categories`, 52 kat.) — `CATEGORY_MAP` (wartości = dokładne nazwy: Magnesy, Szkło/Ceramika, Kule Śniegowe, Statuetki, Dzwonki, Długopisy, Smycze, Pluszaki, Ręczniki, Łyżeczki pamiątkowe, Naparstki, Zapalniczki, Flagi, Aniołki, Naklejki, Monety, Zegary, Pocztówki, Naszywki, Koszulki, Torby, Breloki, Przypinki) i `SHOP_CATEGORIES` (tylko istniejące, jednoznaczne kategorie główne). „Kubki"/„Papiernicze" usunięte (nie istnieją). Zweryfikowane: wszystkie 24 nazwy mapują się na id (zero fallbacku).
- **Wykluczenie „personalizowany"** — produkty bady z tą frazą w nazwie NIE trafiają do sklepu (półprodukt do znakowania, nie towar gotowy). Konfigurowalne: `EXCLUDE_NAME_CONTAINS` (lista po przecinku, domyślnie `personalizowan`). Egzekwowane w `index.ts` zaraz po scrape.

## 0.3.0 — 2026-08-06
- **PIVOT: „ręce" po stronie sklepu przez Shoper REST API** zamiast klikania panelu. Determinizm, koniec z SPA/2FA/CDP/selektorami. `scrape.ts` i `brain.ts` bez zmian; `panel.ts`/`browser.ts` zostają jako legacy/referencja.
- Nowy `src/shoper.ts`: auth Bearer (token z `.env`, fallback login+hasło → `/webapi/rest/auth`), retry/backoff (429/5xx/sieć), `testConnection`, `productExists`, `resolveCategoryId`, `createProduct`, `addImages`, `deleteProduct`.
- **Dedup dokładny:** `GET /products?filters={"stock.code":"<kod>"}` — trafia w jeden produkt o dokładnym kodzie (zero over-matchu wariantów) i od razu daje `product_id`.
- **Tworzenie NIEAKTYWNE:** `POST /products` z `translations.pl_PL.active=0` (aktywność produktu jest w translacji; `stock.active` bazowego nie da się wyłączyć — komunikat API). Producent stały `producer_id=1`.
- **Zdjęcia + opisy:** `POST /product-images` z `content`=base64 (z `downloadImages`), `translations.pl_PL.name`=Opis (SEO)/alt, `description`=Opis (dostępność).
- **Kategorie:** mapa nazwa→id z `GET /categories` (cache). Gdy mapowanie nie trafi (np. „Kubki" nie istnieje w sklepie) → **fallback „Pozostałe"** (API wymaga `category_id`) + ostrzeżenie; produkt i tak nieaktywny.
- `index.ts` przełączony na API; przeglądarka (headless, bez profilu/2FA) już tylko do scrapingu publicznego bady.pl. **Nocne zadanie nie wymaga okna CDP.**
- Konfiguracja w `.env`: `SHOPER_API_BASE_URL`, `SHOPER_API_TOKEN` (+ `SHOPER_API_CLIENT_ID`, `SHOPER_FALLBACK_CATEGORY`, `SHOPER_PRODUCER_ID`). Token = ten sam co PIM (scope: read+create+update; **brak delete**).
- Uwaga: kategoria „Kubki" nie istnieje w sklepie — do poprawienia mapowanie w `config.ts` albo utworzyć kategorię.

## 0.2.1 — 2026-08-06
- **Kod produktu: dopełnianie bazy numeru zerami do 4 cyfr** — sklep zapisuje 3-cyfrowe numery bady z zerem z przodu (bady `122-03` → `BD 0122-03`). Nowy `productCode()` w `config.ts` używany w dedupie i przy wpisie `#code` — naprawia fałszywe „nowe" i duplikaty wariantów (kieliszki).
- **Izolacja błędów per produkt** — cała obróbka jednego produktu w `try/catch`; wyjątek (np. combo kategorii „Kubki") loguje się i przechodzi do następnego, zamiast ubijać cały nocny run.
- `WINDOWS-VPS-SETUP.md` zaktualizowany o model **CDP** (`npm run browser`, sesja interaktywna, zależność nocnego zadania od otwartego okna).
- Znane/do zrobienia: combo kategorii „Kubki" (nie klika opcji); **docelowo migracja „rąk" na Shoper REST API** (klikanie panelu jest łamliwe) — `brain.ts`/`scrape.ts` bez zmian.

## 0.2.0 — 2026-08-06
- **Pełny przebieg E2E działa** — produkt dodawany jako nieaktywny **wraz z opisami zdjęć** (SEO + dostępność). Potwierdzone na żywym panelu (m.in. ID 5382, 5383).
- **Sesja / logowanie (2FA):** `storageState`/cookies NIE działają (sesja Shopera to cookie sesyjne, którego Playwright nie utrwala między procesami, + 2FA). Rozwiązanie: **trwałe okno przeglądarki po CDP**.
  - `npm run browser` (`src/browser.ts`) — startuje JEDNO okno z trwałym profilem `.auth-profile` i portem debug (9222); logujesz się raz (z 2FA) i zostawiasz otwarte.
  - `src/index.ts` podłącza się przez `chromium.connectOverCDP` i NIE zamyka okna → sesja żyje, brak powtórnego 2FA.
- **Deduplikacja (reguła 2)** przepisana na pewny **in-page `fetch`** do `POST /stock/table?_search=<kod>` (liczba wierszy `checkbox_stock_` > 0 ⇒ istnieje). Wcześniejsze podejścia przez DOM/`getByText` dawały fałszywe pozytywy (SPA echo frazy) i były wyścigowe. `#filter_search` szuka po nazwie/ID/kodzie.
- **Combosy Producent/Kategoria** (`a-dropdown a-select`): wrappery mają NIESPÓJNE id (Kategoria `#category`, Producent `#producer-container`) — celujemy w `.a-dropdown` zawierający `input#<id>`; wzorzec: toggler → „Szukaj" → opcja o dokładnym tekscie.
- **Opisy zdjęć w galerii** (`fillGalleryDescriptions`): edycja produktu ma lewe menu (`li.sidemenu__link`) z sekcjami `tab-page` ukrytymi `display:none` — trzeba kliknąć zakładkę „Galeria". Komórki to Shoper `td.inline-edit[data-label="Opis (SEO)"|"Opis (dostępność)"]` (klik → textarea → commit przez blur). Deep-link do `/products/edit/id/<ID>` ODBIJA na listę → wchodzimy przez filtr listy + klik linku (router SPA).
- **Odczyt ID nowego produktu**: z listy po filtrze kodu bierzemy **max ID** (świeżo dodany), bo filtr over-matchuje warianty, a wiersz nie pokazuje kodu.
- **Fix tsx/esbuild `__name`**: `page.addInitScript` wstrzykuje `globalThis.__name` (nazwane funkcje w `page.evaluate` były owijane w nieistniejący `__name`).
- Skrypty: dodane `npm run browser`; `.gitignore` chroni `.auth-profile/` i `auth.json`.

## 0.1.1 — 2026-08-05
- **Prawdziwe selektory panelu Shopera** (odczytane na żywo) zamiast zgadywanych:
  - logowanie: `input[name=login]`, `input[name=password]`, `button[type=submit]` (form → `/admin/auth/login`);
  - pola formularza po stabilnych `id`: `#name`, `#code`, `#producer`, `#active` (checkbox), `#weight`, `#price`, `#category`, `#in_stock`;
  - opisy przez **API TinyMCE** (`tinymce.get('tinymce-content'|'tinymce-short-content').setContent(html); .save()`) — koniec z klikaniem „wyłącz edytor";
  - upload: `input[type=file]` (setInputFiles, także dla wielu zdjęć); zapis: przyciski po tekście „Zapisz i wróć do listy" / „Zapisz".
- Krok opisów zdjęć w galerii (Opis SEO + Opis dostępność) przeniesiony na **best-effort** (try/catch) — ewentualny problem nie przerywa dodania produktu.
- Gotowe do VPS (Windows Server): `run.bat`, instrukcja `WINDOWS-VPS-SETUP.md`, harmonogram przez Task Scheduler.
- Przeniesienie pracy na **VPS + Claude Code**.
- **Do potwierdzenia na żywo:** rozwijane **Producent** i **Kategoria** (wyszukiwarka), oraz selektory inline w galerii.

## 0.1.0 — 2026-08-04
- Szkielet agenta: **TypeScript + Playwright** (ręce) + **Claude API** (mózg). Orkiestrator w `src/index.ts`.
- Reguły zaszyte w `src/config.ts`: tylko kategoria Nowości; deduplikacja; kod `BD <nr artykułu>`; producent „Pamiątki z Polski"; wszystkie zdjęcia; opis marketingowy `<p>`+`<ul>` pod SEO/humor; produkt nieaktywny; cena = placeholder (uzupełniana ręcznie).
- Mózg (`src/brain.ts`): opis sprzedażowy, opisy zdjęć (wizja), mapowanie kategorii.
- PoC „klikany" (Claude in Chrome) przeszedł 2× end-to-end (produkty ID 5380, 5381 w panelu).
