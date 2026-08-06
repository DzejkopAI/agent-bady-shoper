# Changelog — Agent BADY → Shoper

Źródło prawdy = to repo (`DzejkopAI/agent-bady-shoper`). Strona w Notion jest lustrem.
Format wpisu: `## <wersja> — <RRRR-MM-DD>`. Konwencja: patch per ukończony krok.

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
