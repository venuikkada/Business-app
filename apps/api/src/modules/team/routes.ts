import { z } from "zod";
import { ApiRouter, idParam } from "../../http/router.js";
import { inviteMember, listMembers, removeMember, updateMember } from "./service.js";

export const teamRoutes = new ApiRouter("/team");
const r = teamRoutes;

r.get("/", { access: { perm: "team.view" } }, async ({ ctx }) => listMembers(ctx));

r.post("/",
  {
    access: { perm: "team.invite" },
    body: z.object({
      mobile: z.string().trim().min(10).max(16),
      name: z.string().trim().min(1).max(120),
      roleId: z.number().int().positive(),
      allBranches: z.boolean().default(true),
      branchIds: z.array(z.number().int().positive()).max(50).default([]),
    }),
  },
  async ({ ctx, body, res }) => {
    res.status(201);
    return inviteMember(ctx, body);
  },
);

r.patch(
  "/:id",
  {
    access: { perm: "team.edit" },
    body: z.object({
      roleId: z.number().int().positive().optional(),
      allBranches: z.boolean().optional(),
      branchIds: z.array(z.number().int().positive()).max(50).optional(),
      status: z.enum(["active", "disabled"]).optional(),
      displayName: z.string().trim().max(120).nullable().optional(),
    }),
  },
  async ({ ctx, body, params }) => {
    await updateMember(ctx, idParam(params), body);
    return { ok: true };
  },
);

r.delete("/:id", { access: { perm: "team.remove" } }, async ({ ctx, params }) => {
  await removeMember(ctx, idParam(params));
});
