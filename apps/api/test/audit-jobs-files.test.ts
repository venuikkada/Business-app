import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { addMember, ownerWithBusiness } from "./helpers.js";
import { db } from "../src/db/pool.js";
import { ROUTE_REGISTRY } from "../src/http/router.js";
import { runJobs } from "../src/modules/jobs/runner.js";
import { enqueue } from "../src/modules/jobs/queue.js";
import { decryptBuffer } from "../src/lib/crypto.js";
import { storageRoot } from "../src/modules/files/storage.js";
import "../src/app.js";

const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

describe("audit log", () => {
  it("records create, update and delete with field-level changes and who did it", async () => {
    const o = await ownerWithBusiness();
    await o.patch("/tenant", { name: "Sri Lakshmi Mobiles & More", city: "Secunderabad" });
    const role = (await o.post("/roles", { name: "Temp", permissions: ["items.view"] })).body.data;
    await o.patch(`/roles/${role.id}`, { permissions: ["items.view", "stock.view"] });
    await o.del(`/roles/${role.id}`);
    const log = (await o.get("/audit-logs?limit=100")).body.data.items;
    const upd = log.find((a: any) => a.entityType === "tenant" && a.action === "update");
    expect(upd.changes.name).toEqual({ from: "Sri Lakshmi Mobiles (Test)", to: "Sri Lakshmi Mobiles & More" });
    expect(upd.changes.city).toEqual({ from: "Hyderabad", to: "Secunderabad" });
    expect(upd.userName).toBe("Ravi Owner");
    const roleActions = log.filter((a: any) => a.entityType === "role").map((a: any) => a.action);
    expect(roleActions).toEqual(["delete", "update", "create"]);
    expect(log.some((a: any) => a.entityType === "tenant" && a.action === "create")).toBe(true);
    expect(log.some((a: any) => a.entityType === "branch")).toBe(false); // branches are part of the tenant create entry
  });

  it("filters by record and pages with a cursor", async () => {
    const o = await ownerWithBusiness();
    for (let i = 0; i < 5; i++) await o.patch("/tenant", { city: `City ${i}` });
    const p1 = (await o.get("/audit-logs?entityType=tenant&action=update&limit=2")).body.data;
    expect(p1.items.length).toBe(2);
    const p2 = (await o.get(`/audit-logs?entityType=tenant&action=update&limit=2&before=${p1.nextBefore}`)).body.data;
    expect(p2.items[0].id).toBeLessThan(p1.items[1].id);
  });

  it("is append-only in the database (trigger)", async () => {
    const o = await ownerWithBusiness();
    const row = await db().one("SELECT id FROM audit_logs WHERE tenant_id = :t LIMIT 1", { t: o.tenantId });
    await expect(db().exec("UPDATE audit_logs SET summary = 'x' WHERE id = :id", { id: row.id })).rejects.toThrow(/append-only/);
    await expect(db().exec("DELETE FROM audit_logs WHERE id = :id", { id: row.id })).rejects.toThrow(/append-only/);
  });

  it("does not store secrets in change history", async () => {
    const { diff } = await import("../src/modules/audit/service.js");
    expect(diff({ password_hash: "a", name: "x" }, { password_hash: "b", name: "y" })).toEqual({
      password_hash: { from: "•••", to: "•••" },
      name: { from: "x", to: "y" },
    });
  });
});

