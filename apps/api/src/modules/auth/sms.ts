import { env } from "../../config/env.js";
import { maskMobile } from "../../lib/mask.js";

export interface SmsProvider {
  sendOtp(mobileE164: string, code: string): Promise<void>;
}

/** Development/test only: prints the code and keeps it in memory for tests. */
export const consoleOutbox: { mobile: string; code: string; at: number }[] = [];
class ConsoleSms implements SmsProvider {
  async sendOtp(mobile: string, code: string) {
    consoleOutbox.push({ mobile, code, at: Date.now() });
    if (consoleOutbox.length > 200) consoleOutbox.shift();
    if (env().NODE_ENV !== "test") console.log(`[sms:console] OTP for ${maskMobile(mobile)} is ${code}`);
  }
}

/**
 * MSG91 (Indian SMS gateway). Needs a DLT-approved OTP template whose variable
 * is named "otp". Docs: https://docs.msg91.com — not yet tested with live keys.
 */
class Msg91Sms implements SmsProvider {
  async sendOtp(mobile: string, code: string) {
    const e = env();
    const res = await fetch("https://control.msg91.com/api/v5/flow", {
      method: "POST",
      headers: { authkey: e.MSG91_AUTH_KEY!, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        template_id: e.MSG91_OTP_TEMPLATE_ID,
        short_url: "0",
        recipients: [{ mobiles: mobile.replace(/^\+/, ""), otp: code }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`MSG91 returned HTTP ${res.status}`);
    const body = (await res.json().catch(() => ({}))) as { type?: string };
    if (body.type && body.type !== "success") throw new Error("MSG91 rejected the message");
  }
}

let provider: SmsProvider | null = null;
export function sms(): SmsProvider {
  if (!provider) provider = env().SMS_PROVIDER === "msg91" ? new Msg91Sms() : new ConsoleSms();
  return provider;
}
