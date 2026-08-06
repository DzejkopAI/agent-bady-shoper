// ─────────────────────────────────────────────────────────────
//  ORKIESTRATOR — spina wszystko w pętlę.
//  Deterministyczny przepływ; Claude wywoływany tylko w brain.*
// ─────────────────────────────────────────────────────────────
import { chromium } from "playwright";
import type { Browser, BrowserContext } from "playwright";
import { CFG } from "./config.js";
import { getNowosciUrls, scrapeProduct, downloadImages } from "./scrape.js";
import { writeListing, writeImageTexts, mapCategory } from "./brain.js";
import { login, productExists, addProduct, fillGalleryDescriptions } from "./panel.js";

async function main() {
  // Podłącz się do TRWAŁEGO okna z `npm run browser` (CDP). Tam żyje sesja
  // Shopera po jednorazowym 2FA — nie startujemy własnej przeglądarki, więc
  // nie ma powtórnego logowania/2FA.
  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(CFG.cdpUrl);
  } catch {
    console.error(
      `✗ Nie mogę podłączyć się do przeglądarki (${CFG.cdpUrl}).\n` +
        "  Najpierw uruchom w osobnym terminalu: `npm run browser`, zaloguj się (raz, z 2FA)\n" +
        "  i zostaw okno otwarte. Potem odpal `npm start` ponownie."
    );
    process.exit(1);
  }

  const context: BrowserContext = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  // Shim dla tsx/esbuild: `keepNames` owija nazwane funkcje wewnątrz
  // page.evaluate w wywołanie __name(...), którego nie ma w przeglądarce.
  // Wstrzykujemy trywialny odpowiednik (forma stringa — esbuild go nie ruszy)
  // na każdą nawigację.
  await page.addInitScript("globalThis.__name = globalThis.__name || ((fn) => fn);");

  try {
    await login(page);
    console.log("✓ Zalogowano do panelu");

    const urls = await getNowosciUrls(page, CFG.nowosciUrl);
    console.log(`Nowości na bady.pl: ${urls.length}`);

    let added = 0;
    for (const url of urls) {
      if (added >= CFG.maxProducts) break;

      // 1) SCRAPE (deterministyczne)
      const product = await scrapeProduct(page, url);
      if (!product.name || !product.articleNo) continue;

      // 2) DEDUP (reguła 2) — pomiń, jeśli już w sklepie (po kodzie `BD <nr>`)
      const code = `${CFG.codePrefix}${product.articleNo}`;
      if (await productExists(page, code)) {
        console.log(`↷ pomijam (jest w sklepie): ${code} — ${product.name}`);
        continue;
      }

      // 3) ZDJĘCIA — pobierz wszystkie (reguła 5)
      const images = await downloadImages(page, product);
      if (images.length === 0) {
        console.log(`↷ pomijam (brak zdjęć): ${product.name}`);
        continue;
      }

      // 4) MÓZG (Claude): opis, opisy zdjęć, kategoria
      const copy = await writeListing(product);
      const imageCopies = await writeImageTexts(product, images);
      const category = await mapCategory(product);

      // 5) DODAJ do panelu jako NIEAKTYWNY (reguły 3,4,7,8,9)
      const id = await addProduct(page, product, copy, category, images);
      console.log(`✓ dodano ID ${id}: ${product.name}  [${category}]`);

      // 6) OPISY ZDJĘĆ (SEO + dostępność) w galerii — best-effort,
      //    nie przerywa runu jeśli coś w galerii się nie zgadza.
      //    Nawigacja po KODZIE (deep-link do edycji odbija na listę).
      try {
        await fillGalleryDescriptions(page, code, imageCopies);
        console.log(`  ✓ opisy ${imageCopies.length} zdjęć uzupełnione`);
      } catch (e) {
        console.warn(`  ! opisy zdjęć pominięte (${(e as Error).message}) — produkt i tak dodany`);
      }

      added++;
    }

    console.log(`\nGotowe. Dodano ${added} produktów (nieaktywnych, do weryfikacji).`);
  } finally {
    // NIE zamykamy okna — należy do `npm run browser` i ma żyć dalej.
    // Nie wołamy browser.close() (mogłoby zamknąć okno); po prostu kończymy
    // proces, co rozłącza połączenie CDP bez zabijania przeglądarki.
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Błąd agenta:", e);
    process.exit(1);
  });
