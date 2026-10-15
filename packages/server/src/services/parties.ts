import { partySchema, interactionSchema, parseCSVObjects, toCSV, type PartyInput } from "@cba/core";
import type { z } from "zod";
import { assertLimit, type Tenant } from "../context";
import { AppError, notFound } from "../errors";
import { camelize, likePattern, orderBy, parseList, addressFrom, type Page } from "../util";

function partyParams(d: PartyInput) {
  const ship = d.shippingAddress ?? null;
  return [
    d.name, d.isCustomer, d.isSupplier, d.contactPerson, d.phone, d.altPhone, d.email, d.gstin, d.pan,
    d.billingAddress.line1, d.billingAddress.line2, d.billingAddress.city, d.billingAddress.stateCode ?? (d.gstin ? d.gstin.slice(0, 2) : null), d.billingAddress.pincode,
    ship?.line1 ?? null, ship?.line2 ?? null, ship?.city ?? null, ship?.stateCode ?? null, ship?.pincode ?? null,
    d.openingBalance, d.creditLimit ?? null, d.paymentTermsDays ?? null, d.notes, d.tags, d.whatsappOptIn,
  ];
}

function present(r: Record<string, unknown>) {
  const { billing_line1, billing_line2, billing_city, billing_state_code, billing_pincode, shipping_line1, shipping_line2, shipping_city, shipping_state_code, shipping_pincode, ...rest } = r;
  void billing_line1; void billing_line2; void billing_city; void billing_state_code; void billing_pincode;
  void shipping_line1; void shipping_line2; void shipping_city; void shipping_state_code; void shipping_pincode;
  return {
    ...camelize<Record<string, unknown>>(rest),
    billingAddress: addressFrom("billing", r),
    shippingAddress: r.shipping_line1 || r.shipping_city ? addressFrom("shipping", r) : null,
  };
}

export interface DuplicateCandidate {
  id: string;
  name: string;
  phone: string | null;
  gstin: string | null;
  reason: string;
}

/** Finds likely duplicates by phone, GSTIN, email or a very similar name. */
export async function findDuplicates(t: Tenant, d: Pick<PartyInput, "name" | "phone" | "gstin" | "email">, excludeId?: string): Promise<DuplicateCandidate[]> {
  const rows = await t.db.query<DuplicateCandidate>(
    `select id, name, phone, gstin,
            case when $2::text is not null and phone = $2 then 'Same phone number'
                 when $3::text is not null and gstin = $3 then 'Same GSTIN'
                 when $4::text is not null and email = $4 then 'Same email'
                 else 'Similar name' end as reason
       from parties
      where archived_at is null and id is distinct from $5
        and (($2::text is not null and phone = $2) or ($3::text is not null and gstin = $3)
             or ($4::text is not null and email = $4) or similarity(lower(name), lower($1)) > 0.75)
      limit 5`,
    [d.name, d.phone, d.gstin, d.email, excludeId ?? null],
  );
  return rows;
}

