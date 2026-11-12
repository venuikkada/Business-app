# Version 2 — Hostinger + MySQL multi-business app

**Status: Step 1 done, waiting for your review.** Steps 2–5 will not start until you approve.

| Step | Scope | State |
| --- | --- | --- |
| 1 | Core engine, auth, business setup, roles, audit log | ✅ Built & tested — please review |
| 2 | Retail: billing, stock, quotations, staff, payslip, reports | ⏸ Waiting for approval (database tables already exist) |
| 3 | Restaurant | ⏸ |
| 4 | Hotel | ⏸ |
| 5 | Corporate / services | ⏸ |

## Step 1 deliverables
- [Database schema](DATABASE_SCHEMA.md) — 56 tables, `tenant_id` on every business table, 106 foreign keys, 225 indexes. SQL in [`db/mysql/`](../../db/mysql).
- [API endpoint list](API.md) — 45 endpoints, each with its permission rule.
- [Folder structure](FOLDER_STRUCTURE.md)
- [Security checklist](SECURITY_CHECKLIST.md)
- [Test plan + sample data](TEST_PLAN.md) — 54 automated tests + 22 manual checks on a phone.
- [Deploy on Hostinger](DEPLOY_HOSTINGER.md)

## What works now
- Sign in with **mobile OTP** (SMS) or **email/mobile + password**; forgot password via OTP; sign out a device or all devices.
- **Create a business** in one screen: name, GSTIN (checked), sector (10 choices), state, branches, invoice prefix, April–March year. 30-day free trial.
- One person can own or work in **many businesses** and switch between them (each browser tab can show a different one).
- **Team:** add staff by mobile number with a role and branch restriction; send the invite on WhatsApp (`wa.me` link); change role; disable; remove.
- **Roles:** Owner, Admin, Manager, Cashier/Staff, Accountant built in; **custom roles with permission checkboxes**.
- **Audit log** of every create, edit and delete — who, what (old → new value), when (IST); filters; export to CSV via a background job.
- **Settings:** business details, logo upload, branches, document numbering (GST rules: unique per year, ≤ 16 characters).
- **Background jobs** via cron every minute: encrypted daily backups, subscription expiry (trial → 7-day grace → read-only), clean-up, exports.
- **Live updates** by polling every 15 s: notification bell, and permission changes reach other phones without reload.
- **Installable PWA** for Android (icon, full screen, opens offline). **English, हिन्दी, తెలుగు, Hinglish.** ₹ lakh/crore, dd/mm/yyyy, IST.

## Not in Step 1 (on purpose)
- Billing, stock, parties, purchases, money, payroll screens → Step 2.
- Offline **billing** queue in IndexedDB (the service worker shell is ready) → Step 2, with billing.
- Payslip / invoice PDFs → Step 2.
- E-invoice (IRN), e-way bill, payment gateway, online store, Tally export → later (database fields reserved).

## Decisions I made (tell me if you want them changed)
1. **New app beside the old one.** The repo already had a PostgreSQL/Supabase version (`apps/web`, `packages/server`). It is untouched; the new app is `apps/api` + `apps/pwa` + `db/mysql`. It re-uses only `packages/core` (GST maths, GSTIN check, ₹ formats).
2. **Express (not Next.js)** for the backend, with a React PWA built by Vite and served by the same Node app → one process on Hostinger, simpler and lighter.
3. **Stock per item variant** — every item has at least one variant, so sizes/colours (garments) and plain items work the same way.
4. **System roles always follow the code**, so new modules automatically reach Owner/Admin/Manager etc. Custom roles keep exactly what you tick.
5. **SMS provider: MSG91** (common in India, needs DLT registration). Others can be added in one file.
6. App name shown as **"Crazy Business"** (from the existing repo). Easy to change.
