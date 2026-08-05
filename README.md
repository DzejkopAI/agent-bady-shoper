# Agent bady.pl → Shoper (pamiatkizpolski.pl)

Autonomiczny agent: bierze nowości z **bady.pl**, pisze pod nie opis i opisy zdjęć,
i dodaje je jako **nieaktywne** produkty do panelu **Shoper**. Do ręcznej akceptacji.

To jest szkielet do nauki i rozbudowy — logika i reguły są gotowe, a miejsca
oznaczone `TODO` w kodzie to selektory panelu, które trzeba raz potwierdzić na żywo.

---

## Czy musi być uruchomiona aplikacja Claude?

**Nie.** I to jest najważniejsza różnica względem PoC, który klikaliśmy w „Claude in Chrome”.

- **PoC (Claude in Chrome)** — działał *wewnątrz* aplikacji Claude i Twojej przeglądarki.
  Żeby cokolwiek się działo, aplikacja i karta musiały być otwarte.
- **Ten agent** — to **samodzielny program w Node.js**. Nie potrzebuje aplikacji Claude,
  nie potrzebuje wtyczki do Chrome, nie potrzebuje nawet otwartej przeglądarki na wierzchu.
  Uruchamiasz go z terminala (albo z Claude Code), a on:
  1. sam odpala własną przeglądarkę (Playwright/Chromium — może działać „w tle”, headless),
  2. z „mózgiem” Claude gada przez **API** (klucz `ANTHROPIC_API_KEY`), nie przez aplikację.

Czyli jedyne „połączenie z Claude”, jakiego potrzebuje, to **klucz API** (płatne kredyty
API z console.anthropic.com). Poza tym: Node.js, Playwright i login do Twojego panelu.

Efekt: agent może chodzić na Twoim laptopie, na serwerze, albo z crona co noc —
bez klikania, bez otwartego okna, bez Ciebie przy komputerze.

---

## Jak to działa (architektura)

Dwie role. **Playwright = ręce** (deterministyczne: nawigacja, scraping, wypełnianie,
upload, zapis). **Claude = mózg** (twórcze/decyzyjne kawałki, których nie da się „zakodować”).

```
                       ┌───────────────────────────────────────────┐
   bady.pl/nowosci  →  │  SCRAPE (Playwright)   czyste DOM + zdjęcia │
                       └───────────────┬───────────────────────────┘
                                       │  dane produktu + zdjęcia
                       ┌───────────────▼───────────────────────────┐
                       │  DEDUP (Playwright): jest już w sklepie?   │→ tak: pomiń
                       └───────────────┬───────────────────────────┘
                                       │  nie → dalej
                       ┌───────────────▼───────────────────────────┐
   🧠 Claude (API)  →  │  MÓZG:  1) opis <p>+<ul> pod SEO/humor     │
                       │         2) opisy zdjęć SEO + dostępność    │
                       │            (wizja: patrzy na każde zdjęcie)│
                       │         3) mapowanie kategorii             │
                       └───────────────┬───────────────────────────┘
                                       │  gotowe treści
                       ┌───────────────▼───────────────────────────┐
   panel Shoper     ←  │  DODAJ (Playwright): formularz, upload,    │
                       │  cena-placeholder, AKTYWNOŚĆ = OFF, zapis  │
                       │  + opisy zdjęć (SEO/dostępność) w galerii  │
                       └────────────────────────────────────────────┘
```

**Gdzie dokładnie decyduje Claude** (plik `src/brain.ts`):

1. **`writeListing`** — przepisuje suchy opis hurtowni na sprzedażowy, z humorem, pod SEO,
   w wymaganej strukturze: akapit `<p>` + lista `<ul>` (rozmiar, tworzywo, hasła).
2. **`writeImageTexts`** — *patrzy* na każde zdjęcie (wizja) i pisze dla niego dwa teksty:
   „Opis (SEO)” i „Opis (dostępność)”, dopasowane do tego, co na zdjęciu widać.
3. **`mapCategory`** — najpierw prosta tabela mapowania, a gdy nie trafi — Claude wybiera
   kategorię z listy istniejących w sklepie.

Wszystko inne jest deterministyczne — nie chcemy, żeby Claude „zgadywał” kliknięcia.

---

## Reguły (zaszyte w `src/config.ts`)

Te same, które ustaliliśmy w PoC:

- scrapujemy tylko kategorię **Nowości**;
- **deduplikacja** — pomijamy to, co już jest w sklepie;
- kod produktu = **`BD ` + numer artykułu**;
- producent zawsze **„Pamiątki z Polski”**;
- **wszystkie** zdjęcia, każde z opisem SEO + dostępność;
- opis **kreatywny, pod SEO**, w strukturze `<p>` + `<ul>`;
- produkt dodawany jako **nieaktywny**;
- **cena** nie jest pobierana z bady (brak loginu B2B) — wpisujemy placeholder do ręcznej korekty
  (panel wymaga wartości > 0).

---

## Uruchomienie

```bash
# 1. zależności
npm install
npm run install-browser        # pobiera Chromium dla Playwright

# 2. konfiguracja
cp .env.example .env
#   → wpisz ANTHROPIC_API_KEY, login/hasło do panelu, ewentualnie model

# 3. próbny przebieg: jeden produkt, z widoczną przeglądarką
npm run once

# 4. normalnie (tyle produktów, ile w MAX_PRODUCTS)
npm start
```

Pierwszy raz najlepiej z `HEADFUL=true` w `.env` — widzisz, co agent robi.
Na produkcji / z crona ustaw `HEADFUL=false` (chodzi w tle).

---

## Zanim ruszy „na serio” — co potwierdzić

- **Selektory panelu** (`TODO` w `src/panel.ts`). Najszybciej:
  `npx playwright codegen https://sklep5452789.homesklep.pl/admin` — klikasz, a Playwright
  podpowiada selektory. Podmieniasz `TODO` i gotowe.
- **Logowanie**: jeśli panel ma przy logowaniu 2FA lub CAPTCHA, automatyczny login się
  potknie (CAPTCHA celowo blokuje boty). Wtedy: zapisz sesję raz ręcznie
  (`storageState`) i wczytuj ją, zamiast logować się za każdym razem.
- **Model**: aktualne ID modelu w `.env` (`ANTHROPIC_MODEL`) sprawdź na
  https://docs.claude.com/en/docs/about-claude/models

---

## Wersja „na serio” (kiedyś)

Klikanie panelu jest świetne do PoC i nauki, ale najbardziej łamliwe (zmiana layoutu psuje
selektory). Docelowo pewniejsze jest **Shoper REST API** (`POST /webapi/rest/products`
+ upload zdjęć + pola alt/SEO). Wtedy „ręce” = wywołania API zamiast Playwrighta,
a „mózg” (cały `brain.ts`) zostaje bez zmian. Ścieżka: PoC ✅ → ten agent → API.

---

## Struktura plików

```
src/
  config.ts   – reguły i mapowanie kategorii (tu edytujesz politykę)
  types.ts    – typy danych
  scrape.ts   – bady.pl: lista Nowości, dane produktu, pobranie zdjęć  (Playwright)
  brain.ts    – Claude: opis, opisy zdjęć (wizja), kategoria           (API)
  panel.ts    – Shoper: login, dedup, dodanie produktu, opisy zdjęć    (Playwright)
  index.ts    – orkiestrator (pętla po nowościach)
```