export async function listParties(t: Tenant, query: unknown & { type?: string }) {
  t.require("parties.view");
  const q = parseList(query);
  const type = (query as { type?: string })?.type;
  const where: string[] = [q.archived === "true" ? "p.archived_at is not null" : "p.archived_at is null"];
  const params: unknown[] = [];
  if (type === "customer") where.push("p.is_customer");
  if (type === "supplier") where.push("p.is_supplier");
  if (q.q) {
    params.push(likePattern(q.q));
    where.push(`(p.name ilike $${params.length} or p.phone ilike $${params.length} or p.gstin ilike $${params.length} or p.email ilike $${params.length})`);
  }
  if (q.status === "outstanding") where.push("coalesce(b.balance, 0) <> 0");
  const order = orderBy(q.sort, { name: "lower(p.name)", balance: "b.balance", created: "p.created_at" }, "name", q.sort ? q.dir : "asc");
  const w = where.join(" and ");
  const { n } = await t.db.one<{ n: number }>(`select count(*)::int n from parties p left join party_balances b on b.party_id = p.id where ${w}`, params);
  params.push(q.pageSize, (q.page - 1) * q.pageSize);
  const rows = await t.db.query(
    `select p.id, p.name, p.phone, p.email, p.gstin, p.is_customer, p.is_supplier, p.billing_city, p.tags, p.archived_at,
            coalesce(b.balance, 0) as balance
       from parties p left join party_balances b on b.party_id = p.id
      where ${w} order by ${order} limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return { items: camelize(rows), total: n, page: q.page, pageSize: q.pageSize } as Page<Record<string, unknown>>;
}

export async function getParty(t: Tenant, id: string) {
  t.require("parties.view");
  const r = await t.db.maybe<Record<string, unknown>>(
    `select p.*, coalesce(b.balance, 0) as balance from parties p left join party_balances b on b.party_id = p.id where p.id = $1`,
    [id],
  );
  if (!r) throw notFound("Customer/supplier");
  const stats = await t.db.one(
    `select
       coalesce(sum(grand_total) filter (where doc_type = 'invoice' and status not in ('draft','cancelled')), 0) as total_sales,
       coalesce(sum(grand_total) filter (where doc_type = 'purchase_bill' and status not in ('draft','cancelled')), 0) as total_purchases,
       count(*) filter (where doc_type = 'invoice' and status not in ('draft','cancelled'))::int as invoice_count,
       count(*) filter (where doc_type = 'quotation')::int as quotation_count,
       coalesce(sum(balance_due) filter (where doc_type = 'invoice' and status in ('issued','partially_paid') and due_date < $2), 0) as overdue_amount,
       max(issue_date) filter (where doc_type = 'invoice' and status not in ('draft','cancelled')) as last_invoice_date
     from documents where party_id = $1`,
    [id, t.today],
  );
  return { ...present(r), stats: camelize(stats) };
}

export async function createParty(t: Tenant, input: z.input<typeof partySchema> & { confirmDuplicate?: boolean }) {
  t.require("parties.create");
  const d = partySchema.parse(input);
  await assertLimit(t, "parties", "select count(*)::int n from parties where archived_at is null");
  if (!input.confirmDuplicate) {
    const dups = await findDuplicates(t, d);
    if (dups.length) throw new AppError("POSSIBLE_DUPLICATE", "A similar customer/supplier already exists", { duplicates: dups });
  }
  const r = await t.db.one<Record<string, unknown>>(
    `insert into parties(name, is_customer, is_supplier, contact_person, phone, alt_phone, email, gstin, pan,
       billing_line1, billing_line2, billing_city, billing_state_code, billing_pincode,
       shipping_line1, shipping_line2, shipping_city, shipping_state_code, shipping_pincode,
       opening_balance, credit_limit, payment_terms_days, notes, tags, whatsapp_opt_in, business_id, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
     returning *`,
    [...partyParams(d), t.businessId, t.userId],
  );
  await t.audit("party.create", "party", r.id as string, `Created ${d.name}`, undefined, d);
  return present(r);
}

export async function updateParty(t: Tenant, id: string, input: z.input<typeof partySchema>) {
  t.require("parties.edit");
  const d = partySchema.parse(input);
  const before = await t.db.maybe<Record<string, unknown>>("select * from parties where id = $1 for update", [id]);
  if (!before) throw notFound("Customer/supplier");
  if (String(before.opening_balance) !== d.openingBalance && !t.can("financials.view")) {
    throw new AppError("FORBIDDEN", "Only roles with access to financial figures can change opening balances");
  }
  const r = await t.db.one<Record<string, unknown>>(
    `update parties set name=$1, is_customer=$2, is_supplier=$3, contact_person=$4, phone=$5, alt_phone=$6, email=$7, gstin=$8, pan=$9,
       billing_line1=$10, billing_line2=$11, billing_city=$12, billing_state_code=$13, billing_pincode=$14,
       shipping_line1=$15, shipping_line2=$16, shipping_city=$17, shipping_state_code=$18, shipping_pincode=$19,
       opening_balance=$20, credit_limit=$21, payment_terms_days=$22, notes=$23, tags=$24, whatsapp_opt_in=$25
     where id = $26 returning *`,
    [...partyParams(d), id],
  );
  await t.audit("party.update", "party", id, `Updated ${d.name}`, present(before), d);
  return present(r);
}

export async function setPartyArchived(t: Tenant, id: string, archived: boolean) {
  t.require("parties.delete");
  const n = await t.db.exec(`update parties set archived_at = ${archived ? "now()" : "null"} where id = $1`, [id]);
  if (!n) throw notFound("Customer/supplier");
  await t.audit(archived ? "party.archive" : "party.unarchive", "party", id);
}

/** Hard delete is only allowed for parties without any transactions. */
export async function deleteParty(t: Tenant, id: string) {
  t.require("parties.delete");
  const used = await t.db.maybe(
    `select 1 from documents where party_id = $1 union all select 1 from payments where party_id = $1
     union all select 1 from service_tickets where party_id = $1 union all select 1 from expenses where party_id = $1 limit 1`,
    [id],
  );
  if (used) throw new AppError("BUSINESS_RULE", "This customer/supplier has transactions. Archive it instead of deleting.");
  const before = await t.db.maybe("delete from parties where id = $1 returning name", [id]);
  if (!before) throw notFound("Customer/supplier");
  await t.audit("party.delete", "party", id, `Deleted ${(before as { name: string }).name}`);
}

/** Party statement: chronological ledger with running balance. */
export async function partyLedger(t: Tenant, id: string, from?: string, to?: string) {
  t.require("parties.view");
  t.require("payments.view");
  const rows = await t.db.query<{ entry_date: string; kind: string; ref_id: string | null; ref_number: string; debit: string; credit: string }>(
    `select entry_date, kind, ref_id, ref_number, debit, credit from party_ledger
      where party_id = $1 and ($2::date is null or entry_date >= $2) and ($3::date is null or entry_date <= $3)
      order by entry_date, case kind when 'opening' then 0 else 1 end, ref_number`,
    [id, from ?? null, to ?? null],
  );
  const opening = from
    ? await t.db.one<{ b: string }>(
        `select coalesce(sum(debit) - sum(credit), 0) as b from party_ledger where party_id = $1 and entry_date < $2`,
        [id, from],
      )
    : { b: "0" };
  let running = Number(opening.b);
  const entries = rows.map((r) => {
    running = Math.round((running + Number(r.debit) - Number(r.credit)) * 100) / 100;
    return { ...camelize<Record<string, unknown>>(r), balance: running.toFixed(2) };
  });
  return { openingBalance: Number(opening.b).toFixed(2), entries, closingBalance: running.toFixed(2) };
}

export async function listInteractions(t: Tenant, partyId: string) {
  t.require("parties.view");
  return camelize(
    await t.db.query(
      `select i.*, u.full_name as created_by_name from party_interactions i left join users u on u.id = i.created_by
        where i.party_id = $1 order by i.created_at desc limit 200`,
      [partyId],
    ),
  );
}

export async function addInteraction(t: Tenant, partyId: string, input: z.input<typeof interactionSchema>) {
  t.require("parties.edit");
  const d = interactionSchema.parse(input);
  const p = await t.db.maybe("select 1 from parties where id = $1", [partyId]);
  if (!p) throw notFound("Customer/supplier");
  const r = await t.db.one(
    `insert into party_interactions(business_id, party_id, kind, notes, follow_up_on, created_by) values ($1,$2,$3,$4,$5,$6) returning *`,
    [t.businessId, partyId, d.kind, d.notes, d.followUpOn ?? null, t.userId],
  );
  return camelize(r);
}

export async function completeFollowUp(t: Tenant, interactionId: string) {
  t.require("parties.edit");
  const n = await t.db.exec("update party_interactions set completed_at = now() where id = $1 and completed_at is null", [interactionId]);
  if (!n) throw notFound("Follow-up");
}

export async function upcomingFollowUps(t: Tenant, days = 7) {
  t.require("parties.view");
  return camelize(
    await t.db.query(
      `select i.id, i.kind, i.notes, i.follow_up_on, p.id as party_id, p.name as party_name, p.phone as party_phone
         from party_interactions i join parties p on p.id = i.party_id
        where i.completed_at is null and i.follow_up_on is not null and i.follow_up_on <= ($1::date + $2::int)
        order by i.follow_up_on limit 50`,
      [t.today, days],
    ),
  );
}

// ------------------------------------------------------------ CSV import
export const PARTY_CSV_HEADERS = ["name", "type", "phone", "email", "gstin", "contact_person", "address", "city", "state_code", "pincode", "opening_balance", "notes"];

export interface ImportPreviewRow<T> {
  row: number;
  data: T | null;
  errors: string[];
  warnings: string[];
}

function partyFromCsv(r: Record<string, string>) {
  const type = (r.type || "customer").toLowerCase();
  return {
    name: r.name ?? "",
    isCustomer: type === "customer" || type === "both",
    isSupplier: type === "supplier" || type === "both",
    phone: r.phone || null,
    email: r.email || null,
    gstin: r.gstin || null,
    contactPerson: r.contact_person || null,
    billingAddress: { line1: r.address || null, city: r.city || null, stateCode: r.state_code ? r.state_code.padStart(2, "0") : null, pincode: r.pincode || null },
    openingBalance: r.opening_balance || "0",
    notes: r.notes || null,
  };
}

/** Validates a CSV without writing anything. */
export async function previewPartyImport(t: Tenant, csv: string) {
  t.require("parties.create");
  t.require("data.create");
  const { headers, rows } = parseCSVObjects(csv);
  if (!headers.includes("name")) throw new AppError("VALIDATION", "The CSV must have a 'name' column. Download the template to get started.");
  if (rows.length > 5000) throw new AppError("VALIDATION", "Import at most 5,000 rows at a time");
  const seenPhones = new Set<string>();
  const out: ImportPreviewRow<PartyInput>[] = [];
  for (let i = 0; i < rows.length; i++) {
    const parsed = partySchema.safeParse(partyFromCsv(rows[i]!));
    const errors = parsed.success ? [] : parsed.error.issues.map((x) => `${x.path.join(".") || "row"}: ${x.message}`);
    const warnings: string[] = [];
    if (parsed.success) {
      if (parsed.data.phone && seenPhones.has(parsed.data.phone)) warnings.push("Phone number repeats in this file");
      if (parsed.data.phone) seenPhones.add(parsed.data.phone);
      const dups = await findDuplicates(t, parsed.data);
      if (dups.length) warnings.push(`Possible duplicate of existing "${dups[0]!.name}" (${dups[0]!.reason.toLowerCase()})`);
    }
    out.push({ row: i + 2, data: parsed.success ? parsed.data : null, errors, warnings });
  }
  return { rows: out, valid: out.filter((r) => !r.errors.length).length, invalid: out.filter((r) => r.errors.length).length };
}

/** Re-validates and inserts all valid rows in one transaction. */
export async function commitPartyImport(t: Tenant, csv: string, skipWarnings = false) {
  const preview = await previewPartyImport(t, csv);
  if (preview.invalid > 0) throw new AppError("VALIDATION", `${preview.invalid} row(s) have errors. Fix them and preview again.`);
  const toInsert = preview.rows.filter((r) => !(skipWarnings && r.warnings.length));
  const limit = t.plan.limits?.parties;
  if (limit !== null && limit !== undefined) {
    const { n } = await t.db.one<{ n: number }>("select count(*)::int n from parties where archived_at is null");
    if (n + toInsert.length > limit) throw new AppError("PLAN_LIMIT", `This import would exceed your plan limit of ${limit} customers/suppliers.`);
  }
  for (const r of toInsert) {
    await t.db.exec(
      `insert into parties(name, is_customer, is_supplier, contact_person, phone, alt_phone, email, gstin, pan,
         billing_line1, billing_line2, billing_city, billing_state_code, billing_pincode,
         shipping_line1, shipping_line2, shipping_city, shipping_state_code, shipping_pincode,
         opening_balance, credit_limit, payment_terms_days, notes, tags, whatsapp_opt_in, business_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
      [...partyParams(r.data!), t.businessId, t.userId],
    );
  }
  await t.audit("party.import", "party", null, `Imported ${toInsert.length} customers/suppliers`);
  return { imported: toInsert.length, skipped: preview.rows.length - toInsert.length };
}

export async function exportPartiesCSV(t: Tenant) {
  t.require("parties.export");
  const rows = await t.db.query<Record<string, unknown>>(
    `select p.*, coalesce(b.balance, 0) as balance from parties p left join party_balances b on b.party_id = p.id order by lower(p.name)`,
  );
  await t.audit("party.export", "party", null, `Exported ${rows.length} customers/suppliers`);
  const showMoney = t.can("financials.view") || t.can("payments.view");
  return toCSV(
    [...PARTY_CSV_HEADERS, ...(showMoney ? ["current_balance"] : [])],
    rows.map((r) => [
      r.name, r.is_customer && r.is_supplier ? "both" : r.is_supplier ? "supplier" : "customer", r.phone, r.email, r.gstin, r.contact_person,
      [r.billing_line1, r.billing_line2].filter(Boolean).join(", "), r.billing_city, r.billing_state_code, r.billing_pincode, r.opening_balance, r.notes,
      ...(showMoney ? [r.balance] : []),
    ]),
  );
}
