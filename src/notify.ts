// ─────────────────────────────────────────────────────────────
//  Powiadomienia e-mail (SMTP) — mail „co dodałem" po runie.
//  Wzorzec z JD-PIM (powiadomienia.py): starttls + login + sendmail.
//  ZASADA: sendMail NIGDY nie podnosi wyjątku — błąd wysyłki nie może
//  zabić/zepsuć zakończonego runu agenta. Zwraca {ok, info}.
//
//  Test ręczny: `npm run test-mail` (wyśle testowy mail na MAIL_TO).
// ─────────────────────────────────────────────────────────────
import nodemailer from "nodemailer";
import { CFG } from "./config.js";

export async function sendMail(
  subject: string,
  text: string,
  html?: string
): Promise<{ ok: boolean; info: string }> {
  const m = CFG.mail;
  if (!m.enabled) return { ok: false, info: "mail: wyłączony (MAIL_ENABLED=false)" };
  if (!m.host || !m.to.length) return { ok: false, info: "mail: brak SMTP_HOST lub MAIL_TO" };
  try {
    const transport = nodemailer.createTransport({
      host: m.host,
      port: m.port,
      secure: m.port === 465, // 465 = SSL; 587 = STARTTLS (requireTLS niżej)
      requireTLS: m.tls && m.port !== 465,
      auth: m.user ? { user: m.user, pass: m.pass } : undefined,
    });
    await transport.sendMail({ from: m.from, to: m.to.join(", "), subject, text, html });
    return { ok: true, info: `mail -> ${m.to.join(", ")}` };
  } catch (e) {
    return { ok: false, info: `mail błąd: ${(e as Error).message}` };
  }
}

// Tryb testowy: `tsx src/notify.ts --test`
if (process.argv[1] && /notify\.ts$/.test(process.argv[1]) && process.argv.includes("--test")) {
  sendMail(
    "Agent BADY→Shoper — test powiadomień",
    "To jest testowy e-mail z agenta BADY→Shoper. Jeśli go widzisz, SMTP działa."
  ).then((r) => {
    console.log(r.ok ? `✓ ${r.info}` : `✗ ${r.info}`);
    process.exit(r.ok ? 0 : 1);
  });
}
