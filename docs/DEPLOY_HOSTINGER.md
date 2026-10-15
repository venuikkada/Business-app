# Deploying on Hostinger

## Which Hostinger product?

This app needs **PostgreSQL** (tenant isolation is enforced by PostgreSQL row-level
security). Hostinger's Web/Cloud hosting only offers MySQL databases, so:

| Option | Fits? | Notes |
| --- | --- | --- |
| **Hostinger VPS (KVM 2 or higher, Ubuntu 24.04)** | ✅ **Recommended** | Runs everything (PostgreSQL, web, admin, HTTPS, daily jobs) with one command using the Docker stack in `deploy/hostinger/`. Choose the **India (Mumbai)** data centre if offered, otherwise the nearest. |
| Business / Cloud web hosting (Node.js apps) + external PostgreSQL | ⚠️ Possible | Database must live elsewhere (e.g. Neon or Supabase, Mumbai region). The Node.js builder must handle a pnpm monorepo — untested. |
| Single / Premium web hosting | ❌ | No Node.js runtime. |

The Docker stack was tested end-to-end (fresh install → migrations → sign-up →
GST invoice → PDF → payment → dashboard over HTTPS, daily job, backup, restart with
data intact). It has **not yet been run on an actual Hostinger VPS**.

## Option A — Hostinger VPS (recommended)

**Size:** KVM 2 (2 vCPU, 8 GB RAM) is comfortable; KVM 1 (4 GB) works for a pilot.
Building the image needs ~3 GB RAM — on KVM 1 add swap first (`fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`).

1. **Buy/choose the VPS** in hPanel → VPS. OS template: *Ubuntu 24.04* (plain, or the
   "Docker" template). Set a strong root password or, better, add your SSH key.
2. **DNS:** in hPanel → Domains → your domain → DNS, add two **A records** pointing at
   the VPS IP: `app` (e.g. `app.your-domain.in`) and `admin`
   (`admin.your-domain.in`). Wait until `ping app.your-domain.in` shows the VPS IP.
3. **Install** (SSH into the VPS):
   ```bash
   git clone https://github.com/venuikkada/Business-app.git
   cd Business-app && git checkout ccr-9a0e465a-9pife9   # or main once merged
   cd deploy/hostinger
   ./setup.sh app.your-domain.in admin.your-domain.in you@your-domain.in
   ```
   It installs Docker if needed, generates all secrets into `deploy/hostinger/.env`
   (permissions 600 — **copy it to your password manager**), opens only ports 22/80/443,
   builds and starts the stack, and gets free HTTPS certificates from Let's Encrypt.
4. **Open** `https://app.your-domain.in`, register your own account, then make it the
   super admin:
   ```bash
   ./make-admin.sh you@your-domain.in
   ```
   Sign in at `https://admin.your-domain.in` and enrol your authenticator app.
5. **Email** (needed for verification, password reset and staff invites): create a
   mailbox in hPanel → Emails (e.g. `no-reply@your-domain.in`), then set in `.env`:
   ```
   MAIL_FROM="Your Brand <no-reply@your-domain.in>"
   SMTP_URL=smtps://no-reply%40your-domain.in:MAILBOX_PASSWORD@smtp.hostinger.com:465
   ```
   (`%40` is the `@` in the username; URL-encode special characters in the password.)
   Apply with `docker compose up -d`.
6. **Backups:** `crontab -e` and add
   `30 20 * * * /root/Business-app/deploy/hostinger/backup.sh` (02:00 IST). Also enable
   Hostinger's VPS snapshots/backups, and copy `deploy/hostinger/backups/` off the
   server regularly (e.g. `rclone` to Google Drive). Test a restore monthly
   (see [BACKUP_RESTORE.md](BACKUP_RESTORE.md)).
7. **Optional:** set `ADMIN_ALLOWED_IPS` to your office IP; add Razorpay keys after KYC.

### Updating to a new version

```bash
cd ~/Business-app && git pull && cd deploy/hostinger && docker compose up -d --build
```

Migrations run automatically (forward-only, safe to re-run) before the apps restart.
Run `./backup.sh` first.

### Useful commands

```bash
docker compose ps                 # status
docker compose logs -f web        # web app logs
docker compose restart web admin  # restart apps
./backup.sh                       # manual backup
```

### What runs where

