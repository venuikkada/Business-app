import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  auth, businesses, parties, products, documents, payments, finance, service, team, approvals, reports, notifications, files, pdfs, billing,
  exportsSvc, support, AppError, appTx, env, sha256, type Tenant,
} from "@cba/server";
import { runDailyJobs } from "@cba/server/platform";
import { DOC_TYPES, SYSTEM_ROLES, paymentReminderMessage, invoiceShareMessage, whatsappLink, DOC_TYPE_META, type DocType, formatDateIN } from "@cba/core";
import { Router, fileResponse, sessionCookie, type Ctx } from "./router";
import { BUSINESS_COOKIE, SESSION_COOKIE } from "./session";

import { REPORTS, renderReport } from "./reports-def";

const r = new Router();
const b = <T = Record<string, unknown>>(c: Ctx) => c.body() as Promise<T>;
const isMobile = (c: Ctx) => c.req.headers.get("x-client") === "android" || c.req.headers.get("x-client") === "mobile";

function withCookie(res: NextResponse, token: string, expiresAt: string) {
  res.cookies.set(sessionCookie(token, expiresAt));
  return res;
}

// ------------------------------------------------------------------ health
r.get("health", "public", async () => {
  await appTx({}, (db) => db.one("select 1"));
  return { ok: true, time: new Date().toISOString() };
});

// -------------------------------------------------------------------- auth
r.post("auth/register", "public", async (c) => {
  const res = await auth.register((await b(c)) as never, c.meta);
  if (isMobile(c)) {
    // Mobile apps get a long-lived mobile session instead of the web one.
    await auth.logout(res.token);
    const m = await auth.login({ email: res.user.email, password: ((await b(c)) as { password: string }).password }, "mobile", c.meta);
    return { user: m.user, token: m.token, expiresAt: m.session.expiresAt };
  }
  return withCookie(NextResponse.json({ user: res.user }), res.token, res.session.expiresAt);
});

r.post("auth/login", "public", async (c) => {
  const res = await auth.login((await b(c)) as never, isMobile(c) ? "mobile" : "web", c.meta);
  if (isMobile(c)) return { user: res.user, token: res.token, expiresAt: res.session.expiresAt };
  return withCookie(NextResponse.json({ user: res.user }), res.token, res.session.expiresAt);
});

r.post("auth/logout", "user", async (c) => {
  await auth.logout(c.token);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(BUSINESS_COOKIE);
  return res;
});
r.post("auth/forgot", "public", async (c) => {
  await auth.requestPasswordReset((await b(c)) as never, c.meta);
  return { ok: true, message: "If an account exists for this email, a reset link has been sent." };
});
r.post("auth/reset", "public", async (c) => {
  await auth.resetPassword((await b(c)) as never);
  return { ok: true };
});
r.post("auth/verify-email", "public", async (c) => {
  await auth.verifyEmail(String(((await b(c)) as { token?: string }).token ?? ""));
  return { ok: true };
});
r.post("auth/resend-verification", "user", async (c) => {
  await auth.resendVerification(c.user.id);
  return { ok: true };
});

// --------------------------------------------------------------------- me
r.get("me", "user", async (c) => ({ user: c.user, session: { kind: c.session.kind, expiresAt: c.session.expiresAt }, businesses: await businesses.listMyBusinesses(c.user) }));
r.patch("me", "user", async (c) => {
  const d = z.object({ fullName: z.string().trim().min(2).max(120).optional(), phone: z.string().trim().max(20).nullable().optional() }).parse(await b(c));
  return auth.updateProfile(c.user.id, d);
});
r.post("me/password", "user", async (c) => {
  await auth.changePassword(c.user.id, c.session.id, (await b(c)) as never);
  return { ok: true };
});
r.get("me/sessions", "user", async (c) => auth.listSessions(c.user.id));
r.del("me/sessions/:id", "user", async (c) => {
  await auth.revokeSession(c.user.id, c.params.id!);
  return { ok: true };
});
r.post("me/totp/begin", "user", async (c) => auth.beginTotpSetup(c.user.id));
r.post("me/totp/confirm", "user", async (c) => {
  await auth.confirmTotpSetup(c.user.id, c.session.id, String(((await b(c)) as { code?: string }).code ?? ""));
  return { ok: true };
});
r.post("me/totp/disable", "user", async (c) => {
  const d = (await b(c)) as { password?: string; code?: string };
  await auth.disableTotp(c.user.id, String(d.password ?? ""), String(d.code ?? ""));
  return { ok: true };
});
r.post("me/delete", "user", async (c) => {
  await auth.deleteAccount(c.user.id, String(((await b(c)) as { password?: string }).password ?? ""));
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
});
r.post("invitations/accept", "user", async (c) => {
  const token = String(((await b(c)) as { token?: string }).token ?? "");
  if (token.length < 20) throw new AppError("VALIDATION", "Invalid invitation link");
  const row = await appTx({ userId: c.user.id }, (db) => db.one<{ id: string }>("select app.accept_invitation($1) as id", [sha256(token)]));
  const res = NextResponse.json({ businessId: row.id });
  res.cookies.set({ name: BUSINESS_COOKIE, value: row.id, httpOnly: true, sameSite: "lax", secure: env.isProd, path: "/" });
  return res;
});

