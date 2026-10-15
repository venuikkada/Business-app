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

## Option B — Business/Cloud web hosting + external PostgreSQL

Only if you already pay for Business/Cloud hosting and don't want a VPS:

1. Create a PostgreSQL database in **Neon** or **Supabase** (region: Mumbai). Run
   migrations and `db:setup-roles` from your computer (see [DEPLOYMENT.md](DEPLOYMENT.md)).
2. In hPanel → Websites → Add website → Node.js app, connect the GitHub repo.
   Build command `pnpm install --frozen-lockfile && pnpm --filter @cba/web build`,
   start command `pnpm --filter @cba/web start`, Node 20.
3. Add the environment variables from `.env.example` (`DATABASE_URL`,
   `PLATFORM_DATABASE_URL`, `APP_SECRET`, `APP_URL`, `CRON_SECRET`, `SMTP_URL`, …) in the
   Node.js app settings. Do **not** use Hostinger's "create database" for this app (MySQL).
4. Deploy the admin app as a second Node.js website on `admin.` with only
   `PLATFORM_DATABASE_URL`, `APP_SECRET`, `APP_URL`, `ADMIN_URL`.
5. Schedule the daily job with an external cron (e.g. cron-job.org) calling
   `POST https://app.your-domain.in/api/v1/cron/daily` with `Authorization: Bearer <CRON_SECRET>`.

Caveats: uploaded files are stored on the website disk (`STORAGE_LOCAL_DIR`) — make
sure it persists across deploys or use S3; whether Hostinger's builder handles the
pnpm workspace has not been verified.

## Android app

Build the release with `-PapiBaseUrl=https://app.your-domain.in` (see
[GOOGLE_PLAY_CHECKLIST.md](GOOGLE_PLAY_CHECKLIST.md)).