| Container | Purpose | Exposed |
| --- | --- | --- |
| `caddy` | HTTPS + reverse proxy for both domains | 80, 443 |
| `web` | Web app + REST API (Android app talks to this) | internal |
| `admin` | Super-admin panel (platform DB role only) | internal |
| `db` | PostgreSQL 16, data in Docker volume `pgdata` | **not exposed** |
| `migrate` | Runs migrations + sets role passwords, then exits | — |
| `cron` | Calls the daily maintenance job at 06:00 IST | — |

Uploaded files live in the `uploads` volume; HTTPS certificates in `caddy_data`.

## Option B — Business/Cloud web hosting + Supabase PostgreSQL (in use)

This is how the app is deployed on the existing Business plan:

| Piece | Setting |
| --- | --- |
| Website | `sienna-swan-881576.hostingersite.com` (free subdomain; connect your own domain later) |
| Build | Hostinger Node.js build **from GitHub**: repo `venuikkada/Business-app`, root directory `apps/web`, app type Next.js, package manager **pnpm**, Node 20, build script `build`, output `.next` |
| Database | Supabase project `crazy-business-app` (Mumbai, ap-south-1), reached through the **Session pooler** (IPv4) on port 5432 |
| TLS to the database | Verified against the Supabase Root 2021 CA (`DB_SSL_CA_BASE64`) — no `sslmode` in the URLs |

Database setup that was done (via the Supabase connector):
- migrations 0001–0006, 0008, 0009 applied with their checksums recorded in
  `schema_migrations`; schema verified identical to a local database migrated from the
  files (columns, constraints, indexes, policies, function bodies, triggers, grants)
- **0007 must be run by you** in Supabase → SQL Editor (the connector could not show
  its confirmation prompt): paste `db/migrations/0007_jobs_sharing.sql` followed by
  `insert into schema_migrations(name, checksum) values ('0007_jobs_sharing.sql', '<sha256 of the file>');`
- default plans and platform settings seeded
- roles `cba_app` / `cba_platform` can log in (passwords set as SCRAM hashes; no RLS bypass)
- migration 0009 removes all access for Supabase's Data API roles (`anon`, `authenticated`)
  and puts row-level security on every table

Environment variables (hPanel → Websites → the site → Node.js → Environment variables):

```
NODE_ENV=production
DATABASE_URL=postgres://cba_app.<project-ref>:<password>@<session-pooler-host>:5432/postgres
PLATFORM_DATABASE_URL=postgres://cba_platform.<project-ref>:<password>@<session-pooler-host>:5432/postgres
DB_SSL_CA_BASE64=<base64 of prod-ca-2021.crt from Supabase → Database settings → SSL>
DB_POOL_MAX=5
APP_SECRET=<openssl rand -hex 32>
CRON_SECRET=<openssl rand -hex 32>
APP_URL=https://<your-domain>
STORAGE_DRIVER=local
STORAGE_LOCAL_DIR=/home/<hostinger-user>/cba-storage   # outside the deploy folder, survives redeploys
MAIL_FROM="CRAZY BUSINESS APP <no-reply@your-domain>"
SMTP_URL=smtps://no-reply%40your-domain:<mailbox-password>@smtp.hostinger.com:465   # optional
```

The pooler host (`aws-N-ap-south-1.pooler.supabase.com`) must be **copied from Supabase →
Connect → Session pooler**; the number differs between projects. Custom roles use the
username form `role.project-ref`.

Redeploy after pushing new code: hPanel → Node.js → Deploy (or the API's start-build with
the same settings). Run new migrations against Supabase before deploying code that needs them.

Daily jobs: schedule an external cron (e.g. cron-job.org, or hPanel → Advanced → Cron Jobs
with `curl`) for `POST https://<your-domain>/api/v1/cron/daily` with
`Authorization: Bearer <CRON_SECRET>` at 00:30 UTC (06:00 IST).

Still to do on this option: the admin panel (`apps/admin`) is **not deployed yet** — deploy it
as a second Node.js website (root directory `apps/admin`) with only `PLATFORM_DATABASE_URL`,
`DB_SSL_CA_BASE64`, `APP_SECRET`, `APP_URL`, `ADMIN_URL`.

## Android app

Build the release with `-PapiBaseUrl=https://app.your-domain.in` (see
[GOOGLE_PLAY_CHECKLIST.md](GOOGLE_PLAY_CHECKLIST.md)).