// --------------------------------------------------------------- business
r.get("businesses", "user", async (c) => businesses.listMyBusinesses(c.user));
r.post("businesses", "user", async (c) => {
  const d = (await b(c)) as { settings?: unknown };
  const created = await businesses.createBusiness(c.user, d as never, d.settings as never);
  const res = NextResponse.json(created);
  res.cookies.set({ name: BUSINESS_COOKIE, value: created.id, httpOnly: true, sameSite: "lax", secure: env.isProd, path: "/" });
  return res;
});
r.post("businesses/:id/select", "user", async (c) => {
  const mine = await businesses.listMyBusinesses(c.user);
  if (!mine.some((x) => x.id === c.params.id)) throw new AppError("FORBIDDEN", "You are not a member of this business");
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ name: BUSINESS_COOKIE, value: c.params.id!, httpOnly: true, sameSite: "lax", secure: env.isProd, path: "/" });
  return res;
});
r.get("businesses/deleted", "user", async (c) => appTx({ userId: c.user.id }, (db) => db.query("select * from app.my_deleted_businesses()")));
r.post("businesses/:id/restore", "user", async (c) => {
  await appTx({ userId: c.user.id }, (db) => db.one("select app.restore_business($1)", [c.params.id]));
  return { ok: true };
});

/** Everything a client needs to render the shell: business, role, permissions, plan. */
r.get("context", "tenant", async (c) => ({
  business: { id: c.t.businessId, name: c.t.business.name, stateCode: c.t.business.state_code, gstin: c.t.business.gstin, status: c.t.business.status },
  settings: c.t.settings,
  role: { key: c.t.roleKey, name: c.t.roleName },
  permissions: [...c.t.permissions],
  plan: c.t.plan,
  branchIds: c.t.branchIds,
  defaultBranchId: c.t.defaultBranchId,
  isSupport: c.t.isSupport,
  today: c.t.today,
}));
r.get("business", "tenant", async (c) => businesses.businessProfile(c.t));
r.put("business", "tenant", async (c) => {
  await businesses.updateBusiness(c.t, (await b(c)) as never);
  return businesses.businessProfile(c.t);
});
r.put("business/settings", "tenant", async (c) => businesses.updateSettings(c.t, (await b(c)) as never));
r.post("business/delete", "tenant", async (c) => {
  const d = (await b(c)) as { password?: string; confirmName?: string };
  await businesses.requestBusinessDeletion(c.t, String(d.password ?? ""), String(d.confirmName ?? ""));
  return { ok: true };
}, { idempotent: false });

// ------------------------------------------------------------------ files
async function readUpload(c: Ctx) {
  const form = await c.req.formData();
  const f = form.get("file");
  if (!(f instanceof File)) throw new AppError("VALIDATION", "Attach a file");
  if (f.size > 5 * 1024 * 1024) throw new AppError("VALIDATION", "Files must be 5 MB or smaller");
  return { data: Buffer.from(await f.arrayBuffer()), name: f.name, purpose: String(form.get("purpose") ?? "attachment") };
}
r.post("files", "tenant", async (c) => {
  const u = await readUpload(c);
  if (!["logo", "expense_receipt", "attachment"].includes(u.purpose)) throw new AppError("VALIDATION", "Unknown purpose");
  const f = await files.uploadFile(c.t, u.purpose as "logo", u.data, u.name);
  if (u.purpose === "logo") await businesses.setLogo(c.t, f.id);
  return f;
}, { idempotent: false });
r.get("files/:id", "tenant", async (c) => {
  const f = await files.readFileForTenant(c.t, c.params.id!);
  return fileResponse(f.data, f.mime, f.name ?? "file", true);
});
r.del("business/logo", "tenant", async (c) => {
  await businesses.setLogo(c.t, null);
  return { ok: true };
});

