# Database schema (MySQL 8 / MariaDB 10.6+)

**Source of truth:** the SQL files in [`db/mysql/`](../../db/mysql). This page explains them.

| | Count |
| --- | --- |
| Tables | 56 |
| Tables with `tenant_id` | 50 |
| Foreign keys | 106 |
| Indexes (incl. primary/unique keys) | 225 |

Tested by applying all migrations on MariaDB 10.11 (local). CI also runs them on MariaDB 11.4 and MySQL 8.4.

## Rules used everywhere

1. **Every business table has `tenant_id`** (tenant = one business). The only tables without it are
   platform tables that belong to a *person*, not a business: `users`, `tenants` (the business itself),
   `otp_codes`, `rate_limits`, `auth_events`, `refresh_tokens` (reached through `sessions`).
2. **The database itself blocks cross-business links.** Each parent table has `UNIQUE (tenant_id, id)`,
   and children point to it with a *composite* foreign key, e.g.
   `FOREIGN KEY (tenant_id, party_id) REFERENCES parties (tenant_id, id)`.
   An invoice of business A can never point to a customer of business B — MySQL rejects the row.
   (There is an automated test for this.)
3. **All queries filter by `tenant_id`.** Code that touches business data must use `TenantDb`, which
   refuses any SQL that does not contain `:tenantId` and always fills it from the signed-in session,
   never from user input.
4. **Money** = `DECIMAL(14,2)`, quantities = `DECIMAL(14,3)`, rates/costs = `DECIMAL(14,4)`. Never floats.
5. **Time**: `DATETIME(3)` in **UTC**; business dates (invoice date, attendance date) are `DATE` in IST.
   The app shows everything in IST, `dd/mm/yyyy`.
6. **IDs**: `BIGINT UNSIGNED AUTO_INCREMENT`. Offline-created bills also carry a `client_uuid` (unique per business)
   so a bill synced twice is saved once.
7. **Soft delete** (`deleted_at`) for items, parties, files, tenants; documents are *cancelled*, never deleted
   (GST needs the number trail).
8. `utf8mb4` everywhere, so Hindi/Telugu names and ₹ work.
9. **JSON columns** only for flexible extras (`sector_data`, variant attributes, salary components,
   audit changes) — never for anything we filter or total on.

## Tables by area

### 1. Platform & sign-in — `001_platform.sql`
| Table | Purpose | Key points |
| --- | --- | --- |
| `users` | A person (one login for many businesses) | unique `mobile` (E.164 `+91…`), unique `email`, bcrypt `password_hash` (nullable = OTP-only), `failed_logins`, `locked_until` |
| `tenants` | A business | GSTIN, PAN, state code, sector, FY start month (4 = April), language, plan & `subscription_status` (trial → grace → expired), **future:** `aggregate_turnover_band`, `einvoice_enabled`, `ewaybill_enabled` |
| `tenant_modules` | Sector modules switched on | primary sector at onboarding; more later |
| `subscriptions` | Plan history | **future:** payment-gateway reference |
| `sessions` | One row per signed-in device | `revoked_at` checked on every request → instant sign-out |
| `refresh_tokens` | Rotating refresh tokens | only SHA-256 hash stored; `used_at` detects re-use (theft) |
| `otp_codes` | OTPs | only an HMAC of the code; `attempts` (max 5), 5-minute expiry |
| `rate_limits` | Counters for OTP/login limits | works across restarts and multiple Node processes |
| `auth_events` | Security log of sign-ins | masked mobile/email, IP, success/fail; kept 180 days |

### 2. Business setup, team, audit, infrastructure — `002_tenancy.sql`
| Table | Purpose | Key points |
| --- | --- | --- |
| `branches` | Shops / outlets / branches | own `code`, optional own GSTIN (other state), `is_default` |
| `document_series` | Gap-free numbering | unique per (branch, doc type, FY); format `PREFIX/26-27/0001` (≤ 16 chars, GST rule); allocated with `SELECT … FOR UPDATE` |
| `roles` | Owner, Admin, Manager, Cashier/Staff, Accountant + custom | `permissions` JSON array of keys like `team.invite` |
| `memberships` | Person ↔ business, role, status (invited/active/disabled) | `all_branches` flag |
| `membership_branches` | Branch restriction | used when `all_branches = 0` |
| `audit_logs` | Every create/edit/delete | who, what, field-level `changes` (before → after), IP, request id; **append-only** (triggers in `007`) |
| `files` | Logos, photos, PDFs, payslips, exports | bytes on disk in `STORAGE_DIR/t_<tenant>/…`; `sha256`, real MIME type, size |
| `jobs` | Background work for the cron runner | `status`, `run_at`, `attempts`, `dedupe_key`, `locked_at` (stale lock recovery) |
| `notifications` | In-app bell | one row per person, so "read" is personal |
| `idempotency_keys` | Offline sync safety | replayed request returns the first answer (used from Step 2) |
| `integrations` | **Future:** IRP e-invoice, e-way bill, payment gateway, online store, Tally | `config_encrypted` (AES-256-GCM) |

