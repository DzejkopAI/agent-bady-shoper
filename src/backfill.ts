// ─────────────────────────────────────────────────────────────
//  BACKFILL ZDJĘĆ — DRY-RUN (raport zakresu). Bez zapisu do sklepu.
//  Discovery: feed bady (CSV) -> nazwa bady -> slug -> /produkt/<slug>.html.
//  Liczymy zdjęcia sklep (API) vs bady i pokazujemy różnice.
//  UWAGA: bady ma WAF wrażliwy na burst — chodzimy PRZEGLĄDARKĄ (Playwright),
//  jedna sesja/kontekst, mała równoległość + odstępy. NIE gołym fetch!
//  Użycie: npx tsx src/backfill.ts [--sample N] [--conc N] [--delay MS]
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { CFG } from "./config.js";

const CSV_IN = "C:/Users/Administrator/Desktop/product_export.csv";
const CSV_OUT = "C:/Users/Administrator/Desktop/bady_backfill_raport.csv";
const arg = (k: string, d: number) => { const i = process.argv.indexOf(k); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const SAMPLE = arg("--sample", 0);       // 0 = wszystkie
const CONC = arg("--conc", 3);           // łagodnie
const DELAY = arg("--delay", 250);       // ms po każdym produkcie
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function parseLine(line: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) { const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else { if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; } }
  out.push(cur); return out;
}
const normArt = (a: string) => a.replace(/^~/, "").trim().replace(/^0+(\d)/, "$1").toLowerCase();
const slug = (s: string) => s.toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const cell = (s: any) => `"${String(s ?? "").replace(/"/g, '""')}"`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api(path: string): Promise<any> { const r = await fetch(`${CFG.apiBaseUrl}/webapi/rest${path}`, { headers: { Authorization: `Bearer ${CFG.apiToken}` } }); return r.json(); }

// liczba zdjęć produktu bady ze strony /produkt/ (main foto[bms] + distinct foto_add)
async function badyCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const raw = Array.from(document.querySelectorAll("img")).map((i) => (i as HTMLImageElement).src.split("?")[0]).filter((s) => /\/files\/(foto[sbm]|foto_add[a-z_]*)\//i.test(s));
    const hasMain = raw.some((s) => /\/foto[bms]\/product-\d+\.\w+$/i.test(s));
    const adds = new Set(raw.map((s) => (s.match(/foto_add-(\d+)\./i) || [])[1]).filter(Boolean));
    return (hasMain ? 1 : 0) + adds.size;
  });
}

async function pool<T>(items: T[], pages: Page[], fn: (t: T, page: Page) => Promise<void>) {
  let i = 0;
  await Promise.all(pages.map(async (page) => { while (i < items.length) { const k = i++; await fn(items[k], page); await sleep(DELAY); } }));
}

async function main() {
  // feed: artykuł -> nazwa
  const lines = readFileSync(CSV_IN, "utf8").split(/\r?\n/);
  const feed = new Map<string, string>();
  for (let i = 1; i < lines.length; i++) { if (!lines[i]) continue; const c = parseLine(lines[i]); if (c[2]) feed.set(normArt(c[2]), c[29] || ""); }

  // wszystkie produkty BD sklepu (API)
  let prods: any[] = []; let page = 1;
  while (true) { const d = await api(`/products?limit=50&page=${page}`); const list = d.list || [];
    for (const p of list) { const code = p.code || p.stock?.code || ""; if (/^BD\s/i.test(code)) prods.push({ id: p.product_id, code, art: normArt(code.replace(/^BD\s*/i, "")) }); }
    if (page >= Number(d.pages || 1) || !list.length) break; page++; }
  if (SAMPLE > 0) prods = prods.slice(0, SAMPLE);
  console.log(`Produktów BD: ${prods.length}${SAMPLE ? ` (SAMPLE)` : ""}. Przeglądarka Playwright, conc=${CONC}, delay=${DELAY}ms...`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA, locale: "pl-PL" });
  await ctx.addInitScript("globalThis.__name = globalThis.__name || ((fn) => fn);");
  const pages = await Promise.all(Array.from({ length: CONC }, () => ctx.newPage()));

  const rows: any[] = [];
  let done = 0;
  await pool(prods, pages, async (p, pg) => {
    let shopN = -1, badyN = -1, url = "", status = "";
    try {
      const gi = await api(`/product-images?filters=${encodeURIComponent(JSON.stringify({ product_id: p.id }))}&limit=50`);
      shopN = (gi.list || []).length;
      const name = feed.get(p.art);
      if (!name) status = "brak w feedzie";
      else {
        url = `https://www.bady.pl/produkt/${slug(name)}.html`;
        let resp = null;
        for (let a = 0; a < 2 && !resp; a++) { try { resp = await pg.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }); } catch (e) { if (a === 1) throw e; await sleep(1500); } }
        const st = resp?.status() ?? 0;
        if (st === 200) { badyN = await badyCount(pg); status = badyN > 0 ? "ok" : "no-match(0img)"; }
        else status = `http ${st}`;
      }
    } catch (e) { status = "err: " + (e as Error).message.slice(0, 40); }
    rows.push({ code: p.code, art: p.art, name: feed.get(p.art) || "", shopN, badyN, delta: badyN >= 0 ? badyN - shopN : "", url, status });
    if (++done % 50 === 0) console.log(`  ...${done}/${prods.length}`);
  });
  await browser.close();

  // raport
  const header = ["Kod", "Artykul", "NazwaBady", "ZdjeciaSklep", "ZdjeciaBady", "Roznica", "URL", "Status"];
  writeFileSync(CSV_OUT, "\uFEFF" + header.map(cell).join(",") + "\n" +
    rows.map((r) => [r.code, r.art, r.name, r.shopN, r.badyN, r.delta, r.url, r.status].map(cell).join(",")).join("\n"), "utf8");

  const ok = rows.filter((r) => r.status === "ok");
  const more = ok.filter((r) => r.badyN > r.shopN);
  const extra = more.reduce((s, r) => s + (r.badyN - r.shopN), 0);
  const errs = rows.filter((r) => r.status.startsWith("err") || r.status.startsWith("http"));
  console.log(`\n=== RAPORT ===`);
  console.log(`BD produktów: ${rows.length}`);
  console.log(`dopasowanych (bady OK): ${ok.length}`);
  console.log(`z WIĘKSZĄ liczbą zdjęć na bady: ${more.length}  (łącznie do dodania ~${extra} zdjęć)`);
  console.log(`bez dopasowania (feed/slug/0img): ${rows.length - ok.length - errs.length}`);
  console.log(`błędy sieci (http/err): ${errs.length}`);
  console.log(`Zapis: ${CSV_OUT}`);
  console.log("Próbka (do dodania):", JSON.stringify(more.slice(0, 8).map((r) => `${r.code} sklep:${r.shopN} bady:${r.badyN} — ${r.name.slice(0, 30)}`), null, 1));
}
main().then(() => process.exit(0)).catch((e) => { console.error("BLAD:", e.message); process.exit(1); });
