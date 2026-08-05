// Wspólne typy danych przepływających przez pipeline.

export interface ScrapedProduct {
  url: string;
  name: string;
  articleNo: string;        // np. "2575"
  ean?: string;
  packaging?: string;       // "Opakowanie"
  size?: string;            // "Rozmiar"
  material?: string;        // "Tworzywo"
  descriptionRaw: string;   // surowy opis z bady (techniczny)
  techSpecs: Record<string, string>; // tabela "Dane techniczne"
  mainImageUrl: string;
  imageUrls: string[];      // wszystkie zdjęcia (główne + dodatkowe), w rozdzielczości "big"
}

export interface ProductImage {
  url: string;
  filename: string;         // np. "kula-01.jpg"
  buffer: Buffer;           // pobrane bajty (oryginalny kwadratowy JPG)
}

// To, co wygenerował Claude (mózg)
export interface GeneratedCopy {
  shortDescriptionHtml: string;
  descriptionHtml: string;  // struktura <p>...</p><ul><li>...</li></ul>
}

export interface ImageCopy {
  seo: string;              // Opis (SEO)
  alt: string;              // Opis (dostępność)
}
