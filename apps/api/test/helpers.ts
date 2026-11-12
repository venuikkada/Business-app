import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { consoleOutbox } from "../src/modules/auth/sms.js";
import { db } from "../src/db/pool.js";

/** Tests sign in the same number on several "devices"; skip the 30 s resend wait. */
export async function clearOtpCooldown(mobile10: string) {
  await db().exec("DELETE FROM rate_limits WHERE bucket LIKE :b", { b: `otp:cool:%+91${mobile10}` });
}

let app: Express | null = null;
export function testApp(): Express {
  return (app ??= createApp());
}

let mobileSeq = 0;
const runPrefix = String(100 + Math.floor(Math.random() * 900));
/** Unique fictional Indian mobile numbers for each test user (start with 6). */
export function newMobile(): string {
  mobileSeq++;
  return `6${runPrefix}${String(mobileSeq).padStart(6, "0")}`;
}

let ipSeq = 0;
const newIp = () => `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`;

export function lastOtp(mobile10: string): string {
  const e164 = `+91${mobile10}`;
  const hit = [...consoleOutbox].reverse().find((o) => o.mobile === e164);
  if (!hit) throw new Error(`no OTP sent to ${e164}`);
  return hit.code;
}

/** A browser-like client: keeps cookies, sends the CSRF header, has its own IP. */
export class Client {
  readonly agent = request.agent(testApp());
  readonly ip = newIp();
  csrf = "";
  tenantId: number | null = null;
  mobile = "";

  async init() {
    const r = await this.agent.get("/api/v1/auth/csrf").set("X-Forwarded-For", this.ip);
    this.csrf = r.body.data.csrfToken;
    return this;
  }

  private h(req: request.Test, csrf = true) {
    req.set("X-Forwarded-For", this.ip).set("Origin", "http://localhost:5173");
    if (csrf) req.set("X-CSRF-Token", this.csrf);
    if (this.tenantId) req.set("X-Tenant-Id", String(this.tenantId));
    return req;
  }
  get(url: string) {
    return this.h(this.agent.get(`/api/v1${url}`), false);
  }
  post(url: string, body?: object) {
    return this.h(this.agent.post(`/api/v1${url}`)).send(body ?? {});
  }
  patch(url: string, body?: object) {
    return this.h(this.agent.patch(`/api/v1${url}`)).send(body ?? {});
  }
  del(url: string) {
    return this.h(this.agent.delete(`/api/v1${url}`));
  }
  upload(url: string, field: string, buf: Buffer, filename: string, extra: Record<string, string> = {}) {
    const req = this.h(this.agent.post(`/api/v1${url}`));
    for (const [k, v] of Object.entries(extra)) req.field(k, v);
    return req.attach(field, buf, filename);
  }

  async loginOtp(mobile = newMobile(), name = "Test User") {
    this.mobile = mobile;
    await clearOtpCooldown(mobile);
    const r1 = await this.post("/auth/otp/request", { mobile });
    if (r1.status !== 200) throw new Error(`otp request failed ${r1.status} ${JSON.stringify(r1.body)}`);
    const r2 = await this.post("/auth/otp/verify", { mobile, otp: lastOtp(mobile), name });
    if (r2.status !== 200) throw new Error(`otp verify failed ${r2.status} ${JSON.stringify(r2.body)}`);
    return r2.body.data as { userId: number; isNewUser: boolean };
  }
}

export async function signedIn(name = "Test User", mobile?: string) {
  const c = await new Client().init();
  const u = await c.loginOtp(mobile, name);
  return Object.assign(c, { userId: u.userId });
}

export const sampleBusiness = (over: Record<string, unknown> = {}) => ({
  name: "Sri Lakshmi Mobiles (Test)",
  sector: "retail",
  stateCode: "36",
  city: "Hyderabad",
  invoicePrefix: "SLM",
  branches: [
    { name: "Ameerpet", stateCode: "36", city: "Hyderabad" },
    { name: "Kukatpally", stateCode: "36", city: "Hyderabad" },
  ],
  ...over,
});

/** Owner with a new business opened. */
export async function ownerWithBusiness(over: Record<string, unknown> = {}) {
  const c = await signedIn("Ravi Owner");
  const r = await c.post("/tenants", sampleBusiness(over));
  if (r.status !== 201) throw new Error(`create tenant failed ${r.status} ${JSON.stringify(r.body)}`);
  c.tenantId = r.body.data.tenantId;
  return Object.assign(c, { branchIds: r.body.data.branchIds as number[] });
}

/** Adds a team member with a system role and returns their signed-in client. */
export async function addMember(owner: Client, roleKey: string, opts: { allBranches?: boolean; branchIds?: number[] } = {}) {
  const roles = (await owner.get("/roles")).body.data as { id: number; key: string }[];
  const role = roles.find((r) => r.key === roleKey);
  if (!role) throw new Error(`role ${roleKey} missing`);
  const mobile = newMobile();
  const inv = await owner.post("/team", { mobile, name: `${roleKey} person`, roleId: role.id, allBranches: opts.allBranches ?? true, branchIds: opts.branchIds ?? [] });
  if (inv.status !== 201) throw new Error(`invite failed ${inv.status} ${JSON.stringify(inv.body)}`);
  const c = await signedIn(`${roleKey} person`, mobile);
  c.tenantId = owner.tenantId;
  return Object.assign(c, { membershipId: inv.body.data.membershipId as number });
}
