// ─────────────────────────────────────────────────────────────
//  MÓZG — tu (i tylko tu) decyzje podejmuje Claude.
//  Trzy zadania: opis marketingowy, opisy zdjęć (wizja), kategoria.
// ─────────────────────────────────────────────────────────────
import Anthropic from "@anthropic-ai/sdk";
import { CFG, CATEGORY_MAP, SHOP_CATEGORIES } from "./config.js";
import type { GeneratedCopy, ImageCopy, ProductImage, ScrapedProduct } from "./types.js";

const claude = new Anthropic(); // czyta ANTHROPIC_API_KEY z env

// Wykryj typ obrazu z bajtów (magic bytes) — bady miewa .jpg ORAZ .png,
// a Anthropic odrzuca niezgodność media_type z realną zawartością.
type ImgType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
function imageMediaType(buf: Buffer): ImgType {
  if (buf.length > 3 && buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.length > 3 && buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (buf.length > 12 && buf.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "image/jpeg";
}

// Pomocnik: wymuszamy na Claude wywołanie narzędzia i zwracamy jego argumenty
// (to najpewniejszy sposób na ustrukturyzowany, walidowalny wynik).
async function structured<T>(opts: {
  system: string;
  content: Anthropic.MessageParam["content"];
  toolName: string;
  schema: Anthropic.Tool["input_schema"];
}): Promise<T> {
  const res = await claude.messages.create({
    model: CFG.model,
    max_tokens: 1500,
    system: opts.system,
    tools: [{ name: opts.toolName, description: "Zwróć wynik.", input_schema: opts.schema }],
    tool_choice: { type: "tool", name: opts.toolName },
    messages: [{ role: "user", content: opts.content }],
  });
  const block = res.content.find((b) => b.type === "tool_use") as Anthropic.ToolUseBlock;
  return block.input as T;
}

// ── Zadanie 1: opis sprzedażowy (reguły 6 i 7) ────────────────
export async function writeListing(p: ScrapedProduct): Promise<GeneratedCopy> {
  const system = [
    "Jesteś błyskotliwym copywriterem sklepu pamiatkizpolski.pl (pamiątki z Polski).",
    "Piszesz po polsku z POLOTEM: dowcipnie, z charakterem, lekko przymrużając oko —",
    "gra słów, ciepły humor, odrobina autoironii i polskiego kolorytu (ale bez rubaszności,",
    "bez taniej sztampy i bez wykrzykników co drugie słowo). Ma bawić i sprzedawać zarazem.",
    "Złap czytelnika pierwszym zdaniem (hook), a potem podsuń konkret. Pod SEO wpleć",
    "naturalnie nazwę produktu i słowa kluczowe — ale tak, żeby czytało się jak żywy tekst,",
    "nie jak lista fraz. NIE kopiuj sucho opisu hurtowni — napisz to lepiej i zabawniej.",
    "Krótki opis (shortDescriptionHtml): 1–2 zdania z pazurem, jako zajawka.",
    "Struktura 'descriptionHtml' MUSI być: jeden akapit <p>…</p> soczystego tekstu sprzedażowego",
    "z humorem, a po nim <ul> z punktami: Rozmiar, Tworzywo oraz 3–5 haseł (mogą być żartobliwe).",
    "Zwracaj czysty HTML (tylko <p>, <ul>, <li>). Bez nagłówków, bez stylów, bez emoji.",
  ].join(" ");

  const userText = [
    `Nazwa: ${p.name}`,
    `Rozmiar: ${p.size || "-"}`,
    `Tworzywo: ${p.material || "-"}`,
    `Opakowanie: ${p.packaging || "-"}`,
    `Opis z hurtowni (do przepisania): ${p.descriptionRaw}`,
    `Dane techniczne: ${JSON.stringify(p.techSpecs)}`,
  ].join("\n");

  return structured<GeneratedCopy>({
    system,
    content: userText,
    toolName: "zapisz_opis",
    schema: {
      type: "object",
      properties: {
        shortDescriptionHtml: { type: "string", description: "Krótki opis, 1–2 zdania." },
        descriptionHtml: { type: "string", description: "<p>…</p><ul><li>…</li></ul>" },
      },
      required: ["shortDescriptionHtml", "descriptionHtml"],
    },
  });
}

// ── Zadanie 2: opisy zdjęć SEO + dostępność (reguła 5, wizja) ──
export async function writeImageTexts(p: ScrapedProduct, images: ProductImage[]): Promise<ImageCopy[]> {
  const system = [
    "Opisujesz zdjęcia produktu do sklepu, po polsku.",
    "Dla KAŻDEGO zdjęcia zwróć dwa teksty:",
    "- seo: krótka fraza pod SEO (z nazwą produktu i słowami kluczowymi),",
    "- alt: dosłowny opis tego, co widać na TYM konkretnym zdjęciu (dla dostępności).",
    "Zwróć tablicę w tej samej kolejności co zdjęcia.",
  ].join(" ");

  // Wysyłamy wszystkie zdjęcia w jednej wiadomości → spójność między ujęciami.
  const content: Anthropic.MessageParam["content"] = [
    { type: "text", text: `Produkt: ${p.name}. Poniżej ${images.length} zdjęć po kolei.` },
  ];
  images.forEach((img, idx) => {
    content.push({ type: "text", text: `Zdjęcie ${idx + 1}:` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: imageMediaType(img.buffer), data: img.buffer.toString("base64") },
    });
  });

  const { items } = await structured<{ items: ImageCopy[] }>({
    system,
    content,
    toolName: "zapisz_opisy_zdjec",
    schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { seo: { type: "string" }, alt: { type: "string" } },
            required: ["seo", "alt"],
          },
        },
      },
      required: ["items"],
    },
  });
  return items;
}

