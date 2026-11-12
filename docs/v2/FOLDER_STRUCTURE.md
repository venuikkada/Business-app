# Folder structure

The repository already contained an older version of this product (Next.js + PostgreSQL/Supabase).
The **new** Hostinger + MySQL app lives beside it and does not touch the old code.

```
db/mysql/                      ← NEW: MySQL/MariaDB migrations (source of truth for the schema)
  001_platform.sql             users, tenants (businesses), sessions, refresh tokens, OTP, rate limits, auth events
  002_tenancy.sql              branches, numbering, roles, team, audit log, files, jobs, notifications, integrations
  003_masters_stock.sql        units, categories, items, variants, batches, serials/IMEI, stock, transfers, parties, ledger
  004_sales_purchases.sql      sales & purchase documents + lines (e-invoice / e-way bill fields reserved)
  005_money.sql                cash/bank/UPI accounts, payments, allocations, expenses, day book
  006_hr_payroll.sql           employees, documents, attendance, leave, salary structure, advances, payroll, payslips
  007_audit_guard.sql          triggers that make audit_logs append-only (optional if the DB user lacks TRIGGER)

apps/api/                      ← NEW: backend (Express 5 + TypeScript). Also serves the built PWA.
  src/server.ts                web server entry (Hostinger "entry file" = dist/server.js)
  src/cron.ts                  cron entry: process background jobs for ≤ 50 s, then exit
  src/app.ts                   security headers, CSRF, rate limit, routes, static PWA
  src/config/env.ts            all settings from environment variables (validated at start)
  src/db/pool.ts               MySQL pool; Db (platform tables) and TenantDb (forces :tenantId)
  src/db/migrate.ts            migration runner (+ migrate-cli.ts)
  src/http/router.ts           ApiRouter: every route must declare public / user / permission
  src/http/auth-middleware.ts  JWT cookie → session check → business membership → permissions
  src/http/rate-limit.ts       MySQL-backed limits (OTP, login) + in-memory per-IP limit
  src/http/errors.ts           one error format for the whole API
  src/lib/                     permissions catalogue & system roles, sectors, crypto (AES-256-GCM), dates, masks
  src/modules/
    auth/                      OTP, password, tokens, SMS providers (console for dev, MSG91 for production)
    account/                   /me: profile, password, devices
    tenants/                   onboarding, business settings, branches, document numbering
    team/                      invite / edit / remove members, owner protection
    roles/                     custom roles, permission catalogue, no-escalation rule
    audit/                     audit writer (field diff, secret masking), list & CSV export
    files/                     upload checks (real file type, size), per-tenant storage, download
    jobs/                      queue, runner (SKIP LOCKED, retries, backoff), handlers (cleanup, backup, expiry, export)
    notifications/             in-app notifications + /poll for live updates
    meta/                      health, lists for forms, cron HTTP fallback
  scripts/build.mjs            builds dist/ = one self-contained folder to upload to Hostinger
  scripts/seed-demo.ts         fictional demo data
  scripts/print-routes.ts      prints the API table in docs/v2/API.md
  test/                        46 integration tests against a real MySQL/MariaDB database
  .env.example                 every environment variable, with comments

apps/pwa/                      ← NEW: installable web app (React + Vite), Android-installable PWA
  public/manifest.webmanifest  name, icons, colours (installable on Android)
  public/sw.js                 service worker: app opens offline; /api is never cached
  public/icons/                192 / 512 / maskable icons
  src/i18n/{en,hi,te,hinglish}.json   translation files (same keys in every language — tested)
  src/lib/api.ts               fetch wrapper: cookies, CSRF, X-Tenant-Id, silent token refresh
  src/lib/session.tsx          signed-in user, open business, permissions
  src/lib/poll.ts              15-second polling (slower when hidden, pauses offline)
  src/lib/format.ts            ₹ lakh/crore, dd/mm/yyyy, IST, +91 phone format
  src/pages/                   Login, Onboarding, PickBusiness, Home, Team, Roles, Audit, Settings, Account, Notifications
  test/                        translation completeness + Indian formats

packages/core/                 shared (already existed): GST engine, GSTIN/PAN checks, ₹ formats, states, FY helpers

docs/v2/                       Step 1 documents (this folder)

apps/web, apps/admin, apps/android, packages/server, db/migrations   ← OLD PostgreSQL/Supabase version (untouched)
```

## Built output (what goes on Hostinger)

`pnpm --filter @biz/pwa build && pnpm --filter @biz/api build` produces `apps/api/dist/`:

```
dist/server.js      start command: node server.js
dist/cron.js        cron: node cron.js (every minute)
dist/migrate.js     node migrate.js (run after each release)
dist/migrations/    the .sql files
dist/public/        the PWA
dist/package.json   { "type": "module", scripts: start/migrate/cron }
```

All npm packages are bundled into these files, so the server needs **no `npm install`**.

## Files on the server disk (STORAGE_DIR, outside public_html)

```
STORAGE_DIR/t_<tenantId>/logo/2026/11/<random>.png
STORAGE_DIR/t_<tenantId>/export/2026/11/<random>.csv
STORAGE_DIR/backups/t_<tenantId>/2026-11-12.json.gz.enc      (encrypted, last 14 kept)
```
