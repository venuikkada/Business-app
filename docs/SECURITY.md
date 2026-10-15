# Security

This describes the controls that are **implemented and tested**. Items that still
need work are listed at the end and in [STATUS.md](STATUS.md).

## Tenant isolation (defence in depth)

1. **Server authorisation.** Every tenant request runs through `withTenant`, which
   checks membership, role permissions and plan features before any query.
2. **Row-level security.** Every tenant table has RLS policies on
   `business_id = app.current_business_id()`. The running app connects as `cba_app`,
   which does not own tables and has `NOBYPASSRLS`. Context is set per transaction
   with `set_config(..., true)`, so a pooled connection can't leak it.
3. **Composite foreign keys** `(business_id, id)` make cross-business references
   impossible even if application code passed a foreign id.
4. **Super-admin separation.** The admin app connects as `cba_platform`, which has
   **no grants on tenant tables**. It sees only aggregate stats through a
   `SECURITY DEFINER` function. Reading a business's data requires a support grant
   the owner approves; it expires and gives read-only access, and every use is audited.

Tested: `acceptance.test.ts` "2. tenant isolation" (API + raw SQL as the app role +
platform role), `security.test.ts` support-access tests, Playwright cross-tenant test.

## Authentication

- Passwords: scrypt (N=2^15, r=8, p=1), unique salt, min 10 chars with letters and digits.
- Sessions: random 256-bit tokens (`cba_…`); only their SHA-256 is stored. Web: httpOnly,
  Secure (prod), SameSite=Lax cookie, 30 days sliding. Mobile: Bearer, 90 days.
  Admin: separate cookie, 12 hours, TOTP mandatory.
- Lockout: 10 failed logins → 15-minute lock. Rate limits (DB-backed, work across
  instances): login per IP and per email, registration, forgot-password, verification,
  password change, invitations. Errors are generic ("Invalid email or password").
- Password reset tokens are single-use, expire, and revoke all other sessions.
- Optional TOTP 2FA for business users; secrets encrypted with AES-256-GCM using a
  key derived (HKDF) from `APP_SECRET`.
- Account deletion anonymises the user; owners must delete or hand over their business first.

## Authorisation (RBAC)

- Permissions are `resource.action` strings (`invoices.create`, `financials.view`, …).
  System roles: owner, admin, manager, accountant, salesperson, inventory, technician;
  Business plan can create custom roles.
- Checked on the server for every route. The UI hides what you can't do, but hiding is
  never the protection.
- Users cannot grant permissions they don't have, cannot demote/remove the last owner.
- Cost price, profit and cash figures require `financials.view`.
- Approvals: discounts above a threshold / negative stock need an owner/manager; an
  approval is bound to the exact payload (canonical JSON) and is single-use.

## Web protections

- CSRF: cookie-authenticated writes require the `x-cba-csrf: 1` header **and** a
  matching `Origin`. Bearer requests are not cookie-based and skip this.
- Security headers: strict CSP (self + Razorpay checkout), `frame-ancestors 'none'`,
  `X-Content-Type-Options`, `Referrer-Policy`, HSTS in production, `Permissions-Policy`.
- Admin app sends `X-Robots-Tag: noindex` and can be IP-restricted (`ADMIN_ALLOWED_IPS`).
- File uploads: size limits, type detected from magic bytes (not the file name),
  stored outside the web root, served only to members of the owning business.
- CSV exports neutralise spreadsheet formulas (`=`, `+`, `-`, `@` prefixes).
- Public share links use random tokens, show only that one document, can be revoked.

## Payments

- No card or UPI credentials ever touch our servers — Razorpay Checkout handles them.
- A plan is activated only after (a) the HMAC signature verifies **and** (b) the server
  fetches the payment from Razorpay and confirms amount, currency and status. The
  client's "success" callback is never trusted. Webhooks verify their signature and
  are de-duplicated by event id.
- Tested with signature vectors and a mocked gateway (`security.test.ts`). **Not yet
  tested against live Razorpay.**

## Audit

`audit_logs` (per business) and `platform_audit_logs` (admin actions) are append-only:
the app roles have no UPDATE/DELETE, and a trigger blocks changes even for the owner role.
Logged: sign-ins, role changes, invoices issued/cancelled, payments recorded/voided, stock
overrides, approvals, exports, settings changes, support access, plan overrides.

## Secrets

All secrets are server-side environment variables (see `.env.example`). The Android
app contains only the public API base URL. The browser receives only the Razorpay
**key id** (public by design). Never commit `.env*.local`, `keystore.properties` or keystores.

## Known gaps / to do before launch

- Get an independent penetration test and fix findings.
- Rate limiting keys on the first `X-Forwarded-For` address. Deploy behind a proxy
  that overwrites this header (Vercel, Cloudflare, nginx with `real_ip`); otherwise
  per-IP limits can be bypassed (per-email limits still apply).
- No malware scanning of uploaded files yet (uploads are restricted to PNG/JPEG/WebP images and PDFs, 5 MB max).
- No WAF / bot protection on sign-up yet (consider Cloudflare Turnstile).
- Encryption at rest depends on the managed Postgres / object-storage provider.
- Legal texts (`/privacy`, `/terms`) are templates — have a lawyer review them for the
  DPDP Act 2023 before launch.