describe("background jobs", () => {
  it("runs due jobs, retries failures with backoff, and gives up after max attempts", async () => {
    const ok = await enqueue("test.echo", { hello: "world" });
    const bad = await enqueue("test.fail", {}, { maxAttempts: 2 });
    await runJobs(20_000, { schedule: false });
    const a = await db().one("SELECT status, result FROM jobs WHERE id = :id", { id: ok });
    expect(a.status).toBe("done");
    let b = await db().one("SELECT status, attempts, run_at > CURRENT_TIMESTAMP(3) AS later FROM jobs WHERE id = :id", { id: bad });
    expect(b.status).toBe("queued");
    expect(Number(b.later)).toBe(1); // backoff
    await db().exec("UPDATE jobs SET run_at = CURRENT_TIMESTAMP(3) WHERE id = :id", { id: bad });
    await runJobs(20_000, { schedule: false });
    b = await db().one("SELECT status, attempts FROM jobs WHERE id = :id", { id: bad });
    expect(b.status).toBe("dead");
    expect(Number(b.attempts)).toBe(2);
  });

  it("dedupe key stops a job being queued twice", async () => {
    const k = `once:${Date.now()}`;
    expect(await enqueue("test.echo", {}, { dedupeKey: k })).toBeTypeOf("number");
    expect(await enqueue("test.echo", {}, { dedupeKey: k })).toBeNull();
  });

  it("recovers jobs whose worker died", async () => {
    const id = await enqueue("test.echo", {});
    await db().exec("UPDATE jobs SET status = 'running', locked_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 20 MINUTE) WHERE id = :id", { id });
    await runJobs(20_000, { schedule: false });
    expect((await db().one("SELECT status FROM jobs WHERE id = :id", { id })).status).toBe("done");
  });

  it("audit export: queued by API, built by cron, downloadable only with permission", async () => {
    const o = await ownerWithBusiness();
    await o.patch("/me", { name: "=HYPERLINK(\"http://evil\")" });
    await o.patch("/tenant", { city: "Warangal" });
    const q = await o.post("/audit-logs/export", {});
    expect(q.status).toBe(202);
    await runJobs(20_000, { schedule: false });
    const job = (await o.get(`/jobs/${q.body.data.jobId}`)).body.data;
    expect(job.status).toBe("done");
    const file = await o.get(`/files/${job.result.fileId}`);
    expect(file.status).toBe(200);
    const text = file.text ?? file.body.toString();
    expect(text).toContain("Created business");
    expect(text).toContain("'=HYPERLINK"); // formula neutralised
    const cashier = await addMember(o, "cashier");
    expect((await cashier.get(`/files/${job.result.fileId}`)).status).toBe(404);
    const notes = (await o.get("/notifications")).body.data;
    expect(notes[0].type).toBe("export_ready");
  });

  it("daily backup is gzip + AES-256-GCM encrypted and contains only that business", async () => {
    const o = await ownerWithBusiness();
    await db().exec("DELETE FROM jobs WHERE dedupe_key LIKE 'backup:%'");
    await enqueue("backup.tenant", { tenantId: o.tenantId }, { tenantId: o.tenantId });
    await runJobs(30_000, { schedule: false });
    const dir = path.join(storageRoot(), "backups", `t_${o.tenantId}`);
    const files = await readdir(dir);
    expect(files.length).toBe(1);
    const enc = await readFile(path.join(dir, files[0]!));
    expect(enc.subarray(0, 2).toString("hex")).not.toBe("1f8b"); // not plain gzip
    const data = JSON.parse(gunzipSync(decryptBuffer(enc)).toString());
    expect(data.tenantId).toBe(o.tenantId);
    expect(data.tables.branches.length).toBe(2);
    expect(data.tables.roles.every((r: any) => Number(r.tenant_id) === o.tenantId)).toBe(true);
  });

  it("subscription: trial end -> grace -> expired (read-only)", async () => {
    const o = await ownerWithBusiness();
    await db().exec("UPDATE tenants SET subscription_ends_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY) WHERE id = :t", { t: o.tenantId });
    await enqueue("subscription.check", {});
    await runJobs(20_000, { schedule: false });
    expect((await o.get("/tenant")).body.data.tenant.subscriptionStatus).toBe("grace");
    expect((await o.patch("/tenant", { city: "Still works" })).status).toBe(200);
    await db().exec("UPDATE tenants SET subscription_ends_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 8 DAY) WHERE id = :t", { t: o.tenantId });
    await enqueue("subscription.check", {});
    await runJobs(20_000, { schedule: false });
    expect((await o.get("/tenant")).body.data.tenant.subscriptionStatus).toBe("expired");
    const w = await o.post("/branches", { name: "Third", stateCode: "36" });
    expect(w.status).toBe(402);
    expect((await o.get("/branches")).status).toBe(200); // reading still works
    const notes = (await o.get("/notifications")).body.data;
    expect(notes.some((n: any) => n.type === "subscription")).toBe(true);
  });

  it("cron HTTP endpoint needs the secret", async () => {
    const o = await ownerWithBusiness();
    const r = await o.agent.post("/api/v1/internal/cron").set("X-Cron-Key", "wrong");
    expect(r.status).toBe(404);
    const ok = await o.agent.post("/api/v1/internal/cron").set("X-Cron-Key", process.env.CRON_SECRET!);
    expect(ok.status).toBe(200);
    expect(ok.body.data).toHaveProperty("processed");
  });
});

describe("file uploads", () => {
  it("accepts a real PNG logo and serves it only to members", async () => {
    const o = await ownerWithBusiness();
    const up = await o.upload("/tenant/logo", "file", PNG_1x1, "logo.png");
    expect(up.status).toBe(200);
    const id = up.body.data.fileId;
    const get = await o.get(`/files/${id}`);
    expect(get.status).toBe(200);
    expect(get.headers["content-type"]).toBe("image/png");
    expect(get.headers["x-content-type-options"]).toBe("nosniff");
    const other = await ownerWithBusiness();
    expect((await other.get(`/files/${id}`)).status).toBe(404);
    const row = await db().one("SELECT storage_path FROM files WHERE id = :id", { id });
    expect(row.storage_path).toMatch(new RegExp(`^t_${o.tenantId}/logo/\\d{4}/\\d{2}/[0-9a-f]{32}\\.png$`));
  });

  it("rejects fake images, SVG, and files over the size limit", async () => {
    const o = await ownerWithBusiness();
    const fake = await o.upload("/tenant/logo", "file", Buffer.from("<html><script>alert(1)</script></html>"), "logo.png");
    expect(fake.body.error.code).toBe("invalid_file_type");
    const svg = await o.upload("/tenant/logo", "file", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), "logo.svg");
    expect(svg.body.error.code).toBe("invalid_file_type");
    const big = Buffer.concat([PNG_1x1, Buffer.alloc(1_100_000)]);
    expect((await o.upload("/tenant/logo", "file", big, "big.png")).body.error.code).toBe("file_too_large");
    const huge = Buffer.concat([PNG_1x1, Buffer.alloc(6 * 1024 * 1024)]);
    expect((await o.upload("/files", "file", huge, "huge.png", { kind: "attachment" })).body.error.code).toBe("file_too_large");
  });
});

describe("every API route declares who may call it", () => {
  it("has an access rule on every route, and public routes are only the expected ones", () => {
    expect(ROUTE_REGISTRY.length).toBeGreaterThan(30);
    for (const r of ROUTE_REGISTRY) {
      expect(["public", "user", "tenant"]).toContain(r.access);
      if (r.access === "tenant") expect(r.perm && r.perm.length > 0).toBe(true);
    }
    const publicRoutes = ROUTE_REGISTRY.filter((r) => r.access === "public").map((r) => `${r.method} ${r.path}`).sort();
    expect(publicRoutes).toEqual([
      "GET /auth/csrf", "GET /health", "GET /meta",
      "POST /auth/login", "POST /auth/logout", "POST /auth/otp/request", "POST /auth/otp/verify",
      "POST /auth/password/reset", "POST /auth/refresh", "POST /internal/cron",
    ].sort());
  });
});
