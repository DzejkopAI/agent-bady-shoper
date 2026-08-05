// ─────────────────────────────────────────────────────────────
//  PANEL Shoper — ręce agenta (Playwright).
//  UWAGA: selektory oznaczone TODO trzeba potwierdzić na żywym panelu
//  (użyj `npx playwright codegen <adres>` żeby je nagrać).
//  Wnioski z PoC: nie zmieniać rozmiaru okna; czekać na network-idle;
//  formularz wypełniać po kolei.
// ─────────────────────────────────────────────────────────────
import type { Page } from "playwright";
import { CFG } from "./config.js";
import type { GeneratedCopy, ImageCopy, ProductImage, ScrapedProduct } from "./types.js";

// ── Logowanie do panelu ───────────────────────────────────────
export async function login(page: Page): Promise<void> {
  await page.goto(CFG.adminUrl, { waitUntil: "networkidle" });
  // Jeśli już zalogowany (cookie/sesja), pomiń.
  if (page.url().includes("/dashboard") || (await page.getByText("Pulpit").count()) > 0) return;

  // TODO: potwierdź selektory pól logowania
  await page.getByLabel(/login|e-?mail/i).fill(CFG.login);
  await page.getByLabel(/hasło|password/i).fill(CFG.password);
  await page.getByRole("button", { name: /zaloguj/i }).click();
  await page.waitForLoadState("networkidle");
  // Jeśli tu wyskoczy 2FA/CAPTCHA — agent musi się zatrzymać (patrz README).
}

// ── Deduplikacja (reguła 2): czy produkt już jest w sklepie? ──
export async function productExists(page: Page, phrase: string): Promise<boolean> {
  await page.goto(`${CFG.adminUrl}/stock/list`, { waitUntil: "networkidle" });
  const search = page.getByPlaceholder(/szukaj produktu/i); // TODO potwierdź
  await search.fill(phrase);
  await search.press("Enter");
  await page.waitForLoadState("networkidle");
  const foundText = await page.getByText(/znaleziono\s+\d+\s+wynik/i).textContent().catch(() => "");
  const n = Number((foundText || "").match(/(\d+)/)?.[1] ?? "0");
  return n > 0;
}

// ── Dodanie produktu (reguły 3,4,7,8,9) → zwraca ID produktu ──
export async function addProduct(
  page: Page,
  p: ScrapedProduct,
  copy: GeneratedCopy,
  category: string,
  images: ProductImage[]
): Promise<string> {
  await page.goto(`${CFG.adminUrl}/products/add`, { waitUntil: "networkidle" });

  // Nazwa
  await page.getByLabel("Nazwa", { exact: false }).fill(p.name);

  // Kod produktu = "BD " + numer artykułu (reguła 3) — nadpisujemy auto-kod
  const code = page.getByLabel("Kod produktu", { exact: false });
  await code.fill("");
  await code.fill(`${CFG.codePrefix}${p.articleNo}`);

  // Producent (reguła 4) — dropdown z wyszukiwaniem
  await selectFromCombo(page, /producent/i, CFG.producer);

  // Aktywność OFF (reguła 8) — toggle domyślnie ON
  const active = page.getByRole("switch", { name: /aktywność/i }); // TODO potwierdź rolę
  if ((await active.getAttribute("aria-checked")) === "true") await active.click();

  // Waga (z danych technicznych, jeśli są; format polski z przecinkiem)
  const weight = wagaKg(p);
  if (weight) await page.getByLabel("Waga", { exact: false }).fill(weight);

  // Cena — placeholder > 0 (reguła 9)
  await page.getByLabel(/cena/i).first().fill(CFG.placeholderPrice); // TODO potwierdź selektor pola ceny

  // Kategoria główna — dropdown z wyszukiwaniem
  await selectFromCombo(page, /kategoria główna/i, category);

  // Opisy — tryb HTML ("wyłącz edytor") i wklejenie gotowego HTML (reguła 7)
  await fillHtmlEditor(page, "Krótki opis produktu", copy.shortDescriptionHtml);
  await fillHtmlEditor(page, "Opis produktu", copy.descriptionHtml);

  // Galeria — upload wszystkich zdjęć (reguła 5)
  const fileInput = page.locator('input[type="file"]').first(); // TODO potwierdź, że to input galerii
  await fileInput.setInputFiles(
    images.map((im) => ({ name: im.filename, mimeType: "image/jpeg", buffer: im.buffer }))
  );
  await page.waitForLoadState("networkidle");

  // Zapis → powrót na listę
  await page.getByRole("button", { name: /zapisz i wróć do listy/i }).click();
  await page.waitForLoadState("networkidle");

  // Odczyt ID nowego produktu (pierwszy wiersz listy po zapisie)
  const idText = await page.locator("table tbody tr").first().locator("td").first().textContent();
  return (idText || "").trim();
}

