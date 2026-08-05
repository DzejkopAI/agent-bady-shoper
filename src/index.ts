// ─────────────────────────────────────────────────────────────
//  ORKIESTRATOR — spina wszystko w pętlę.
//  Deterministyczny przepływ; Claude wywoływany tylko w brain.*
// ─────────────────────────────────────────────────────────────
import { chromium } from "playwright";
import { CFG } from "./config.js";
import { getNowosciUrls, scrapeProduct, downloadImages } from "./scrape.js";
import { writeListing, writeImageTexts, mapCategory } from "./brain.js";
import { login, productExists, addProduct, fillGalleryDescriptions } from "./panel.js";

async function main() {
  const browser = await chromium.launch({ headless: !CFG.headful });
  const context = await browser.newContext();
  const page = await context.newPage();

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

      // 2) DEDUP (reguła 2) — pomiń, jeśli już w sklepie
      if (await productExists(page, product.name)) {
        console.log(`↷ pomijam (jest w sklepie): ${product.name}`);
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
      if (id) {
        try {
          await fillGalleryDescriptions(page, id, imageCopies);
          console.log(`  ✓ opisy ${imageCopies.length} zdjęć uzupełnione`);
        } catch (e) {
          console.warn(`  ! opisy zdjęć pominięte (${(e as Error).message}) — produkt i tak dodany`);
        }
      } else {
        console.warn("  ! nie odczytano ID produktu — opisy zdjęć pominięte");
      }

      added++;
    }

    console.log(`\nGotowe. Dodano ${added} produktów (nieaktywnych, do weryfikacji).`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("Błąd agenta:", e);
  process.exit(1);
});
