// ─────────────────────────────────────────────────────────────
//  ENRICH-SEO — uzupełnia Opis (SEO)=name + Opis (dostępność)=description
//  na ZDJĘCIACH istniejących produktów (wizja Claude). Aktualizuje tylko te,
//  które mają zamiast opisu nazwę pliku / hash / pusto (nie nadpisuje realnych).
//  Zapis przez PUT /product-images/{gfx_id} (token ma update). Bez bady.
//  Użycie: npx tsx src/enrich-seo.ts --codes "BD 2131-05,BD 2136-01"  [--dry]
// ─────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { CFG } from "./config.js";
import { writeImageTexts } from "./brain.js";
import type { ProductImage, ScrapedProduct } from "./types.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const argVal = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const DRY = process.argv.includes("--dry");
function pl(line: string): string[] { const o: string[] = []; let c = "", q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (q) { if (ch === '"') { if (line[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; } else { if (ch === '"') q = true; else if (ch === ",") { o.push(c); c = ""; } else c += ch; } } o.push(c); return o; }
let CODES = (argVal("--codes") || "").split(",").map((s) => s.trim()).filter(Boolean);
// --from-dodane: wczytaj wszystkie kody z raportu dodanych (backfill)
if (process.argv.includes("--from-dodane")) {
  CODES = readFileSync("C:/Users/Administrator/Desktop/bady_backfill_dodane.csv", "utf8").split(/\r?\n/).slice(1).filter(Boolean).map((l) => pl(l)[0]).filter(Boolean);
}

async function api(path: string, method = "GET", body?: any): Promise<any> {
  const r = await fetch(`${CFG.apiBaseUrl}/webapi/rest${path}`, {
    method, headers: { Authorization: `Bearer ${CFG.apiToken}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (r.status >= 400) throw new Error(`HTTP ${r.status} ${path} :: ${t.slice(0, 150)}`);
  try { return JSON.parse(t); } catch { return t; }
}

// „opis" to śmieć (nazwa pliku / hash / pusto / za krótki) → do uzupełnienia
function isJunk(name: string, desc: string): boolean {
  const n = (name || "").trim();
  const d = (desc || "").trim();
  const filename = /\.(jpe?g|png|gif|webp)$/i.test(n);
  const hash = /^[0-9a-f]{16,}$/i.test(n);
  const shortName = n.length < 6;
  const noDesc = d.length < 6;
  return filename || hash || shortName || noDesc;
}

async function fetchBytes(unic: string): Promise<Buffer | null> {
  for (const sz of ["500_500", "250_250", "1200_1200"]) {
    try {
      const r = await fetch(`${CFG.apiBaseUrl}/environment/cache/images/productGfx_${unic}_${sz}.jpg`, { headers: { "User-Agent": UA } });
      if (r.ok) { const b = Buffer.from(await r.arrayBuffer()); if (b.length > 100) return b; }
    } catch { /* następny rozmiar */ }
  }
  return null;
}

async function main() {
  const CONC = Number(argVal("--conc") || 4);
  // --all-bd / --non-bd / --all: zbierz kody ze sklepu (stronicowanie)
  const ALL_BD = process.argv.includes("--all-bd");
  const NON_BD = process.argv.includes("--non-bd");
  const ALL = process.argv.includes("--all");
  if (ALL_BD || NON_BD || ALL) {
    let page = 1;
    while (true) {
      const d = await api(`/products?limit=50&page=${page}`);
      const lst = d.list || [];
      for (const p of lst) {
        const c = p.code || p.stock?.code || "";
        if (!c) continue;
        const isBd = /^BD\s/i.test(c);
        if (ALL || (ALL_BD && isBd) || (NON_BD && !isBd)) CODES.push(c);
      }
      if (page >= Number(d.pages || 1) || !lst.length) break; page++;
    }
    console.log(`${ALL ? "--all" : ALL_BD ? "--all-bd" : "--non-bd"}: zebrano ${CODES.length} produktów`);
  }
  if (!CODES.length) { console.error("Podaj --codes / --from-dodane / --all-bd"); process.exit(1); }
  console.log(`${DRY ? "[DRY] " : ""}Enrich SEO/dostępność dla ${CODES.length} produktów (conc=${CONC}).\n`);
  let updated = 0, done = 0, prodUpd = 0, prodSkip = 0, errs = 0, creditOut = false;

  function flush(buf: string[]) {
    if (++done % 50 === 0) buf.push(`  … ${done}/${CODES.length} (opisano ${updated} zdj, produktów ${prodUpd})`);
    if (buf.length) console.log(buf.join("\n"));
  }

  async function processOne(code: string) {
    const buf: string[] = [];
    try {
      const pr = await api(`/products?limit=1&filters=${encodeURIComponent(JSON.stringify({ "stock.code": code }))}`);
      const prod = pr.list?.[0];
      if (!prod) { buf.push(`✗ ${code}: nie ma w sklepie`); return flush(buf); }
      const shopName = prod.translations?.[CFG.lang]?.name || prod.name || code;
      const gi = await api(`/product-images?filters=${encodeURIComponent(JSON.stringify({ product_id: prod.product_id }))}&limit=60`);
      const list = (gi.list || []).sort((a: any, b: any) => Number(a.order) - Number(b.order));
      const need = list.filter((x: any) => isJunk(x.name || x.translations?.[CFG.lang]?.name || "", x.translations?.[CFG.lang]?.description || ""));
      if (!need.length) { prodSkip++; return flush(buf); } // cicho — miały opisy

      const imgs: (ProductImage & { gfx: string })[] = [];
      for (const x of need) {
        const b = await fetchBytes(String(x.unic_name));
        if (b) imgs.push({ url: "", filename: `${x.gfx_id}.jpg`, buffer: b, gfx: String(x.gfx_id) });
      }
      if (!imgs.length) { buf.push(`! ${code}: brak bajtów zdjęć`); return flush(buf); }

      const texts = (await writeImageTexts({ name: shopName } as ScrapedProduct, imgs)) ?? [];
      let n = 0;
      for (let i = 0; i < imgs.length; i++) {
        const t = texts[i] || { seo: "", alt: "" };
        if (!DRY && (t.seo || t.alt)) {
          await api(`/product-images/${imgs[i].gfx}`, "PUT", { translations: { [CFG.lang]: { name: t.seo || "", description: t.alt || "" } } });
          updated++; n++;
        }
      }
      if (n) prodUpd++;
      buf.push(`✓ ${code} — ${shopName.slice(0, 40)}: +${n} opis`);
    } catch (e) {
      errs++;
      const msg = (e as Error).message || "";
      if (/credit balance is too low/i.test(msg)) { creditOut = true; buf.push(`✗ ${code}: KREDYTY Anthropic wyczerpane — przerywam (doładuj i wznów)`); }
      else buf.push(`✗ ${code}: BŁĄD ${msg.replace(/\s+/g, " ").slice(0, 120)}`);
    }
    return flush(buf);
  }

  let idx = 0;
  await Promise.all(Array.from({ length: CONC }, async () => { while (idx < CODES.length && !creditOut) await processOne(CODES[idx++]); }));
  if (creditOut) console.log(`\n⚠ PRZERWANO: kredyty Anthropic wyczerpane. Doładuj i wznów tym samym poleceniem (idempotentnie dokończy resztę).`);

  console.log(`\n${DRY ? "[DRY] " : ""}Gotowe. Produktów: ${CODES.length} | z dodanymi opisami: ${prodUpd} | pominięte (miały opisy): ${prodSkip} | błędy: ${errs} | zaktualizowanych zdjęć: ${updated}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error("BLAD:", e.message); process.exit(1); });
