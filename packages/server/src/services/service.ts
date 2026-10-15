import { serviceTicketSchema, serviceTicketUpdateSchema, servicePartSchema, amcSchema, D, addDays } from "@cba/core";
import type { z } from "zod";
import { resolveBranch, type Tenant } from "../context";
import { AppError, notFound, forbidden } from "../errors";
import { camelize, likePattern, parseList } from "../util";
import { nextNumber, createDocument, finalizeDocument } from "./documents";
import { moveStock, currentAvgCost } from "./stock";

/** Technicians (no service.create) only see tickets assigned to them. */
function scope(t: Tenant) {
  return t.can("service.create") ? "true" : `st.assigned_to = '${t.userId}'`;
}

async function assertAssignee(t: Tenant, userId: string | null | undefined) {
  if (!userId) return;
  const m = await t.db.maybe("select 1 from memberships where user_id = $1 and status = 'active'", [userId]);
  if (!m) throw new AppError("VALIDATION", "The technician is not a member of this business");
}

async function event(t: Tenant, ticketId: string, kind: string, note?: string | null, from?: string | null, to?: string | null) {
  await t.db.exec(
    "insert into service_ticket_events(business_id, ticket_id, kind, from_status, to_status, note, created_by) values ($1,$2,$3,$4,$5,$6,$7)",
    [t.businessId, ticketId, kind, from ?? null, to ?? null, note ?? null, t.userId],
  );
}

async function notifyAssignee(t: Tenant, ticketId: string, number: string, userId: string | null | undefined) {
  if (!userId || userId === t.userId) return;
  await t.db.exec(
    `insert into notifications(business_id, user_id, kind, title, entity_type, entity_id, dedupe_key)
     values ($1,$2,'service_assigned',$3,'service_ticket',$4,$5) on conflict do nothing`,
    [t.businessId, userId, `Service ticket ${number} assigned to you`, ticketId, `assign:${ticketId}:${userId}`],
  );
}

