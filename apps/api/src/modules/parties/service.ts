import { TenantDb, withTx } from "../../db/pool.js";
import type { TenantCtx } from "../../http/context.js";
import { notFound } from "../../lib/errors.js";
import { istDate } from "../../lib/dates.js";
import { audit } from "../audit/service.js";

export interface PartyInput {
  partyType: "customer" | "supplier" | "both";
  name: string;
  mobile?: string | null;
  email?: string | null;
  gstin?: string | null;
  stateCode?: string | null;
  billingAddress?: string | null;
  openingBalance?: number;
  creditLimit?: number | null;
  notes?: string | null;
}

function out(r: any) {
  return {
    id: Number(r.id), partyType: r.party_type, name: r.name, mobile: r.mobile, email: r.email, gstin: r.gstin, stateCode: r.state_code,
    billingAddress: r.billing_address, balance: r.balance, creditLimit: r.credit_limit, notes: r.notes, isActive: !!r.is_active,
  };
}

export async function listParties(ctx: TenantCtx, q: { search?: string; type?: string; limit: number }) {
  const p: Record<string, unknown> = { limit: q.limit };
  let sql = "SELECT * FROM parties WHERE tenant_id = :tenantId AND deleted_at IS NULL";
  if (q.type === "customer") sql += " AND party_type IN ('customer','both')";
  if (q.type === "supplier") sql += " AND party_type IN ('supplier','both')";
  if (q.search) {
    sql += " AND (name LIKE :like OR mobile LIKE :like OR gstin = :exact)";
    p.like = `%${q.search.replace(/[%_\\]/g, "\\$&")}%`;
    p.exact = q.search.toUpperCase();
  }
  return (await ctx.tdb.all(sql + " ORDER BY name LIMIT :limit", p)).map(out);
}

/** Adds a ledger row and keeps the cached balance in step (same transaction as the bill/payment). */
export async function ledgerEntry(
  tdb: TenantDb,
  e: { partyId: number; date?: string; refType: string; refId?: number | null; debit?: string | number; credit?: string | number; narration?: string },
) {
  await tdb.exec(
    `INSERT INTO party_ledger (tenant_id, party_id, entry_date, ref_type, ref_id, debit, credit, narration)
     VALUES (:tenantId, :p, :d, :rt, :ri, :debit, :credit, :n)`,
    { p: e.partyId, d: e.date ?? istDate(), rt: e.refType, ri: e.refId ?? null, debit: e.debit ?? 0, credit: e.credit ?? 0, n: e.narration ?? null },
  );
  await tdb.exec("UPDATE parties SET balance = balance + :debit - :credit WHERE tenant_id = :tenantId AND id = :p", {
    p: e.partyId, debit: e.debit ?? 0, credit: e.credit ?? 0,
  });
}

export async function createParty(ctx: TenantCtx, input: PartyInput) {
  return withTx(async (conn) => {
    const tdb = new TenantDb(conn, ctx.tenantId);
    const r = await tdb.exec(
      `INSERT INTO parties (tenant_id, party_type, name, mobile, email, gstin, state_code, billing_address, credit_limit, opening_balance, notes, created_by)
       VALUES (:tenantId, :type, :name, :mobile, :email, :gstin, :state, :addr, :limit, :open, :notes, :by)`,
      {
        type: input.partyType, name: input.name, mobile: input.mobile || null, email: input.email || null, gstin: input.gstin || null,
        state: input.stateCode || (input.gstin ? input.gstin.slice(0, 2) : null), addr: input.billingAddress || null,
        limit: input.creditLimit ?? null, open: input.openingBalance ?? 0, notes: input.notes || null, by: ctx.userId,
      },
    );
    if (input.openingBalance) {
      const ob = input.openingBalance;
      await ledgerEntry(tdb, { partyId: r.insertId, refType: "opening", debit: ob > 0 ? ob : 0, credit: ob < 0 ? -ob : 0, narration: "Opening balance" });
    }
    await audit(tdb, ctx, {
      action: "create", entityType: "party", entityId: r.insertId, summary: `Added ${input.partyType} "${input.name}"`,
      after: { name: input.name, mobile: input.mobile ?? null, gstin: input.gstin ?? null },
    });
    return out(await tdb.one("SELECT * FROM parties WHERE tenant_id = :tenantId AND id = :id", { id: r.insertId }));
  });
}

export async function updateParty(ctx: TenantCtx, id: number, input: Partial<PartyInput> & { isActive?: boolean }) {
  return withTx(async (conn) => {
    const tdb = new TenantDb(conn, ctx.tenantId);
    const before = await tdb.one("SELECT * FROM parties WHERE tenant_id = :tenantId AND id = :id AND deleted_at IS NULL FOR UPDATE", { id });
    if (!before) throw notFound("Customer / supplier");
    const map: Record<string, string> = {
      partyType: "party_type", name: "name", mobile: "mobile", email: "email", gstin: "gstin", stateCode: "state_code",
      billingAddress: "billing_address", creditLimit: "credit_limit", notes: "notes",
    };
    const sets: string[] = [];
    const p: Record<string, unknown> = { id };
    for (const [k, col] of Object.entries(map)) if (k in input) (sets.push(`${col} = :${k}`), (p[k] = (input as any)[k] === "" ? null : (input as any)[k]));
    if (input.isActive !== undefined) (sets.push("is_active = :active"), (p.active = input.isActive ? 1 : 0));
    if (sets.length) await tdb.exec(`UPDATE parties SET ${sets.join(", ")} WHERE tenant_id = :tenantId AND id = :id`, p);
    const after = await tdb.one("SELECT * FROM parties WHERE tenant_id = :tenantId AND id = :id", { id });
    await audit(tdb, ctx, { action: "update", entityType: "party", entityId: id, summary: `Updated "${after.name}"`, before, after });
    return out(after);
  });
}

export async function getParty(ctx: TenantCtx, id: number) {
  const r = await ctx.tdb.one("SELECT * FROM parties WHERE tenant_id = :tenantId AND id = :id AND deleted_at IS NULL", { id });
  if (!r) throw notFound("Customer / supplier");
  const ledger = await ctx.tdb.all(
    "SELECT id, entry_date, ref_type, ref_id, debit, credit, narration FROM party_ledger WHERE tenant_id = :tenantId AND party_id = :id ORDER BY id DESC LIMIT 100",
    { id },
  );
  return {
    ...out(r),
    ledger: ledger.map((l) => ({
      id: Number(l.id), date: l.entry_date, refType: l.ref_type, refId: l.ref_id ? Number(l.ref_id) : null, debit: l.debit, credit: l.credit, narration: l.narration,
    })),
  };
}
