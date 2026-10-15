# CRAZY BUSINESS APP

**One App. Complete Business Control.**

A multi-tenant business-management SaaS for Indian small and medium businesses —
retail shops, wholesalers, distributors, IT / CCTV / computer / electronics dealers,
service companies and freelancers. GST-ready invoices and quotations, customers,
inventory with serial numbers and warranty, purchases, expenses and cashbook,
payments and dues with WhatsApp reminders, service tickets and AMC, staff roles and
approvals, and reports that keep **sales, cash, gross profit and net profit apart**.

| Part | Path | Stack |
| --- | --- | --- |
| Web app + REST API (`/api/v1`) | `apps/web` | Next.js 15, React 19, Tailwind 4 |
| Super-admin panel (separate app, TOTP required) | `apps/admin` | Next.js 15 |
| Android app | `apps/android` | Kotlin, Jetpack Compose |
| Business logic, auth, services | `packages/server` | TypeScript, PostgreSQL (`pg`), pdfkit |
| GST engine, Indian formats, schemas, plans | `packages/core` | TypeScript, decimal.js, zod |
| Shared UI components | `packages/ui` | React |
| Database migrations (RLS) | `db/migrations` | PostgreSQL 16 SQL |

**Start here:** [docs/STATUS.md](docs/STATUS.md) says honestly what is done, what was
tested, and what still needs work before launch.
To sell it: [docs/GO_TO_MARKET.md](docs/GO_TO_MARKET.md).

## Quick start (local)

Requirements: Node 20+, pnpm 10, PostgreSQL 16 (local or Docker).

```bash
pnpm install

# 1. Create a database and run migrations as the owner role
createdb cba_dev
export MIGRATION_DATABASE_URL=postgres://postgres:postgres@localhost:5432/cba_dev
pnpm db:migrate

# 2. Let the two application roles log in (passwords ≥ 16 chars)
CBA_APP_PASSWORD=cba_app_dev_password CBA_PLATFORM_PASSWORD=cba_platform_dev_password \
  pnpm --filter @cba/server db:setup-roles

# 3. Configure the apps
cp .env.example apps/web/.env.local     # fill DATABASE_URL, PLATFORM_DATABASE_URL, APP_SECRET
cp .env.example apps/admin/.env.local   # keep only PLATFORM_DATABASE_URL, APP_SECRET, URLs

# 4. Fictional demo data (Sharma CCTV & Computers (Demo) — not a real business)
DATABASE_URL=postgres://cba_app:cba_app_dev_password@localhost:5432/cba_dev pnpm db:seed

# 5. Run
pnpm dev          # web app on http://localhost:3000
pnpm dev:admin    # admin panel on http://localhost:3001
```

Demo login: `demo@crazybusiness.example` / `DemoPassw0rd2026` (local only — change
`DEMO_PASSWORD` for any shared environment).

Make a super admin (they must enrol an authenticator app on first admin sign-in):

```bash
MIGRATION_DATABASE_URL=… pnpm --filter @cba/server exec tsx scripts/create-admin.ts you@example.com
```

## Tests

```bash
pnpm typecheck
pnpm test           # 337 core unit tests + 47 server integration tests (real PostgreSQL)
pnpm test:e2e       # Playwright: full quote-to-cash journey, cross-tenant, mobile layout
cd apps/android && gradle :core:test   # Kotlin GST engine, API client, offline sync
```

Server tests create and drop a throwaway database (`TEST_DB_ADMIN_URL`, local only).
See [docs/TESTING.md](docs/TESTING.md) for the results and a manual checklist.

## Documentation

- [docs/STATUS.md](docs/STATUS.md) — what works, what is incomplete
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — design, data model, modules
- [docs/SECURITY.md](docs/SECURITY.md) — tenant isolation, auth, RBAC, audit, payments
- [docs/API.md](docs/API.md) — REST API conventions and endpoints
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — production setup in India
- [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md) — backups and verified restores
- [docs/TESTING.md](docs/TESTING.md) — automated results and manual QA checklist
- [docs/PRICING.md](docs/PRICING.md) — plans, limits and how to change them
- [docs/GOOGLE_PLAY_CHECKLIST.md](docs/GOOGLE_PLAY_CHECKLIST.md) — Android release
- [docs/GO_TO_MARKET.md](docs/GO_TO_MARKET.md) — how to sell and market it
- [apps/android/README.md](apps/android/README.md) — Android build & release

## Important limits

- GST calculations follow standard CGST/SGST/IGST rules, but this app does **not**
  integrate with the GST portal, e-invoicing (IRN) or e-way bills, and it does not
  file returns. Have an accountant review the formats before relying on them.
- Profit figures are **estimates** based on recorded costs.
- Prices in `packages/core/src/plans.ts` are starting hypotheses, not validated prices.