### 3. Items, stock, parties — `003_masters_stock.sql` (used from Step 2)
| Table | Purpose |
| --- | --- |
| `units` | UQC codes (NOS, PCS, KGS, LTR, MTR…) — seeded at onboarding |
| `item_categories` | Tree of categories |
| `items` | Name, HSN/SAC, GST rate (0–40%), cess, flags: `track_stock`, `track_batch`, `track_serial`, `has_variants`; `sector_data` JSON (e.g. pharmacy `prescription_required`) |
| `item_variants` | **Stock is always per variant** (size/colour). Items without variants get one default variant. SKU, barcode, MRP, sale/purchase price |
| `item_images` | Photos (→ `files`) |
| `batches` | Batch no., mfg/expiry date, MRP (pharmacy, FMCG) |
| `serials` | One row per serial/IMEI (electronics): status in_stock/sold/in_repair…, warranty date |
| `stock_levels` | Current qty + weighted average cost per branch & variant (fast reads) |
| `batch_stock` | Qty per batch per branch |
| `stock_movements` | **Stock ledger** — every in/out with type (sale, purchase, transfer, adjustment, recipe, production…) and reference |
| `stock_transfers`, `stock_transfer_lines` | Branch transfers (draft → dispatched → received) |
| `stock_adjustments`, `stock_adjustment_lines` | Adjustments with a **reason** (damaged, expired, theft, count correction…) and approval |
| `customer_groups` | For wholesale price lists later |
| `parties` | Customers & suppliers: GSTIN, state (decides CGST+SGST vs IGST), credit limit/days, opening & cached balance, notes (last write wins) |
| `party_ledger` | Debit/credit ledger per party → outstanding balance |

### 4. Sales & purchases — `004_sales_purchases.sql` (used from Step 2)
| Table | Purpose |
| --- | --- |
| `sales_documents` | quotation, sales_order, delivery_challan, invoice, credit_note. B2B/B2C, place of supply, CGST/SGST/IGST/cess totals, round-off, paid/balance, `source_doc_id` (quote → order → invoice chain), `channel` (counter, dine-in, takeaway, delivery), `sector_ref_type/id` (restaurant order, hotel folio, project). **Future-ready:** `irn`, `irn_ack_no`, `irn_signed_qr`, `eway_bill_no`, `transport_details`. Offline: `client_uuid` |
| `sales_document_lines` | Qty, rate, discount, taxable value, tax split, `cost_price` (profit by item), serials, `meta` JSON (modifiers, measurements, room nights) |
| `purchase_documents` | purchase_order, goods_receipt, supplier_bill, debit_note; supplier bill no., ITC eligible |
| `purchase_document_lines` | Incl. qty received, batch & expiry, serial numbers |

### 5. Money — `005_money.sql` (used from Step 2)
| Table | Purpose |
| --- | --- |
| `accounts` | Cash, bank, UPI, card, wallet (only last 4 digits of bank account) — "Cash in hand" seeded |
| `payments` | Money in / out; mode cash/UPI/bank/card/cheque; UPI ref/UTR; **future:** `gateway_ref` |
| `payment_allocations` | Which invoices/bills a payment settles |
| `expense_categories` | Seeded with common Indian shop expenses |
| `expenses` | Staff claims: pending → approved/rejected → paid |
| `account_entries` | **Day book** — every money movement per account |

### 6. Employees & payroll — `006_hr_payroll.sql` (used from Step 2)
| Table | Purpose |
| --- | --- |
| `employees` | Profile; Aadhaar **last 4 only**; bank account stored **encrypted**; PAN, UAN, ESIC |
| `employee_documents` | ID proofs etc. (→ `files`) |
| `attendance` | One row per person per day; manual or check-in |
| `leave_types`, `leave_requests` | Casual/Sick/Unpaid seeded; approval flow |
| `salary_structures` | Basic + allowances/deductions (JSON), effective date |
| `salary_advances` | Advance + monthly recovery |
| `payroll_runs`, `payslips` | Monthly run; payslip PDF (→ `files`); salary register = payslips of a run |

## Room for the future (no code yet)
- **E-invoice (IRN)** — fields on `sales_documents`, turnover band + flag on `tenants`, credentials in `integrations`.
- **E-way bill** — `eway_bill_no`, validity, `transport_details` JSON.
- **Payment gateway** — `payments.gateway_ref`, `subscriptions.gateway_ref`, `integrations`.
- **Online store** — `integrations` + `channel = 'online'` on sales documents.
- **Tally export for the CA** — all ledgers are relational (party ledger, day book, tax split per line), so an XML export is a report, not a schema change.
- **Sector tables** (restaurant tables & KOT, hotel rooms & folios, projects & timesheets…) are added in their own steps and link back with `sector_ref_type/id` and `sector_data`.

## Hostinger notes
- Hostinger's managed database is MariaDB. Everything here avoids MySQL-only features.
  `FOR UPDATE SKIP LOCKED` (job queue) needs **MariaDB 10.6+ / MySQL 8.0+** — check the version in phpMyAdmin.
- Shared/Cloud hosting usually gives one DB user with full rights on its database. Ideally run the
  app with a user that has only `SELECT, INSERT, UPDATE, DELETE`, and run migrations with the full user
  (`MIGRATION_DB_USER`). If Hostinger only allows one user, the app still works.
- If the DB user cannot create triggers, `007_audit_guard.sql` is skipped (recorded as `skipped`); the
  app never edits or deletes audit rows anyway, but the database-level guarantee is then missing.
