# Deploy on Hostinger (Node.js hosting + managed MySQL)

Works on Hostinger **Business** or **Cloud** web hosting plans that include Node.js apps.
No Supabase, Firebase or other BaaS: Node.js app + Hostinger MySQL + files on the hosting disk.

> Hostinger's hPanel menus change from time to time. The names below are what to look for; if a
> label differs, the idea is the same. I can also do these steps for you through the Hostinger
> connector if you ask (it overwrites the site, so I'll confirm the domain first).

## 1. Database
1. hPanel → **Databases → MySQL databases** → create database + user (e.g. `u123_bizapp`). Save the password in your password manager.
2. Open phpMyAdmin once and check the version (top right): needs **MariaDB 10.6+** or **MySQL 8.0+**.
3. From the app, the database host is **`127.0.0.1`** (not the `srvNNNN.hstgr.io` name — that one is only for connecting from outside).

## 2. Node.js app
hPanel → **Websites → Add website → Node.js app** (or open your site → **Node.js**), connect GitHub repo `venuikkada/Business-app`, branch of your choice, and set:

| Setting | Value |
| --- | --- |
| Node version | 20 or 22 |
| Root / app directory | repository root (`/`) — the app uses the shared `packages/core` |
| Install + build command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @biz/pwa build && pnpm --filter @biz/api build` |
| Start command / entry file | `node apps/api/dist/server.js` (entry file: `apps/api/dist/server.js`) |

**No build on the server?** Build on your computer (`pnpm --filter @biz/pwa build && pnpm --filter @biz/api build`), zip
`apps/api/dist/`, upload it with File Manager, and set the entry file to `server.js`. All packages are bundled, so no `npm install` is needed.

## 3. Environment variables
hPanel → your site → **Node.js → Environment variables**. Copy every line of
[`apps/api/.env.example`](../../apps/api/.env.example) and fill in:

- `APP_ORIGIN` = `https://your-domain.in` (exactly, with https)
- `DB_NAME`, `DB_USER`, `DB_PASSWORD` from step 1; `DB_HOST=127.0.0.1`
- `JWT_SECRET`, `OTP_SECRET`, `CRON_SECRET`: each a different random 64-character hex string
- `DATA_ENCRYPTION_KEY`: random 64-character hex string — **keep a copy offline; without it backups cannot be opened**
- `SMS_PROVIDER=msg91`, `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID` (DLT-approved template with variable `otp`)
- `STORAGE_DIR=/home/<your-user>/bizapp-storage` — **outside** `public_html`
- `MIGRATE_ON_START=true` — creates/updates tables automatically on each start

Make random secrets on your computer:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Restart the app. Check `https://your-domain.in/api/v1/health` → `{"data":{"ok":true,…}}`.

**Check the real visitor IP is seen** (OTP and login limits are per IP): sign in, open
**My account → Signed-in devices**. The IP shown must be your phone's public IP. If it shows a
private address (`10.x`, `172.16–31.x`, `192.168.x`, `127.0.0.1`), Hostinger has one more proxy in
front: set `TRUST_PROXY=2` and restart. Otherwise every visitor would share one IP and hit the limits together.

## 4. Cron (background jobs) — every minute
hPanel → **Advanced → Cron jobs** → Custom, every minute (`* * * * *`):

```bash
curl -fsS -m 70 -X POST -H "X-Cron-Key: YOUR_CRON_SECRET" https://your-domain.in/api/v1/internal/cron > /dev/null
```

This runs due jobs for at most ~50 seconds (exports, daily encrypted backups, subscription expiry,
clean-up; reminders, low-stock digests and bulk imports arrive in Step 2). If your plan allows running
Node in cron with the same environment variables, `node apps/api/dist/cron.js` does the same thing.

## 5. Domain & HTTPS
Point your domain to the site and turn on the free SSL in hPanel. `APP_ORIGIN` must match the final https address.

## 6. After every release
- Push to the branch → Hostinger rebuilds → app restarts → `MIGRATE_ON_START` applies new migrations (one process at a time, using a database lock).
- Check `/api/v1/health`.
- Keep Hostinger's own daily backups switched on; our encrypted per-business backups are an extra copy in `STORAGE_DIR/backups/`.

## Limits to know
- Each request must finish within 120 seconds (server enforces it). Long work goes through the job queue.
- Live updates use polling every 15 seconds (no WebSockets), which shared hosting handles well.
- One Hostinger plan has limited CPU/RAM; with many busy shops, move to a Cloud plan or VPS — no code change needed.
