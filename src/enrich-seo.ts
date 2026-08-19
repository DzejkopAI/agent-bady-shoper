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
  if (!CODES.length) { console.error("Podaj --codes \"BD ...,BD ...\""); process.exit(1); }
  console.log(`${DRY ? "[DRY] " : ""}Enrich SEO/dostępność dla ${CODES.length} produktów.\n`);
  let updated = 0, skipped = 0;

  for (const code of CODES) {
    try {
      const pr = await api(`/products?limit=1&filters=${encodeURIComponent(JSON.stringify({ "stock.code": code }))}`);
      const prod = pr.list?.[0];
      if (!prod) { console.log(`✗ ${code}: nie ma w sklepie`); continue; }
      const shopName = prod.translations?.[CFG.lang]?.name || prod.name || code;
      const gi = await api(`/product-images?filters=${encodeURIComponent(JSON.stringify({ product_id: prod.product_id }))}&limit=60`);
      const list = (gi.list || []).sort((a: any, b: any) => Number(a.order) - Number(b.order));

      // które wymagają uzupełnienia
      const need = list.filter((x: any) => isJunk(x.name || x.translations?.[CFG.lang]?.name || "", x.translations?.[CFG.lang]?.description || ""));
      if (!need.length) { console.log(`• ${code} — ${shopName}: wszystkie ${list.length} zdj mają opisy, pomijam`); continue; }

      // pobierz bajty
      const imgs: (ProductImage & { gfx: string })[] = [];
      for (const x of need) {
        const buf = await fetchBytes(String(x.unic_name));
        if (buf) imgs.push({ url: "", filename: `${x.gfx_id}.jpg`, buffer: buf, gfx: String(x.gfx_id) });
        else console.log(`  ! ${code} gfx${x.gfx_id}: nie pobrałem bajtów — pomijam to zdjęcie`);
      }
      if (!imgs.length) { console.log(`✗ ${code}: brak bajtów zdjęć`); continue; }

      // wizja: SEO + dostępność (dla spójności — wszystkie razem)
      const texts = (await writeImageTexts({ name: shopName } as ScrapedProduct, imgs)) ?? [];
      console.log(`${code} — ${shopName}: uzupełniam ${imgs.length}/${list.length} zdj`);
      for (let i = 0; i < imgs.length; i++) {
        const t = texts[i] || { seo: "", alt: "" };
        console.log(`  ord? gfx${imgs[i].gfx}: SEO="${(t.seo || "").slice(0, 50)}" | dost="${(t.alt || "").slice(0, 40)}"`);
        if (!DRY && (t.seo || t.alt)) {
          await api(`/product-images/${imgs[i].gfx}`, "PUT", { translations: { [CFG.lang]: { name: t.seo || "", description: t.alt || "" } } });
          updated++;
        }
      }
    } catch (e) { console.log(`✗ ${code}: BŁĄD ${(e as Error).message.slice(0, 80)}`); }
  }
  console.log(`\n${DRY ? "[DRY] " : ""}Zaktualizowanych zdjęć: ${updated}${skipped ? `, pominiętych: ${skipped}` : ""}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error("BLAD:", e.message); process.exit(1); });
