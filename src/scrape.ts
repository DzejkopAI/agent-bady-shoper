// ─────────────────────────────────────────────────────────────
//  SCRAPING bady.pl  (deterministyczny — czysty DOM, bez Claude)
// ─────────────────────────────────────────────────────────────
import type { Page } from "playwright";
import type { ProductImage, ScrapedProduct } from "./types.js";

// 1) Lista URL-i produktów z kategorii Nowości.
export async function getNowosciUrls(page: Page, nowosciUrl: string): Promise<string[]> {
  await page.goto(nowosciUrl, { waitUntil: "domcontentloaded" });
  const urls = await page.$$eval("a", (as) =>
    Array.from(
      new Set(
        as
          .map((a) => (a as HTMLAnchorElement).href)
          .filter((h) => /\/nowosci\/.+\.html/.test(h))
      )
    )
  );
  return urls;
}

// 2) Szczegóły pojedynczego produktu + adresy WSZYSTKICH zdjęć (reguła 5).
export async function scrapeProduct(page: Page, url: string): Promise<ScrapedProduct> {
  await page.goto(url, { waitUntil: "domcontentloaded" });

  const data = await page.evaluate(() => {
    const text = (el: Element | null) => (el?.textContent ?? "").trim();

    // Nazwa
    const name = text(document.querySelector("h1"));

    // Pary label→wartość z górnej sekcji (Nr artykułu, EAN, Rozmiar, Tworzywo, Opakowanie…)
    // TODO: dostrój selektory do realnego DOM (tu: skan całego <main> po etykietach).
    const main = text(document.querySelector("main"));
    const pick = (label: string) => {
      const re = new RegExp(label + "\\s*:?\\s*\\n?\\s*([^\\n]+)", "i");
      const m = main.match(re);
      return m ? m[1].trim() : "";
    };

    const articleNo = pick("Nr artykułu");
    // EAN na bady bywa ze spacjami („590 17208 2152 2") — Shoper chce samych cyfr.
    const ean = pick("EAN").replace(/[^0-9]/g, "");
    const size = pick("Rozmiar");
    const material = pick("Tworzywo");
    const packaging = pick("Opakowanie");

    // Opis produktu (akapit pod nagłówkiem "Opis produktu")
    let descriptionRaw = "";
    const heads = Array.from(document.querySelectorAll("h1,h2,h3,strong,b"));
    const opisHead = heads.find((h) => /opis produktu/i.test(h.textContent || ""));
    if (opisHead) {
      let n = opisHead.parentElement?.nextElementSibling || opisHead.nextElementSibling;
      const parts: string[] = [];
      let guard = 0;
      while (n && guard++ < 8) {
        const t = (n.textContent || "").trim();
        if (t && !/dane techniczne/i.test(t)) parts.push(t);
        if (/dane techniczne/i.test(t)) break;
        n = n.nextElementSibling;
      }
      descriptionRaw = parts.join("\n\n");
    }

    // Tabela "Dane techniczne" → obiekt {klucz: wartość}
    const techSpecs: Record<string, string> = {};
    document.querySelectorAll("table tr").forEach((tr) => {
      const cells = tr.querySelectorAll("td,th");
      if (cells.length >= 2) {
        const k = (cells[0].textContent || "").trim();
        const v = (cells[1].textContent || "").trim();
        if (k) techSpecs[k] = v;
      }
    });

    // Zdjęcia: bierzemy realne src z <img> w wariancie DUŻYM, zachowując
    // PRAWDZIWE rozszerzenie — bady miewa i .jpg, i .png (na sztywno .jpg dawało 404).
    const base = "https://www.bady.pl/files";
    // UWAGA: zdjęcia dodatkowe bywają serwowane jako foto_add_small/medium
    // (strony /produkt/ na bady) — łapiemy każdy wariant foto_add*, a big
    // budujemy niżej. Bez tego braliśmy tylko główne zdjęcie.
    const raw = Array.from(document.querySelectorAll("img"))
      .map((i) => (i as HTMLImageElement).src.split("?")[0]) // bez ?ts=...
      .filter((s) => /\/files\/(foto[sbm]|foto_add[a-z_]*)\//i.test(s));

    const imageUrls: string[] = [];
    // Główne: preferuj istniejący duży fotob; inaczej zbuduj z fotom/fotos (to samo rozszerzenie).
    let mainImg = raw.find((s) => /\/fotob\/product-\d+\.\w+$/i.test(s));
    if (!mainImg) {
      const alt = raw.find((s) => /\/foto[ms]\/product-\d+\.\w+$/i.test(s));
      if (alt) mainImg = alt.replace(/\/foto[ms]\//i, "/fotob/");
    }
    if (mainImg) imageUrls.push(mainImg);
    // Dodatkowe: foto_add-<id>.<ext> → wariant DUŻY foto_add_big/foto_add-<id>.<ext>.
    const adds = new Set<string>();
    for (const s of raw) {
      const m = s.match(/foto_add-(\d+)\.(\w+)/i);
      if (m) adds.add(`${base}/foto_add_big/foto_add-${m[1]}.${m[2]}`);
    }
    imageUrls.push(...adds);

    return {
      name,
      articleNo,
      ean,
      size,
      material,
      packaging,
      descriptionRaw,
      techSpecs,
      mainImageUrl: imageUrls[0] ?? "",
      imageUrls,
    };
  });

  return { url, ...data };
}

// 3) Pobranie bajtów zdjęć. page.request działa w kontekście przeglądarki,
//    więc bez problemów z CORS/egress (inaczej niż w sandboxie PoC).
export async function downloadImages(page: Page, product: ScrapedProduct): Promise<ProductImage[]> {
  const out: ProductImage[] = [];
  let i = 1;
  for (const url of product.imageUrls) {
    const resp = await page.request.get(url);
    if (!resp.ok()) continue;
    const buffer = Buffer.from(await resp.body());
    const filename = `${slug(product.name)}-${String(i).padStart(2, "0")}.jpg`;
    out.push({ url, filename, buffer });
    i++;
  }
  return out;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}
