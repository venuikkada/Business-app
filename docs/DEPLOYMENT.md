# Deployment (production, India)

> Nothing has been deployed yet. This is the recommended setup; follow
> [STATUS.md](STATUS.md) "Before launch" too. **On Hostinger, use the tested Docker
> stack in [DEPLOY_HOSTINGER.md](DEPLOY_HOSTINGER.md) instead.**

## Recommended stack

| Piece | Recommendation (data stays in India) |
| --- | --- |
| Database | Managed PostgreSQL 16 in **Mumbai (ap-south-1)** or Hyderabad: AWS RDS, Google Cloud SQL, Azure, DigitalOcean BLR, or Supabase (Postgres only) with PITR backups |
| Web app (`apps/web`) | Vercel (region `bom1`), or any Node 20 host (`next start`) behind HTTPS |
| Admin app (`apps/admin`) | **Separate** deployment and domain (e.g. `admin.your-domain.in`), IP-restricted |
| Files | S3-compatible bucket in ap-south-1 (AWS S3) or Cloudflare R2; private, no public ACLs |
| Email | Any SMTP provider (Amazon SES Mumbai, Zoho ZeptoMail, Postmark…) |
| Payments | Razorpay (live keys after KYC) |
| Scheduler | Vercel Cron / GitHub Actions / system cron hitting the daily job |

## 1. Database

```bash
# As the database owner (admin user of your managed Postgres):
export MIGRATION_DATABASE_URL='postgres://owner:…@db-host:5432/cba?sslmode=require'
pnpm install --frozen-lockfile
pnpm db:migrate                       # creates schema, RLS policies, roles cba_app & cba_platform, plans

# Give the two app roles long random passwords (≥16 chars):
CBA_APP_PASSWORD="$(openssl rand -base64 32)" \
CBA_PLATFORM_PASSWORD="$(openssl rand -base64 32)" \
  pnpm --filter @cba/server db:setup-roles     # store both in your secret manager
```

- Migrations are forward-only, checksummed and run under an advisory lock (safe to run
  from CI on every deploy). Never edit an applied migration; add a new file.
- Use `sslmode=require` (or `verify-full` with the provider CA) in all URLs.
- On Supabase: use the **direct** connection (not the transaction pooler) for
  migrations; the app roles can use the session pooler. Do not expose these roles via
  PostgREST — this app does not use the Supabase client API.
- Do **not** run `db:seed` in production.

## 2. Web app

Environment (see `.env.example`):

```
NODE_ENV=production
DATABASE_URL=postgres://cba_app:…@db-host:5432/cba?sslmode=require
PLATFORM_DATABASE_URL=postgres://cba_platform:…@db-host:5432/cba?sslmode=require
APP_SECRET=<openssl rand -base64 48>
APP_URL=https://app.your-domain.in
CRON_SECRET=<openssl rand -hex 32>
MAIL_FROM="Your Brand <no-reply@your-domain.in>"
SMTP_URL=smtps://user:pass@smtp.provider.com:465
STORAGE_DRIVER=s3
S3_BUCKET=… S3_REGION=ap-south-1 S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=… S3_SSE=AES256
RAZORPAY_KEY_ID=… RAZORPAY_KEY_SECRET=… RAZORPAY_WEBHOOK_SECRET=…
```

Build & run:

```bash
pnpm install --frozen-lockfile
pnpm --filter @cba/web build
pnpm --filter @cba/web start      # PORT=3000
```

The web app needs the platform URL only for the public pricing page and billing
(plans are platform data). It never needs the owner/migration URL.

**Proxy requirement:** run behind a proxy that sets `X-Forwarded-For` itself
(Vercel, Cloudflare, nginx `real_ip`), otherwise per-IP rate limits can be spoofed.

For S3 storage install the SDK in the web app: `pnpm --filter @cba/web add @aws-sdk/client-s3`
(the S3 driver loads it on demand). **The S3 driver has not been tested against a real
bucket yet** — upload and download a logo once after setup.

## 3. Admin app

```
NODE_ENV=production
PLATFORM_DATABASE_URL=postgres://cba_platform:…   # ONLY this database URL
APP_SECRET=<same value as the web app — TOTP secrets are shared>
APP_URL=https://app.your-domain.in
ADMIN_URL=https://admin.your-domain.in
ADMIN_ALLOWED_IPS=<your office / VPN IPs>
```

```bash
pnpm --filter @cba/admin build && pnpm --filter @cba/admin start   # PORT=3001
```

Grant yourself admin (CLI only, by design), then sign in and enrol TOTP:

```bash
MIGRATION_DATABASE_URL=… pnpm --filter @cba/server exec tsx scripts/create-admin.ts you@your-domain.in
```

## 4. Daily jobs

Once a day (06:00 IST = 00:30 UTC):

```bash
curl -fsS -X POST https://app.your-domain.in/api/v1/cron/daily -H "Authorization: Bearer $CRON_SECRET"
```

Vercel: add a cron in `vercel.json` that calls the path. The job is idempotent.

## 5. Razorpay

1. Complete KYC; create live API keys.
2. Dashboard → Webhooks → `https://app.your-domain.in/api/v1/webhooks/razorpay`,
   events `payment.captured`, `payment.failed`, `order.paid`; set a webhook secret →
   `RAZORPAY_WEBHOOK_SECRET`.
3. Test with Razorpay **test mode** keys end-to-end before switching to live keys
   (this has not been done yet).
4. Prices are set per plan in the admin panel (Plans) — in paise in the database.

## 6. Android app

Build the release with `-PapiBaseUrl=https://app.your-domain.in` — see
[apps/android/README.md](../apps/android/README.md) and
[GOOGLE_PLAY_CHECKLIST.md](GOOGLE_PLAY_CHECKLIST.md).

## 7. After deploy — smoke test

1. `GET /api/v1/health` → `{ ok: true }`.
2. Register a new account with a real email; verification email arrives.
3. Create a business, a customer, a product; issue an invoice; download the PDF;
   open the share link in a private window.
4. Record a payment; dashboard shows sales vs cash correctly.
5. Forgot password email arrives and the link works once.
6. Admin: sign in, TOTP, see the new business in the list (no tenant data visible).
7. Run `scripts/backup.sh` and `scripts/verify-restore.sh` against a scratch DB.

## Monitoring

- Uptime check on `/api/v1/health`.
- Log drain for `[api] unhandled error` and `[mail] Failed` lines.
- Alert on database CPU/storage and backup failures.