// ---------------------------------------------------------------- parties
r.get("parties", "tenant", async (c) => parties.listParties(c.t, c.query));
r.post("parties", "tenant", async (c) => parties.createParty(c.t, (await b(c)) as never));
r.post("parties/duplicates", "tenant", async (c) => parties.findDuplicates(c.t, (await b(c)) as never, c.query.exclude), { idempotent: false });
r.get("parties/export", "tenant", async (c) => fileResponse(Buffer.from(await parties.exportPartiesCSV(c.t), "utf8"), "text/csv; charset=utf-8", `customers-${c.t.today}.csv`));
r.post("parties/import/preview", "tenant", async (c) => parties.previewPartyImport(c.t, String(((await b(c)) as { csv?: string }).csv ?? "")), { idempotent: false });
r.post("parties/import/commit", "tenant", async (c) => {
  const d = (await b(c)) as { csv?: string; skipWarnings?: boolean };
  return parties.commitPartyImport(c.t, String(d.csv ?? ""), !!d.skipWarnings);
});
r.get("parties/:id", "tenant", async (c) => parties.getParty(c.t, c.params.id!));
r.put("parties/:id", "tenant", async (c) => parties.updateParty(c.t, c.params.id!, (await b(c)) as never));
r.del("parties/:id", "tenant", async (c) => {
  await parties.deleteParty(c.t, c.params.id!);
  return { ok: true };
});
r.post("parties/:id/archive", "tenant", async (c) => {
  await parties.setPartyArchived(c.t, c.params.id!, true);
  return { ok: true };
});
r.post("parties/:id/unarchive", "tenant", async (c) => {
  await parties.setPartyArchived(c.t, c.params.id!, false);
  return { ok: true };
});
r.get("parties/:id/ledger", "tenant", async (c) => parties.partyLedger(c.t, c.params.id!, c.query.from, c.query.to));
r.get("parties/:id/interactions", "tenant", async (c) => parties.listInteractions(c.t, c.params.id!));
r.post("parties/:id/interactions", "tenant", async (c) => parties.addInteraction(c.t, c.params.id!, (await b(c)) as never));
r.post("interactions/:id/complete", "tenant", async (c) => {
  await parties.completeFollowUp(c.t, c.params.id!);
  return { ok: true };
});
r.get("followups", "tenant", async (c) => parties.upcomingFollowUps(c.t, Number(c.query.days ?? 7)));
r.get("parties/:id/unpaid", "tenant", async (c) => payments.unpaidDocuments(c.t, c.params.id!, c.query.direction === "out" ? "out" : "in"));
r.get("parties/:id/reminder", "tenant", async (c) => {
  c.t.requireFeature("reminders");
  const p = await parties.getParty(c.t, c.params.id!);
  const open = (await payments.unpaidDocuments(c.t, c.params.id!, "in")) as Array<{ number: string; dueDate: string | null }>;
  const oldest = open[0];
  const days = oldest?.dueDate ? Math.round((Date.parse(c.t.today) - Date.parse(oldest.dueDate)) / 86_400_000) : null;
  if (!p.whatsappOptIn) {
    // Still allowed (it opens the owner's own WhatsApp), but the UI warns.
  }
  const message = paymentReminderMessage({ businessName: c.t.business.name, customerName: p.name as string, outstanding: p.balance as string, oldestInvoice: oldest?.number, daysOverdue: days, upiId: c.t.settings.upiId });
  await c.t.audit("party.reminder", "party", c.params.id!, "Payment reminder prepared for WhatsApp");
  return { message, url: whatsappLink(p.phone as string | null, message), optedIn: !!p.whatsappOptIn };
});

