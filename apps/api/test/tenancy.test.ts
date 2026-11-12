import { describe, expect, it } from "vitest";
import { gstinCheckChar } from "@cba/core";
import { addMember, ownerWithBusiness, sampleBusiness, signedIn } from "./helpers.js";
import { TenantDb, db, getPool, withTx } from "../src/db/pool.js";
import { nextDocNumber } from "../src/modules/tenants/series.js";

const fakeGstin = (state: string, pan = "AAAFZ1234A") => {
  const first14 = `${state}${pan}1Z`;
  return first14 + gstinCheckChar(first14);
};

describe("business onboarding", () => {
  it("creates business, branches, 5 system roles, owner, number series and defaults", async () => {
    const o = await ownerWithBusiness({ gstin: fakeGstin("36") });
    const cur = await o.get("/tenant");
    expect(cur.status).toBe(200);
    const d = cur.body.data;
    expect(d.tenant.sector).toBe("retail");
    expect(d.tenant.fyStartMonth).toBe(4);
    expect(d.tenant.pan).toBe("AAAFZ1234A");
    expect(d.tenant.subscriptionStatus).toBe("trial");
    expect(d.modules).toEqual(["retail"]);
    expect(d.branches.map((b: any) => b.code)).toEqual(["MAIN", "B2"]);
    expect(d.me.role.key).toBe("owner");
    const roles = (await o.get("/roles")).body.data;
    expect(roles.map((r: any) => r.key)).toEqual(["owner", "admin", "manager", "accountant", "cashier"]);
    const series = (await o.get("/document-series")).body.data;
    const inv = series.filter((s: any) => s.docType === "invoice");
    expect(inv.map((s: any) => s.prefix).sort()).toEqual(["SLM", "SLM2"]);
    const t = await db().one("SELECT (SELECT COUNT(*) FROM units WHERE tenant_id = :t) AS units, (SELECT COUNT(*) FROM accounts WHERE tenant_id = :t) AS acc", { t: o.tenantId });
    expect(Number(t.units)).toBeGreaterThan(5);
    expect(Number(t.acc)).toBe(1);
  });

  it("validates GSTIN checksum and state", async () => {
    const c = await signedIn();
    const bad = await c.post("/tenants", sampleBusiness({ gstin: "36AAAFZ1234A1Z0" === fakeGstin("36") ? "36AAAFZ1234A1Z1" : "36AAAFZ1234A1Z0" }));
    expect(bad.status).toBe(400);
    const wrongState = await c.post("/tenants", sampleBusiness({ gstin: fakeGstin("29") }));
    expect(wrongState.status).toBe(400);
    expect(JSON.stringify(wrongState.body)).toContain("state");
  });

  it("one user can own several businesses and switch between them", async () => {
    const o = await ownerWithBusiness();
    const second = await o.post("/tenants", sampleBusiness({ name: "Annapurna Tiffins (Test)", sector: "restaurant", branches: [{ name: "Main", stateCode: "36" }] }));
    expect(second.status).toBe(201);
    const list = (await o.get("/tenants")).body.data;
    expect(list.length).toBe(2);
    const sw = await o.post(`/tenants/${o.tenantId}/switch`);
    expect(sw.status).toBe(200);
    expect(sw.body.data.tenant.id).toBe(o.tenantId);
  });
});

