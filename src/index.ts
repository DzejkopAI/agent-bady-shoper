// ─────────────────────────────────────────────────────────────
//  ORKIESTRATOR — spina wszystko w pętlę.
//  Ręce: bady.pl = przeglądarka (publiczne, headless), Shoper = REST API.
//  Mózg (brain.*) = Claude. Przepływ deterministyczny.
// ─────────────────────────────────────────────────────────────
import { chromium } from "playwright";
import { CFG, productCode } from "./config.js";
import { getNowosciUrls, scrapeProduct, downloadImages } from "./scrape.js";
import { writeListing, writeImageTexts, mapCategory } from "./brain.js";
import { testConnection, productExists, createProduct, addImages } from "./shoper.js";

async function main() {
  // Shoper — sprawdź API zanim ruszymy scraping (szybki fail przy złym tokenie).
  if (!CFG.apiBaseUrl || (!CFG.apiToken && !(CFG.apiLogin && CFG.apiPassword))) {
    console.error("✗ Brak konfiguracji Shoper API — uzupełnij w .env: SHOPER_API_BASE_URL i SHOPER_API_TOKEN.");
    process.exit(1);
  }
  console.log("Shoper API:", await testConnection());

  // bady.pl to publiczny sklep — zwykła przeglądarka headless, bez profilu/2FA/CDP.
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext().then((c) => c.newPage());
  // Shim tsx/esbuild: nazwane funkcje w page.evaluate są owijane w __name.
  await page.addInitScript("globalThis.__name = globalThis.__name || ((fn) => fn);");

  try {
    const urls = await getNowosciUrls(page, CFG.nowosciUrl);
    console.log(`Nowości na bady.pl: ${urls.length}`);

    let added = 0;
    for (const url of urls) {
      if (added >= CFG.maxProducts) break;

      // Izolacja per produkt — błąd jednego nie ubija całego nocnego runu.
      try {
        // 1) SCRAPE bady.pl (przeglądarka)
        const product = await scrapeProduct(page, url);
        if (!product.name || !product.articleNo) continue;

        // 1b) WYKLUCZENIA — np. „personalizowany" (półprodukt do znakowania).
        const lname = product.name.toLowerCase();
        const hit = CFG.excludeNameContains.find((x) => lname.includes(x));
        if (hit) {
          console.log(`↷ pomijam (wykluczone „${hit}"): ${product.name}`);
          continue;
        }

        // 2) DEDUP (reguła 2) — po kodzie `BD <nr>` (padding), przez API (dokładnie).
        const code = productCode(product.articleNo);
        if (await productExists(code)) {
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

        // 5) UTWÓRZ w Shoperze jako NIEAKTYWNY (reguły 3,4,7,8,9) — API
        const id = await createProduct(product, copy, category);
        console.log(`✓ utworzono ID ${id}: ${product.name}  [${category}]`);

        // 6) ZDJĘCIA + OPISY (SEO=name, dostępność=description) — API
        try {
          const n = await addImages(id, images, imageCopies);
          console.log(`  ✓ ${n} zdjęć z opisami dodane`);
        } catch (e) {
          console.warn(`  ! zdjęcia pominięte (${(e as Error).message}) — produkt i tak utworzony`);
        }

        added++;
      } catch (e) {
        console.error(`✗ pominięto produkt (${url}): ${(e as Error).message.split("\n")[0]}`);
        continue;
      }
    }

    console.log(`\nGotowe. Dodano ${added} produktów (nieaktywnych, do weryfikacji).`);
  } finally {
    await browser.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Błąd agenta:", e);
    process.exit(1);
  });
