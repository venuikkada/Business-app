import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { auth, businesses, parties, team, billing, outbox, withTenant, documents } from "../src";
import * as platform from "../src/platform";
import { totp } from "../src/auth/totp";
import { decryptSecret, encryptSecret } from "../src/auth/crypto";
import { newUser, newBusiness, as, owner, expectCode, STRONG, meta, item } from "./helpers";

const ip = () => `10.200.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

describe("authentication", () => {
  it("locks the account after repeated wrong passwords and uses a generic error", async () => {
    const u = await newUser("Lockout");
    const m = { ...meta, ip: ip() };
    for (let i = 0; i < 10; i++) {
      const e = await expectCode(auth.login({ email: u.email, password: "wrong-password-1" }, "web", m), i < 10 ? "UNAUTHENTICATED" : "RATE_LIMITED");
      expect(e.message).toBe("Invalid email or password");
    }
    // Locked now (correct password also refused) — but no account enumeration for unknown emails.
    await expectCode(auth.login({ email: u.email, password: STRONG }, "web", { ...meta, ip: ip() }), "RATE_LIMITED");
    const unknown = await expectCode(auth.login({ email: "nobody@example.test", password: "x" }, "web", { ...meta, ip: ip() }), "UNAUTHENTICATED");
    expect(unknown.message).toBe("Invalid email or password");
  });

  it("password reset works once, expires other sessions, and does not reveal accounts", async () => {
    const u = await newUser("Resetter");
    const s1 = await auth.login({ email: u.email, password: STRONG }, "web", { ...meta, ip: ip() });
    await auth.requestPasswordReset({ email: u.email }, { ...meta, ip: ip() });
    await auth.requestPasswordReset({ email: "ghost@example.test" }, { ...meta, ip: ip() }); // silently ignored
    const mail = [...outbox].reverse().find((m) => m.to === u.email && m.subject.startsWith("Reset"));
    const token = /token=([\w-]+)/.exec(mail!.text)![1]!;
    expect(outbox.some((m) => m.to === "ghost@example.test")).toBe(false);
    await auth.resetPassword({ token, password: "NewPassw0rd123" });
    expect(await auth.authenticate(s1.token)).toBeNull();
    await expectCode(auth.resetPassword({ token, password: "AnotherPass123" }), "VALIDATION");
    await expectCode(auth.login({ email: u.email, password: STRONG }, "web", { ...meta, ip: ip() }), "UNAUTHENTICATED");
    const ok = await auth.login({ email: u.email, password: "NewPassw0rd123" }, "web", { ...meta, ip: ip() });
    expect(ok.token).toBeTruthy();
  });

  it("logout revokes the session; tampered tokens are rejected", async () => {
    const u = await newUser("Logout");
    const s = await auth.login({ email: u.email, password: STRONG }, "mobile", { ...meta, ip: ip() });
    expect((await auth.authenticate(s.token))?.session.kind).toBe("mobile");
    expect(await auth.authenticate(s.token.slice(0, -2) + "xx")).toBeNull();
    expect(await auth.authenticate("not-a-token")).toBeNull();
    await auth.logout(s.token);
    expect(await auth.authenticate(s.token)).toBeNull();
  });

  it("supports optional TOTP two-factor login", async () => {
    const u = await newUser("TOTP user");
    const s = await auth.login({ email: u.email, password: STRONG }, "web", { ...meta, ip: ip() });
    const { secret } = await auth.beginTotpSetup(u.user.id);
    await expectCode(auth.confirmTotpSetup(u.user.id, s.session.id, "000000"), "VALIDATION");
    await auth.confirmTotpSetup(u.user.id, s.session.id, totp(secret));
    await expectCode(auth.login({ email: u.email, password: STRONG }, "web", { ...meta, ip: ip() }), "MFA_REQUIRED");
    const ok = await auth.login({ email: u.email, password: STRONG, totp: totp(secret) }, "web", { ...meta, ip: ip() });
    expect(ok.session.mfaVerified).toBe(true);
    // Secrets are encrypted at rest.
    const enc = await owner(async (c) => (await c.query("select totp_secret_enc from users where id = $1", [u.user.id])).rows[0].totp_secret_enc as string);
    expect(enc).not.toContain(secret);
    expect(decryptSecret(enc)).toBe(secret);
    const parts = encryptSecret("x").split(".");
    parts[2] = (parts[2]![0] === "A" ? "B" : "A") + parts[2]!.slice(1); // tamper with the auth tag
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("account deletion anonymises the user; owners must delete their business first", async () => {
    const u = await newUser("Deleter");
    await newBusiness(u.user);
    await expectCode(auth.deleteAccount(u.user.id, STRONG), "BUSINESS_RULE");
    const v = await newUser("Leaver");
    await auth.deleteAccount(v.user.id, STRONG);
    const row = await owner(async (c) => (await c.query("select email, full_name, status from users where id = $1", [v.user.id])).rows[0]);
    expect(row.status).toBe("deleted");
    expect(row.email).toContain("@deleted.invalid");
    await expectCode(auth.login({ email: v.email, password: STRONG }, "web", { ...meta, ip: ip() }), "UNAUTHENTICATED");
  });
});

describe("team permissions", () => {
  it("invites, accepts, and prevents privilege escalation and owner lockout", async () => {
    const O = await newUser("Team Owner");
    const biz = await newBusiness(O.user);
    const M = await newUser("Manager Mona");
    const roles = (await as(O.user, biz, (t) => team.listRoles(t))) as Array<{ id: string; key: string }>;
    const managerRole = roles.find((r) => r.key === "manager")!;
    const ownerRole = roles.find((r) => r.key === "owner")!;
    const inv = await as(O.user, biz, (t) => team.inviteMember(t, { email: M.email, roleId: managerRole.id }));
    const token = new URL(inv.inviteUrl).searchParams.get("token")!;
    // Someone else cannot use the invitation.
    const X = await newUser("Intruder");
    const { sha256 } = await import("../src/auth/crypto");
    await expect(withTenant(X.user, biz, meta, async () => 1)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { appTx } = await import("../src/db");
    await expect(appTx({ userId: X.user.id }, (db) => db.one("select app.accept_invitation($1)", [sha256(token)]))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await appTx({ userId: M.user.id }, (db) => db.one("select app.accept_invitation($1)", [sha256(token)]));
    await as(M.user, biz, async (t) => {
      expect(t.roleKey).toBe("manager");
      // Managers cannot grant themselves billing or deletion rights through a custom role.
      await expectCode(team.saveRole(t, null, { name: "Sneaky", permissions: ["billing.edit", "data.delete"] }), "FORBIDDEN");
      const members = (await team.listMembers(t)).members as Array<{ id: string; userId: string }>;
      const ownerMembership = members.find((m) => m.userId === O.user.id)!;
      await expectCode(team.updateMember(t, ownerMembership.id, { roleId: managerRole.id }), "FORBIDDEN");
      await expectCode(team.inviteMember(t, { email: "boss@example.test", roleId: ownerRole.id }), "FORBIDDEN");
    });
    await as(O.user, biz, async (t) => {
      const members = (await team.listMembers(t)).members as Array<{ id: string; userId: string }>;
      const mine = members.find((m) => m.userId === O.user.id)!;
      await expectCode(team.updateMember(t, mine.id, { roleId: managerRole.id }), "BUSINESS_RULE");
      await expectCode(team.removeMember(t, mine.id), "BUSINESS_RULE");
    });
  });

  it("enforces the plan's user limit", async () => {
    const O = await newUser("Seat Owner");
    const biz = await newBusiness(O.user);
    // Pro trial allows 5 users.
    const roles = (await as(O.user, biz, (t) => team.listRoles(t))) as Array<{ id: string; key: string }>;
    const r = roles.find((x) => x.key === "salesperson")!;
    for (let i = 0; i < 4; i++) await as(O.user, biz, (t) => team.inviteMember(t, { email: `seat${i}-${biz.slice(0, 6)}@example.test`, roleId: r.id }));
    await expectCode(as(O.user, biz, (t) => team.inviteMember(t, { email: `seat-x-${biz.slice(0, 6)}@example.test`, roleId: r.id })), "PLAN_LIMIT");
  });
});

describe("super-admin and support access", () => {
  async function makeAdmin() {
    const a = await newUser("Platform Admin");
    await owner((c) => c.query("update users set is_platform_admin = true where id = $1", [a.user.id]));
    return a;
  }

  it("requires TOTP enrolment before any admin operation", async () => {
    const a = await makeAdmin();
    const s = await platform.adminLogin({ email: a.email, password: STRONG }, { ...meta, ip: ip() });
    expect(await platform.authenticateAdmin(s.token, meta)).toBeNull();
    const pending = await platform.authenticateAdmin(s.token, meta, true);
    expect(pending).not.toBeNull();
    const { secret } = await platform.adminBeginTotp(a.user.id);
    await platform.adminConfirmTotp(a.user.id, s.session.id, totp(secret));
    const ctx = await platform.authenticateAdmin(s.token, meta);
    expect(ctx?.user.isPlatformAdmin).toBe(true);
    // A regular user cannot obtain an admin session.
    const u = await newUser("Not admin");
    await expectCode(platform.adminLogin({ email: u.email, password: STRONG }, { ...meta, ip: ip() }), "UNAUTHENTICATED");
    // A web session token is not accepted by the admin app.
    const web = await auth.login({ email: a.email, password: STRONG, totp: totp(secret) }, "web", { ...meta, ip: ip() });
    expect(await platform.authenticateAdmin(web.token, meta)).toBeNull();
    const m = await platform.platformMetrics(ctx!);
    expect(m.businesses).toBeGreaterThan(0);
  });

  it("support can read a business only with an owner-approved, unexpired grant — and never write", async () => {
    const a = await makeAdmin();
    const s = await platform.adminLogin({ email: a.email, password: STRONG }, { ...meta, ip: ip() });
    const { secret } = await platform.adminBeginTotp(a.user.id);
    await platform.adminConfirmTotp(a.user.id, s.session.id, totp(secret));
    const ctx = (await platform.authenticateAdmin(s.token, meta))!;

    const O = await newUser("Grant Owner");
    const biz = await newBusiness(O.user, { name: "Grant Test Shop" });
    await as(O.user, biz, (t) => parties.createParty(t, { name: "Confidential Customer", billingAddress: { stateCode: "29" }, openingBalance: "0" }));

    const list = await platform.listBusinesses(ctx, { q: "Grant Test Shop" });
    expect((list.items as Array<{ id: string }>)[0]!.id).toBe(biz);
    await expectCode(withTenant(a.user, biz, meta, async () => 1), "FORBIDDEN");

    const g = await platform.requestSupportAccess(ctx, biz, "Customer reported wrong totals on invoice");
    await expectCode(withTenant(a.user, biz, meta, async () => 1), "FORBIDDEN"); // not yet approved
    await as(O.user, biz, (t) => team.decideSupportGrant(t, g.id, true, 2));
    await withTenant(a.user, biz, meta, async (t) => {
      expect(t.isSupport).toBe(true);
      const ps = await parties.listParties(t, {});
      expect(ps.items.map((p) => p.name)).toContain("Confidential Customer");
      await expectCode(parties.createParty(t, { name: "Support wrote this", billingAddress: { stateCode: "29" }, openingBalance: "0" }), "FORBIDDEN");
      await expectCode(documents.createDocument(t, { docType: "invoice", partyId: ps.items[0]!.id as string, issueDate: t.today, items: [item()] }), "FORBIDDEN");
    });
    // Owner revokes → access ends immediately.
    await as(O.user, biz, (t) => team.decideSupportGrant(t, g.id, false));
    await expectCode(withTenant(a.user, biz, meta, async () => 1), "FORBIDDEN");
  });

  it("admins can suspend a business, which becomes read-only", async () => {
    const a = await makeAdmin();
    const s = await platform.adminLogin({ email: a.email, password: STRONG }, { ...meta, ip: ip() });
    const { secret } = await platform.adminBeginTotp(a.user.id);
    await platform.adminConfirmTotp(a.user.id, s.session.id, totp(secret));
    const ctx = (await platform.authenticateAdmin(s.token, meta))!;
    const O = await newUser("Suspended Owner");
    const biz = await newBusiness(O.user);
    await platform.setBusinessStatus(ctx, biz, "suspended", "Chargeback investigation");
    await as(O.user, biz, async (t) => {
      await parties.listParties(t, {});
      await expectCode(parties.createParty(t, { name: "x", billingAddress: { stateCode: "29" }, openingBalance: "0" }), "FORBIDDEN");
    });
    await platform.setBusinessStatus(ctx, biz, "active", "Resolved");
    await as(O.user, biz, (t) => parties.createParty(t, { name: "back", billingAddress: { stateCode: "29" }, openingBalance: "0" }));
    const log = await platform.platformAudit(ctx);
    expect((log as Array<{ action: string }>).some((l) => l.action === "business.suspend")).toBe(true);
  });
});

describe("billing verification", () => {
  it("verifies Razorpay signatures and never trusts client success flags", async () => {
    const secret = "test_secret_abc";
    const sig = createHmac("sha256", secret).update("order_1|pay_1").digest("hex");
    expect(billing.verifyCheckoutSignature("order_1", "pay_1", sig, secret)).toBe(true);
    expect(billing.verifyCheckoutSignature("order_1", "pay_2", sig, secret)).toBe(false);
    expect(billing.verifyCheckoutSignature("order_1", "pay_1", "", secret)).toBe(false);
    const body = JSON.stringify({ event: "payment.captured" });
    expect(billing.verifyWebhookSignature(body, createHmac("sha256", "wh").update(body).digest("hex"), "wh")).toBe(true);
    expect(billing.verifyWebhookSignature(body + " ", createHmac("sha256", "wh").update(body).digest("hex"), "wh")).toBe(false);
  });

  it("activates a plan only after signature + gateway confirmation; webhooks are idempotent", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_key";
    process.env.RAZORPAY_KEY_SECRET = "rzp_test_secret";
    process.env.RAZORPAY_WEBHOOK_SECRET = "rzp_webhook_secret";
    const calls: string[] = [];
    let captured = false;
    billing.setBillingFetch(async (url, init) => {
      calls.push(`${init?.method} ${url}`);
      if (url.endsWith("/orders")) {
        const b = JSON.parse(String(init!.body));
        return new Response(JSON.stringify({ id: "order_TEST1", amount: b.amount, currency: "INR" }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "pay_TEST1", order_id: "order_TEST1", status: captured ? "captured" : "authorized", amount: 69900, currency: "INR" }), { status: 200 });
    });
    try {
      const O = await newUser("Payer");
      const biz = await newBusiness(O.user);
      const co = await as(O.user, biz, (t) => billing.createCheckout(t, "pro", "month"));
      expect(co.amount).toBe(69900);
      const sig = createHmac("sha256", "rzp_test_secret").update("order_TEST1|pay_TEST1").digest("hex");
      await expectCode(as(O.user, biz, (t) => billing.verifyCheckout(t, { orderId: "order_TEST1", paymentId: "pay_TEST1", signature: "forged" })), "VALIDATION");
      // Valid signature but the gateway says not captured → not activated.
      await expectCode(as(O.user, biz, (t) => billing.verifyCheckout(t, { orderId: "order_TEST1", paymentId: "pay_TEST1", signature: sig })), "VALIDATION");
      // Another business cannot claim this order.
      const P = await newUser("Thief");
      const pb = await newBusiness(P.user);
      captured = true;
      await expectCode(as(P.user, pb, (t) => billing.verifyCheckout(t, { orderId: "order_TEST1", paymentId: "pay_TEST1", signature: sig })), "VALIDATION");
      const r = await as(O.user, biz, (t) => billing.verifyCheckout(t, { orderId: "order_TEST1", paymentId: "pay_TEST1", signature: sig }));
      expect(r.alreadyProcessed).toBe(false);
      await as(O.user, biz, async (t) => {
        expect(t.plan.status).toBe("active");
        expect(t.plan.code).toBe("pro");
      });
      // Webhook for the same payment: processed once, duplicate delivery ignored.
      const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_TEST1", order_id: "order_TEST1", amount: 69900, status: "captured" } } } });
      const wsig = createHmac("sha256", "rzp_webhook_secret").update(body).digest("hex");
      expect((await billing.handleRazorpayWebhook(body, wsig, "evt_1")).duplicate).toBe(false);
      expect((await billing.handleRazorpayWebhook(body, wsig, "evt_1")).duplicate).toBe(true);
      await expectCode(billing.handleRazorpayWebhook(body, "bad", "evt_2"), "UNAUTHENTICATED");
      const paid = await owner(async (c) => (await c.query("select count(*)::int n from subscription_payments where gateway_order_id = 'order_TEST1' and status = 'paid'")).rows[0].n);
      expect(paid).toBe(1);
      // The tenant role cannot change its own subscription directly.
      await expect(as(O.user, biz, (t) => t.db.exec("update subscriptions set plan_id = plan_id"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;
      delete process.env.RAZORPAY_WEBHOOK_SECRET;
    }
  });
});

describe("business deletion", () => {
  it("hides the business immediately, can be restored, and is purged after retention", async () => {
    const O = await newUser("Closing Owner");
    const biz = await newBusiness(O.user, { name: "Closing Down Ltd" });
    await as(O.user, biz, async (t) => {
      const c = await parties.createParty(t, { name: "Old Customer", billingAddress: { stateCode: "29" }, openingBalance: "0" });
      const d = await documents.createDocument(t, { docType: "invoice", partyId: c.id as string, issueDate: t.today, items: [item()] });
      await documents.finalizeDocument(t, d.id as string);
    });
    await expectCode(as(O.user, biz, (t) => businesses.requestBusinessDeletion(t, STRONG, "wrong name")), "VALIDATION");
    await as(O.user, biz, (t) => businesses.requestBusinessDeletion(t, STRONG, "Closing Down Ltd"));
    await expectCode(withTenant(O.user, biz, meta, async () => 1), "FORBIDDEN");
    expect((await businesses.listMyBusinesses(O.user)).find((b) => b.id === biz)).toBeUndefined();
    const { appTx } = await import("../src/db");
    await appTx({ userId: O.user.id }, (db) => db.one("select app.restore_business($1)", [biz]));
    await withTenant(O.user, biz, meta, async () => 1);
    await as(O.user, biz, (t) => businesses.requestBusinessDeletion(t, STRONG, "Closing Down Ltd"));
    await owner((c) => c.query("update businesses set purge_after = now() - interval '1 minute' where id = $1", [biz]));
    const r = await platform.runDailyJobs();
    expect(r.purgedBusinesses).toBeGreaterThanOrEqual(1);
    const left = await owner(async (c) => (await c.query("select (select count(*) from businesses where id = $1) + (select count(*) from documents where business_id = $1) + (select count(*) from audit_logs where business_id = $1) as n", [biz])).rows[0].n);
    expect(Number(left)).toBe(0);
  });
});
