import type { Tenant } from "../context";
import { AppError, notFound } from "../errors";
import { camelize } from "../util";

/** Stable JSON (sorted keys) so payload comparisons ignore key order. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export type ApprovalKind = "discount" | "refund" | "stock_adjustment" | "negative_stock" | "payment_void";

const APPROVER_PERMISSION: Record<ApprovalKind, Parameters<Tenant["require"]>[0]> = {
  discount: "invoices.approve",
  refund: "payments.approve",
  payment_void: "payments.approve",
  stock_adjustment: "inventory.approve",
  negative_stock: "inventory.approve",
};

export function canApprove(t: Tenant, kind: ApprovalKind) {
  return t.can(APPROVER_PERMISSION[kind]);
}

/** Creates (or reuses) a pending approval request and notifies approvers. */
export async function requestApproval(t: Tenant, kind: ApprovalKind, entityType: string, entityId: string | null, payload: Record<string, unknown>, reason: string) {
  const existing = await t.db.maybe<{ id: string }>(
    `select id from approval_requests where kind = $1 and entity_id is not distinct from $2 and requested_by = $3 and status = 'pending' and payload = $4::jsonb`,
    [kind, entityId, t.userId, JSON.stringify(payload)],
  );
  const id =
    existing?.id ??
    (
      await t.db.one<{ id: string }>(
        `insert into approval_requests(business_id, kind, entity_type, entity_id, payload, reason, requested_by)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [t.businessId, kind, entityType, entityId, JSON.stringify(payload), reason, t.userId],
      )
    ).id;
  if (!existing) {
    const approvers = await t.db.query<{ user_id: string }>(
      `select m.user_id from memberships m join roles r on r.id = m.role_id
        where m.status = 'active' and $1 = any(r.permissions) and m.user_id <> $2`,
      [APPROVER_PERMISSION[kind], t.userId],
    );
    for (const a of approvers) {
      await t.db.exec(
        `insert into notifications(business_id, user_id, kind, title, body, entity_type, entity_id, dedupe_key)
         values ($1,$2,'approval_request',$3,$4,'approval',$5,$6) on conflict do nothing`,
        [t.businessId, a.user_id, `Approval needed: ${kind.replace("_", " ")}`, `${t.user.fullName}: ${reason}`, id, `approval:${id}`],
      );
    }
    await t.audit("approval.request", "approval", id, reason, undefined, payload);
  }
  return id;
}

/** Throws APPROVAL_REQUIRED (with the request id) so the client can show "waiting for approval". */
export async function requireApproval(t: Tenant, kind: ApprovalKind, entityType: string, entityId: string | null, payload: Record<string, unknown>, reason: string): Promise<never> {
  const id = await requestApproval(t, kind, entityType, entityId, payload, reason);
  throw new AppError("APPROVAL_REQUIRED", `${reason}. An approval request was sent to the owner/manager.`, { approvalId: id, kind });
}

/**
 * Verifies an approved, unused approval that matches this exact operation
 * and marks it used (one approval = one operation).
 */
export async function consumeApproval(t: Tenant, approvalId: string, kind: ApprovalKind, entityId: string | null, payload: Record<string, unknown>) {
  const a = await t.db.maybe<{ status: string; kind: string; entity_id: string | null; payload: Record<string, unknown>; requested_by: string }>(
    "select status, kind, entity_id, payload, requested_by from approval_requests where id = $1 for update",
    [approvalId],
  );
  if (!a || a.kind !== kind) throw new AppError("VALIDATION", "Approval not found for this action");
  if (a.status !== "approved") throw new AppError("APPROVAL_REQUIRED", a.status === "pending" ? "Still waiting for approval" : `Approval was ${a.status}`, { approvalId });
  if ((a.entity_id ?? null) !== (entityId ?? null) || canonical(a.payload) !== canonical(payload)) {
    throw new AppError("VALIDATION", "The approval was given for different values. Request a new approval.");
  }
  await t.db.exec("update approval_requests set status = 'used', used_at = now() where id = $1", [approvalId]);
}

export async function listApprovals(t: Tenant, status = "pending") {
  const rows = await t.db.query(
    `select a.*, u.full_name as requested_by_name, d.full_name as decided_by_name
       from approval_requests a join users u on u.id = a.requested_by left join users d on d.id = a.decided_by
      where ($1 = 'all' or a.status = $1)
        and (a.requested_by = $2 or $3::text[] && array[
          case when a.kind = 'discount' then 'invoices.approve' end,
          case when a.kind in ('refund','payment_void') then 'payments.approve' end,
          case when a.kind in ('stock_adjustment','negative_stock') then 'inventory.approve' end])
      order by a.created_at desc limit 100`,
    [status, t.userId, [...t.permissions]],
  );
  return camelize(rows);
}

export async function decideApproval(t: Tenant, id: string, approve: boolean, note?: string | null) {
  const a = await t.db.maybe<{ kind: ApprovalKind; status: string; requested_by: string }>("select kind, status, requested_by from approval_requests where id = $1 for update", [id]);
  if (!a) throw notFound("Approval request");
  t.require(APPROVER_PERMISSION[a.kind]);
  if (a.requested_by === t.userId && t.roleKey !== "owner") throw new AppError("FORBIDDEN", "You cannot approve your own request");
  if (a.status !== "pending") throw new AppError("CONFLICT", `This request is already ${a.status}`);
  await t.db.exec(
    "update approval_requests set status = $2, decided_by = $3, decided_at = now(), decision_note = $4 where id = $1",
    [id, approve ? "approved" : "rejected", t.userId, note ?? null],
  );
  await t.db.exec(
    `insert into notifications(business_id, user_id, kind, title, body, entity_type, entity_id, dedupe_key)
     values ($1,$2,'approval_decision',$3,$4,'approval',$5,$6) on conflict do nothing`,
    [t.businessId, a.requested_by, approve ? "Your request was approved" : "Your request was rejected", note ?? null, id, `approval-decision:${id}`],
  );
  await t.audit(approve ? "approval.approve" : "approval.reject", "approval", id, note ?? undefined);
}
