// ─────────────────────────────────────────────────────────────
//  TRWAŁE OKNO PRZEGLĄDARKI (CDP) — uruchamiasz RAZ, zostaje otwarte.
//  Uruchom: `npm run browser`.
//
//  Otworzy się okno Chromium z profilem CFG.authProfileDir i portem
//  debugowania CFG.cdpPort. Zaloguj się DO KOŃCA (login + hasło + KOD 2FA).
//  ZOSTAW to okno otwarte — agent (`npm start`) podłącza się do niego przez
//  CDP i korzysta z żywej sesji, więc 2FA nie wyskakuje przy każdym starcie.
//
//  Okno zamknij dopiero, gdy chcesz zakończyć (albo przy restarcie VPSa —
//  wtedy odpal `npm run browser` i zaloguj się ponownie, raz).
// ─────────────────────────────────────────────────────────────
import { chromium } from "playwright";
import { CFG } from "./config.js";

async function main() {
  const context = await chromium.launchPersistentContext(CFG.authProfileDir, {
    headless: false, // musi być widoczne — logujesz się ręcznie
    args: [`--remote-debugging-port=${CFG.cdpPort}`],
    viewport: null,
  });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${CFG.adminUrl}/auth/login`, { waitUntil: "domcontentloaded" }).catch(() => {});

  console.log("\n=== TRWAŁE OKNO PRZEGLĄDARKI (CDP) ===");
  console.log(`Profil:      ${CFG.authProfileDir}`);
  console.log(`Port CDP:    ${CFG.cdpPort}`);
  console.log(`Endpoint:    ${CFG.cdpUrl}`);
  console.log("\n1) Zaloguj się w tym oknie DO KOŃCA (login + hasło + KOD 2FA).");
  console.log("2) ZOSTAW okno otwarte.");
  console.log("3) W drugim terminalu odpal `npm start` — agent podłączy się tutaj.\n");
  console.log("(Ctrl+C w tym terminalu ALBO zamknięcie okna kończy sesję.)\n");

  // Trzymaj proces przy życiu, aż okno zostanie zamknięte.
  await new Promise<void>((resolve) => {
    context.on("close", () => resolve());
    process.on("SIGINT", () => resolve());
    process.on("SIGTERM", () => resolve());
  });

  console.log("Okno zamknięte — kończę.");
  await context.close().catch(() => {});
  process.exit(0);
}

main().catch((e) => {
  console.error("Błąd okna przeglądarki:", e);
  process.exit(1);
});