describe("tenant isolation", () => {
  it("a user cannot open or read another business", async () => {
    const a = await ownerWithBusiness();
    const b = await ownerWithBusiness();
    const asB = Object.assign(Object.create(Object.getPrototypeOf(a)), a, { tenantId: b.tenantId });
    for (const url of ["/tenant", "/team", "/roles", "/audit-logs", "/branches", "/poll"]) {
      const r = await asB.get(url);
      expect(r.status, url).toBe(403);
      expect(r.body.error.code).toBe("no_business_access");
    }
    expect((await a.post(`/tenants/${b.tenantId}/switch`)).status).toBe(403);
    expect((await asB.patch("/tenant", { name: "Hacked" })).status).toBe(403);
  });

  it("ids from another business are not found", async () => {
    const a = await ownerWithBusiness();
    const b = await ownerWithBusiness();
    const bBranch = b.branchIds[0];
    expect((await a.patch(`/branches/${bBranch}`, { name: "Hacked" })).status).toBe(404);
    const bRoles = (await b.get("/roles")).body.data;
    expect((await a.patch(`/roles/${bRoles[0].id}`, { name: "Hacked" })).status).toBe(404);
    const bTeam = (await b.get("/team")).body.data;
    expect((await a.patch(`/team/${bTeam[0].id}`, { displayName: "x" })).status).toBe(404);
  });

  it("TenantDb refuses a query that is not scoped to :tenantId", async () => {
    const tdb = new TenantDb(getPool(), 1);
    await expect(tdb.all("SELECT * FROM branches")).rejects.toThrow(/not scoped/);
    await expect(tdb.exec("DELETE FROM branches WHERE id = 1")).rejects.toThrow(/not scoped/);
  });

  it("the database itself rejects a row linking to another business's data", async () => {
    const a = await ownerWithBusiness();
    const b = await ownerWithBusiness();
    const bRole = (await b.get("/roles")).body.data[1];
    const user = await db().one("SELECT id FROM users ORDER BY id DESC LIMIT 1");
    await expect(
      db().exec("INSERT INTO memberships (tenant_id, user_id, role_id, status) VALUES (:t, :u, :r, 'active')", { t: a.tenantId, u: user.id, r: bRole.id }),
    ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
  });
});

describe("roles and permissions", () => {
  it("cashier cannot see team, roles, audit or settings", async () => {
    const o = await ownerWithBusiness();
    const cashier = await addMember(o, "cashier");
    expect((await cashier.get("/tenant")).status).toBe(200);
    for (const url of ["/team", "/audit-logs", "/document-series", "/permissions"]) {
      const r = await cashier.get(url);
      expect(r.status, url).toBe(403);
      expect(r.body.error.code).toBe("permission_denied");
    }
    expect((await cashier.patch("/tenant", { name: "x" })).status).toBe(403);
    expect((await cashier.post("/branches", { name: "New", stateCode: "36" })).status).toBe(403);
  });

  it("custom role with checkbox permissions works, and grants are limited to your own", async () => {
    const o = await ownerWithBusiness();
    const created = await o.post("/roles", { name: "Store keeper", permissions: ["items.view", "stock.view", "stock.adjust", "team.view"] });
    expect(created.status).toBe(201);
    const unknown = await o.post("/roles", { name: "Bad", permissions: ["items.fly"] });
    expect(unknown.status).toBe(400);
    const ownerOnly = await o.post("/roles", { name: "Billing", permissions: ["billing.manage"] });
    expect(ownerOnly.body.error.code).toBe("owner_only_permission");

    const manager = await addMember(o, "manager");
    // Manager lacks roles.manage entirely.
    expect((await manager.post("/roles", { name: "X", permissions: [] })).status).toBe(403);

    // A custom "HR lead" with roles.manage but no payroll cannot hand out payroll.
    const hr = await o.post("/roles", { name: "HR lead", permissions: ["roles.manage", "roles.view", "team.view", "team.invite", "employees.view"] });
    const hrUser = await addMember(o, "cashier");
    await o.patch(`/team/${hrUser.membershipId}`, { roleId: hr.body.data.id });
    const esc = await hrUser.post("/roles", { name: "Sneaky", permissions: ["payroll.run"] });
    expect(esc.status).toBe(403);
    expect(esc.body.error.code).toBe("cannot_grant");
    // ...and cannot invite someone as admin.
    const roles = (await o.get("/roles")).body.data;
    const admin = roles.find((r: any) => r.key === "admin");
    const inv = await hrUser.post("/team", { mobile: "9876500001", name: "X", roleId: admin.id });
    expect(inv.status).toBe(403);
  });

  it("system roles cannot be edited or deleted; roles in use cannot be deleted", async () => {
    const o = await ownerWithBusiness();
    const roles = (await o.get("/roles")).body.data;
    expect((await o.patch(`/roles/${roles[1].id}`, { name: "Boss" })).status).toBe(403);
    expect((await o.del(`/roles/${roles[1].id}`)).status).toBe(403);
    const custom = (await o.post("/roles", { name: "Helper", permissions: ["items.view"] })).body.data;
    const m = await addMember(o, "cashier");
    await o.patch(`/team/${m.membershipId}`, { roleId: custom.id });
    expect((await o.del(`/roles/${custom.id}`)).status).toBe(409);
  });

  it("permission changes apply on the very next request", async () => {
    const o = await ownerWithBusiness();
    const m = await addMember(o, "cashier");
    expect((await m.get("/team")).status).toBe(403);
    const roles = (await o.get("/roles")).body.data;
    await o.patch(`/team/${m.membershipId}`, { roleId: roles.find((r: any) => r.key === "manager").id });
    expect((await m.get("/team")).status).toBe(200);
    await o.patch(`/team/${m.membershipId}`, { status: "disabled" });
    expect((await m.get("/tenant")).status).toBe(403);
  });
});

describe("team rules", () => {
  it("invite returns a WhatsApp link; invited person becomes active on first sign-in", async () => {
    const o = await ownerWithBusiness();
    const roles = (await o.get("/roles")).body.data;
    const r = await o.post("/team", { mobile: "98765 43210".replace("98765", String(90000 + Math.floor(Math.random() * 9999))), name: "Kiran", roleId: roles[4].id });
    expect(r.status).toBe(201);
    expect(r.body.data.whatsappLink).toMatch(/^https:\/\/wa\.me\/91\d{10}\?text=/);
    const team = (await o.get("/team")).body.data;
    expect(team.find((t: any) => t.name === "Kiran").status).toBe("invited");
  });

  it("owner cannot change own role; last owner cannot be removed or demoted", async () => {
    const o = await ownerWithBusiness();
    const team = (await o.get("/team")).body.data;
    const me = team[0];
    const roles = (await o.get("/roles")).body.data;
    expect((await o.patch(`/team/${me.id}`, { roleId: roles[1].id })).body.error.code).toBe("own_access");
    expect((await o.del(`/team/${me.id}`)).body.error.code).toBe("own_access");
    // A second owner can't demote the only other owner if that leaves none... add second owner first
    const second = await addMember(o, "admin");
    await o.patch(`/team/${second.membershipId}`, { roleId: roles[0].id });
    // Admin cannot touch owners
    const admin = await addMember(o, "admin");
    expect((await admin.patch(`/team/${me.id}`, { status: "disabled" })).body.error.code).toBe("owner_only");
    // Second owner removes the first: allowed (one owner remains)
    expect((await second.del(`/team/${me.id}`)).status).toBe(204);
    // Now second is the last owner; nobody else can remove them and they can't remove themselves
    expect((await second.del(`/team/${second.membershipId}`)).body.error.code).toBe("own_access");
  });

  it("branch restriction limits which branches a member sees", async () => {
    const o = await ownerWithBusiness();
    const m = await addMember(o, "cashier", { allBranches: false, branchIds: [o.branchIds[1]!] });
    const b = (await m.get("/branches")).body.data;
    expect(b.map((x: any) => x.id)).toEqual([o.branchIds[1]]);
    const cur = (await m.get("/tenant")).body.data;
    expect(cur.me.branchIds).toEqual([o.branchIds[1]]);
  });
});

describe("document numbering", () => {
  it("gives gap-free unique numbers under concurrency and FY-based format", async () => {
    const o = await ownerWithBusiness({ invoicePrefix: "TST" });
    const branchId = o.branchIds[0]!;
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        withTx(async (conn) => nextDocNumber(new TenantDb(conn, o.tenantId!), branchId, "invoice", "2026-11-12")),
      ),
    );
    const nums = results.map((r) => r.number).sort();
    expect(new Set(nums).size).toBe(12);
    expect(nums[0]).toBe("TST/26-27/0001");
    expect(nums[11]).toBe("TST/26-27/0012");
    // A date in the next FY starts again at 1.
    const next = await withTx((conn) => nextDocNumber(new TenantDb(conn, o.tenantId!), branchId, "invoice", "2027-04-01"));
    expect(next).toEqual({ number: "TST/27-28/0001", fy: "2027-28" });
    // A rolled-back transaction gives its number back.
    await withTx(async (conn) => {
      await nextDocNumber(new TenantDb(conn, o.tenantId!), branchId, "invoice", "2026-11-12");
      throw new Error("cancel");
    }).catch(() => {});
    const after = await withTx((conn) => nextDocNumber(new TenantDb(conn, o.tenantId!), branchId, "invoice", "2026-11-12"));
    expect(after.number).toBe("TST/26-27/0013");
  });

  it("number series cannot go backwards", async () => {
    const o = await ownerWithBusiness();
    const s = (await o.get("/document-series")).body.data[0];
    expect((await o.patch(`/document-series/${s.id}`, { prefix: s.prefix, nextNumber: 50 })).status).toBe(200);
    expect((await o.patch(`/document-series/${s.id}`, { prefix: s.prefix, nextNumber: 10 })).body.error.code).toBe("series_backwards");
    expect((await o.patch(`/document-series/${s.id}`, { prefix: "TOOLONG1" })).status).toBe(400);
  });
});

describe("invitations", () => {
  it("are accepted on first sign-in by password too", async () => {
    const { Client, newMobile } = await import("./helpers.js");
    const { hashPassword } = await import("../src/modules/auth/password.js");
    const o = await ownerWithBusiness();
    const mobile = newMobile();
    const roles = (await o.get("/roles")).body.data;
    await o.post("/team", { mobile, name: "Pw Staff", roleId: roles.find((r: any) => r.key === "cashier").id });
    await db().exec("UPDATE users SET password_hash = :h WHERE mobile = :m", { h: await hashPassword("Staff2026pass"), m: `+91${mobile}` });
    const c = await new Client().init();
    expect((await c.post("/auth/login", { identifier: mobile, password: "Staff2026pass" })).status).toBe(200);
    const me = (await c.get("/me")).body.data;
    expect(me.businesses.map((b: any) => b.id)).toEqual([o.tenantId]);
    expect(me.currentTenantId).toBe(o.tenantId);
  });
});