// ── Opisy zdjęć w galerii: Opis (SEO) + Opis (dostępność) ─────
//  (widok edycji produktu → zakładka Galeria → edycja inline komórek)
export async function fillGalleryDescriptions(
  page: Page,
  productId: string,
  imageCopies: ImageCopy[]
): Promise<void> {
  await page.goto(`${CFG.adminUrl}/products/edit/id/${productId}`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: /galeria/i }).click(); // zakładka
  await page.waitForLoadState("networkidle");

  const rows = page.locator("table tbody tr");
  const count = Math.min(await rows.count(), imageCopies.length);
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    // TODO: potwierdź indeksy kolumn "Opis (SEO)" i "Opis (dostępność)".
    await editInlineCell(page, row, "Opis (SEO)", imageCopies[i].seo);
    await editInlineCell(page, row, "Opis (dostępność)", imageCopies[i].alt);
  }
}

// ── Helpery ───────────────────────────────────────────────────

// Dropdown-wyszukiwarka: klik, wpisz frazę, kliknij pasującą opcję.
async function selectFromCombo(page: Page, label: RegExp, value: string) {
  const combo = page.getByText(label).locator("xpath=following::*[self::input or self::button][1]");
  await combo.click();
  await page.keyboard.type(value.slice(0, 8));
  await page.getByRole("option", { name: value }).first().click().catch(async () => {
    await page.getByText(value, { exact: true }).first().click();
  });
}

// Edytor TinyMCE: przełącz na tryb HTML ("wyłącz edytor"), wklej HTML.
async function fillHtmlEditor(page: Page, sectionLabel: string, html: string) {
  const section = page.locator(`text=${sectionLabel}`).locator("xpath=ancestor::*[1]");
  await section.getByText(/wyłącz edytor/i).click();
  const textarea = section.locator("textarea").first();
  await textarea.fill(html);
  await section.getByText(/włącz edytor/i).click(); // sparsuj HTML z powrotem
}

// Inline edycja komórki tabeli galerii.
async function editInlineCell(page: Page, row: any, columnLabel: string, value: string) {
  // Klik w komórkę otwiera textarea + przycisk "Zapisz".
  const headers = await page.locator("table thead th").allTextContents();
  const colIdx = headers.findIndex((h) => h.includes(columnLabel));
  if (colIdx < 0) return;
  await row.locator("td").nth(colIdx).click();
  const editor = page.locator("textarea:visible").last();
  await editor.fill(value);
  await page.getByRole("button", { name: /^zapisz$/i }).click();
  await page.waitForTimeout(400); // zapis per-komórka
}

// Waga w kg z formatem polskim (przecinek). Szuka "waga [g]" w danych technicznych.
function wagaKg(p: ScrapedProduct): string | null {
  const g = Object.entries(p.techSpecs).find(([k]) => /waga/i.test(k))?.[1];
  const grams = Number((g || "").replace(/[^\d]/g, ""));
  if (!grams) return null;
  return (grams / 1000).toFixed(3).replace(".", ",");
}
