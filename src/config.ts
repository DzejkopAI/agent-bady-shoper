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

  // Panel
  adminUrl: process.env.SHOPER_ADMIN_URL!,
  login: process.env.SHOPER_LOGIN!,
  password: process.env.SHOPER_PASSWORD!,

  // Claude
  model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",

  headful: (process.env.HEADFUL ?? "true") === "true",
};

// Mapowanie kategorii bady → kategoria główna w sklepie.
// Klucz = fraza z nazwy/kategorii bady (lowercase), wartość = nazwa kategorii w Shoperze.
// Jeśli nic nie pasuje, agent spyta Claude (patrz brain.mapCategory).
export const CATEGORY_MAP: Record<string, string> = {
  "kula śnieżna": "Kule Śniegowe",
  "kula sniezna": "Kule Śniegowe",
  "słoik": "Kule Śniegowe",
  magnes: "Magnesy",
  brelok: "Breloki",
  przypink: "Przypinki",
  kubek: "Kubki",
  koszulk: "Koszulki",
  torb: "Torby",
  statuetk: "Statuetki",
  świeczk: "Szkło/Ceramika",
  kieliszek: "Szkło/Ceramika",
  szkło: "Szkło/Ceramika",
  ceramik: "Szkło/Ceramika",
};

// Lista kategorii sklepu (fallback dla Claude, gdy mapa nie trafi).
// Docelowo można ją pobrać dynamicznie z /admin/categories.
export const SHOP_CATEGORIES = [
  "Breloki",
  "Magnesy",
  "Przypinki",
  "Papiernicze",
  "Dzwonki",
  "Szkło/Ceramika",
  "Statuetki",
  "Kule Śniegowe",
  "Torby",
  "Koszulki",
  "Naszywki",
  "Kubki",
  "Pozostałe",
];