// --------------------------------------------------------------- products
r.get("products", "tenant", async (c) => products.listProducts(c.t, c.query));
r.post("products", "tenant", async (c) => products.createProduct(c.t, (await b(c)) as never));
r.get("products/export", "tenant", async (c) => fileResponse(Buffer.from(await products.exportProductsCSV(c.t), "utf8"), "text/csv; charset=utf-8", `products-${c.t.today}.csv`));
r.post("products/import/preview", "tenant", async (c) => products.previewProductImport(c.t, String(((await b(c)) as { csv?: string }).csv ?? "")), { idempotent: false });
r.post("products/import/commit", "tenant", async (c) => products.commitProductImport(c.t, String(((await b(c)) as { csv?: string }).csv ?? "")));
r.get("products/barcode/:code", "tenant", async (c) => products.findByBarcode(c.t, c.params.code!));
r.get("products/:id", "tenant", async (c) => products.getProduct(c.t, c.params.id!));
r.put("products/:id", "tenant", async (c) => products.updateProduct(c.t, c.params.id!, (await b(c)) as never));
r.post("products/:id/archive", "tenant", async (c) => {
  await products.setProductArchived(c.t, c.params.id!, true);
  return { ok: true };
});
r.post("products/:id/unarchive", "tenant", async (c) => {
  await products.setProductArchived(c.t, c.params.id!, false);
  return { ok: true };
});
r.get("products/:id/movements", "tenant", async (c) => products.productMovements(c.t, c.params.id!, Number(c.query.limit ?? 100)));
r.get("categories", "tenant", async (c) => products.listCategories(c.t));
r.post("categories", "tenant", async (c) => products.createCategory(c.t, (await b(c)) as never));
r.put("categories/:id", "tenant", async (c) => {
  await products.renameCategory(c.t, c.params.id!, String(((await b(c)) as { name?: string }).name ?? ""));
  return { ok: true };
});
r.del("categories/:id", "tenant", async (c) => {
  await products.deleteCategory(c.t, c.params.id!);
  return { ok: true };
});
r.post("stock/adjust", "tenant", async (c) => products.adjustStock(c.t, (await b(c)) as never));
r.post("stock/transfer", "tenant", async (c) => products.transferStock(c.t, (await b(c)) as never));
r.get("stock/low", "tenant", async (c) => products.lowStock(c.t, Number(c.query.limit ?? 50)));
r.get("stock/valuation", "tenant", async (c) => products.stockValuation(c.t));

// -------------------------------------------------------------- documents
const docTypes = (q?: string): DocType[] => {
  const types = (q ?? "").split(",").filter((x) => (DOC_TYPES as readonly string[]).includes(x)) as DocType[];
  if (!types.length) throw new AppError("VALIDATION", "Specify ?type=invoice (or quotation, sales_order, …)");
  return types;
};
r.get("documents", "tenant", async (c) => documents.listDocuments(c.t, docTypes(c.query.type), c.query));
r.post("documents", "tenant", async (c) => documents.createDocument(c.t, (await b(c)) as never));
r.post("documents/preview", "tenant", async (c) => documents.previewDocument(c.t, (await b(c)) as never), { idempotent: false });
r.get("documents/:id", "tenant", async (c) => documents.getDocument(c.t, c.params.id!));
r.put("documents/:id", "tenant", async (c) => documents.updateDocument(c.t, c.params.id!, (await b(c)) as never));
r.del("documents/:id", "tenant", async (c) => {
  await documents.deleteDraft(c.t, c.params.id!);
  return { ok: true };
});
r.post("documents/:id/finalize", "tenant", async (c) => {
  const d = (await b(c)) as { approvalId?: string; allowNegativeStock?: boolean };
  return documents.finalizeDocument(c.t, c.params.id!, { approvalId: d.approvalId ?? null, allowNegativeStock: !!d.allowNegativeStock });
});
r.post("documents/:id/cancel", "tenant", async (c) => documents.cancelDocument(c.t, c.params.id!, (await b(c)) as never));
r.post("documents/:id/convert", "tenant", async (c) => {
  const d = z.object({ target: z.enum(DOC_TYPES), finalize: z.boolean().optional() }).parse(await b(c));
  return documents.convertDocument(c.t, c.params.id!, d.target, { finalize: d.finalize });
});
r.post("documents/:id/duplicate", "tenant", async (c) => documents.duplicateDocument(c.t, c.params.id!));
r.post("documents/:id/status", "tenant", async (c) => {
  const d = z.object({ status: z.enum(["accepted", "rejected", "sent"]) }).parse(await b(c));
  await documents.setQuotationStatus(c.t, c.params.id!, d.status);
  return documents.getDocument(c.t, c.params.id!);
}, { idempotent: false });
r.get("documents/:id/pdf", "tenant", async (c) => {
  const { pdf, filename } = await pdfs.documentPdf(c.t, c.params.id!);
  return fileResponse(pdf, "application/pdf", filename, c.query.download !== "1");
});
r.get("documents/:id/share", "tenant", async (c) => {
  const d = await documents.getDocument(c.t, c.params.id!);
  if (d.status === "draft") throw new AppError("BUSINESS_RULE", "Issue the document before sharing it");
  const link = d.shareToken ? `${env.appUrl}/p/${d.shareToken as string}` : null;
  const message = invoiceShareMessage({
    businessName: c.t.business.name, customerName: d.partyName as string, docLabel: DOC_TYPE_META[d.docType as DocType].label, number: d.number as string,
    total: d.grandTotal as string, dueDate: d.docType === "invoice" ? (d.dueDate as string | null) : null, link,
  });
  return { link, message, whatsappUrl: whatsappLink(d.partyPhone as string | null, message) };
});
r.post("documents/:id/shared", "tenant", async (c) => {
  await documents.markSent(c.t, c.params.id!);
  return { ok: true };
}, { idempotent: false });

