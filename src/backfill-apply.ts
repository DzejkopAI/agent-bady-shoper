// ─────────────────────────────────────────────────────────────
//  BACKFILL ZDJĘĆ — APPLY (ZAPISUJE do sklepu!).
//  Dla wskazanych produktów BD: scrape zdjęć bady -> pobranie zdjęć sklepu ->
//  WIZJA (pickImagesToAdd: pomija duplikaty i „tył") -> upload brakujących
//  z Opisem SEO + dostępności. main=0 (nie ruszamy głównego), order po istniejących.
//  bady TYLKO Playwright, łagodnie (WAF). Użycie:
//    npx tsx src/backfill-apply.ts --n 10            (pierwsze 10 kandydatów z raportu)
//    npx tsx src/backfill-apply.ts --codes "BD 0002,BD 0017"
//    dopisz --dry aby wizja policzyła, ale NIC nie wgrywać (podgląd decyzji)
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { CFG } from "./config.js";
import { scrapeProduct, downloadImages } from "./scrape.js";
import { pickImagesToAdd, writeImageTexts } from "./brain.js";
import type { ProductImage } from "./types.js";

const CSV_IN = "C:/Users/Administrator/Desktop/product_export.csv";
const REPORT = "C:/Users/Administrator/Desktop/bady_backfill_raport.csv";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const argVal = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const DRY = process.argv.includes("--dry");
const N = Number(argVal("--n") || 10);
const CODES = argVal("--codes");
const DELAY = 400;
const CONC = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseLine(line: string): string[] {
  const out: string[] = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) { const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else { if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; } }
  out.push(cur); return out;
}
const normArt = (a: string) => a.replace(/^~/, "").trim().replace(/^0+(\d)/, "$1").toLowerCase();
const slug = (s: string) => s.toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

