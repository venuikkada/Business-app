# Security checklist — Step 1

Legend: ✅ done and covered by an automated test · ☑️ done (no automated test) · ⚠️ partly done · ⬜ not done yet / needs you

## Input validation
- ✅ Every request body and query string is checked with a schema (zod) before any code runs. Bad input → `400 validation_failed` with field messages.
- ✅ GSTIN: format + state code + checksum; GSTIN state must match the business/branch state; PAN must match GSTIN.
- ✅ Indian mobile numbers normalised to `+91XXXXXXXXXX`; anything else rejected.
- ✅ Route ids must be numeric; ids from another business return 404.
- ☑️ SQL: only parameterised queries (named placeholders, escaped by the driver). Column names in dynamic `UPDATE`s come from fixed allow-lists in code, never from the request.
- ☑️ JSON body limit 1 MB; uploads 5 MB max (1 MB for logos).

## Who can do what (role checks on every API)
- ✅ Every route must declare `public`, `signed in`, or a permission — the server refuses to start a route without one, and a test lists all public routes so a new public route cannot slip in unnoticed.
- ✅ Membership, role, permissions and branch access are re-read on **every** request, so a role change or "disable" works on the very next click.
- ✅ Tenant isolation: queries must contain `:tenantId` (enforced in code), the value always comes from the session, and composite foreign keys make MySQL reject cross-business links. Tested: user of business A gets 403/404 for everything in business B.
- ✅ No privilege escalation: you can only give permissions you hold; only an owner can create/change owners; subscription permission is owner-only.
- ✅ Owner protection: nobody can change their own role/status; a business always keeps ≥ 1 active owner.
- ✅ Branch restriction per team member.
- ✅ Expired plan → read-only (writes return 402), data still visible and exportable.

## Sign-in (built ourselves, no BaaS)
- ✅ OTP: 6 digits from a crypto-secure random source; only an HMAC-SHA256 of the code is stored; valid 5 minutes; single use; max 5 wrong tries per code.
- ✅ **OTP rate limits** (stored in MySQL, survive restarts): 1 per 30 s per number, 5 per hour, 10 per day; 20 per hour per IP; 10 verify attempts per hour per number; **platform-wide daily cap** (`OTP_GLOBAL_DAILY_LIMIT`, default 3000) so bots cannot burn your SMS credit.
- ✅ "Forgot password" never reveals whether a number is registered.
- ✅ Passwords: bcrypt (cost 12); min 8 chars with letters + numbers; common passwords refused; max 72 chars (bcrypt limit).
- ✅ Wrong password 10 times in a row → account locked 15 minutes (OTP still works). Also per-IP (30 / 15 min) and per-account (15 / 15 min) limits.
- ✅ Same error for "no such account" and "wrong password", and the same time taken (dummy bcrypt check).
- ✅ Access token: JWT (HS256, 15 min) in an **httpOnly** cookie — JavaScript cannot read it.
- ✅ Refresh token: random 256-bit, httpOnly, `SameSite=Strict`, sent only to `/api/v1/auth`; only its SHA-256 is stored; **rotated on every use**; re-using an old one signs that device out (theft detection, 30 s grace for two tabs).
- ✅ Sessions: 30 days idle, 90 days maximum; revoke one device or all others; logout, password change and password reset revoke sessions immediately.
- ✅ CSRF: double-submit token (cookie + `X-CSRF-Token` header) **and** Origin check on every POST/PATCH/PUT/DELETE.
- ☑️ Security log (`auth_events`) of every sign-in, failure, lockout, reset and token re-use, with masked mobile/email.

## Data protection
- ✅ **Encrypted backups**: daily per-business export, gzip + AES-256-GCM (authenticated encryption) with `DATA_ENCRYPTION_KEY`; last 14 kept; test decrypts one and checks it contains only that business.
- ☑️ Same encryption helper ready for sensitive columns (employee bank account) and integration keys (Step 2+).
- ☑️ Aadhaar: only the last 4 digits are stored (by design of the schema).
- ✅ Audit log is append-only (database triggers block UPDATE/DELETE) and passwords/tokens/hashes are masked in the stored "before/after" values.
- ✅ CSV exports neutralise spreadsheet formulas (`=`, `+`, `-`, `@` at the start of a cell).

## Files
- ✅ File type checked from the real bytes (PNG/JPEG/WebP/PDF signatures), not the file name; SVG/HTML refused.
- ✅ Size limits enforced (1 MB logo, 5 MB others).
- ✅ Stored outside the website folder under `STORAGE_DIR/t_<tenantId>/…` with random names; path traversal blocked.
- ✅ Downloads only through the API, only for members of the same business (and payslips/exports need extra permission); served with `nosniff`, a sandboxing CSP and `attachment` for non-images.

## Server & secrets
- ✅ All secrets come from environment variables, checked at start-up (app refuses to start if one is missing/too short). Production refuses the console SMS provider and a non-https `APP_ORIGIN`.
- ☑️ `.env` files are git-ignored; `.env.example` has no real values.
- ☑️ Security headers (helmet): Content-Security-Policy (no inline scripts), `frame-ancestors 'none'`, HSTS (production), `nosniff`, `Referrer-Policy: no-referrer`, no `X-Powered-By`.
- ☑️ API responses `Cache-Control: no-store`; the service worker never caches `/api`.
- ☑️ General limit: 600 requests/min per IP (in memory).
- ☑️ Errors never show stack traces or SQL to users; every response has an `X-Request-Id` for support.
- ☑️ No request may run longer than 120 s (server timeout). Long work (exports, backups, bulk import) runs in the cron job queue with a 50 s budget per run.
- ✅ The tests run the app with a database user that has **only SELECT/INSERT/UPDATE/DELETE** — the app never needs to alter tables.
- ✅ Cron HTTP endpoint needs a secret header (constant-time compare); wrong key looks like 404.
- ✅ `pnpm audit`: no known advisories in the new apps' dependencies (checked 12/11/2026 after upgrading multer, mysql2, react-router).

## Before going live (not done yet)
- ⬜ **You:** register a DLT entity + OTP template with your SMS provider (MSG91 or similar). MSG91 code is written but **not tested with live keys**.
- ⬜ **You:** keep a copy of `DATA_ENCRYPTION_KEY` somewhere safe and offline (password manager). Lose it = backups cannot be opened.
- ⬜ Copy encrypted backups **off the server** (e.g. Google Drive / another host). Today they sit on the same disk as the app; Hostinger's own daily backups are the second copy.
- ⬜ Bot protection on the OTP form (e.g. Cloudflare Turnstile) if you see SMS abuse.
- ⬜ Uptime monitor on `/api/v1/health` (free UptimeRobot) and alerts.
- ⬜ Two-factor login for owners (later).
- ⬜ Key rotation for `JWT_SECRET` / `DATA_ENCRYPTION_KEY` (format is versioned `v1:` so it can be added).
- ⬜ Privacy policy & consent per the DPDP Act 2023 (lawyer), and an external security test before launch.
- ⚠️ If Hostinger's DB user cannot create triggers, the audit log is protected by the app only (no DB-level block). Check `schema_migrations` after the first deploy.
