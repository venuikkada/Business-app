# Architecture

## Overview

```
 Android app (Kotlin/Compose) ─┐  Bearer token, X-Business-Id
                               ├──► apps/web  ── /api/v1/* (REST, JSON) ──┐
 Browser (Next.js pages) ──────┘  httpOnly cookie + CSRF header           │
                                                                          ▼
                                                 packages/server (services, auth, PDFs)
                                                          │   pg pool as role cba_app
                                                          ▼
                                                  PostgreSQL 16  (RLS on every tenant table)
                                                          ▲
 Admin browser ──► apps/admin (separate app, TOTP) ───────┘   pg pool as role cba_platform
```

- **One backend, many clients.** The web pages are React Server Components that
  call the same service functions the REST API calls. The Android app uses only
  the REST API. All business rules live in `packages/server`; clients never compute
  anything the server trusts (totals are recomputed on save).
- **Own API instead of Supabase.** The spec allowed "Supabase or an equally secure
  backend". The SQL (RLS policies, roles, functions) is plain PostgreSQL and runs on
  any managed Postgres, including Supabase's. We chose a server-side API so that no
  database key of any kind reaches a browser or phone.

## Packages

| Package | Responsibility |
| --- | --- |
| `packages/core` | Pure, framework-free logic shared by server and web: decimal money (`decimal.js`), GST engine (`calculateDocument`), Indian states, GSTIN checksum, phone/date/FY formats, amount in words, zod input schemas, permission catalogue and system roles, plan features/limits, CSV with formula-injection guard. |
| `packages/server` | DB pools and transactions, migrations runner, auth (scrypt, sessions, TOTP, resets, rate limits), tenant context (`withTenant`), services per module, PDF rendering (pdfkit + Noto Sans for ₹), storage drivers, mailer, Razorpay billing, platform/admin services, daily jobs. |
| `packages/ui` | Shared React components (buttons, cards, tables, forms, badges) for web and admin. |
| `apps/web` | Next.js app: marketing pages, auth pages, the business app, public share page `/p/[token]`, and the REST API (`src/app/api/v1/[...path]` → `src/lib/routes.ts`). |
| `apps/admin` | Separate Next.js app for the platform owner. Connects only as `cba_platform`. |
| `apps/android` | `:core` Kotlin library (GST engine port, API client, offline sync) + `:app` Compose UI. |

## Request lifecycle (tenant API call)

1. `router.ts` authenticates (cookie or Bearer), checks CSRF for cookie writes,
   applies the idempotency key if present, resolves the business (header/cookie;
   falls back to the user's only business).
2. `withTenant` opens a transaction on the `cba_app` pool and sets
   `app.user_id` / `app.business_id` with `set_config(..., true)` (transaction-local).
3. It loads membership, role permissions, plan (with trial/expiry fallback to Free)
   and settings. Suspended businesses and support sessions get read-only permissions.
4. The service calls `t.require("invoices.create")`, `t.requireFeature("purchases")`,
   `assertLimit(...)`, then runs SQL. RLS policies (`business_id = app.current_business_id()`)
   are the second line of defence if a query forgets a filter.
5. Important actions write `audit_logs` (append-only) in the same transaction.

## Data model (main tables)

- Platform: `users`, `sessions`, `user_tokens`, `rate_limits`, `plans`,
  `platform_settings`, `platform_audit_logs`, `payment_gateway_events`,
  `support_access_grants`, `support_tickets`, `support_ticket_messages`.
- Tenancy: `businesses`, `branches`, `roles`, `memberships`, `invitations`,
  `subscriptions`, `subscription_payments`, `document_sequences`, `idempotency_keys`.
- CRM & inventory: `parties`, `party_interactions`, `categories`, `products`,
  `product_serials`, `stock_levels`, `stock_movements` (append-only).
- Documents & money: `documents`, `document_items`, `payments`, `allocations`,
  `accounts`, `account_transactions` (append-only), `expense_categories`, `expenses`.
- Service & ops: `service_tickets`, `service_ticket_events`, `service_ticket_parts`, `amc_contracts`,
  `approval_requests`, `notifications`, `files`, `audit_logs`.

Every tenant table has `business_id`, and child tables use **composite foreign
keys `(business_id, id)`** so a row can never point at another business's row,
even through a bug.

## Key invariants (enforced in the database)

| Invariant | How |
| --- | --- |
| Tenant isolation | RLS on all tenant tables; app role has no BYPASSRLS; composite FKs |
| Finalised documents are immutable | trigger rejects updates to issued invoices except status/settlement fields |
| Stock moves exactly once per document line | unique `(source_line_id, kind)` on `stock_movements` |
| No negative stock unless overridden | `app.move_stock` raises `P0002` unless the audited override flag is set |
| Gap-free numbering per FY and type | `document_sequences` row lock → `INV/26-27/0001` |
| Balances always match payments | allocation trigger recomputes `amount_settled`, `balance_due`, status |
| Audit/stock/ledger history can't be rewritten | append-only triggers + no UPDATE/DELETE grants |
| Duplicate submits don't duplicate data | `Idempotency-Key` stored per user + business |

## GST engine

`packages/core/src/gst.ts` (TypeScript) and `apps/android/core/.../GstCalculator.kt`
(Kotlin) implement the same algorithm and are both tested against
`test-vectors/gst.json`:

- line gross → line discount → document discount allocated by largest remainder →
  taxable value → CGST+SGST (intra-state) or IGST (inter-state, decided by place of
  supply vs business state) → optional additional charges → round-off.
- Tax-inclusive prices are back-calculated.
- Composition / unregistered businesses issue a **Bill of Supply** with no tax.
- All amounts are decimals rounded half-up to paise; nothing uses floating point.

## Reports and the money definitions

| Term | Meaning in this app |
| --- | --- |
| Sales / revenue | Issued invoices minus credit notes, **taxable value** (GST is not revenue) — dashboards also show the invoice total incl. GST, clearly labelled |
| Cash collected | Payments actually received in the period (any invoice date) |
| Gross profit (estimate) | Taxable sales − cost of goods sold at weighted-average cost at time of sale |
| Net profit (estimate) | Gross profit − expenses in the period |
| Receivable / payable | Unsettled balances of issued documents, with 0–30/31–60/61–90/90+ ageing |

## Background jobs

`app.daily_maintenance()` (SQL) — overdue/low-stock/AMC notifications (idempotent),
expire old quotations, expire lapsed subscriptions, purge businesses deleted more
than 30 days ago, clean old tokens/rate-limit rows. Trigger it daily via
`POST /api/v1/cron/daily` (Bearer `CRON_SECRET`) or `pnpm --filter @cba/server jobs:daily`.
