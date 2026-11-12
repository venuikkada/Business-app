import { z } from "zod";
import { ApiRouter, idParam } from "../../http/router.js";
import { createRole, deleteRole, listRoles, permissionCatalogue, updateRole } from "./service.js";

export const roleRoutes = new ApiRouter("");
const r = roleRoutes;

const roleBody = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(255).nullable().optional(),
  permissions: z.array(z.string().max(60)).max(200),
});

r.get("/permissions", { access: { perm: ["roles.view", "roles.manage"] } }, async ({ ctx }) => permissionCatalogue(ctx));
r.get("/roles", { access: { perm: ["roles.view", "team.view"] } }, async ({ ctx }) => listRoles(ctx));
r.post("/roles", { access: { perm: "roles.manage" }, body: roleBody }, async ({ ctx, body, res }) => {
  res.status(201);
  return createRole(ctx, body);
});
r.patch("/roles/:id", { access: { perm: "roles.manage" }, body: roleBody.partial() }, async ({ ctx, body, params }) =>
  updateRole(ctx, idParam(params), body),
);
r.delete("/roles/:id", { access: { perm: "roles.manage" } }, async ({ ctx, params }) => {
  await deleteRole(ctx, idParam(params));
});
