import nodemailer from "nodemailer";
import { env } from "./env";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** In development and tests, emails are captured here instead of sent. */
export const outbox: Mail[] = [];

type Transport = (m: Mail) => Promise<void>;
let transport: Transport | null = null;

/** Lets the host app plug in a real transport (SMTP, SES, Resend…). */
export function setMailTransport(t: Transport | null) {
  transport = t;
}

/**
 * SMTP transport built from SMTP_URL, e.g.
 *   smtps://user:pass@smtp.example.com:465   (implicit TLS)
 *   smtp://user:pass@smtp.example.com:587    (STARTTLS, required)
 */
export function smtpTransport(url: string): Transport {
  const u = new URL(url);
  const secure = u.protocol === "smtps:";
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(u.hostname);
  const mailer = nodemailer.createTransport({
    host: u.hostname,
    port: Number(u.port) || (secure ? 465 : 587),
    secure,
    // Never send credentials in clear text to a remote server.
    requireTLS: !secure && !isLocal,
    auth: u.username ? { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) } : undefined,
    connectionTimeout: 15_000,
  });
  return async (m) => {
    await mailer.sendMail({ from: env.mailFrom, to: m.to, subject: m.subject, text: m.text });
  };
}

export async function sendMail(m: Mail): Promise<void> {
  if (!transport && env.smtpUrl) transport = smtpTransport(env.smtpUrl);
  if (transport) {
    // A mail outage must not break sign-up or password reset; log and move on.
    try {
      await transport(m);
    } catch (e) {
      console.error(`[mail] Failed to send to ${m.to}: ${(e as Error).message}`);
    }
    return;
  }
  if (env.isProd) {
    console.error(`[mail] No mail transport configured; email to ${m.to} not sent: ${m.subject}`);
    return;
  }
  outbox.push(m);
  if (outbox.length > 200) outbox.shift();
  if (!process.env.VITEST) console.info(`[mail:dev] to=${m.to} subject="${m.subject}"\n${m.text}`);
}
