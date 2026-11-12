import { z } from "zod";
import { ApiRouter, idParam } from "../../http/router.js";
import { branchInput, createTenantInput, updateSeriesInput, updateTenantInput } from "./schemas.js";
import {
  createBranch, createTenant, currentTenant, listBranches, listMyTenants, listSeries, switchTenant, updateBranch, updateSeries, updateTenant,
} from "./service.js";
import { resolveTenant } from "../../http/auth-middleware.js";

export const tenantRoutes = new ApiRouter("");
const r = tenantRoutes;

/* businesses I belong to + onboarding (no open business needed) */
r.get("/tenants", { access: { access: "user" } }, async ({ ctx }) => listMyTenants(ctx.userId));

r.post("/tenants", { access: { access: "user" }, body: createTenantInput }, async ({ ctx, body, res }) => {
  const out = await createTenant(ctx, body);
  res.status(201);
  return out;
});

r.post("/tenants/:id/switch", { access: { access: "user" } }, async ({ ctx, params, req }) => {
  const id = idParam(params);
  await switchTenant(ctx, id);
  req.headers["x-tenant-id"] = String(id);
  return currentTenant(await resolveTenant(req, { ...ctx, sessionTenantId: id }));
});

/* the open business */
r.get("/tenant", { access: { perm: "any_member" } }, async ({ ctx }) => currentTenant(ctx));
r.patch("/tenant", { access: { perm: "settings.edit" }, body: updateTenantInput, allowWhenExpired: true }, async ({ ctx, body }) => updateTenant(ctx, body));

r.get("/branches", { access: { perm: "any_member" } }, async ({ ctx }) => listBranches(ctx));
r.post("/branches", { access: { perm: "settings.edit" }, body: branchInput }, async ({ ctx, body, res }) => {
  res.status(201);
  return createBranch(ctx, body);
});
r.patch(
  "/branches/:id",
  { access: { perm: "settings.edit" }, body: branchInput.partial().extend({ isActive: z.boolean().optional(), isDefault: z.boolean().optional() }) },
  async ({ ctx, body, params }) => updateBranch(ctx, idParam(params), body),
);

r.get(
  "/document-series",
  { access: { perm: "settings.view" }, query: z.object({ fy: z.string().regex(/^\d{4}-\d{2}$/).optional() }) },
  async ({ ctx, query }) => listSeries(ctx, query.fy),
);
r.patch("/document-series/:id", { access: { perm: "settings.edit" }, body: updateSeriesInput }, async ({ ctx, body, params }) =>
  updateSeries(ctx, idParam(params), body),
);
