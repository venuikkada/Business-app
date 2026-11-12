import { describe, expect, it } from "vitest";
import { Client, lastOtp, newMobile, signedIn } from "./helpers.js";
import { db } from "../src/db/pool.js";

describe("OTP login", () => {
  it("signs up a new user, sets httpOnly cookies, and /me works", async () => {
    const c = await new Client().init();
    const mobile = newMobile();
    const r1 = await c.post("/auth/otp/request", { mobile });
    expect(r1.status).toBe(200);
    expect(r1.body.data.mobile).toMatch(/^\+91\*+\d{4}$/); // masked
    const r2 = await c.post("/auth/otp/verify", { mobile, otp: lastOtp(mobile), name: "Asha" });
    expect(r2.status).toBe(200);
    expect(r2.body.data.isNewUser).toBe(true);
    const cookies = ([] as string[]).concat(r2.headers["set-cookie"] ?? []);
    expect(cookies.find((x) => x.startsWith("ba_at="))).toMatch(/HttpOnly/i);
    expect(cookies.find((x) => x.startsWith("ba_rt="))).toMatch(/HttpOnly.*SameSite=Strict|SameSite=Strict.*HttpOnly/i);
    const me = await c.get("/me");
    expect(me.status).toBe(200);
    expect(me.body.data.user.mobile).toBe(`+91${mobile}`);
    expect(me.body.data.user.name).toBe("Asha");
  });

  it("rejects a wrong OTP and locks the code after 5 wrong tries", async () => {
    const c = await new Client().init();
    const mobile = newMobile();
    await c.post("/auth/otp/request", { mobile });
    const good = lastOtp(mobile);
    const wrong = good === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      const r = await c.post("/auth/otp/verify", { mobile, otp: wrong });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe("otp_invalid");
    }
    const r = await c.post("/auth/otp/verify", { mobile, otp: good });
    expect(r.body.error.code).toBe("otp_too_many_attempts");
  });

  it("an OTP works only once", async () => {
    const c = await new Client().init();
    const mobile = newMobile();
    await c.post("/auth/otp/request", { mobile });
    const otp = lastOtp(mobile);
    expect((await c.post("/auth/otp/verify", { mobile, otp })).status).toBe(200);
    expect((await c.post("/auth/otp/verify", { mobile, otp })).status).toBe(400);
  });

  it("enforces the 30-second resend cooldown and 5-per-hour limit per number", async () => {
    const mobile = newMobile();
    const a = await new Client().init();
    expect((await a.post("/auth/otp/request", { mobile })).status).toBe(200);
    const again = await a.post("/auth/otp/request", { mobile });
    expect(again.status).toBe(429);
    expect(again.headers["retry-after"]).toBeDefined();
    // Simulate the cooldown passing by clearing only the cooldown bucket.
    for (let i = 0; i < 4; i++) {
      await db().exec("DELETE FROM rate_limits WHERE bucket LIKE :b", { b: `otp:cool:%${mobile}` });
      expect((await (await new Client().init()).post("/auth/otp/request", { mobile })).status).toBe(200);
    }
    await db().exec("DELETE FROM rate_limits WHERE bucket LIKE :b", { b: `otp:cool:%${mobile}` });
    const sixth = await (await new Client().init()).post("/auth/otp/request", { mobile });
    expect(sixth.status).toBe(429);
  });

  it("limits OTP requests per IP address", async () => {
    const c = await new Client().init();
    let last = 200;
    for (let i = 0; i < 21; i++) last = (await c.post("/auth/otp/request", { mobile: newMobile() })).status;
    expect(last).toBe(429);
  });

  it("rejects invalid mobile numbers", async () => {
    const c = await new Client().init();
    const r = await c.post("/auth/otp/request", { mobile: "12345" });
    expect(r.status).toBe(400);
  });
});

describe("CSRF and origin checks", () => {
  it("blocks unsafe requests without the CSRF header", async () => {
    const c = await new Client().init();
    const r = await c.agent.post("/api/v1/auth/otp/request").set("X-Forwarded-For", c.ip).send({ mobile: newMobile() });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("csrf_failed");
  });

  it("blocks requests from another website", async () => {
    const c = await new Client().init();
    const r = await c.agent
      .post("/api/v1/auth/otp/request")
      .set("X-Forwarded-For", c.ip)
      .set("Origin", "https://evil.example")
      .set("X-CSRF-Token", c.csrf)
      .send({ mobile: newMobile() });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("bad_origin");
  });
});