// ── Backfill: wizyjna selekcja zdjęć do dodania ───────────────
// Claude ogląda zdjęcia JUŻ w sklepie + kandydatów z bady i decyduje per
// kandydat: dodać czy pominąć (duplikat / tył produktu / brzydkie/zbędne).
export interface ImgDecision {
  add: boolean;
  reason: string; // krótkie uzasadnienie po polsku
}

export async function pickImagesToAdd(
  productName: string,
  shopImages: Buffer[],
  badyImages: Buffer[]
): Promise<ImgDecision[]> {
  if (badyImages.length === 0) return [];

  const system = [
    "Jesteś redaktorem zdjęć w sklepie z pamiątkami (pamiatkizpolski.pl).",
    "Masz zdjęcia produktu JUŻ w sklepie oraz KANDYDATÓW z hurtowni.",
    "Dla KAŻDEGO kandydata zdecyduj, czy dodać go do sklepu.",
    "POMIŃ (add=false), gdy kandydat:",
    "- to TO SAMO ujęcie/ten sam produkt co zdjęcie już w sklepie — także jeśli różni się TYLKO tłem, KOLOREM TŁA, oświetleniem, rozdzielczością lub drobnym kadrem (to wciąż duplikat, nic nie wnosi),",
    "- pokazuje BRZYDKI, techniczny tył/spód: tył magnesu z magnesem, zapięcie/mechanizm przypinki, gołą teksturowaną metalową spodnią stronę, naklejkę/napis producenta — to odrzucamy,",
    "- jest niskiej jakości, rozmyty albo zbędny (kolejne prawie identyczne ujęcie).",
    "DODAJ (add=true), gdy kandydat wnosi realnie COŚ NOWEGO:",
    "- inny, faktycznie odmienny kąt/perspektywa (z boku, pod kątem, produkt w użyciu, ładny detal),",
    "- ŁADNY rewers/druga strona z wartością wizualną: mapa, grafika, drugi motyw, wzór — TAKIE chcemy (NIE myl z brzydkim technicznym tyłem),",
    "- realnie inny WARIANT PRODUKTU (inny przedmiot, nie samo inne tło).",
    "Reguła kluczowa: różnica tylko w tle/kolorze tła/rozdzielczości = DUPLIKAT (pomiń). Ładny rewers z grafiką/mapą = DODAJ. Brzydki tył techniczny (magnes, zapięcie) = POMIŃ.",
    "Zwróć tablicę decyzji w TEJ SAMEJ kolejności co kandydaci; 'reason' krótko po polsku.",
  ].join(" ");

  const content: Anthropic.MessageParam["content"] = [
    { type: "text", text: `Produkt: ${productName}.` },
  ];
  if (shopImages.length) {
    content.push({ type: "text", text: `Zdjęcia JUŻ w sklepie (${shopImages.length}):` });
    for (const b of shopImages) {
      content.push({ type: "image", source: { type: "base64", media_type: imageMediaType(b), data: b.toString("base64") } });
    }
  } else {
    content.push({ type: "text", text: "Sklep NIE ma jeszcze żadnego zdjęcia tego produktu." });
  }
  content.push({ type: "text", text: `KANDYDACI z hurtowni (${badyImages.length}), po kolei:` });
  badyImages.forEach((b, i) => {
    content.push({ type: "text", text: `Kandydat ${i + 1}:` });
    content.push({ type: "image", source: { type: "base64", media_type: imageMediaType(b), data: b.toString("base64") } });
  });

  const { decisions } = await structured<{ decisions: ImgDecision[] }>({
    system,
    content,
    toolName: "decyzje_zdjec",
    schema: {
      type: "object",
      properties: {
        decisions: {
          type: "array",
          items: {
            type: "object",
            properties: { add: { type: "boolean" }, reason: { type: "string" } },
            required: ["add", "reason"],
          },
        },
      },
      required: ["decisions"],
    },
  });
  return decisions;
}

// ── Zadanie 3: kategoria (najpierw mapa, potem Claude) ────────
export async function mapCategory(p: ScrapedProduct): Promise<string> {
  const hay = `${p.name} ${p.descriptionRaw}`.toLowerCase();
  for (const [key, cat] of Object.entries(CATEGORY_MAP)) {
    if (hay.includes(key)) return cat;
  }
  // brak trafienia w mapie → pytamy Claude, ograniczając do istniejących kategorii
  const { category } = await structured<{ category: string }>({
    system: "Wybierz najlepszą kategorię sklepu dla produktu. Odpowiedz WYŁĄCZNIE jedną z podanych nazw.",
    content: `Produkt: ${p.name}\nDostępne kategorie: ${SHOP_CATEGORIES.join(", ")}`,
    toolName: "wybierz_kategorie",
    schema: {
      type: "object",
      properties: { category: { type: "string", enum: SHOP_CATEGORIES } },
      required: ["category"],
    },
  });
  return category;
}