// --------------------------------------------------------------- payments
r.get("payments", "tenant", async (c) => payments.listPayments(c.t, c.query));
r.post("payments", "tenant", async (c) => {
  const d = (await b(c)) as { autoAllocate?: boolean };
  return payments.recordPayment(c.t, d as never, { autoAllocate: !!d.autoAllocate });
});
r.get("payments/:id", "tenant", async (c) => payments.getPayment(c.t, c.params.id!));
r.post("payments/:id/void", "tenant", async (c) => {
  await payments.voidPayment(c.t, c.params.id!, String(((await b(c)) as { reason?: string }).reason ?? ""));
  return payments.getPayment(c.t, c.params.id!);
});
r.post("payments/:id/allocate", "tenant", async (c) => {
  const d = (await b(c)) as { documentId: string; amount: string };
  return payments.allocateExisting(c.t, c.params.id!, d.documentId, String(d.amount));
});
r.get("payments/:id/pdf", "tenant", async (c) => {
  const { pdf, filename } = await pdfs.receiptPdf(c.t, c.params.id!);
  return fileResponse(pdf, "application/pdf", filename, c.query.download !== "1");
});
r.get("outstanding", "tenant", async (c) => payments.outstandingReport(c.t, c.query.side === "payable" ? "payable" : "receivable", c.query.asOf));

// ------------------------------------------------------- expenses/accounts
r.get("expenses", "tenant", async (c) => finance.listExpenses(c.t, c.query));
r.post("expenses", "tenant", async (c) => finance.recordExpense(c.t, (await b(c)) as never));
r.get("expenses/:id", "tenant", async (c) => finance.getExpense(c.t, c.params.id!));
r.post("expenses/:id/void", "tenant", async (c) => {
  await finance.voidExpense(c.t, c.params.id!, String(((await b(c)) as { reason?: string }).reason ?? ""));
  return finance.getExpense(c.t, c.params.id!);
});
r.get("expense-categories", "tenant", async (c) => finance.listExpenseCategories(c.t));
r.post("expense-categories", "tenant", async (c) => finance.createExpenseCategory(c.t, (await b(c)) as never));
r.get("accounts", "tenant", async (c) => finance.listAccounts(c.t));
r.post("accounts", "tenant", async (c) => finance.createAccount(c.t, (await b(c)) as never));
r.patch("accounts/:id", "tenant", async (c) => {
  await finance.updateAccount(c.t, c.params.id!, (await b(c)) as never);
  return { ok: true };
});
r.post("accounts/transfer", "tenant", async (c) => finance.transferBetweenAccounts(c.t, (await b(c)) as never));
r.post("accounts/entry", "tenant", async (c) => finance.recordAccountEntry(c.t, (await b(c)) as never));
r.get("cashbook", "tenant", async (c) => finance.cashbook(c.t, c.query.accountId || null, c.query.from ?? `${c.t.today.slice(0, 7)}-01`, c.query.to ?? c.t.today));

