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
export async function productExists(page: Page, name: string): Promise<boolean> {
  await page.goto(`${CFG.adminUrl}/stock/list`, { waitUntil: "domcontentloaded" });
  const search = page.getByPlaceholder(/szukaj produktu/i);
  await search.waitFor({ state: "visible", timeout: 15000 });
  await search.fill(name);
  await search.press("Enter");
  await page.waitForTimeout(1500);

  const body = await page.locator("body").innerText();
  if (/nie znaleziono/i.test(body)) return false;
  const m = body.match(/znaleziono\s+(\d+)\s+wynik/i);
  if (m) return Number(m[1]) > 0;
  return (await page.locator("table tbody tr").count()) > 0;
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

  // ID nowego produktu = pierwszy wiersz listy
  const rowText = await page.locator("table tbody tr").first().innerText().catch(() => "");
  const id = (rowText.match(/\b(\d{3,})\b/) || [])[1] || "";
  return id;
}

// ── Opisy zdjęć: Opis (SEO) + Opis (dostępność) — best-effort ─
export async function fillGalleryDescriptions(
  page: Page,
  productId: string,
  imageCopies: ImageCopy[]
): Promise<void> {
  await page.goto(`${CFG.adminUrl}/products/edit/id/${productId}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: /galeria/i }).click();
  await page.waitForTimeout(1500);

  const headers = await page.locator("table thead th").allTextContents();
  const seoCol = headers.findIndex((h) => /opis \(seo\)/i.test(h));
  const altCol = headers.findIndex((h) => /opis \(dost/i.test(h));
  if (seoCol < 0 || altCol < 0) throw new Error("Nie znaleziono kolumn opisów w galerii");

  const rows = page.locator("table tbody tr");
  const count = Math.min(await rows.count(), imageCopies.length);
  for (let i = 0; i < count; i++) {
    await editInlineCell(page, rows.nth(i), seoCol, imageCopies[i].seo);
    await editInlineCell(page, rows.nth(i), altCol, imageCopies[i].alt);
  }
}

// ── Helpery ───────────────────────────────────────────────────

// Rozwijana lista z wyszukiwaniem (Producent / Kategoria).
async function pickCombo(page: Page, inputId: string, value: string): Promise<void> {
  const input = page.locator(`#${inputId}`);
  await input.scrollIntoViewIfNeeded();
  await input.click();
  await page.keyboard.type(value, { delay: 30 });
  await page.waitForTimeout(600);
  // kliknij opcję o dokładnym tekscie (ostatnia — pod polem, nie w innym miejscu strony)
  const option = page.getByText(value, { exact: true }).last();
  await option.waitFor({ state: "visible", timeout: 6000 });
  await option.click();
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

// Edycja inline komórki galerii (klik → textarea → Zapisz).
async function editInlineCell(page: Page, row: any, colIdx: number, value: string): Promise<void> {
  await row.locator("td").nth(colIdx).click();
  const editor = page.locator("textarea:visible").last();
  await editor.waitFor({ state: "visible", timeout: 5000 });
  await editor.fill(value);
  await page.getByRole("button", { name: /^zapisz$/i }).click();
  await page.waitForTimeout(500);
}

// Waga w kg (przecinek) z „waga [g]" w danych technicznych.
function wagaKg(p: ScrapedProduct): string | null {
  const g = Object.entries(p.techSpecs).find(([k]) => /waga/i.test(k))?.[1];
  const grams = Number((g || "").replace(/[^\d]/g, ""));
  if (!grams) return null;
  return (grams / 1000).toFixed(3).replace(".", ",");
}
