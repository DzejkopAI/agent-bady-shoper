// ─────────────────────────────────────────────────────────────
//  PANEL Shoper — ręce agenta (Playwright).
//  Selektory potwierdzone na żywym panelu (2026-08-05).
//  Wnioski z PoC: SPA bywa wolne → używamy domcontentloaded + jawnych
//  waitFor na kluczowe elementy zamiast networkidle (które potrafi wisieć).
// ─────────────────────────────────────────────────────────────
import type { Page } from "playwright";
import { CFG } from "./config.js";
import type { GeneratedCopy, ImageCopy, ProductImage, ScrapedProduct } from "./types.js";

// ── Logowanie ─────────────────────────────────────────────────
export async function login(page: Page): Promise<void> {
  await page.goto(`${CFG.adminUrl}/auth/login`, { waitUntil: "domcontentloaded" });

  const loginField = page.locator('input[name="login"]');
  if ((await loginField.count()) === 0) return; // już zalogowany

  await loginField.fill(CFG.login);
  await page.locator('input[name="password"]').fill(CFG.password);
  await page.locator('button[type="submit"]').click();

  await page.waitForLoadState("domcontentloaded");
  await page.waitForURL((u) => !u.href.includes("/auth/login"), { timeout: 30000 }).catch(() => {});
  // Jeśli tu byłoby 2FA/CAPTCHA — agent utknie; wtedy przejdź na storageState (README).
}

