// ─────────────────────────────────────────────────────────────
//  REGUŁY PRODUKCYJNE (z ustaleń PoC) — w jednym miejscu.
//  To jest "polityka" agenta. Zmieniasz tu, nie w kodzie logiki.
// ─────────────────────────────────────────────────────────────

import "dotenv/config";

export const CFG = {
  // Źródło: scrapujemy TYLKO kategorię Nowości
  nowosciUrl: "https://www.bady.pl/nowosci/",

  // Reguła 3: kod produktu = "BD " + numer artykułu z bady
  codePrefix: "BD ",

  // Reguła 4: producent zawsze ten sam
  producer: "Pamiątki z Polski",

  // Reguła 8: produkt dodawany jako NIEAKTYWNY (do ręcznej weryfikacji)
  activeOnAdd: false,

  // Reguła 9: ceny nie pobieramy z bady (brak loginu B2B). Panel wymaga > 0,
  // więc wpisujemy placeholder do ręcznej korekty.
  placeholderPrice: "1",

  // Reguła 2: deduplikacja — ile produktów na raz, żeby nie zasypać sklepu
  maxProducts: Number(process.env.MAX_PRODUCTS ?? 3),

  // Wykluczenia: NIE dodawaj do sklepu produktów, których nazwa zawiera którąś
  // z tych fraz (lowercase). „personalizowany" = półprodukt do znakowania, nie
  // towar gotowy — nie chcemy go na pamiatkizpolski.pl. Rozdzielane przecinkiem.
  excludeNameContains: (process.env.EXCLUDE_NAME_CONTAINS ?? "personalizowan")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  // Panel
  adminUrl: process.env.SHOPER_ADMIN_URL!,
  login: process.env.SHOPER_LOGIN!,
  password: process.env.SHOPER_PASSWORD!,

  // Trwały profil przeglądarki (jak zwykły profil Chrome). Używany przez
  // `npm run browser`, które startuje JEDNO okno na stałe z portem debug.
  authProfileDir: process.env.AUTH_PROFILE_DIR ?? ".auth-profile",

  // CDP: agent (`npm start`) podłącza się do już działającego okna z
  // `npm run browser` zamiast startować własną przeglądarkę. Dzięki temu
  // sesja Shopera (cookie sesyjne w pamięci) żyje i NIE ma powtórnego 2FA.
  // (Ścieżka BROWSER — legacy/fallback; produkcja idzie przez REST API poniżej.)
  cdpPort: Number(process.env.CDP_PORT ?? 9222),
  cdpUrl: process.env.CDP_URL ?? `http://127.0.0.1:${process.env.CDP_PORT ?? 9222}`,

  // ── Shoper REST API (ścieżka produkcyjna) ──────────────────────
  // base_url = adres sklepu BEZ /admin (np. https://pamiatkizpolski.pl).
  // Token API z panelu (Integracje) — ten sam sklep co PIM. Fallback: login+hasło.
  apiBaseUrl: (process.env.SHOPER_API_BASE_URL ?? "").replace(/\/$/, ""),
  apiToken: process.env.SHOPER_API_TOKEN ?? "",
  apiClientId: process.env.SHOPER_API_CLIENT_ID ?? "",
  apiLogin: process.env.SHOPER_API_LOGIN ?? "",
  apiPassword: process.env.SHOPER_API_PASSWORD ?? "",
  // Reguła 4: producent zawsze „Pamiątki z Polski" = producer_id 1 (zasób
  // /producers bywa poza scope tokenu; ID stałe, potwierdzone na produktach).
  producerId: Number(process.env.SHOPER_PRODUCER_ID ?? 1),
  lang: process.env.SHOPER_LANG ?? "pl_PL",
  // Kategoria awaryjna, gdy mapowanie nie trafi w istniejącą kategorię sklepu
  // (API wymaga category_id). Produkt i tak nieaktywny → ręczna rekategoryzacja.
  fallbackCategory: process.env.SHOPER_FALLBACK_CATEGORY ?? "Pozostałe",

  // Powiadomienia e-mail (SMTP) — mail „co dodałem" po nocnym runie.
  // Wzorzec z JD-PIM (powiadomienia.py). Dane w .env; te same poświadczenia
  // co PIM (konto stany-wapro@bady.pl). MAIL_TO = odbiorcy po przecinku.
  mail: {
    enabled: (process.env.MAIL_ENABLED ?? "true") === "true",
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    tls: (process.env.SMTP_TLS ?? "true") === "true",
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "",
    to: (process.env.MAIL_TO ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },

  // Claude
  model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",

  headful: (process.env.HEADFUL ?? "true") === "true",
};

// Kod produktu w sklepie: prefiks + numer artykułu, przy czym BAZĘ numeru
// (część przed pierwszym „-") sklep dopełnia zerami z przodu do 4 cyfr.
// Przykłady: bady „122-03" → „BD 0122-03"; „2575" → „BD 2575"; „2150-04" → „BD 2150-04".
export function productCode(articleNo: string): string {
  const m = String(articleNo).trim().match(/^(\d+)(.*)$/);
  const padded = m ? (m[1].length < 4 ? m[1].padStart(4, "0") : m[1]) + m[2] : String(articleNo).trim();
  return CFG.codePrefix + padded;
}

// Mapowanie kategorii bady → kategoria główna w sklepie.
// Klucz = fraza z nazwy/kategorii bady (lowercase), wartość = nazwa kategorii w Shoperze.
// Jeśli nic nie pasuje, agent spyta Claude (patrz brain.mapCategory).
// WARTOŚCI muszą być DOKŁADNYMI nazwami kategorii w sklepie (potwierdzone
// przez GET /categories, 2026-08-06) — inaczej createProduct spadnie na fallback.
export const CATEGORY_MAP: Record<string, string> = {
  // Kule Śniegowe
  "kula śnieżna": "Kule Śniegowe",
  "kula sniezna": "Kule Śniegowe",
  kula: "Kule Śniegowe",
  "słoik": "Kule Śniegowe",
  // Magnesy
  magnes: "Magnesy",
  // Breloki
  brelok: "Breloki",
  // Przypinki
  przypink: "Przypinki",
  // Szkło / Ceramika (kubki, kieliszki, świeczki, ceramika)
  kubek: "Szkło/Ceramika",
  kubk: "Szkło/Ceramika",
  kieliszek: "Szkło/Ceramika",
  "świeczk": "Szkło/Ceramika",
  swieczk: "Szkło/Ceramika",
  "szkło": "Szkło/Ceramika",
  ceramik: "Szkło/Ceramika",
  // Statuetki
  statuetk: "Statuetki",
  // Koszulki
  koszulk: "Koszulki",
  // Torby
  torb: "Torby",
  // Naszywki (naprasowanki/hafty)
  naszywk: "Naszywki",
  naprasowank: "Naszywki",
  // Dzwonki
  dzwonek: "Dzwonki",
  dzwonk: "Dzwonki",
  // Długopisy
  "długopis": "Długopisy",
  dlugopis: "Długopisy",
  // Smycze
  smycz: "Smycze",
  // Pocztówki
  "pocztówk": "Pocztówki",
  pocztowk: "Pocztówki",
  // Naklejki
  naklejk: "Naklejki",
  // Monety
  monet: "Monety",
  // Zegary
  zegar: "Zegary",
  // Pluszaki
  pluszak: "Pluszaki",
  // Ręczniki
  "ręcznik": "Ręczniki",
  recznik: "Ręczniki",
  // Łyżeczki
  "łyżeczk": "Łyżeczki pamiątkowe",
  lyzeczk: "Łyżeczki pamiątkowe",
  // Naparstki
  naparstek: "Naparstki",
  naparstk: "Naparstki",
  // Zapalniczki
  zapalniczk: "Zapalniczki",
  // Flagi
  flaga: "Flagi",
  // Aniołki
  "aniołek": "Aniołki",
  aniolek: "Aniołki",
};

// Lista kategorii sklepu (fallback dla Claude, gdy mapa nie trafi) — tylko
// realne, jednoznaczne kategorie główne (z GET /categories). Bez dwuznacznych
// podkategorii („Metalowe" itp.). „Pozostałe" = ostatnia deska ratunku.
export const SHOP_CATEGORIES = [
  "Przypinki",
  "Breloki",
  "Magnesy",
  "Kule Śniegowe",
  "Szkło/Ceramika",
  "Statuetki",
  "Koszulki",
  "Torby",
  "Naszywki",
  "Dzwonki",
  "Długopisy",
  "Smycze",
  "Pocztówki",
  "Naklejki",
  "Monety",
  "Zegary",
  "Pluszaki",
  "Ręczniki",
  "Łyżeczki pamiątkowe",
  "Naparstki",
  "Zapalniczki",
  "Flagi",
  "Aniołki",
  "Pozostałe",
];
