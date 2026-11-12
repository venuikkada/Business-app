/**
 * Fictional demo data for testing (NOT real businesses or people).
 * Used by scripts/seed-demo.ts and, when SEED_DEMO_ON_START=true, by the server at start.
 */
import { gstinCheckChar } from "@cba/core";
import { TenantDb, db, getPool } from "../db/pool.js";
import type { TenantCtx, UserCtx } from "../http/context.js";
import { ALL_PERMISSIONS } from "../lib/permissions.js";
import { hashPassword } from "../modules/auth/password.js";
import { createTenant } from "../modules/tenants/service.js";
import { inviteMember } from "../modules/team/service.js";
import { createRole } from "../modules/roles/service.js";

const meta = { ip: "127.0.0.1", userAgent: "seed-script", requestId: "seed" };
const demoPassword = () => process.env.DEMO_PASSWORD ?? "Demo2026pass";
const fakeGstin = (state: string) => `${state}AAAFZ1234A1Z` + gstinCheckChar(`${state}AAAFZ1234A1Z`);

async function user(name: string, mobile: string, password?: string) {
  const d = db();
  const existing = await d.one("SELECT id FROM users WHERE mobile = :m", { m: mobile });
  if (existing) return Number(existing.id);
  const r = await d.exec(
    "INSERT INTO users (name, mobile, mobile_verified_at, password_hash, email) VALUES (:n, :m, CURRENT_TIMESTAMP(3), :p, :e)",
    { n: name, m: mobile, p: password ? await hashPassword(password) : null, e: password ? "owner@demo.example" : null },
  );
  return r.insertId;
}

function ownerCtx(userId: number, tenantId: number, name: string): TenantCtx {
  return {
    kind: "tenant", meta, userId, sessionId: 0, sessionTenantId: tenantId,
    user: { id: userId, name, mobile: null, email: null, language: "en" },
    tenantId, tdb: new TenantDb(getPool(), tenantId),
    tenant: { id: tenantId, name: "", sector: "retail", stateCode: "36", fyStartMonth: 4, subscriptionStatus: "trial" },
    membershipId: 0, role: { id: 0, key: "owner", name: "Owner" }, permissions: new Set(ALL_PERMISSIONS), branchIds: null,
  };
}

/** Idempotent: does nothing if the demo owner already has a business. Returns true if data was created. */
export async function seedDemo(log: (m: string) => void = console.log): Promise<boolean> {
  const ownerMobile = "+919000000001";
  if (await db().one("SELECT 1 FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.mobile = :m", { m: ownerMobile })) {
    log("Demo data already present — nothing to do.");
    return false;
  }
  const ownerId = await user("Ravi Kumar (Demo)", ownerMobile, demoPassword());
  const u: UserCtx = { kind: "user", meta, userId: ownerId, sessionId: 0, sessionTenantId: null, user: { id: ownerId, name: "Ravi Kumar (Demo)", mobile: ownerMobile, email: null, language: "en" } };

  const shop = await createTenant(u, {
    name: "Sri Lakshmi Mobiles (Demo)", legalName: "Sri Lakshmi Mobiles", gstin: fakeGstin("36"), pan: null, sector: "retail",
    stateCode: "36", addressLine1: "Shop 12, Main Road, Ameerpet", addressLine2: null, city: "Hyderabad", pincode: "500016",
    phone: null, email: null, fyStartMonth: 4, defaultLanguage: "te", invoicePrefix: "SLM",
    branches: [
      { name: "Ameerpet", stateCode: "36", city: "Hyderabad", gstin: null, pincode: "500016", addressLine1: null, addressLine2: null, phone: null },
      { name: "Kukatpally", stateCode: "36", city: "Hyderabad", gstin: null, pincode: "500072", addressLine1: null, addressLine2: null, phone: null, invoicePrefix: "SLK" },
    ],
  });
  const ctx = ownerCtx(ownerId, shop.tenantId, "Ravi Kumar (Demo)");
  const roles = await ctx.tdb.all("SELECT id, role_key FROM roles WHERE tenant_id = :tenantId");
  const roleId = (k: string) => Number(roles.find((r) => r.role_key === k)!.id);

  await inviteMember(ctx, { mobile: "9000000002", name: "Suresh (Manager, Demo)", roleId: roleId("manager"), allBranches: true, branchIds: [] });
  await inviteMember(ctx, { mobile: "9000000003", name: "Priya (Cashier, Demo)", roleId: roleId("cashier"), allBranches: false, branchIds: [shop.branchIds[1]!] });
  await inviteMember(ctx, { mobile: "9000000004", name: "Anil (Accountant, Demo)", roleId: roleId("accountant"), allBranches: true, branchIds: [] });
  await createRole(ctx, {
    name: "Store keeper", description: "Receives stock and counts it. No sales or money.",
    permissions: ["dashboard.view", "items.view", "items.create", "items.edit", "stock.view", "stock.adjust", "stock.transfer"],
  });

  // A second business for the same owner (shows the business switcher).
  await createTenant(u, {
    name: "Annapurna Tiffins (Demo)", legalName: null, gstin: null, pan: null, sector: "restaurant", stateCode: "36",
    addressLine1: null, addressLine2: null, city: "Secunderabad", pincode: null, phone: null, email: null,
    fyStartMonth: 4, defaultLanguage: "en", invoicePrefix: "AT",
    branches: [{ name: "Secunderabad", stateCode: "36", city: "Secunderabad", gstin: null, pincode: null, addressLine1: null, addressLine2: null, phone: null }],
  });

  log(`
Demo data created (all fictional):
  Owner     Ravi Kumar      mobile 90000 00001  (OTP in the server log, or the DEMO_PASSWORD)
  Manager   Suresh          mobile 90000 00002  (OTP)
  Cashier   Priya           mobile 90000 00003  (OTP, Kukatpally branch only)
  Accountant Anil           mobile 90000 00004  (OTP)
  Businesses: "Sri Lakshmi Mobiles (Demo)" (retail, 2 branches), "Annapurna Tiffins (Demo)" (restaurant)
`);
  return true;
}