// ---------------------------------------------------------------- service
r.get("service/tickets", "tenant", async (c) => service.listTickets(c.t, c.query));
r.post("service/tickets", "tenant", async (c) => service.createTicket(c.t, (await b(c)) as never));
r.get("service/tickets/:id", "tenant", async (c) => service.getTicket(c.t, c.params.id!));
r.patch("service/tickets/:id", "tenant", async (c) => service.updateTicket(c.t, c.params.id!, (await b(c)) as never));
r.post("service/tickets/:id/parts", "tenant", async (c) => service.addPart(c.t, c.params.id!, (await b(c)) as never));
r.del("service/tickets/:id/parts/:partId", "tenant", async (c) => {
  await service.removePart(c.t, c.params.id!, c.params.partId!);
  return { ok: true };
});
r.post("service/tickets/:id/invoice", "tenant", async (c) => service.invoiceTicket(c.t, c.params.id!, !!((await b(c)) as { finalize?: boolean }).finalize));
r.get("amc", "tenant", async (c) => service.listAmcs(c.t, c.query));
r.post("amc", "tenant", async (c) => service.createAmc(c.t, (await b(c)) as never));
r.get("amc/:id", "tenant", async (c) => service.getAmc(c.t, c.params.id!));
r.post("amc/:id/renew", "tenant", async (c) => service.renewAmc(c.t, c.params.id!, (await b(c)) as never));
r.post("amc/:id/cancel", "tenant", async (c) => {
  await service.cancelAmc(c.t, c.params.id!);
  return { ok: true };
});
r.post("amc/:id/invoice", "tenant", async (c) => service.invoiceAmc(c.t, c.params.id!));

// ------------------------------------------------------------------- team
r.get("team", "tenant", async (c) => team.listMembers(c.t));
r.post("team/invitations", "tenant", async (c) => team.inviteMember(c.t, (await b(c)) as never));
r.del("team/invitations/:id", "tenant", async (c) => {
  await team.revokeInvitation(c.t, c.params.id!);
  return { ok: true };
});
r.patch("team/members/:id", "tenant", async (c) => {
  await team.updateMember(c.t, c.params.id!, (await b(c)) as never);
  return { ok: true };
});
r.del("team/members/:id", "tenant", async (c) => {
  await team.removeMember(c.t, c.params.id!);
  return { ok: true };
});
r.get("roles", "tenant", async (c) => team.listRoles(c.t));
r.get("roles/templates", "tenant", async () => SYSTEM_ROLES);
r.post("roles", "tenant", async (c) => team.saveRole(c.t, null, (await b(c)) as never));
r.put("roles/:id", "tenant", async (c) => team.saveRole(c.t, c.params.id!, (await b(c)) as never));
r.del("roles/:id", "tenant", async (c) => {
  await team.deleteRole(c.t, c.params.id!);
  return { ok: true };
});
r.get("branches", "tenant", async (c) => team.listBranches(c.t));
r.post("branches", "tenant", async (c) => team.saveBranch(c.t, null, (await b(c)) as never));
r.put("branches/:id", "tenant", async (c) => team.saveBranch(c.t, c.params.id!, (await b(c)) as never));
r.post("branches/:id/archive", "tenant", async (c) => {
  await team.archiveBranch(c.t, c.params.id!);
  return { ok: true };
});
r.get("support-grants", "tenant", async (c) => team.listSupportGrants(c.t));
r.post("support-grants/:id", "tenant", async (c) => {
  const d = (await b(c)) as { approve?: boolean; hours?: number };
  await team.decideSupportGrant(c.t, c.params.id!, !!d.approve, Number(d.hours ?? 24));
  return { ok: true };
}, { idempotent: false });
r.get("audit", "tenant", async (c) => team.listAudit(c.t, c.query as never));
r.get("audit/:id", "tenant", async (c) => team.auditDetail(c.t, Number(c.params.id)));

// -------------------------------------------------------------- approvals
r.get("approvals", "tenant", async (c) => approvals.listApprovals(c.t, c.query.status ?? "pending"));
r.post("approvals/:id", "tenant", async (c) => {
  const d = (await b(c)) as { approve?: boolean; note?: string };
  await approvals.decideApproval(c.t, c.params.id!, !!d.approve, d.note ?? null);
  return { ok: true };
}, { idempotent: false });

