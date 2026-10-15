import type { Tenant } from "../context";
import { AppError, notFound } from "../errors";
import { newStorageKey, sha256Hex, sniff, storage } from "../storage";

const ALLOWED: Record<string, string[]> = {
  logo: ["image/png", "image/jpeg", "image/webp"],
  expense_receipt: ["image/png", "image/jpeg", "image/webp", "application/pdf"],
  attachment: ["image/png", "image/jpeg", "image/webp", "application/pdf"],
};

export async function uploadFile(t: Tenant, purpose: "logo" | "expense_receipt" | "attachment", data: Buffer, originalName?: string | null) {
  if (purpose === "logo") t.require("settings.edit");
  else if (purpose === "expense_receipt") t.require("expenses.create");
  else t.require("parties.edit");
  const allowed = ALLOWED[purpose];
  if (!allowed) throw new AppError("VALIDATION", "Unknown upload purpose");
  const { mime, ext } = sniff(data, allowed);
  const key = newStorageKey(t.businessId, ext);
  await storage().put(key, data, mime);
  try {
    const r = await t.db.one<{ id: string }>(
      `insert into files(business_id, purpose, storage_key, mime_type, size_bytes, original_name, sha256, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [t.businessId, purpose, key, mime, data.length, (originalName ?? "").replace(/[^\w.\- ]/g, "_").slice(0, 120) || null, sha256Hex(data), t.userId],
    );
    return { id: r.id, mimeType: mime, sizeBytes: data.length };
  } catch (e) {
    await storage().remove(key);
    throw e;
  }
}

/** Reads a file after RLS confirms it belongs to the current business. */
export async function readFileForTenant(t: Tenant, id: string) {
  const f = await t.db.maybe<{ storage_key: string; mime_type: string; purpose: string; original_name: string | null }>(
    "select storage_key, mime_type, purpose, original_name from files where id = $1",
    [id],
  );
  if (!f) throw notFound("File");
  if (f.purpose === "expense_receipt") t.require("expenses.view");
  return { data: await storage().get(f.storage_key), mime: f.mime_type, name: f.original_name };
}