describe("refresh tokens and sessions", () => {
  it("rotates the refresh token and detects re-use of an old one", async () => {
    const c = await new Client().init();
    const mobile = newMobile();
    await c.post("/auth/otp/request", { mobile });
    const login = await c.post("/auth/otp/verify", { mobile, otp: lastOtp(mobile) });
    const oldRt = ([] as string[]).concat(login.headers["set-cookie"] ?? []).find((x) => x.startsWith("ba_rt="))!.split(";")[0]!.slice(6);
    expect(oldRt.length).toBeGreaterThan(20);
    expect((await c.post("/auth/refresh")).status).toBe(200);
    // Pretend the old token was used more than 30 s ago and is now replayed by a thief.
    await db().exec("UPDATE refresh_tokens SET used_at = DATE_SUB(used_at, INTERVAL 1 MINUTE) WHERE used_at IS NOT NULL");
    const thief = await new Client().init();
    const r = await thief.agent
      .post("/api/v1/auth/refresh")
      .set("Cookie", `ba_rt=${oldRt}; ba_csrf=${thief.csrf}`)
      .set("X-CSRF-Token", thief.csrf)
      .set("X-Forwarded-For", thief.ip);
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("session_revoked");
    // The real user's session was revoked too (safety first).
    expect((await c.get("/me")).status).toBe(401);
  });

  it("logout revokes the session immediately", async () => {
    const c = await signedIn();
    expect((await c.get("/me")).status).toBe(200);
    expect((await c.post("/auth/logout")).status).toBe(200);
    expect((await c.get("/me")).status).toBe(401);
  });

  it("lists devices and can sign out another device", async () => {
    const mobile = newMobile();
    const phone = await signedIn("Multi", mobile);
    const laptop = await new Client().init();
    await laptop.loginOtp(mobile);
    const list = await laptop.get("/me/sessions");
    expect(list.body.data.length).toBe(2);
    const other = list.body.data.find((s: any) => !s.current);
    expect((await laptop.del(`/me/sessions/${other.id}`)).status).toBe(204);
    expect((await phone.get("/me")).status).toBe(401);
    expect((await laptop.get("/me")).status).toBe(200);
  });

  it("an expired/invalid access token is rejected", async () => {
    const c = await new Client().init();
    const r = await c.agent.get("/api/v1/me").set("Cookie", "ba_at=not.a.jwt");
    expect(r.status).toBe(401);
  });
});

describe("password fallback", () => {
  it("sets a password, logs in with email or mobile, and locks after 10 wrong tries", async () => {
    const mobile = newMobile();
    const c = await signedIn("Pw User", mobile);
    const email = `pw${mobile}@example.com`;
    expect((await c.patch("/me", { email })).status).toBe(200);
    const weak = await c.post("/me/password", { newPassword: "password" });
    expect(weak.status).toBe(400);
    expect((await c.post("/me/password", { newPassword: "Shop2026secure" })).status).toBe(200);

    const b = await new Client().init();
    expect((await b.post("/auth/login", { identifier: email, password: "Shop2026secure" })).status).toBe(200);
    const m = await new Client().init();
    expect((await m.post("/auth/login", { identifier: mobile, password: "Shop2026secure" })).status).toBe(200);

    const x = await new Client().init();
    for (let i = 0; i < 10; i++) expect((await x.post("/auth/login", { identifier: email, password: "wrong-pass-1" })).status).toBe(401);
    const locked = await x.post("/auth/login", { identifier: email, password: "Shop2026secure" });
    expect(locked.status).toBe(423);
    // OTP still works while the password is locked.
    const o = await new Client().init();
    await o.loginOtp(mobile);
    expect((await o.get("/me")).status).toBe(200);
  });

  it("wrong email and wrong password give the same answer", async () => {
    const c = await new Client().init();
    const a = await c.post("/auth/login", { identifier: "nobody@example.com", password: "Whatever123" });
    expect(a.status).toBe(401);
    expect(a.body.error.code).toBe("invalid_credentials");
  });

  it("reset password via OTP signs out every device", async () => {
    const mobile = newMobile();
    const c = await signedIn("Reset", mobile);
    await c.post("/me/password", { newPassword: "FirstPass123" });
    const r = await new Client().init();
    expect((await r.post("/auth/otp/request", { mobile, purpose: "reset_password" })).status).toBe(200);
    const done = await r.post("/auth/password/reset", { mobile, otp: lastOtp(mobile), newPassword: "SecondPass456" });
    expect(done.status).toBe(200);
    expect((await c.get("/me")).status).toBe(401);
    expect((await r.post("/auth/login", { identifier: mobile, password: "SecondPass456" })).status).toBe(200);
  });

  it("reset for an unknown number does not reveal that it is unknown", async () => {
    const r = await new Client().init();
    const res = await r.post("/auth/otp/request", { mobile: newMobile(), purpose: "reset_password" });
    expect(res.status).toBe(200);
    expect(res.body.data.sent).toBe(true);
  });
});