export async function createTicket(t: Tenant, input: z.input<typeof serviceTicketSchema>) {
  t.require("service.create");
  t.requireFeature("service");
  const d = serviceTicketSchema.parse(input);
  const party = await t.db.maybe<{ name: string }>("select name from parties where id = $1", [d.partyId]);
  if (!party) throw new AppError("VALIDATION", "Customer not found");
  await assertAssignee(t, d.assignedTo);
  let underWarranty = d.underWarranty;
  if (d.serialNumber && d.productId) {
    const s = await t.db.maybe<{ warranty_until: string | null }>("select warranty_until from product_serials where product_id = $1 and serial_number = upper($2)", [d.productId, d.serialNumber]);
    if (s?.warranty_until && s.warranty_until >= t.today) underWarranty = true;
  }
  if (d.amcContractId) {
    const amc = await t.db.maybe<{ status: string; end_date: string; party_id: string }>("select status, end_date, party_id from amc_contracts where id = $1", [d.amcContractId]);
    if (!amc || amc.party_id !== d.partyId) throw new AppError("VALIDATION", "AMC contract not found for this customer");
    if (amc.status !== "active" || amc.end_date < t.today) throw new AppError("BUSINESS_RULE", "The AMC contract is not active");
  }
  const branchId = await resolveBranch(t, null);
  const { number } = await nextNumber(t, "service_ticket", t.today, "SRV");
  const r = await t.db.one<{ id: string }>(
    `insert into service_tickets(business_id, branch_id, number, party_id, product_id, equipment, serial_number, issue, priority, status,
       assigned_to, scheduled_at, service_charge, under_warranty, amc_contract_id, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
    [t.businessId, branchId, number, d.partyId, d.productId ?? null, d.equipment, d.serialNumber ? d.serialNumber.toUpperCase() : null, d.issue, d.priority,
      d.assignedTo ? "assigned" : "open", d.assignedTo ?? null, d.scheduledAt ?? null, d.serviceCharge ?? 0, underWarranty, d.amcContractId ?? null, t.userId],
  );
  await event(t, r.id, "created", d.issue, null, d.assignedTo ? "assigned" : "open");
  await notifyAssignee(t, r.id, number, d.assignedTo);
  await t.audit("service.create", "service_ticket", r.id, `${number} for ${party.name}`);
  return getTicket(t, r.id);
}

const TRANSITIONS: Record<string, string[]> = {
  open: ["assigned", "in_progress", "on_hold", "cancelled", "completed"],
  assigned: ["in_progress", "on_hold", "open", "cancelled", "completed"],
  in_progress: ["on_hold", "completed", "assigned", "cancelled"],
  on_hold: ["in_progress", "assigned", "cancelled", "completed"],
  completed: [],
  cancelled: [],
};

export async function updateTicket(t: Tenant, id: string, input: z.input<typeof serviceTicketUpdateSchema>) {
  t.require("service.edit");
  const d = serviceTicketUpdateSchema.parse(input);
  const cur = await t.db.maybe<Record<string, unknown>>(`select * from service_tickets st where id = $1 and ${scope(t)} for update`, [id]);
  if (!cur) throw notFound("Service ticket");
  const status = cur.status as string;
  if ((status === "completed" || status === "cancelled") && (d.status || d.assignedTo !== undefined || d.serviceCharge !== undefined)) throw new AppError("BUSINESS_RULE", `Ticket is ${status}`);
  if (d.assignedTo !== undefined && d.assignedTo !== cur.assigned_to) {
    if (!t.can("service.create")) throw forbidden("Only managers can reassign tickets");
    await assertAssignee(t, d.assignedTo);
    await t.db.exec("update service_tickets set assigned_to = $2, status = case when status = 'open' and $2::uuid is not null then 'assigned' else status end where id = $1", [id, d.assignedTo]);
    await event(t, id, "assigned", null);
    await notifyAssignee(t, id, cur.number as string, d.assignedTo);
  }
  if (d.scheduledAt !== undefined) {
    await t.db.exec("update service_tickets set scheduled_at = $2 where id = $1", [id, d.scheduledAt]);
    await event(t, id, "scheduled", d.scheduledAt ? `Visit scheduled ${d.scheduledAt}` : "Visit unscheduled");
  }
  if (d.serviceCharge !== undefined) await t.db.exec("update service_tickets set service_charge = $2 where id = $1", [id, d.serviceCharge]);
  if (d.resolution !== undefined) await t.db.exec("update service_tickets set resolution = $2 where id = $1", [id, d.resolution]);
  if (d.note) await event(t, id, "note", d.note);
  if (d.status && d.status !== status) {
    if (!(TRANSITIONS[status] ?? []).includes(d.status)) throw new AppError("BUSINESS_RULE", `Cannot move a ${status} ticket to ${d.status}`);
    if (d.status === "completed") await consumeParts(t, id, cur.branch_id as string, cur.number as string);
    await t.db.exec(
      `update service_tickets set status = $2,
         started_at = case when $2 = 'in_progress' and started_at is null then now() else started_at end,
         completed_at = case when $2 = 'completed' then now() else completed_at end where id = $1`,
      [id, d.status],
    );
    await event(t, id, "status", d.note ?? null, status, d.status);
    await t.audit(`service.${d.status}`, "service_ticket", id, `${cur.number}: ${status} → ${d.status}`);
  }
  return getTicket(t, id);
}

/** Spare parts reduce stock exactly once, when the ticket is completed. */
async function consumeParts(t: Tenant, ticketId: string, branchId: string, number: string) {
  const parts = await t.db.query<{ id: string; product_id: string; quantity: string; track_inventory: boolean }>(
    `select sp.id, sp.product_id, sp.quantity, p.track_inventory from service_ticket_parts sp join products p on p.id = sp.product_id
      where sp.ticket_id = $1 and sp.consumed_at is null`,
    [ticketId],
  );
  for (const p of parts) {
    if (p.track_inventory) {
      await moveStock(t, {
        productId: p.product_id, branchId, quantity: new D(p.quantity).neg().toString(), kind: "service_consumption",
        unitCost: await currentAvgCost(t, p.product_id, branchId), sourceType: "service_ticket", sourceId: ticketId, sourceLineId: p.id, note: number,
      });
    }
    await t.db.exec("update service_ticket_parts set consumed_at = now() where id = $1", [p.id]);
  }
}

export async function addPart(t: Tenant, ticketId: string, input: z.input<typeof servicePartSchema>) {
  t.require("service.edit");
  const d = servicePartSchema.parse(input);
  const tk = await t.db.maybe<{ status: string; number: string }>(`select status, number from service_tickets st where id = $1 and ${scope(t)}`, [ticketId]);
  if (!tk) throw notFound("Service ticket");
  if (tk.status === "completed" || tk.status === "cancelled") throw new AppError("BUSINESS_RULE", `Ticket is ${tk.status}`);
  const p = await t.db.maybe<{ name: string }>("select name from products where id = $1", [d.productId]);
  if (!p) throw new AppError("VALIDATION", "Product not found");
  await t.db.exec("insert into service_ticket_parts(business_id, ticket_id, product_id, quantity, unit_price, created_by) values ($1,$2,$3,$4,$5,$6)", [t.businessId, ticketId, d.productId, d.quantity, d.unitPrice, t.userId]);
  await event(t, ticketId, "part", `${d.quantity} × ${p.name}`);
  return getTicket(t, ticketId);
}

export async function removePart(t: Tenant, ticketId: string, partId: string) {
  t.require("service.edit");
  const n = await t.db.exec("delete from service_ticket_parts where id = $1 and ticket_id = $2 and consumed_at is null", [partId, ticketId]);
  if (!n) throw new AppError("BUSINESS_RULE", "Part not found or already consumed");
}

/** Bills a completed ticket: service charge + parts on a new invoice. */
export async function invoiceTicket(t: Tenant, ticketId: string, finalize = false) {
  t.require("invoices.create");
  const tk = await t.db.maybe<Record<string, unknown>>("select * from service_tickets where id = $1 for update", [ticketId]);
  if (!tk) throw notFound("Service ticket");
  if (tk.invoice_id) throw new AppError("CONFLICT", "This ticket is already invoiced");
  if (tk.status !== "completed") throw new AppError("BUSINESS_RULE", "Complete the ticket before invoicing");
  const parts = await t.db.query<{ product_id: string; quantity: string; unit_price: string; name: string; hsn_code: string | null; unit: string; tax_rate: string }>(
    `select sp.product_id, sp.quantity, sp.unit_price, p.name, p.hsn_code, p.unit, p.tax_rate from service_ticket_parts sp join products p on p.id = sp.product_id where sp.ticket_id = $1`,
    [ticketId],
  );
  const items = [
    ...(new D(tk.service_charge as string).gt(0) || !parts.length
      ? [{ description: `Service charges — ${tk.number}${tk.equipment ? ` (${tk.equipment})` : ""}`, hsnCode: "998719", quantity: "1", unit: "job", unitPrice: tk.service_charge as string, taxRate: 18 }]
      : []),
    // Parts were already deducted from stock when the ticket was completed,
    // so they are billed as free-text lines (no product link → no second stock movement).
    ...parts.map((p) => ({ description: `${p.name} (spare part)`, hsnCode: p.hsn_code, quantity: p.quantity, unit: p.unit, unitPrice: p.unit_price, taxRate: Number(p.tax_rate) })),
  ];
  if (tk.under_warranty || tk.amc_contract_id) items.forEach((i) => (i.unitPrice = "0"));
  const inv = await createDocument(t, { docType: "invoice", partyId: tk.party_id as string, issueDate: t.today, items, notes: `Against service ticket ${tk.number}`, roundOff: t.settings.roundOffTotals });
  await t.db.exec("update service_tickets set invoice_id = $2 where id = $1", [ticketId, inv.id]);
  await event(t, ticketId, "invoiced", `Draft invoice created`);
  return finalize ? finalizeDocument(t, inv.id as string) : inv;
}

export async function getTicket(t: Tenant, id: string) {
  t.require("service.view");
  const r = await t.db.maybe(
    `select st.*, p.name as party_name, p.phone as party_phone, pr.name as product_name, u.full_name as assigned_to_name, a.title as amc_title, d.number as invoice_number
       from service_tickets st join parties p on p.id = st.party_id left join products pr on pr.id = st.product_id
       left join users u on u.id = st.assigned_to left join amc_contracts a on a.id = st.amc_contract_id left join documents d on d.id = st.invoice_id
      where st.id = $1 and ${scope(t)}`,
    [id],
  );
  if (!r) throw notFound("Service ticket");
  const events = await t.db.query("select e.*, u.full_name as created_by_name from service_ticket_events e left join users u on u.id = e.created_by where e.ticket_id = $1 order by e.created_at", [id]);
  const parts = await t.db.query("select sp.*, p.name as product_name, p.unit from service_ticket_parts sp join products p on p.id = sp.product_id where sp.ticket_id = $1 order by sp.created_at", [id]);
  const history = await t.db.query(
    `select id, number, status, issue, created_at, completed_at from service_tickets st
      where st.id <> $1 and ${scope(t)} and (($2::text is not null and serial_number = $2) or party_id = $3) order by created_at desc limit 10`,
    [id, (r as { serial_number: string | null }).serial_number, (r as { party_id: string }).party_id],
  );
  return { ...camelize<Record<string, unknown>>(r), events: camelize(events), parts: camelize(parts), history: camelize(history) } as Record<string, unknown> & { events: Record<string, unknown>[]; parts: Record<string, unknown>[]; history: Record<string, unknown>[] };
}

export async function listTickets(t: Tenant, query: unknown) {
  t.require("service.view");
  const q = parseList(query);
  const extra = (query ?? {}) as { assignedTo?: string };
  const params: unknown[] = [];
  const where = [scope(t)];
  if (q.status === "active") where.push("st.status not in ('completed','cancelled')");
  else if (q.status) {
    params.push(q.status);
    where.push(`st.status = $${params.length}`);
  }
  if (extra.assignedTo === "me") {
    params.push(t.userId);
    where.push(`st.assigned_to = $${params.length}`);
  }
  if (q.q) {
    params.push(likePattern(q.q));
    where.push(`(st.number ilike $${params.length} or p.name ilike $${params.length} or st.serial_number ilike $${params.length} or st.equipment ilike $${params.length})`);
  }
  const w = where.join(" and ");
  const { n } = await t.db.one<{ n: number }>(`select count(*)::int n from service_tickets st join parties p on p.id = st.party_id where ${w}`, params);
  params.push(q.pageSize, (q.page - 1) * q.pageSize);
  const rows = await t.db.query(
    `select st.id, st.number, st.status, st.priority, st.issue, st.equipment, st.serial_number, st.scheduled_at, st.created_at, st.under_warranty,
            p.name as party_name, u.full_name as assigned_to_name
       from service_tickets st join parties p on p.id = st.party_id left join users u on u.id = st.assigned_to
      where ${w} order by case st.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, st.created_at desc
      limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return { items: camelize(rows), total: n, page: q.page, pageSize: q.pageSize };
}

// --------------------------------------------------------------------- AMC
export async function createAmc(t: Tenant, input: z.input<typeof amcSchema>, renewedFromId?: string) {
  t.require("service.create");
  t.requireFeature("service");
  const d = amcSchema.parse(input);
  const party = await t.db.maybe<{ name: string }>("select name from parties where id = $1", [d.partyId]);
  if (!party) throw new AppError("VALIDATION", "Customer not found");
  const { number } = await nextNumber(t, "amc", d.startDate, "AMC");
  const r = await t.db.one<{ id: string }>(
    `insert into amc_contracts(business_id, number, party_id, title, start_date, end_date, amount, visits_included, covered_items, reminder_days_before, notes, renewed_from_id, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
    [t.businessId, number, d.partyId, d.title, d.startDate, d.endDate, d.amount, d.visitsIncluded, d.coveredItems, d.reminderDaysBefore, d.notes, renewedFromId ?? null, t.userId],
  );
  await t.audit("amc.create", "amc", r.id, `${number} for ${party.name}`);
  return getAmc(t, r.id);
}

export async function renewAmc(t: Tenant, id: string, input?: Partial<z.input<typeof amcSchema>>) {
  const cur = await t.db.maybe<Record<string, unknown>>("select * from amc_contracts where id = $1 for update", [id]);
  if (!cur) throw notFound("AMC contract");
  if (cur.status === "renewed" || cur.status === "cancelled") throw new AppError("BUSINESS_RULE", `Contract is ${cur.status}`);
  const start = addDays(cur.end_date as string, 1);
  const lengthDays = Math.round((Date.parse(cur.end_date as string) - Date.parse(cur.start_date as string)) / 86_400_000);
  const renewed = await createAmc(
    t,
    {
      partyId: cur.party_id as string, title: cur.title as string, startDate: start, endDate: addDays(start, lengthDays), amount: cur.amount as string,
      visitsIncluded: cur.visits_included as number, coveredItems: cur.covered_items as string | null, reminderDaysBefore: cur.reminder_days_before as number,
      notes: cur.notes as string | null, ...input,
    },
    id,
  );
  await t.db.exec("update amc_contracts set status = 'renewed' where id = $1", [id]);
  return renewed;
}

export async function cancelAmc(t: Tenant, id: string) {
  t.require("service.delete");
  const n = await t.db.exec("update amc_contracts set status = 'cancelled' where id = $1 and status = 'active'", [id]);
  if (!n) throw new AppError("BUSINESS_RULE", "Only active contracts can be cancelled");
  await t.audit("amc.cancel", "amc", id);
}

export async function invoiceAmc(t: Tenant, id: string) {
  t.require("invoices.create");
  const a = await t.db.maybe<Record<string, unknown>>("select * from amc_contracts where id = $1 for update", [id]);
  if (!a) throw notFound("AMC contract");
  if (a.invoice_id) throw new AppError("CONFLICT", "Already invoiced");
  const inv = await createDocument(t, {
    docType: "invoice", partyId: a.party_id as string, issueDate: t.today, roundOff: t.settings.roundOffTotals,
    items: [{ description: `${a.title} — AMC ${a.number} (${a.start_date} to ${a.end_date})`, hsnCode: "998719", quantity: "1", unit: "contract", unitPrice: a.amount as string, taxRate: 18 }],
  });
  await t.db.exec("update amc_contracts set invoice_id = $2 where id = $1", [id, inv.id]);
  return inv;
}

export async function getAmc(t: Tenant, id: string) {
  t.require("service.view");
  const a = await t.db.maybe(
    `select a.*, p.name as party_name, p.phone as party_phone, d.number as invoice_number,
            (select count(*)::int from service_tickets st where st.amc_contract_id = a.id and st.status = 'completed') as visits_used
       from amc_contracts a join parties p on p.id = a.party_id left join documents d on d.id = a.invoice_id where a.id = $1`,
    [id],
  );
  if (!a) throw notFound("AMC contract");
  const tickets = await t.db.query("select id, number, status, issue, completed_at from service_tickets where amc_contract_id = $1 order by created_at desc", [id]);
  return { ...camelize<Record<string, unknown>>(a), tickets: camelize(tickets) } as Record<string, unknown> & { tickets: Record<string, unknown>[] };
}

export async function listAmcs(t: Tenant, query: unknown) {
  t.require("service.view");
  const q = parseList(query);
  const params: unknown[] = [t.today];
  const where = ["true"];
  if (q.status === "expiring") where.push("a.status = 'active' and a.end_date between $1 and $1::date + a.reminder_days_before");
  else if (q.status) {
    params.push(q.status);
    where.push(`a.status = $${params.length}`);
  }
  if (q.q) {
    params.push(likePattern(q.q));
    where.push(`(a.number ilike $${params.length} or a.title ilike $${params.length} or p.name ilike $${params.length})`);
  }
  const rows = await t.db.query(
    `select a.id, a.number, a.title, a.start_date, a.end_date, a.amount, a.status, a.visits_included, p.name as party_name,
            (a.end_date - $1::date) as days_left
       from amc_contracts a join parties p on p.id = a.party_id where ${where.join(" and ")} order by a.end_date limit 200`,
    params,
  );
  return { items: camelize(rows), total: rows.length, page: 1, pageSize: 200 };
}
