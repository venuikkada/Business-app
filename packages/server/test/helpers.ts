import { randomUUID } from "node:crypto";
import pg from "pg";
import { auth, businesses, withTenant, type Tenant, type AuthUser } from "../src";

export const meta = { ip: "127.0.0.1", userAgent: "vitest" };
export const STRONG = "Str0ngPassw0rd!";

export async function newUser(name = "Test User") {
  const email = `${randomUUID().slice(0, 8)}@example.test`;
  // Unique client IP per test user so the per-IP signup rate limit is not hit.
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const r = await auth.register({ fullName: name, email, password: STRONG, acceptTerms: true }, { ...meta, ip });
  return { ...r, email };
}

export async function newBusiness(user: AuthUser, overrides: Record<string, unknown> = {}, settings: Record<string, unknown> = {}) {
  const { id } = await businesses.createBusiness(
    user,
    { name: `Shop ${randomUUID().slice(0, 6)}`, stateCode: "29", address: { city: "Bengaluru", stateCode: "29" }, ...overrides } as never,
    settings as never,
  );
  return id;
}

export function as<T>(user: AuthUser, businessId: string, fn: (t: Tenant) => Promise<T>) {
  return withTenant(user, businessId, meta, fn);
}

/** Raw connection as the owner (bypasses RLS) for test setup and assertions. */
export async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: process.env.TEST_OWNER_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Raw connection as cba_app (RLS enforced). */
export async function asAppRole<T>(ctx: { userId?: string; businessId?: string }, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.user_id', $1, true), set_config('app.business_id', $2, true)", [ctx.userId ?? "", ctx.businessId ?? ""]);
    const r = await fn(c);
    await c.query("rollback");
    return r;
  } finally {
    await c.end();
  }
}

export async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    const got = (e as { code?: string }).code;
    if (got !== code) throw new Error(`Expected error ${code} but got ${got}: ${(e as Error).message}`);
    return e as Error & { code: string; details?: Record<string, unknown> };
  }
  throw new Error(`Expected error ${code} but the call succeeded`);
}

/** Makes `user` a member of the business with a system role. */
export async function addMember(businessId: string, roleKey: string, name = "Staff") {
  const u = await newUser(name);
  await owner(async (c) => {
    const r = await c.query("select id from roles where business_id = $1 and key = $2", [businessId, roleKey]);
    await c.query("insert into memberships(business_id, user_id, role_id) values ($1,$2,$3)", [businessId, u.user.id, r.rows[0].id]);
  });
  return u;
}

export const item = (o: Record<string, unknown> = {}) => ({ description: "Item", quantity: "1", unit: "pcs", unitPrice: "100", taxRate: 18, ...o });