// ── Deduplikacja (reguła 2) ───────────────────────────────────
// Szukamy po KODZIE produktu (`BD <nr>`) — to nasz unikalny klucz.
// Lista „Produkty" to SPA; jej wyszukiwarka (#filter_search) obsługuje też kod
// i pod spodem woła POST /stock/table. Zamiast walczyć z wyścigami UI, wołamy
// ten sam endpoint bezpośrednio fetch-em WEWNĄTRZ strony (page.evaluate) —
// uwierzytelnione sesyjnym cookie (same-origin), deterministyczne. Liczba
// wierszy `checkbox_stock_` w odpowiedzi > 0 ⇒ produkt istnieje.
export async function productExists(page: Page, code: string): Promise<boolean> {
  // fetch musi lecieć z origin panelu (po scrape strona jest na bady.pl).
  const adminHost = new URL(CFG.adminUrl).host;
  if (!page.url().includes(adminHost)) {
    await page.goto(`${CFG.adminUrl}/stock/list`, { waitUntil: "domcontentloaded" });
  }

  const hits = await page.evaluate(
    async ({ base, code }: { base: string; code: string }) => {
      try {
        const resp = await fetch(`${base}/stock/table?_search=${encodeURIComponent(code)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
          credentials: "include",
          body: JSON.stringify({
            page: 1, limit: 20, sort: "", sortingUsed: 0, order: "",
            filters: [{ name: "filter_search", values: [code] }],
            columns: ["stock_id", "name", "product_image", "stock", "delivery", "price", "active"],
          }),
        });
        const text = await resp.text();
        if (/ctrl-auth|actn-login/i.test(text)) return -1; // wróciła strona logowania
        return (text.match(/checkbox_stock_\d+/g) || []).length;
      } catch {
        return -2; // błąd sieci/fetch
      }
    },
    { base: CFG.adminUrl, code }
  );

  if (hits < 0) {
    throw new Error(
      `Dedup nieudany dla „${code}" (kod ${hits}: ${hits === -1 ? "brak sesji" : "błąd fetch"}). ` +
        "Upewnij się, że okno `npm run browser` jest zalogowane."
    );
  }
  return hits > 0;
}

// ── Dodanie produktu (reguły 3,4,7,8,9) → zwraca ID ──────────
export async function addProduct(
  page: Page,
  p: ScrapedProduct,
  copy: GeneratedCopy,
  category: string,
  images: ProductImage[]
): Promise<string> {
  await page.goto(`${CFG.adminUrl}/products/add`, { waitUntil: "domcontentloaded" });
  await page.locator("#name").waitFor({ state: "visible", timeout: 20000 });

  // Pola tekstowe po stabilnych id
  await page.locator("#name").fill(p.name);
  await page.locator("#code").fill(`${CFG.codePrefix}${p.articleNo}`); // reguła 3: "BD ..."
  const weight = wagaKg(p);
  if (weight) await page.locator("#weight").fill(weight);
  await page.locator("#price").fill(CFG.placeholderPrice); // reguła 9: placeholder > 0

  // Producent (reguła 4) i Kategoria — rozwijane z wyszukiwaniem
  await pickCombo(page, "producer", CFG.producer);
  await pickCombo(page, "category", category);

  // Aktywność OFF (reguła 8) — klik natywnego checkboxa przez JS (pewne, niezależne od stylu)
  await page.evaluate((wanted) => {
    const cb = document.getElementById("active") as HTMLInputElement | null;
    if (cb && cb.checked !== wanted) cb.click();
  }, CFG.activeOnAdd);

  // Opisy (reguła 7) — przez API TinyMCE (bez klikania „wyłącz edytor")
  await setTinyMce(page, "tinymce-content", copy.descriptionHtml);
  await setTinyMce(page, "tinymce-short-content", copy.shortDescriptionHtml);

  // Galeria — wszystkie zdjęcia naraz (reguła 5). Input jest ukryty; setInputFiles działa.
  await page.locator('input[type="file"]').first().setInputFiles(
    images.map((im) => ({ name: im.filename, mimeType: "image/jpeg", buffer: im.buffer }))
  );
  // poczekaj aż miniatury się pojawią (upload xhr)
  await page.waitForTimeout(1500 + images.length * 500);

  // Zapis i powrót na listę
  await page.getByRole("button", { name: "Zapisz i wróć do listy" }).click();
  await page.waitForURL(/\/stock\/list|\/stock($|\?)/, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // ID nowego produktu — pewnie z listy: filtr po kodzie → href linku produktu.
  return await productIdByCode(page, `${CFG.codePrefix}${p.articleNo}`);
}

// Wpisz kod w filtr listy i poczekaj aż wyniki się przeładują.
async function filterListByCode(page: Page, code: string): Promise<void> {
  await page.goto(`${CFG.adminUrl}/stock/list`, { waitUntil: "domcontentloaded" });
  const filter = page.locator("#filter_search").first();
  await filter.waitFor({ state: "visible", timeout: 15000 });
  await filter.fill(code);
  await filter.press("Enter");
  await page.waitForTimeout(1500);
  await waitListLoaded(page);
}

// Najwyższe ID wśród wyników — to nowo dodany produkt (ID rosną).
// UWAGA: filtr po kodzie over-matchuje warianty (np. „BD 2150-02" łapie „-04"),
// a wiersz nie pokazuje kodu; „najnowszy = max ID" celnie wskazuje świeży wpis.
async function newestProductId(page: Page): Promise<string> {
  const ids: string[] = await page
    .locator('#main-list a.link[href*="/products/edit/id/"]')
    .evaluateAll((as) =>
      as
        .map((a) => (a.getAttribute("href") || "").match(/id\/(\d+)/)?.[1])
        .filter((x): x is string => !!x)
    );
  if (!ids.length) return "";
  return String(Math.max(...ids.map(Number)));
}

// Filtr listy po kodzie i odczyt ID nowo dodanego produktu (max ID).
async function productIdByCode(page: Page, code: string): Promise<string> {
  await filterListByCode(page, code);
  return await newestProductId(page);
}

// Czekaj aż lista SPA przestanie się ładować (znika klasa aurora-loader).
async function waitListLoaded(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector("div.list#main-list");
        return !!el && !el.className.includes("aurora-loader");
      },
      { timeout: 15000 }
    )
    .catch(() => {});
}

// Otwórz stronę edycji NOWO dodanego produktu przez listę (deep-link /edit/id/
// ODBIJA na listę, więc klikamy link — router SPA). Celujemy w wiersz o max ID
// (świeżo dodany), bo filtr kodu może zwrócić też starsze warianty.
async function openProductEditByCode(page: Page, code: string): Promise<string> {
  await filterListByCode(page, code);
  const id = await newestProductId(page);
  if (!id) throw new Error(`Nie znalazłem produktu na liście dla kodu ${code}`);
  const link = page.locator(`#main-list a.link[href*="/products/edit/id/${id}"]`).first();
  await link.waitFor({ state: "visible", timeout: 10000 });
  await link.click();
  await page.waitForURL(/\/products\/edit\/id\/\d+/, { timeout: 15000 });
  await page.waitForTimeout(2500);
  return page.url().match(/id\/(\d+)/)?.[1] ?? "";
}

// ── Opisy zdjęć: Opis (SEO) + Opis (dostępność) — best-effort ─
// Wejście na edycję produktu przez listę (po KODZIE, bo deep-link odbija).
// Kolumny galerii to komórki Shoper „inline-edit" (td.inline-edit z data-label);
// klik → textarea → wpis → commit. Celujemy po data-label, per zdjęcie.
export async function fillGalleryDescriptions(
  page: Page,
  code: string,
  imageCopies: ImageCopy[]
): Promise<void> {
  await openProductEditByCode(page, code);

  // Edycja produktu ma lewe menu (sidemenu) z „tab-page" ukrytymi przez display:none.
  // Trzeba aktywować zakładkę „Galeria", inaczej komórki opisów są niewidoczne.
  await page.locator("li.sidemenu__link").filter({ hasText: "Galeria" }).first().click();
  await page.waitForTimeout(1500);

  const seoCells = page.locator('td.inline-edit[data-label="Opis (SEO)"]');
  const altCells = page.locator('td.inline-edit[data-label="Opis (dostępność)"]');
  await seoCells.first().waitFor({ state: "visible", timeout: 8000 });

  const count = Math.min(await seoCells.count(), imageCopies.length);
  if (count === 0) throw new Error("Nie znaleziono komórek opisów w galerii");
  for (let i = 0; i < count; i++) {
    await editInlineCell(page, seoCells.nth(i), imageCopies[i].seo);
    await editInlineCell(page, altCells.nth(i), imageCopies[i].alt);
  }
}

// ── Helpery ───────────────────────────────────────────────────

// Rozwijana lista Shopera (widget `a-dropdown a-select`) — Producent / Kategoria.
// UWAGA: nazewnictwo wrappera jest NIESPÓJNE — Kategoria: `div#category`,
// Producent: `div#producer-container` (a input ma id `producer`). Dlatego
// wyznaczamy widget jako `.a-dropdown` ZAWIERAJĄCY `input#<id>` — działa dla obu.
// Wzorzec: klik toggler → wpisz w „Szukaj" → klik opcji o DOKŁADNYM tekscie
// (żeby „Breloki" nie trafiło w „Breloki > Gumowe").
async function pickCombo(page: Page, inputId: string, value: string): Promise<void> {
  const widget = page
    .locator(".a-dropdown", { has: page.locator(`input#${inputId}`) })
    .first();
  await widget.scrollIntoViewIfNeeded();

  const toggler = widget.locator('[data-test-id="dropdown-toggler"]');
  await ((await toggler.count()) ? toggler.first() : widget).click();

  const content = widget.locator('[data-test-id="dropdown-content"]');
  await content.waitFor({ state: "visible", timeout: 6000 });

  // Pole „Szukaj" wewnątrz dropdownu (jeśli jest) — zawęża listę.
  const search = content.locator("input.control_s");
  if (await search.count()) {
    await search.first().fill(value);
    await page.waitForTimeout(500);
  }

  // Najpierw dokładne dopasowanie, potem fallback „zawiera".
  let option = content.getByText(value, { exact: true });
  if (!(await option.count())) option = content.getByText(value);
  await option.first().waitFor({ state: "visible", timeout: 6000 });
  await option.first().click();
}

// Ustaw treść edytora TinyMCE i zsynchronizuj do textarea (bez trybu HTML w UI).
async function setTinyMce(page: Page, editorId: string, html: string): Promise<void> {
  await page.evaluate(
    ({ id, content }) => {
      const tm = (window as any).tinymce;
      const ed = tm && tm.get(id);
      if (ed) {
        ed.setContent(content);
        ed.save(); // zapis do <textarea>, żeby formularz go wysłał
      }
    },
    { id: editorId, content: html }
  );
}

// Edycja inline komórki galerii Shopera (klik komórki → textarea → commit).
// Commit: Shoper zapisuje inline-edit po utracie fokusu (blur) LUB przez
// przycisk/ikonę „zapisz" obok pola. Próbujemy oba warianty.
async function editInlineCell(page: Page, cell: any, value: string): Promise<void> {
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  const editor = page.locator("textarea:visible").last();
  await editor.waitFor({ state: "visible", timeout: 5000 });
  await editor.fill(value);

  // Wariant 1: przycisk/ikona zapisu w pobliżu edytora.
  const saveBtn = page
    .locator('.inline-edit button, .inline-edit a, [class*="inline-edit"] [class*="save"], button[title*="apisz"], [class*="confirm"]')
    .filter({ hasText: /^\s*(zapisz|ok|✓)?\s*$/i })
    .first();
  if (await saveBtn.count()) {
    await saveBtn.click().catch(() => {});
  }
  // Wariant 2: commit przez blur (klik poza edytorem) — pewny fallback.
  await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.waitForTimeout(500);
}

// Waga w kg (przecinek) z „waga [g]" w danych technicznych.
function wagaKg(p: ScrapedProduct): string | null {
  const g = Object.entries(p.techSpecs).find(([k]) => /waga/i.test(k))?.[1];
  const grams = Number((g || "").replace(/[^\d]/g, ""));
  if (!grams) return null;
  return (grams / 1000).toFixed(3).replace(".", ",");
}
