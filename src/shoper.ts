// ─────────────────────────────────────────────────────────────
//  SHOPER REST API — „ręce" po stronie sklepu (zamiast klikania panelu).
//  Determinizm: dedup po kodzie, utworzenie nieaktywnego produktu, zdjęcia
//  z opisami (alt/SEO + dostępność). Zwalidowane spike'ami 2026-08-06.
//
//  AUTH: Bearer token z .env (SHOPER_API_TOKEN); fallback login+hasło -> /auth.
//  Zapis JEST celem tego agenta (dodaje nowości) — ale zawsze jako NIEAKTYWNE.
// ─────────────────────────────────────────────────────────────
import { CFG, productCode } from "./config.js";
import type { GeneratedCopy, ImageCopy, ProductImage, ScrapedProduct } from "./types.js";

const RETRY = 3;
const RETRY_WAIT_MS = 1500;
const TIMEOUT_MS = 30000;

let _token: string | null = null;

async function getToken(): Promise<string> {
  if (_token) return _token;
  if (CFG.apiToken) return (_token = CFG.apiToken);
  if (CFG.apiLogin && CFG.apiPassword) {
    const basic = Buffer.from(`${CFG.apiLogin}:${CFG.apiPassword}`).toString("base64");
    const r = await fetch(`${CFG.apiBaseUrl}/webapi/rest/auth`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}` },
    });
    if (!r.ok) throw new Error(`Auth /auth ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j: any = await r.json();
    return (_token = j.access_token);
  }
  throw new Error("Brak SHOPER_API_TOKEN i brak login/hasło — uzupełnij .env.");
}

async function api(path: string, opts: RequestInit = {}): Promise<{ status: number; json: any; text: string }> {
  const token = await getToken();
  const url = `${CFG.apiBaseUrl}/webapi/rest${path}`;
  let last: { status: number; text: string } | null = null;
  for (let i = 1; i <= RETRY; i++) {
    let r: Response;
    try {
      r = await fetch(url, {
        ...opts,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      if (i < RETRY) { await sleep(RETRY_WAIT_MS * i); continue; }
      throw new Error(`Sieć (po ${RETRY} próbach): ${path} :: ${(e as Error).message}`);
    }
    const text = await r.text();
    if (r.status < 400) {
      let json: any = null;
      try { json = JSON.parse(text); } catch { /* część odpowiedzi to gołe id */ }
      return { status: r.status, json, text };
    }
    last = { status: r.status, text };
    if (r.status === 429 || r.status >= 500) { await sleep(RETRY_WAIT_MS * i); continue; }
    break;
  }
  throw new Error(`HTTP ${last?.status} ${path} :: ${(last?.text || "").replace(/\s+/g, " ").slice(0, 300)}`);
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// ── Test połączenia ────────────────────────────────────────────
export async function testConnection(): Promise<string> {
  const r = await api("/products?limit=1");
  return `OK — API odpowiada, produktów w sklepie: ${r.json?.count ?? "?"}`;
}

// ── Deduplikacja (reguła 2) — dokładnie po kodzie wariantu ──────
export async function productExists(code: string): Promise<boolean> {
  const filters = encodeURIComponent(JSON.stringify({ "stock.code": code }));
  const r = await api(`/products?limit=1&filters=${filters}`);
  return Array.isArray(r.json?.list) && r.json.list.length > 0;
}

// ── Kategorie: mapa nazwa(lower) -> category_id (cache) ─────────
let _catMap: Map<string, string> | null = null;

async function categoryMap(): Promise<Map<string, string>> {
  if (_catMap) return _catMap;
  const map = new Map<string, string>();
  const first = await api(`/categories?limit=50&page=1`);
  const pages = Math.min(Number(first.json?.pages || 1), 40);
  const add = (list: any[]) => {
    for (const c of list || []) {
      const tr = c.translations || {};
      const name = tr?.[CFG.lang]?.name ?? (Object.values(tr)[0] as any)?.name ?? c.name ?? "";
      const id = String(c.category_id ?? c.id ?? "");
      if (name && id) map.set(String(name).trim().toLowerCase(), id);
    }
  };
  add(first.json?.list);
  for (let p = 2; p <= pages; p++) {
    const r = await api(`/categories?limit=50&page=${p}`);
    add(r.json?.list);
  }
  return (_catMap = map);
}

export async function resolveCategoryId(name: string): Promise<string | null> {
  const map = await categoryMap();
  return map.get(String(name).trim().toLowerCase()) ?? null;
}

// ── Utworzenie NIEAKTYWNEGO produktu (reguły 3,4,7,8,9) → ID ────
export async function createProduct(
  p: ScrapedProduct,
  copy: GeneratedCopy,
  categoryName: string
): Promise<string> {
  const code = productCode(p.articleNo);
  let categoryId = await resolveCategoryId(categoryName);
  if (!categoryId) {
    categoryId = await resolveCategoryId(CFG.fallbackCategory);
    console.warn(`  ! kategoria „${categoryName}" nieznana w sklepie → fallback „${CFG.fallbackCategory}"`);
  }
  if (!categoryId) throw new Error(`Brak category_id — ani „${categoryName}", ani fallback „${CFG.fallbackCategory}" nie istnieją w sklepie`);

  const payload: any = {
    producer_id: CFG.producerId, // reguła 4
    tax_id: 1,
    code, // reguła 3 (z paddingiem)
    ean: p.ean || "",
    stock: {
      price: Number(CFG.placeholderPrice) || 1, // reguła 9: placeholder > 0
      stock: 0,
      code,
    },
    translations: {
      [CFG.lang]: {
        name: p.name,
        short_description: copy.shortDescriptionHtml,
        description: copy.descriptionHtml, // reguła 7
        active: 0, // reguła 8: NIEAKTYWNY (aktywność produktu jest w translacji)
      },
    },
  };
  if (categoryId) {
    payload.category_id = Number(categoryId);
    payload.categories = [Number(categoryId)];
  }

  const r = await api("/products", { method: "POST", body: JSON.stringify(payload) });
  const id = typeof r.json === "number" ? String(r.json) : String(r.json ?? r.text).trim();
  if (!/^\d+$/.test(id)) throw new Error(`createProduct: nieoczekiwana odpowiedź: ${r.text.slice(0, 150)}`);
  return id;
}

// ── Zdjęcia (reguła 5) + opisy (SEO=name, dostępność=description) ─
export async function addImages(
  productId: string,
  images: ProductImage[],
  copies: ImageCopy[]
): Promise<number> {
  let ok = 0;
  for (let i = 0; i < images.length; i++) {
    const c = copies[i] || { seo: "", alt: "" };
    const body = {
      product_id: Number(productId),
      main: i === 0 ? 1 : 0,
      order: i + 1,
      content: images[i].buffer.toString("base64"),
      translations: {
        [CFG.lang]: {
          name: c.seo || images[i].filename, // Opis (SEO) / alt
          description: c.alt || "", // Opis (dostępność)
        },
      },
    };
    await api("/product-images", { method: "POST", body: JSON.stringify(body) });
    ok++;
  }
  return ok;
}

// ── Usuwanie (sprzątanie testów) — używać świadomie ────────────
export async function deleteProduct(productId: string | number): Promise<number> {
  const r = await api(`/products/${productId}`, { method: "DELETE" });
  return r.status;
}
