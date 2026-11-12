import { z } from "zod";
import { ApiRouter, idParam } from "../../http/router.js";
import { listNotifications, markRead, pollState } from "./service.js";

export const notificationRoutes = new ApiRouter("");
const r = notificationRoutes;

/** Live updates without WebSockets: the app calls this every 10–20 seconds. */
r.get("/poll", { access: { perm: "any_member" } }, async ({ ctx }) => pollState(ctx));

r.get("/notifications", { access: { perm: "any_member" }, query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }) }, async ({ ctx, query }) =>
  listNotifications(ctx, query.limit),
);
r.post("/notifications/read-all", { access: { perm: "any_member" }, allowWhenExpired: true }, async ({ ctx }) => {
  await markRead(ctx, "all");
});
r.post("/notifications/:id/read", { access: { perm: "any_member" }, allowWhenExpired: true }, async ({ ctx, params }) => {
  await markRead(ctx, idParam(params));
});