async function api(path: string, opts: RequestInit = {}): Promise<any> {
  const r = await fetch(`${CFG.apiBaseUrl}/webapi/rest${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${CFG.apiToken}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const t = await r.text();
  if (r.status >= 400) throw new Error(`HTTP ${r.status} ${path} :: ${t.slice(0, 200)}`);
  try { return JSON.parse(t); } catch { return t; }
}

async function shopImages(productId: string): Promise<{ buffers: Buffer[]; maxOrder: number }> {
  const gi = await api(`/product-images?filters=${encodeURIComponent(JSON.stringify({ product_id: productId }))}&limit=50`);
  const list = (gi.list || []).sort((a: any, b: any) => Number(a.order) - Number(b.order));
  const buffers: Buffer[] = [];
  let maxOrder = 0;
  for (const x of list) {
    maxOrder = Math.max(maxOrder, Number(x.order) || 0);
    try {
      const u = `${CFG.apiBaseUrl}/environment/cache/images/productGfx_${x.unic_name}_500_500.jpg`;
      const r = await fetch(u, { headers: { "User-Agent": UA } });
      if (r.ok) buffers.push(Buffer.from(await r.arrayBuffer()));
    } catch { /* pomiń pojedyncze */ }
  }
  return { buffers, maxOrder };
}

// wybór kodów: --codes albo pierwsze N kandydatów (delta>0) z raportu
function pickCodes(): string[] {
  if (CODES) return CODES.split(",").map((s) => s.trim()).filter(Boolean);
  const rows = readFileSync(REPORT, "utf8").split(/\r?\n/).slice(1).filter(Boolean).map(parseLine);
  return rows.filter((r) => r[7] === "ok" && Number(r[5]) > 0).slice(0, N).map((r) => r[0]);
}

async function main() {
  // feed: artykuł -> nazwa (do sluga bady)
  const lines = readFileSync(CSV_IN, "utf8").split(/\r?\n/);
  const feed = new Map<string, string>();
  for (let i = 1; i < lines.length; i++) { if (!lines[i]) continue; const c = parseLine(lines[i]); if (c[2]) feed.set(normArt(c[2]), c[29] || ""); }

  const codes = pickCodes();
  console.log(`${DRY ? "[DRY] " : ""}Produkty do backfillu (${codes.length}): ${codes.join(", ")}\n`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA, locale: "pl-PL" });
  await ctx.addInitScript("globalThis.__name = globalThis.__name || ((fn) => fn);");
  const pages = await Promise.all(Array.from({ length: CONC }, () => ctx.newPage()));

  // Bezpiecznik spójności: gdy uzasadnienie mówi „pomiń", a model dał add=true —
  // wymuszamy pominięcie. Tylko add->skip. Zgodnie z decyzją właściciela:
  //  - wariant tła/koloru/rozdzielczości = duplikat -> pomiń,
  //  - BRZYDKI techniczny tył (magnes/zapięcie/spód/naklejka) -> pomiń,
  //  - ŁADNY rewers (mapa/grafika) NIE jest tu łapany -> może zostać dodany (opcja B).
  // UWAGA: bez \b — w JS \b nie działa z „ł"/„ó" (spoza ASCII); używamy podłańcuchów.
  const SKIP_RE = /duplikat|identyczn|to samo uj|to samo zdj|to ten sam|niepotrzebn|nieestetyczn|zbędn|zbedn|innym tle|inne tło|inne tlo|wariant kolorystyczn|rozdzielczości|rozdzielczosci|tył magnesu|spód magnesu|zapięci|zapink|mechanizm|teksturowan|napisem producenta|naklejk/i;

  const summary: any[] = [];
  let idx = 0, done = 0;

  async function processCode(code: string, page: Page): Promise<{ line: any; buf: string[] }> {
    const art = normArt(code.replace(/^BD\s*/i, ""));
    const line: any = { code, added: 0, note: "", id: "", shopName: "", adds: [] as string[] };
    const buf: string[] = [];
    try {
      // 1) produkt w sklepie
      const pr = await api(`/products?limit=1&filters=${encodeURIComponent(JSON.stringify({ "stock.code": code }))}`);
      const prod = pr.list?.[0];
      if (!prod) { line.note = "nie ma w sklepie"; buf.push(`✗ ${code}: nie ma w sklepie`); return { line, buf }; }
      line.id = String(prod.product_id);
      line.shopName = prod.translations?.[CFG.lang]?.name || prod.name || "";
      const { buffers: shopBuf, maxOrder } = await shopImages(line.id);

      // 2) bady
      const name = feed.get(art);
      if (!name) { line.note = "brak w feedzie"; buf.push(`✗ ${code}: brak w feedzie`); return { line, buf }; }
      const url = `https://www.bady.pl/produkt/${slug(name)}.html`;
      const scraped = await scrapeProduct(page, url);
      const badyImgs: ProductImage[] = await downloadImages(page, scraped);
      await sleep(DELAY);
      if (!badyImgs.length) { line.note = "bady: 0 zdjęć"; buf.push(`✗ ${code}: bady 0 zdjęć (${url})`); return { line, buf }; }
      // SAFEGUARD: strona-seria (bady grupuje rodzeństwo/warianty w jednej galerii) →
      // wizja brałaby OBCE produkty za „warianty". Powyżej progu pomijamy do ręcznego przeglądu.
      if (badyImgs.length >= 8) { line.note = `seria? bady ${badyImgs.length} zdj — pominięto`; buf.push(`⚠ ${code}: bady ${badyImgs.length} zdj (podejrzenie serii wariantów) — POMINIĘTO, do ręcznego przeglądu`); return { line, buf }; }

      // 3) WIZJA — które kandydatów dodać (+ bezpiecznik)
      const decisions = await pickImagesToAdd(scraped.name || line.shopName, shopBuf, badyImgs.map((b) => b.buffer));
      const toAdd: ProductImage[] = [];
      buf.push(`${code} — ${line.shopName}`);
      badyImgs.forEach((img, i) => {
        let d = decisions[i] || { add: false, reason: "brak decyzji" };
        if (d.add && SKIP_RE.test(d.reason)) d = { add: false, reason: "[bezpiecznik] " + d.reason };
        buf.push(`  ${d.add ? "＋" : "－"} kand.${i + 1}: ${d.reason}`);
        if (d.add) toAdd.push(img);
      });
      // Twardy limit bezpieczeństwa: max 4 nowe zdjęcia na produkt (gdyby seria przecisnęła się < progu).
      if (toAdd.length > 4) { buf.push(`  ⚠ przycięto z ${toAdd.length} do 4 (podejrzenie serii)`); toAdd.length = 4; }
      buf.splice(1, 0, `   sklep: ${shopBuf.length} zdj | bady: ${badyImgs.length} | wizja dodaje: ${toAdd.length}`);

      // 4) opisy + upload (main=0, order po istniejących)
      if (toAdd.length && !DRY) {
        const texts = (await writeImageTexts(scraped, toAdd)) ?? [];
        for (let k = 0; k < toAdd.length; k++) {
          const t = texts[k] || { seo: "", alt: "" };
          await api("/product-images", {
            method: "POST",
            body: JSON.stringify({
              product_id: Number(line.id),
              main: 0,
              order: maxOrder + 1 + k,
              content: toAdd[k].buffer.toString("base64"),
              translations: { [CFG.lang]: { name: t.seo || "", description: t.alt || "" } },
            }),
          });
          line.adds.push(t.seo || "(bez opisu)");
        }
        line.added = toAdd.length;
      }
      line.note = DRY ? `dodałbym ${toAdd.length}` : `dodano ${toAdd.length}`;
    } catch (e) {
      line.note = "BŁĄD: " + (e as Error).message.slice(0, 80);
      buf.push(`✗ ${code}: ${line.note}`);
    }
    return { line, buf };
  }

  async function worker(page: Page) {
    while (idx < codes.length) {
      const code = codes[idx++];
      const { line, buf } = await processCode(code, page);
      summary.push(line);
      if (++done % 25 === 0) buf.push(`  … postęp ${done}/${codes.length}`);
      console.log(buf.join("\n"));
    }
  }
  await Promise.all(pages.map((p) => worker(p)));
  await browser.close();

  // podsumowanie + CSV dodanych
  const withAdds = summary.filter((s) => s.added > 0).sort((a, b) => a.code.localeCompare(b.code));
  const total = summary.reduce((n, s) => n + (s.added || 0), 0);
  const errs = summary.filter((s) => /^BŁĄD/.test(s.note)).length;
  console.log(`\n=== PODSUMOWANIE ===`);
  console.log(`${DRY ? "[DRY] " : ""}Produktów: ${summary.length} | z dodanymi zdjęciami: ${withAdds.length} | łącznie ${DRY ? "do dodania" : "dodanych"} zdjęć: ${total} | błędy: ${errs}`);
  if (!DRY) {
    const cell = (s: any) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const out = "C:/Users/Administrator/Desktop/bady_backfill_dodane.csv";
    const rows = withAdds.map((s) => [s.code, s.id, s.shopName, s.added, s.adds.join(" | "), `https://www.pamiatkizpolski.pl/pl/p/x/${s.id}`].map(cell).join(","));
    writeFileSync(out, "\uFEFF" + ["Kod", "id", "Nazwa", "DodanoZdjec", "OpisySEO", "Podglad"].map(cell).join(",") + "\n" + rows.join("\n"), "utf8");
    console.log(`Lista dodanych (do przeglądu): ${out}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error("BLAD:", e.message); process.exit(1); });
