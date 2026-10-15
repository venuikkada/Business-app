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
export function setMailTransport(t: Transport) {
  transport = t;
}

export async function sendMail(m: Mail): Promise<void> {
  if (transport) return transport(m);
  if (env.isProd && !env.smtpUrl) {
    console.error(`[mail] No mail transport configured; email to ${m.to} not sent: ${m.subject}`);
    return;
  }
  outbox.push(m);
  if (outbox.length > 200) outbox.shift();
  if (!process.env.VITEST) console.info(`[mail:dev] to=${m.to} subject="${m.subject}"\n${m.text}`);
}
