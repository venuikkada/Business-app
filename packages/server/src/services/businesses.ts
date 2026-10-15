import { businessSchema, businessSettingsSchema, SYSTEM_ROLES, TRIAL_PLAN_CODE, type BusinessInput } from "@cba/core";
import type { z } from "zod";
import { appTx } from "../db";
import { AppError } from "../errors";
import type { AuthUser } from "../auth/service";
import type { Tenant } from "../context";
import { camelize } from "../util";
import { verifyPassword } from "../auth/crypto";

export async function listMyBusinesses(user: AuthUser) {
  return appTx({ userId: user.id }, async (db) => {
    const rows = await db.query("select * from app.my_businesses()");
    return camelize<{ id: string; name: string; roleName: string; roleKey: string | null; status: string; planName: string | null }>(rows);
  });
}

export async function createBusiness(user: AuthUser, input: z.input<typeof businessSchema>, settings?: z.input<typeof businessSettingsSchema>) {
  const data: BusinessInput = businessSchema.parse(input);
  const s = businessSettingsSchema.parse(settings ?? {});
  if (data.gstin && data.gstin.slice(0, 2) !== data.stateCode) {
    throw new AppError("VALIDATION", "GSTIN state code does not match the selected state", { field: "gstin" });
  }
  const roles = Object.entries(SYSTEM_ROLES).map(([key, r]) => ({ key, name: r.name, description: r.description, permissions: r.permissions }));
  return appTx({ userId: user.id }, async (db) => {
    // Free-plan abuse guard: a user may own a limited number of businesses
    // that are not on an active paid plan.
    const setting = await db.maybe<{ value: number }>("select value from platform_settings where key = 'max_unpaid_businesses_per_user'");
    const maxUnpaid = Number(setting?.value ?? 1);
    const { n } = await db.one<{ n: number }>(
      `select count(*)::int as n from businesses b
         join subscriptions s on s.business_id = b.id join plans p on p.id = s.plan_id
        where b.created_by = $1 and b.status <> 'deleted'
          and not (s.status = 'active' and p.price_monthly > 0)`,
      [user.id],
    );
    if (n >= maxUnpaid) {
      throw new AppError("PLAN_LIMIT", "You already have a business on a free or trial plan. Upgrade it to a paid plan to create another business.");
    }
    const { id } = await db.one<{ id: string }>("select app.create_business($1, $2, $3) as id", [
      JSON.stringify({
        name: data.name,
        legalName: data.legalName,
        businessType: data.businessType,
        gstin: data.gstin,
        pan: data.pan,
        phone: data.phone,
        email: data.email,
        line1: data.address.line1,
        line2: data.address.line2,
        city: data.address.city,
        stateCode: data.stateCode,
        pincode: data.address.pincode,
        settings: s,
      }),
      JSON.stringify(roles),
      TRIAL_PLAN_CODE,
    ]);
    return { id };
  });
}

export function businessProfile(t: Tenant) {
  t.require("settings.view");
  const b = t.business;
  return {
    id: b.id,
    name: b.name,
    legalName: b.legal_name,
    businessType: b.business_type,
    gstin: b.gstin,
    pan: b.pan,
    phone: b.phone,
    email: b.email,
    address: { line1: b.address_line1, line2: b.address_line2, city: b.city, stateCode: b.state_code, pincode: b.pincode },
    stateCode: b.state_code,
    logoFileId: b.logo_file_id,
    fyStartMonth: b.fy_start_month,
    status: b.status,
    settings: t.settings,
  };
}

export async function updateBusiness(t: Tenant, input: z.input<typeof businessSchema>) {
  t.require("settings.edit");
  const d = businessSchema.parse(input);
  if (d.gstin && d.gstin.slice(0, 2) !== d.stateCode) throw new AppError("VALIDATION", "GSTIN state code does not match the selected state", { field: "gstin" });
  const before = businessProfile(t);
  await t.db.exec(
    `update businesses set name=$2, legal_name=$3, business_type=$4, gstin=$5, pan=$6, phone=$7, email=$8,
       address_line1=$9, address_line2=$10, city=$11, state_code=$12, pincode=$13 where id=$1`,
    [t.businessId, d.name, d.legalName, d.businessType, d.gstin, d.pan, d.phone, d.email, d.address.line1, d.address.line2, d.address.city, d.stateCode, d.address.pincode],
  );
  // Keep the default branch's state in sync for single-branch businesses.
  await t.db.exec("update branches set state_code = $2, gstin = coalesce(gstin, $3) where business_id = $1 and is_default", [t.businessId, d.stateCode, d.gstin]);
  await t.audit("business.update", "business", t.businessId, "Business profile updated", before, d);
}

export async function updateSettings(t: Tenant, input: z.input<typeof businessSettingsSchema>) {
  t.require("settings.edit");
  const s = businessSettingsSchema.parse({ ...t.settings, ...(input as object) });
  await t.db.exec("update businesses set settings = $2 where id = $1", [t.businessId, JSON.stringify(s)]);
  await t.audit("business.settings", "business", t.businessId, "Settings updated", t.settings, s);
  return s;
}

export async function setLogo(t: Tenant, fileId: string | null) {
  t.require("settings.edit");
  await t.db.exec("update businesses set logo_file_id = $2 where id = $1", [t.businessId, fileId]);
  await t.audit("business.logo", "business", t.businessId, fileId ? "Logo updated" : "Logo removed");
}

/**
 * Owner-initiated deletion. The business becomes inaccessible immediately
 * and is permanently purged after the retention window (30 days) by the
 * daily job, giving time to download an export or cancel.
 */
export async function requestBusinessDeletion(t: Tenant, password: string, confirmName: string) {
  t.require("data.delete");
  const u = await t.db.one<{ password_hash: string }>("select password_hash from users where id = $1", [t.userId]);
  if (!(await verifyPassword(password, u.password_hash))) throw new AppError("VALIDATION", "Password is incorrect");
  if (confirmName.trim() !== t.business.name) throw new AppError("VALIDATION", "Type the exact business name to confirm");
  await t.audit("business.delete_requested", "business", t.businessId, "Deletion requested; data will be purged after 30 days");
  await t.db.exec(
    "update businesses set status = 'deleted', deletion_requested_at = now(), purge_after = now() + interval '30 days' where id = $1",
    [t.businessId],
  );
}
