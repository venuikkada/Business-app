import { z } from "zod";
import { ApiRouter, idParam } from "../../http/router.js";
import { audit, listAudit } from "./service.js";
import { enqueue, getJob } from "../jobs/queue.js";
import { notFound } from "../../lib/errors.js";

export const auditRoutes = new ApiRouter("");
const r = auditRoutes;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const filters = z.object({
  entityType: z.string().regex(/^[a-z_]{1,40}$/).optional(),
  entityId: z.coerce.number().int().positive().optional(),
  userId: z.coerce.number().int().positive().optional(),
  action: z.string().regex(/^[a-z_]{1,20}$/).optional(),
  from: date.optional(),
  to: date.optional(),
});

r.get(
  "/audit-logs",
  { access: { perm: "audit.view" }, query: filters.extend({ before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }) },
  async ({ ctx, query }) => listAudit(ctx.tdb, query),
);

/** Big exports run as a background job; the app polls /jobs/:id until it is done. */
r.post("/audit-logs/export", { access: { perm: "audit.export" }, body: filters }, async ({ ctx, body, res }) => {
  const jobId = await enqueue("export.audit_csv", { filters: body, requestedBy: ctx.userId }, { tenantId: ctx.tenantId, priority: 4, createdBy: ctx.userId });
  await audit(ctx.tdb, ctx, { action: "export", entityType: "audit_log", summary: "Exported audit log" });
  res.status(202);
  return { jobId };
});

r.get("/jobs/:id", { access: { perm: "any_member" } }, async ({ ctx, params }) => {
  const job = await getJob(ctx.tenantId, idParam(params));
  if (!job) throw notFound("Job");
  return job;
});