// ---------------------------------------------------------- notifications
r.get("notifications", "tenant", async (c) => notifications.listNotifications(c.t, c.query.unread === "true"));
r.post("notifications/read", "tenant", async (c) => {
  const d = (await b(c)) as { ids?: string[] | "all" };
  await notifications.markNotificationsRead(c.t, d.ids === "all" || !d.ids ? "all" : d.ids.filter((x) => /^[0-9a-f-]{36}$/.test(x)));
  return { ok: true };
}, { idempotent: false });

// ---------------------------------------------------------------- reports
r.get("dashboard", "tenant", async (c) => reports.dashboard(c.t, reports.resolveRange(c.t, c.query)));
r.get("reports/:name", "tenant", async (c) => {
  const def = REPORTS[c.params.name!];
  if (!def) throw new AppError("NOT_FOUND", "Unknown report");
  const range = reports.resolveRange(c.t, c.query);
  const data = await def.load(c.t, range, c.query);
  if (c.query.format === "csv" || c.query.format === "pdf") {
    c.t.require("reports.export");
    return renderReport(c.t, def, data, range, c.query.format);
  }
  return { range, data };
});

// ---------------------------------------------------------------- billing
r.get("billing", "tenant", async (c) => billing.subscriptionOverview(c.t));
r.post("billing/checkout", "tenant", async (c) => {
  const d = z.object({ planCode: z.string(), interval: z.enum(["month", "year"]) }).parse(await b(c));
  return billing.createCheckout(c.t, d.planCode, d.interval);
}, { idempotent: false });
r.post("billing/verify", "tenant", async (c) => {
  const d = z.object({ orderId: z.string().min(5).max(64), paymentId: z.string().min(5).max(64), signature: z.string().min(10).max(256) }).parse(await b(c));
  return billing.verifyCheckout(c.t, d);
}, { idempotent: false });
r.post("billing/cancel", "tenant", async (c) => {
  await billing.cancelAtPeriodEnd(c.t, true);
  return { ok: true };
}, { idempotent: false });
r.post("billing/resume", "tenant", async (c) => {
  await billing.cancelAtPeriodEnd(c.t, false);
  return { ok: true };
}, { idempotent: false });
r.post("webhooks/razorpay", "public", async (c) => {
  const raw = await c.raw();
  return billing.handleRazorpayWebhook(raw, c.req.headers.get("x-razorpay-signature") ?? "", c.req.headers.get("x-razorpay-event-id"));
});

// ------------------------------------------------------------ data export
r.get("export", "tenant", async (c) => {
  const { zip, filename } = await exportsSvc.exportBusinessData(c.t);
  return fileResponse(zip, "application/zip", filename);
});

// ---------------------------------------------------------------- support
r.get("support", "tenant", async (c) => support.listSupportTickets(c.t));
r.post("support", "tenant", async (c) => {
  const d = (await b(c)) as { subject?: string; body?: string };
  return support.createSupportTicket(c.t, String(d.subject ?? ""), String(d.body ?? ""));
});
r.get("support/:id", "tenant", async (c) => support.getSupportTicket(c.t, c.params.id!));
r.post("support/:id/reply", "tenant", async (c) => {
  await support.replySupportTicket(c.t, c.params.id!, String(((await b(c)) as { body?: string }).body ?? ""));
  return { ok: true };
}, { idempotent: false });

// ----------------------------------------------------------------- public
r.get("public/documents/:token", "public", async (c) => {
  const d = await pdfs.publicDocument(c.params.token!);
  return { document: d.document, items: d.items, business: { ...d.business, settings: undefined, logo_storage_key: undefined } };
});
r.get("public/documents/:token/pdf", "public", async (c) => {
  const { pdf, filename } = await pdfs.publicDocumentPdf(c.params.token!);
  return fileResponse(pdf, "application/pdf", filename, true);
});

// ------------------------------------------------------------------- cron
r.post("cron/daily", "public", async (c) => {
  const secret = env.cronSecret;
  const given = (c.req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!secret || given.length !== secret.length || !(await import("node:crypto")).timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    throw new AppError("UNAUTHENTICATED", "Invalid cron secret");
  }
  return runDailyJobs();
});

export const router = r;
export type { Tenant };
export { formatDateIN };
