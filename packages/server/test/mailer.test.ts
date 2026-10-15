import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SMTPServer } from "smtp-server";
import type { AddressInfo } from "node:net";
import { sendMail, setMailTransport, smtpTransport } from "../src/mailer";

describe("SMTP mail transport", () => {
  const received: Array<{ from: string; to: string[]; data: string; user?: string }> = [];
  let server: SMTPServer;
  let port = 0;

  beforeAll(async () => {
    server = new SMTPServer({
      authOptional: false,
      allowInsecureAuth: true, // local test server only
      disabledCommands: ["STARTTLS"],
      onAuth(auth, _s, cb) {
        if (auth.username === "mailer" && auth.password === "p@ss word") cb(null, { user: auth.username });
        else cb(new Error("bad credentials"));
      },
      onData(stream, session, cb) {
        let data = "";
        stream.on("data", (c: Buffer) => (data += c.toString()));
        stream.on("end", () => {
          received.push({ from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "", to: session.envelope.rcptTo.map((r) => r.address), data, user: session.user as string | undefined });
          cb();
        });
      },
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    setMailTransport(null);
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("delivers mail with credentials from SMTP_URL (URL-encoded password)", async () => {
    setMailTransport(smtpTransport(`smtp://mailer:${encodeURIComponent("p@ss word")}@127.0.0.1:${port}`));
    await sendMail({ to: "owner@example.com", subject: "Reset your password", text: "Open https://app.example/reset?token=abc" });
    expect(received).toHaveLength(1);
    expect(received[0]!.to).toEqual(["owner@example.com"]);
    expect(received[0]!.user).toBe("mailer");
    expect(received[0]!.data).toContain("Subject: Reset your password");
    expect(received[0]!.data).toContain("reset?token=abc");
  });

  it("does not throw when the SMTP server rejects the login", async () => {
    setMailTransport(smtpTransport(`smtp://mailer:wrong@127.0.0.1:${port}`));
    await expect(sendMail({ to: "x@example.com", subject: "s", text: "t" })).resolves.toBeUndefined();
    expect(received).toHaveLength(1);
  });
});
