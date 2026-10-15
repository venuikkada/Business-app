# Project status — honest summary

Last updated: 15 Oct 2026. "Tested" means covered by the automated tests in
[TESTING.md](TESTING.md) unless noted. Nothing has been deployed to production.

## Platform pieces

| Piece | State |
| --- | --- |
| Database schema, RLS, roles, migrations (8 files) | ✅ Done, tested |
| Server/business logic (`packages/server`) | ✅ Done, tested (47 integration tests) |
| Web app + REST API (~140 endpoints) | ✅ Done, built, E2E-tested, crawled for server errors |
| Super-admin app (separate, TOTP) | ✅ Done, built, manually browser-tested |
| Android `:core` (GST, API client, offline sync) | ✅ Done, tested |
| Android `:app` (Compose UI) | ⚠️ **Compiles** — GitHub Actions builds a debug APK on every push (downloadable artifact `crazy-business-debug-apk`). It has **never been run** on a phone or emulator, has no UI tests, and **no signed release (AAB) has been built or published**. |
| Docs, `.env.example`, CI workflow, backup scripts | ✅ Done |

## Modules (spec A–M)

| Module | Implemented | Not yet |
| --- | --- | --- |
| A. Dashboard | Today / period sales, cash collected, gross & net profit estimates, receivable/payable, overdue, low stock, charts, recent docs, date presets; per-role figures | Customisable widgets |
| B. CRM | Customers & suppliers, GSTIN validation, duplicate warning, ledger & balances, interactions & follow-ups, CSV import/export, archive | Lead pipeline stages, tags-based segments UI |
| C. Products & inventory | Goods & services, HSN/SAC, categories, barcode lookup, serial numbers & warranty, multi-branch stock, adjustments with reasons, transfers, low-stock, valuation (weighted average), movement history, negative-stock control | **Batch / expiry tracking**, barcode label printing, variants (size/colour) |
| D. Quotations | Create, edit drafts, send/share, accept/reject/expire, convert to sales order / invoice, PDF | Online "accept quote" button for customers |
| E. Invoices & billing | Tax invoice & bill of supply, CGST/SGST/IGST by place of supply, inclusive/exclusive prices, line & document discounts, round-off, gap-free FY numbering, immutable after issue, cancel, credit/debit notes, PDF with UPI QR, share links, WhatsApp share | **No GST portal / e-invoice (IRN) / e-way bill integration**, no GSTR-1 JSON export, thermal-printer layout, recurring invoices |
| F. Purchases | Purchase orders, partial/full receipt, purchase bills (stock at cost), debit notes, supplier payments | Purchase returns UI polish, landed cost |
| G. Expenses & cashbook | Expenses with categories & attachments, cash/bank accounts, transfers, cashbook, duplicate warning | Bank statement import / reconciliation |
| H. Payments & dues | Partial / full / advance / void, allocation to invoices, outstanding with ageing buckets, WhatsApp reminder message (user presses send) | Automatic scheduled reminders, payment links (Razorpay for customers' customers) |
| I. Sales orders & service | Sales orders, delivery challans, service tickets with status history and spare parts, bill a ticket, AMC contracts with renewals & expiry alerts | Technician mobile app flows (field visits, signatures, photos) |
| J. Employees & permissions | Invitations, system roles, custom roles (Business plan), branch restriction, approvals for discounts/negative stock, owner protection, audit | Attendance / payroll (out of scope) |
| K. Reports | 12 reports (P&L estimate, sales & purchases, product profitability, customer, supplier, outstanding & ageing, GST summary, expenses, cash flow, stock valuation, employee, branch) with CSV & PDF, drill-down links | Scheduled email reports, Tally export |
| L. Notifications | In-app notifications (overdue, low stock, AMC, approvals), daily job, email for account events | **Push notifications (FCM)**, SMS, **WhatsApp Business API automated sending** |
| M. Data | Full export (ZIP of CSV), CSV import with preview for customers/products, business delete with 30-day restore and purge, account deletion, backup/restore scripts | Import of opening invoices, migration tools from Vyapar/Tally |

## Integrations

| Integration | State |
| --- | --- |
| Email (SMTP via nodemailer) | ✅ Implemented and tested against a local SMTP server; not yet tried with a real provider |
| File storage S3 | ⚠️ Driver written, **not tested** against a real bucket (local disk driver is tested) |
| Razorpay subscriptions | ⚠️ Order, verification (signature + server fetch), webhooks implemented and tested with signature vectors and a mocked gateway; **not tested with Razorpay test or live keys** |
| WhatsApp | `wa.me` links with prepared messages only (no Business API) |
| GST portal / e-invoice / e-way bill | ❌ Not implemented — the app must not be marketed as doing this |

## Before launch (must do)

1. Install the CI debug APK on real phones and test every screen; fix issues; build a signed AAB.
2. Razorpay test-mode end-to-end, then live keys after KYC.
3. Try S3 storage and SMTP with the real providers.
4. Lawyer review of Terms & Privacy (DPDP Act 2023) and a Data Processing Agreement for customers.
5. Chartered accountant review of invoice, credit note and bill of supply formats and the GST summary report.
6. External security review / penetration test; enable Cloudflare (WAF + Turnstile on sign-up).
7. Production deployment in an Indian region with PITR backups and monitoring ([DEPLOYMENT.md](DEPLOYMENT.md)).
8. Replace demo/marketing copy that mentions features from the "Not yet" column.
9. A public "how to delete your account" help page (needed for Google Play).

## Known limitations

- Profit figures are estimates (weighted-average cost; expenses as recorded).
- Android offline mode saves invoices/quotations created while the connection drops;
  searching customers/products still needs internet (no offline catalogue cache).
- English only (Hindi and regional languages not yet translated).
- Single currency (INR).
